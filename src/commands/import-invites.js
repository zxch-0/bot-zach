// ============================================================
// /import-invites — (admin) importe les invitations existantes
// du serveur (compteur "utilisations" de chaque lien d'invitation).
// Utile quand le bot arrive après la création du serveur :
// les anciennes invitations ne peuvent pas être suivies en direct,
// mais leurs compteurs peuvent être importés.
// ============================================================
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const invitesService = require('../services/invites');
const { baseEmbed, COLORS, errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import-invites')
    .setDescription('(Admin) Importe les invitations existantes du serveur dans les compteurs')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    // Lecture des invitations (requiert la permission "Gérer le serveur" pour le bot)
    let guildInvites;
    try {
      guildInvites = await interaction.guild.invites.fetch();
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed(`Impossible de lire les invitations : ${err.message}\nLe bot a-t-il la permission **Gérer le serveur** ?`)],
        ephemeral: true,
      });
    }

    const map = {};
    for (const invite of guildInvites.values()) {
      if (invite.inviter && invite.uses > 0) {
        map[invite.inviter.id] = (map[invite.inviter.id] || 0) + invite.uses;
      }
    }

    const entries = Object.entries(map);
    if (!entries.length) {
      return interaction.reply({
        embeds: [errorEmbed('Aucune invitation utilisée trouvée sur ce serveur (ou aucun lien avec des utilisations).')],
        ephemeral: true,
      });
    }

    const store = interaction.client.store;
    await store.importInvites(map);

    // Snapshot à jour pour le tracking temps réel
    await invitesService.syncGuild(interaction.guild);

    const lines = entries
      .slice(0, 15)
      .map(([inviterId, uses]) => `<@${inviterId}> — **${uses}** invitation(s)`)
      .join('\n');

    const embed = baseEmbed(COLORS.success)
      .setTitle('📥 Invitations importées')
      .setDescription(
        `${entries.length} membre(s) ont vu leurs compteurs mis à jour :\n\n${lines}` +
          (entries.length > 15 ? '\n*(liste tronquée à 15)*' : '')
      )
      .addFields({
        name: 'ℹ️ À savoir',
        value:
          'Les invitations importées comptent pour le `/daily`, mais ne sont pas décomptées si le membre part ' +
          '(seules les invitations suivies en direct le sont).',
      });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
