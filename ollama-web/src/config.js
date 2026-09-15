'use strict';

/**
 * Chargement de la configuration.
 *
 * Aucune dépendance externe : `.env` est lu à la main (dotenv-like) pour que
 * le projet puisse démarrer même sur une machine sans `npm install`.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

const VERSION = '1.0.0';
const APP_NAME = 'Ollama Web';

/** Lit un fichier .env et injecte les variables manquantes dans process.env. */
function loadDotEnv(file = path.join(ROOT, '.env')) {
  try {
    if (!fs.existsSync(file)) return false;
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

function str(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function int(name, fallback) {
  const value = Number.parseInt(str(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback = false) {
  const value = str(name).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'y', 'oui', 'on'].includes(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBaseUrl(url) {
  let value = String(url || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, '');
}

/**
 * PROVIDERS_EXTRA : une ligne par fournisseur, séparateur "|"
 *   id|libellé|type(ollama|openai)|url|clé|modèle
 * Les lignes peuvent être séparées par des retours à la ligne ou des ";".
 */
function parseExtraProviders(raw) {
  const out = [];
  if (!raw) return out;
  for (const chunk of String(raw).split(/[\n;]+/)) {
    const line = chunk.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    const [id, label, kind, baseUrl, apiKey, model] = parts;
    if (!baseUrl) continue;
    const type = (kind || 'ollama').toLowerCase() === 'openai' ? 'openai' : 'ollama';
    out.push({
      id: (id || `extra-${out.length + 1}`).replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
      label: label || id || 'Fournisseur',
      kind: type,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: apiKey || '',
      defaultModel: model || '',
      allowPull: type === 'ollama',
      hint: 'Fournisseur personnalisé',
      env: true,
    });
  }
  return out;
}

function buildConfig(overrides = {}) {
  const providers = [];

  const cloudKey = str('OLLAMA_CLOUD_API_KEY');
  if (cloudKey) {
    providers.push({
      id: 'cloud',
      label: 'Ollama Cloud',
      kind: 'ollama',
      baseUrl: normalizeBaseUrl(str('OLLAMA_CLOUD_URL', 'https://ollama.com')),
      apiKey: cloudKey,
      defaultModel: str('OLLAMA_CLOUD_MODEL'),
      allowPull: false,
      hint: "Modèles hébergés par Ollama (compte gratuit)",
      remote: true,
    });
  }

  const remoteUrl = normalizeBaseUrl(str('OLLAMA_REMOTE_URL'));
  if (remoteUrl) {
    providers.push({
      id: 'remote',
      label: str('OLLAMA_REMOTE_LABEL', 'Ollama distant'),
      kind: 'ollama',
      baseUrl: remoteUrl,
      apiKey: str('OLLAMA_REMOTE_API_KEY'),
      defaultModel: str('OLLAMA_REMOTE_MODEL'),
      allowPull: true,
      hint: 'Serveur Ollama exposé (Colab, VPS, PC maison…)',
      remote: true,
    });
  }

  const disableLocal = bool('DISABLE_LOCAL_PROVIDER');
  const localUrl = normalizeBaseUrl(str('OLLAMA_LOCAL_URL', 'http://127.0.0.1:11434'));
  if (!disableLocal && localUrl) {
    providers.push({
      id: 'local',
      label: 'Ollama local',
      kind: 'ollama',
      baseUrl: localUrl,
      apiKey: str('OLLAMA_LOCAL_API_KEY'),
      defaultModel: str('OLLAMA_LOCAL_MODEL'),
      allowPull: true,
      hint: "Ollama installé sur cette machine (http://localhost:11434)",
      remote: false,
    });
  }

  const openaiUrl = normalizeBaseUrl(str('OPENAI_BASE_URL'));
  if (openaiUrl) {
    providers.push({
      id: 'openai',
      label: str('OPENAI_LABEL', 'API compatible OpenAI'),
      kind: 'openai',
      baseUrl: openaiUrl,
      apiKey: str('OPENAI_API_KEY'),
      defaultModel: str('OPENAI_MODEL'),
      allowPull: false,
      hint: 'API compatible OpenAI (Groq, OpenRouter, LM Studio…)',
      remote: true,
    });
  }

  for (const extra of parseExtraProviders(str('PROVIDERS_EXTRA'))) {
    if (!providers.some((p) => p.id === extra.id)) providers.push(extra);
  }

  const requestedDefault = str('DEFAULT_PROVIDER');
  const defaultProviderId =
    (requestedDefault && providers.some((p) => p.id === requestedDefault) && requestedDefault) ||
    (providers.find((p) => p.id === 'cloud') && 'cloud') ||
    (providers.find((p) => p.id === 'remote') && 'remote') ||
    (providers[0] && providers[0].id) ||
    null;

  const sessionSecret =
    str('SESSION_SECRET') || crypto.randomBytes(32).toString('hex');

  const config = {
    appName: APP_NAME,
    version: VERSION,
    root: ROOT,
    publicDir: path.join(ROOT, 'public'),
    port: int('PORT', int('OLLAMA_WEB_PORT', 3000)),
    host: str('HOST', '0.0.0.0'),
    providers,
    defaultProviderId,
    allowPull: bool('ALLOW_PULL', true),
    appPassword: str('APP_PASSWORD'),
    sessionSecret,
    sessionSecretGenerated: !str('SESSION_SECRET'),
    sessionTtlMs: clamp(int('SESSION_TTL_DAYS', 30), 1, 365) * 24 * 60 * 60 * 1000,
    systemPrompt: str('SYSTEM_PROMPT', 'Tu es un assistant francophone, précis et concis.'),
    requestTimeoutMs: clamp(int('REQUEST_TIMEOUT_MS', 300000), 5000, 900000),
    maxMessages: clamp(int('MAX_MESSAGES', 60), 2, 400),
    maxBodyBytes: clamp(int('MAX_BODY_KB', 512), 8, 8192) * 1024,
    maxContextChars: clamp(int('MAX_CONTEXT_CHARS', 48000), 2000, 1000000),
    rateLimitPerMinute: clamp(int('RATE_LIMIT_PER_MINUTE', 60), 0, 10000),
    verbose: bool('VERBOSE', true),
    envFileLoaded: false,
    startedAt: Date.now(),
  };

  return { ...config, ...overrides };
}

module.exports = {
  VERSION,
  APP_NAME,
  loadDotEnv,
  buildConfig,
  normalizeBaseUrl,
  parseExtraProviders,
};
