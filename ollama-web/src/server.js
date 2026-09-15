'use strict';

/**
 * Serveur HTTP : fichiers statiques + API JSON + streaming SSE.
 * Zéro dépendance (module `http` natif uniquement).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('./auth');
const providers = require('./providers');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sseOpen(res, extraHeaders = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...extraHeaders,
  });
  res.write(': connected\n\n');
}

function sseSend(res, event) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    /* client parti */
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'inconnu';
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    let drained = 0;
    req.on('data', (chunk) => {
      if (overflow) {
        // On vide le reste du corps sans le stocker (afin que la réponse 413
        // puisse être délivrée), puis on coupe si le client insiste vraiment.
        drained += chunk.length;
        if (drained > 8 * 1024 * 1024) req.destroy();
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        overflow = true;
        const error = new Error('Corps de requête trop volumineux');
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) return undefined;
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        const error = new Error('JSON invalide');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function publicProvider(provider) {
  let host = provider.baseUrl;
  try {
    const url = new URL(provider.baseUrl);
    url.username = '';
    url.password = '';
    host = url.toString().replace(/\/+$/, '');
  } catch {
    /* garde la chaîne brute */
  }
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    baseUrl: host,
    hint: provider.hint || '',
    allowPull: Boolean(provider.allowPull),
    hasKey: Boolean(provider.apiKey),
    defaultModel: provider.defaultModel || '',
    isLocal: !provider.remote,
  };
}

async function serveStatic(config, req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(config.publicDir, relative);
  if (!target.startsWith(path.resolve(config.publicDir))) {
    return json(res, 403, { error: 'forbidden' });
  }
  let filePath = target;
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // SPA : toute route inconnue renvoie l'application
    filePath = path.join(config.publicDir, 'index.html');
  }
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': isHtml ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    json(res, 404, { error: 'not_found', message: 'Fichier introuvable' });
  }
}

