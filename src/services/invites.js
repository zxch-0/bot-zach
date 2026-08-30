// ============================================================
// ZachServices — Tracking des invitations (intégré, sans bot externe)
//
// Principe : le bot photographie tous les liens d'invitation du serveur
// (code -> nombre d'utilisations). Quand un membre arrive, on compare
// l'ancienne et la nouvelle photo : le lien dont le compteur a augmenté
// est celui utilisé => son créateur est crédité d'une invitation réussie.
//
// Deux pièges gérés ici :
//  1. Arrivées simultanées : les attributions sont SÉRIALISÉES par serveur
//     (sinon deux events concurrents lisent le même snapshot et créditent
//     le mauvais inviteur).
//  2. Invitations à usage unique : Discord SUPPRIME le lien dès qu'il est
//     utilisé. On garde donc une mémoire courte des liens récemment
//     supprimés : si aucun compteur n'a bougé et qu'UN SEUL lien a été
//     supprimé dans les dernières secondes, c'est lui qui a servi.
//
// ⚠️ Prérequis : intent "Server Members" + permission "Gérer le serveur".
// Une invitation réussie = un membre rejoint via ton lien ET toujours
// présent. S'il repart, le compteur redescend.
// ============================================================

// guildId -> Map(code -> { uses, inviterId }) + vanity
const snapshots = new Map();

// guildId -> true si le tracking fonctionne (permission présente)
const trackingOk = new Map();

// guildId -> chaîne de promesses : sérialise les attributions concurrentes
const attributionQueues = new Map();

// guildId -> Map(code -> { inviterId, ts }) : liens récemment supprimés
const recentDeleted = new Map();
const RECENT_DELETED_TTL_MS = 30_000; // fenêtre d'attribution
const RECENT_DELETED_MAX = 100; // taille maximale de la mémoire

function setSnapshot(guildId, invitesMap, vanityUses = null) {
  snapshots.set(guildId, { invites: invitesMap, vanityUses });
}

function getSnapshot(guildId) {
  return snapshots.get(guildId) || { invites: new Map(), vanityUses: null };
}

/** Snapshot en mémoire (sans requête Discord) — utilisé par les events inviteCreate/Delete */
function updateSnapshot(guildId, invitesMap, vanityUses) {
  const current = getSnapshot(guildId);
  setSnapshot(guildId, invitesMap, vanityUses ?? current.vanityUses);
}

/** Sérialise une tâche par serveur : les arrivées simultanées sont traitées l'une après l'autre. */
function enqueueAttribution(guildId, task) {
  const previous = attributionQueues.get(guildId) || Promise.resolve();
  const run = previous.then(task, task); // la tâche s'exécute même si la précédente a échoué
  attributionQueues.set(
    guildId,
    run.catch(() => {})
  );
  return run;
}

/* ---------- Mémoire des invitations récemment supprimées ---------- */

function rememberDeletedInvite(guildId, code, inviterId) {
  let map = recentDeleted.get(guildId);
  if (!map) {
    map = new Map();
    recentDeleted.set(guildId, map);
  }
  // limite de taille (par acquit de conscience sur de très gros serveurs)
  if (map.size >= RECENT_DELETED_MAX) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(code, { inviterId, ts: Date.now() });
}

/** Candidats supprimés récemment (et toujours absents des invitations actuelles). */
function recentDeletedCandidates(guildId, freshMap) {
  const map = recentDeleted.get(guildId);
  if (!map) return [];
  const now = Date.now();
  const candidates = [];
  for (const [code, info] of map) {
    if (now - info.ts > RECENT_DELETED_TTL_MS) {
      map.delete(code); // nettoyage au passage
      continue;
    }
    if (!freshMap.has(code)) candidates.push({ code, ...info });
  }
  return candidates;
}

/**
 * Récupère tous les liens d'invitation du serveur.
 * Retourne null si le bot n'a pas la permission "Gérer le serveur".
 */
async function fetchGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    for (const invite of invites.values()) {
      if (invite.inviter) {
        map.set(invite.code, { uses: invite.uses, inviterId: invite.inviter.id });
      }
    }
    return map;
  } catch (err) {
    console.warn(
      `[invitations] Impossible de lire les invitations de "${guild.name}" — ` +
        `le bot a-t-il la permission "Gérer le serveur" ? (${err.message})`
    );
    return null;
  }
}

