// ============================================================
// ZachServices — Utilitaires de formatage
// ============================================================

const CURRENCY = require('../config').currency;

/** Formate un montant : 1234567 -> "1 234 567 🪙" */
function fmtCoins(amount) {
  const n = Number(amount || 0);
  return `${n.toLocaleString('fr-FR')} ${CURRENCY}`;
}

/** Formate une durée en "X j HH h MM min SS s" (parties nulles masquées) */
function fmtTimeLeft(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} j`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} min`);
  if (days === 0 && hours === 0) parts.push(`${seconds} s`);
  return parts.join(' ') || 'quelques secondes';
}

/** Date locale lisible : "30/08/2026 à 14:32" */
function fmtDate(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Discord timestamp relatif (<t:...:R>) — s'affiche "dans 23 heures" dans Discord */
function discordRelative(ts) {
  return `<t:${Math.floor(ts / 1000)}:R>`;
}

/**
 * Troncature SÛRE par points de code (et non par unités UTF-16) :
 * String.slice() peut couper un emoji en plein milieu d'une paire de
 * substitution et produire un caractère orphelin que l'API Discord rejette.
 * Discord comptant ses limites en unités UTF-16, on retire ensuite des
 * points de code entiers jusqu'à respecter la limite des deux façons.
 */
function cut(text, maxLength) {
  const cps = Array.from(String(text ?? ''));
  if (cps.length > maxLength) cps.length = maxLength;
  let str = cps.join('');
  while (str.length > maxLength) {
    cps.pop(); // retire un point de code ENTIER (jamais une moitié d'emoji)
    str = cps.join('');
  }
  return str;
}

module.exports = { fmtCoins, fmtTimeLeft, fmtDate, discordRelative, cut };
