// ============================================================
// ZachServices — Droits d'administration
// Est admin du bot si AU MOINS UNE de ces conditions est vraie :
//   1. son ID est dans ADMIN_USER_IDS / ADMIN_USER_ID (fichier .env)
//   2. il possède le rôle ADMIN_ROLE_ID (fichier .env)
//   3. il a la permission Discord "Administrateur" sur le serveur
// Configuration minimale : rien à faire (la condition 3 suffit).
// ============================================================
const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function hasAdminRole(interaction) {
  if (!config.adminRoleId) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  // GuildMember (cache) ou membre "brut" d'une interaction (tableau d'IDs)
  if (Array.isArray(roles)) return roles.includes(config.adminRoleId);
  if (roles.cache) return roles.cache.has(config.adminRoleId);
  return false;
}

/** Vrai si l'utilisateur est admin du bot dans cette interaction. */
function isAdminInteraction(interaction) {
  if (!interaction || !interaction.user) return false;
  if (config.adminUserIds.includes(interaction.user.id)) return true;
  if (hasAdminRole(interaction)) return true;
  try {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
  } catch {
    return false;
  }
}

module.exports = { isAdminInteraction };
