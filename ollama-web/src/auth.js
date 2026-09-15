'use strict';

/**
 * Authentification minimaliste par mot de passe partagé (APP_PASSWORD).
 * Session = cookie signé HMAC, aucune dépendance, aucun stockage serveur.
 */

const crypto = require('node:crypto');

const COOKIE_NAME = 'ow_session';

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionToken(config) {
  const expires = Date.now() + config.sessionTtlMs;
  const payload = String(expires);
  return `${payload}.${sign(config.sessionSecret, payload)}`;
}

function verifySessionToken(config, token) {
  if (!token || typeof token !== 'string') return false;
  const index = token.lastIndexOf('.');
  if (index <= 0) return false;
  const payload = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(signature, sign(config.sessionSecret, payload));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sessionCookie(config, token) {
  const maxAge = Math.floor(config.sessionTtlMs / 1000);
  const secure = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isAuthenticated(config, req) {
  if (!config.appPassword) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(config, cookies[COOKIE_NAME]);
}

function checkPassword(config, candidate) {
  if (!config.appPassword) return true;
  return safeEqual(candidate || '', config.appPassword);
}

/** Anti brute-force très simple : N tentatives par IP et par fenêtre. */
function createAttemptLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: max - 1 };
      }
      entry.count += 1;
      if (entry.count > max) {
        return { allowed: false, retryAfterMs: entry.resetAt - now };
      }
      return { allowed: true, remaining: max - entry.count };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = {
  COOKIE_NAME,
  checkPassword,
  clearCookie,
  createAttemptLimiter,
  createSessionToken,
  isAuthenticated,
  parseCookies,
  sessionCookie,
  verifySessionToken,
};