function createServer(options = {}) {
  const config = options.config;
  const probeCache = new Map();
  const requestCounters = new Map();
  const loginLimiter = auth.createAttemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  function rateLimit(ip) {
    if (!config.rateLimitPerMinute) return { allowed: true };
    const now = Date.now();
    const entry = requestCounters.get(ip);
    if (!entry || now > entry.resetAt) {
      requestCounters.set(ip, { count: 1, resetAt: now + 60000 });
      return { allowed: true };
    }
    entry.count += 1;
    if (entry.count > config.rateLimitPerMinute) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    return { allowed: true };
  }

  function findProvider(id) {
    if (!config.providers.length) return null;
    if (id) return config.providers.find((p) => p.id === id) || null;
    return config.providers.find((p) => p.id === config.defaultProviderId) || config.providers[0];
  }

  async function probeAll({ force = false, timeoutMs = 4000 } = {}) {
    const now = Date.now();
    const results = await Promise.all(
      config.providers.map(async (provider) => {
        const cached = probeCache.get(provider.id);
        if (!force && cached && cached.expiresAt > now) return cached.value;
        const value = await providers.probe(provider, { timeoutMs });
        probeCache.set(provider.id, { value, expiresAt: Date.now() + 30000 });
        return value;
      }),
    );
    return results;
  }

  async function bestProviderId() {
    if (config.defaultProviderId) {
      const probes = await probeAll();
      const wanted = probes.find((p) => p.id === config.defaultProviderId);
      if (wanted?.reachable) return wanted.id;
      const firstReachable = probes.find((p) => p.reachable);
      return firstReachable?.id || config.defaultProviderId;
    }
    const probes = await probeAll();
    return probes.find((p) => p.reachable)?.id || null;
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();
    const ip = clientIp(req);

    res.on('finish', () => {
      if (!config.verbose) return;
      const ms = Date.now() - started;
      const line = `${method} ${pathname}${url.search} → ${res.statusCode} (${ms} ms)`;
      if (res.statusCode >= 400) console.warn(`  ✗ ${line}`);
      else console.log(`  · ${line}`);
    });

    try {
      // ---------- santé (pour Render, UptimeRobot, Docker HEALTHCHECK) ----
      if (pathname === '/healthz') {
        return json(res, 200, { status: 'ok', uptimeMs: Date.now() - config.startedAt, version: config.version });
      }

      if (pathname === '/api/health') {
        const probes = await probeAll({ force: url.searchParams.get('force') === '1' });
        const anyReachable = probes.some((p) => p.reachable);
        return json(res, 200, {
          status: anyReachable ? 'ok' : 'degraded',
          version: config.version,
          uptimeMs: Date.now() - config.startedAt,
          providers: probes,
        });
      }

      if (pathname === '/api/version') {
        return json(res, 200, {
          name: config.appName,
          version: config.version,
          node: process.version,
          uptimeMs: Date.now() - config.startedAt,
        });
      }

      // ---------- session / configuration ---------------------------------
      if (pathname === '/api/config') {
        const authenticated = auth.isAuthenticated(config, req);
        if (!authenticated) {
          return json(res, 200, {
            authRequired: true,
            authenticated: false,
            name: config.appName,
            version: config.version,
          });
        }
        const providerList = config.providers.map(publicProvider);
        return json(res, 200, {
          authRequired: Boolean(config.appPassword),
          authenticated: true,
          name: config.appName,
          version: config.version,
          node: process.version,
          providers: providerList,
          defaultProviderId: config.defaultProviderId,
          recommendedProviderId: await bestProviderId(),
          allowPull: config.allowPull,
          systemPrompt: config.systemPrompt,
          limits: {
            maxMessages: config.maxMessages,
            maxBodyBytes: config.maxBodyBytes,
            requestTimeoutMs: config.requestTimeoutMs,
          },
        });
      }

      if (pathname === '/api/session') {
        return json(res, 200, { authenticated: auth.isAuthenticated(config, req), authRequired: Boolean(config.appPassword) });
      }

      if (pathname === '/api/login') {
        if (method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
        const limit = loginLimiter.check(ip);
        if (!limit.allowed) {
          return json(res, 429, {
            error: 'too_many_attempts',
            message: 'Trop de tentatives. Réessayez dans quelques minutes.',
          });
        }
        const body = await readBody(req, config.maxBodyBytes);
        if (!auth.checkPassword(config, body.password)) {
          return json(res, 401, { error: 'bad_password', message: 'Mot de passe incorrect' });
        }
        loginLimiter.reset(ip);
        const token = auth.createSessionToken(config);
        return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(config, token) });
      }

      if (pathname === '/api/logout') {
        return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
      }

      // ---------- à partir d'ici : authentification requise ----------------
      // Les fichiers statiques restent publics : c'est l'application qui
      // affiche l'écran de connexion. Seules les données sont protégées.
      if (pathname.startsWith('/api/') && !auth.isAuthenticated(config, req)) {
        return json(res, 401, { error: 'unauthorized', message: 'Mot de passe requis' });
      }

      if (pathname === '/api/models') {
        const provider = findProvider(url.searchParams.get('provider'));
        if (!provider) return json(res, 400, { error: 'no_provider', message: 'Aucun fournisseur configuré' });
        const result = await providers.listModels(provider, { timeoutMs: 15000 });
        return json(res, 200, {
          providerId: provider.id,
          ok: result.ok,
          error: result.error || null,
          latencyMs: result.latencyMs,
          models: result.models,
          suggested: providers.suggestedModel(provider, result.models),
        });
      }

      if (pathname === '/api/chat') {
        if (method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
        const limit = rateLimit(ip);
        if (!limit.allowed) {
          return json(res, 429, { error: 'rate_limited', message: 'Trop de requêtes, patientez un instant.' });
        }
        const body = await readBody(req, config.maxBodyBytes);
        const provider = findProvider(body.providerId);
        if (!provider) return json(res, 400, { error: 'no_provider', message: 'Aucun fournisseur configuré' });
        const model = String(body.model || provider.defaultModel || '').trim();
        if (!model) return json(res, 400, { error: 'no_model', message: 'Choisissez un modèle' });

        const messages = providers.sanitizeMessages(body.messages, {
          maxMessages: config.maxMessages,
          maxContextChars: config.maxContextChars,
        });
        if (!messages.length) return json(res, 400, { error: 'empty', message: 'Message vide' });

        const controller = new AbortController();
        req.on('close', () => controller.abort());

        sseOpen(res);
        sseSend(res, { type: 'start', providerId: provider.id, providerLabel: provider.label, model });

        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 15000);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();

        try {
          await providers.chatStream(
            provider,
            { model, messages, options: body.options || {} },
            {
              signal: controller.signal,
              timeoutMs: config.requestTimeoutMs,
              onEvent: (event) => sseSend(res, event),
            },
          );
        } catch (error) {
          const friendly = providers.friendlyError(error, provider);
          sseSend(res, {
            type: 'error',
            message: error.message && !error.status ? error.message : friendly.message,
            hint: friendly.hint,
            status: error.status || 502,
          });
        } finally {
          clearInterval(heartbeat);
          if (!res.writableEnded) res.end();
        }
        return undefined;
      }

      if (pathname === '/api/pull') {
        if (method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
        if (!config.allowPull) {
          return json(res, 403, { error: 'pull_disabled', message: 'Téléchargement désactivé (ALLOW_PULL=false)' });
        }
        const pullLimit = rateLimit(ip);
        if (!pullLimit.allowed) {
          return json(res, 429, { error: 'rate_limited', message: 'Trop de requêtes, patientez un instant.' });
        }
        const body = await readBody(req, config.maxBodyBytes);
        const provider = findProvider(body.providerId);
        if (!provider) return json(res, 400, { error: 'no_provider' });
        const model = String(body.model || '').trim();
        if (!model) return json(res, 400, { error: 'no_model', message: 'Indiquez le nom du modèle à télécharger' });

        const controller = new AbortController();
        req.on('close', () => controller.abort());

        sseOpen(res);
        sseSend(res, { type: 'start', providerId: provider.id, model });
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 15000);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();
        try {
          await providers.pullStream(provider, model, {
            signal: controller.signal,
            onEvent: (event) => sseSend(res, event),
          });
        } catch (error) {
          const friendly = providers.friendlyError(error, provider);
          sseSend(res, { type: 'error', message: friendly.message, hint: friendly.hint });
        } finally {
          clearInterval(heartbeat);
          if (!res.writableEnded) res.end();
        }
        return undefined;
      }

      if (pathname.startsWith('/api/')) {
        return json(res, 404, { error: 'not_found', message: `Route inconnue : ${pathname}` });
      }

      if (method === 'GET' || method === 'HEAD') {
        return await serveStatic(config, req, res, pathname);
      }

      return json(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error('Erreur serveur :', error);
      if (!res.headersSent) {
        json(res, status, { error: 'server_error', message: error.message || 'Erreur interne' });
      } else if (!res.writableEnded) {
        res.end();
      }
      return undefined;
    }
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.config = config;
  return server;
}

module.exports = { createServer };