async function fetchVanityUses(guild) {
  try {
    if (guild.vanityURLCode) {
      const vanity = await guild.fetchVanityURL();
      return vanity.uses;
    }
  } catch {}
  return null;
}

/**
 * Prend une photo complète des invitations du serveur (appelé au démarrage,
 * à l'arrivée du bot dans un serveur, et périodiquement).
 */
async function syncGuild(guild) {
  const invitesMap = await fetchGuildInvites(guild);
  if (invitesMap === null) {
    trackingOk.set(guild.id, false);
    return false;
  }
  trackingOk.set(guild.id, true);
  const vanityUses = await fetchVanityUses(guild);
  setSnapshot(guild.id, invitesMap, vanityUses);
  return true;
}

function isTrackingAvailable(guildId) {
  return trackingOk.get(guildId) === true;
}

/**
 * Détermine qui a invité un membre qui vient d'arriver (sérialisé par serveur).
 * Retourne { inviterId } ou null (lien vanity / introuvable).
 */
function attributeJoin(guild) {
  return enqueueAttribution(guild.id, () => doAttributeJoin(guild));
}

async function doAttributeJoin(guild) {
  const before = getSnapshot(guild.id);
  const fresh = await fetchGuildInvites(guild);
  if (fresh === null) {
    trackingOk.set(guild.id, false);
    return null;
  }
  trackingOk.set(guild.id, true);
  const freshVanity = await fetchVanityUses(guild);

  let inviterId = null;

  // 1) Un lien connu dont le compteur a monté
  for (const [code, info] of fresh) {
    const previous = before.invites.get(code);
    if (!previous || info.uses > previous.uses) {
      inviterId = info.inviterId;
      break;
    }
  }
  // 2) Un lien créé après le dernier snapshot (déjà utilisé)
  if (!inviterId) {
    for (const [code, info] of fresh) {
      if (!before.invites.has(code) && info.uses > 0) {
        inviterId = info.inviterId;
        break;
      }
    }
  }
  // 3) Invitation à usage unique : le lien a été SUPPRIMÉ par Discord au
  //    moment même où il servait. Si aucun compteur n'a bougé et qu'un seul
  //    lien a disparu dans les dernières secondes, c'est lui qui a servi.
  if (!inviterId) {
    const candidates = recentDeletedCandidates(guild.id, fresh);
    if (candidates.length === 1) {
      inviterId = candidates[0].inviterId;
      recentDeleted.get(guild.id).delete(candidates[0].code);
    }
  }
  // (4) Lien vanity (discord.gg/nom-du-serveur) — pas d'inviteur identifiable

  setSnapshot(guild.id, fresh, freshVanity);
  return inviterId ? { inviterId } : null;
}

/** Event Discord : un lien d'invitation vient d'être créé */
function onInviteCreate(invite) {
  if (!invite.inviter) return;
  const snap = getSnapshot(invite.guild.id);
  const map = new Map(snap.invites);
  map.set(invite.code, { uses: invite.uses, inviterId: invite.inviter.id });
  updateSnapshot(invite.guild.id, map);
}

/** Event Discord : un lien d'invitation vient d'être supprimé */
function onInviteDelete(invite) {
  const snap = getSnapshot(invite.guild.id);
  const map = new Map(snap.invites);
  const removed = map.get(invite.code);
  map.delete(invite.code);
  updateSnapshot(invite.guild.id, map);
  // On mémorise le créateur : si quelqu'un rejoint dans les prochaines
  // secondes sans qu'aucun compteur bouge, c'est ce lien épuisé qui a servi.
  if (removed && removed.inviterId) {
    rememberDeletedInvite(invite.guild.id, invite.code, removed.inviterId);
  }
}

/** Vide l'état interne d'un serveur (tests) */
function resetTrackingState() {
  snapshots.clear();
  trackingOk.clear();
  attributionQueues.clear();
  recentDeleted.clear();
}

module.exports = {
  syncGuild,
  attributeJoin,
  isTrackingAvailable,
  getSnapshot,
  updateSnapshot,
  snapshots,
  onInviteCreate,
  onInviteDelete,
  resetTrackingState,
};
