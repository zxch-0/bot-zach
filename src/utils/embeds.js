// ============================================================
// ZachServices — Embeds à l'image du bot
// ============================================================
const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865f2, // Blurple
  success: 0x57f287, // Vert
  error: 0xed4245, // Rouge
  warning: 0xfee75c, // Jaune
  casino: 0x1f8b4c, // Vert casino
  info: 0x3498db, // Bleu
};

/** Embed de base avec la signature ZachServices */
function baseEmbed(color = COLORS.primary) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: 'ZachServices', iconURL: undefined })
    .setTimestamp();
}

/** Embed d'erreur prêt à l'emploi */
function errorEmbed(message) {
  return baseEmbed(COLORS.error).setTitle('❌ Erreur').setDescription(message);
}

module.exports = { COLORS, baseEmbed, errorEmbed };
