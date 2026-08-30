// ============================================================
// ZachServices — Tracking des invitations (intégré, sans bot externe)
//
// Principe : le bot photographie tous les liens d'invitation du serveur
// (code -> nombre d'utilisations). Quand un membre arrive, on compare
// l'ancienne et la nouvelle photo : le lien dont le compteur a augmenté
// est celui utilisé => son créateur est crédité d'une invitation réussie.
//
// ⚠️ Prérequis : intent "Server Members" + permission "Gérer le serveur".
// Une invitation réussie = un membre rejoint via ton lien ET toujours
// présent. S'il repart, le compteur redescend.
// ============================================================

// guildId -> Map(code -> { uses, inviterId }) + vanity
const snapshots = new Map();

// guildId -> true si le tracking fonctionne (permission présente)
const trackingOk = new Map();

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
 * Détermine qui a invité un membre qui vient d'arriver.
 * Retourne { inviterId } ou null (lien vainity / introuvable).
 */
async function attributeJoin(guild) {
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
  // 3) Lien vanity (discord.gg/nom-du-serveur) — pas d'inviteur identifiable
  if (!inviterId && freshVanity !== null && before.vanityUses !== null && freshVanity > before.vanityUses) {
    inviterId = null;
  }

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
  map.delete(invite.code);
  updateSnapshot(invite.guild.id, map);
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
};
