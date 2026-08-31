// ============================================================
// /invites — montre les invitations réussies d'un membre
// (et si le /daily est débloqué)
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const invitesService = require('../services/invites');
const { baseEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Show the number of successful invites (yours or another member\'s)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to check').setRequired(false)
    ),

  async execute(interaction) {
    const store = interaction.client.store;
    const target = interaction.options.getUser('user') ?? interaction.user;
    const invites = await store.getInviteCount(target.id);
    const total = invites.count + invites.imported;

    const embed = baseEmbed(total >= 1 ? COLORS.success : COLORS.info)
      .setTitle(`🎟️ Invitations de ${target.username}`)
      .setDescription(
        total >= 1
          ? `✅ **${total}** invitation(s) réussie(s) — le \`/daily\` est **débloqué** !`
          : '❌ Aucune invitation réussie pour le moment.'
      )
      .addFields({
        name: '📊 Détails',
        value:
          `• Membres invités présents : **${invites.count}**\n` +
          `• Invitations importées : **${invites.imported}**`,
      });

    if (total < 1) {
      embed.addFields({
        name: 'ℹ️ Comment inviter',
        value:
          'Sur Discord : salon texte → icône ➕ *Inviter des personnes* (ou Paramètres du serveur → Invitations), ' +
          'envoie le lien à un ami. S\'il rejoint **et reste** sur le serveur, ton invitation est réussie 🎉',
      });
    }

    if (!invitesService.isTrackingAvailable(interaction.guildId)) {
      embed.addFields({
        name: '⚠️ Tracking désactivé',
        value: 'Le bot n\'a pas la permission **Gérer le serveur** : il ne peut pas suivre les invitations. Un admin doit la lui donner.',
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
