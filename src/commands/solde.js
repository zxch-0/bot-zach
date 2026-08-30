// ============================================================
// /solde — affiche le solde de coins (et les invitations)
// ============================================================
const { SlashCommandBuilder, InteractionContextType, userMention } = require('discord.js');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solde')
    .setDescription('Affiche ton solde de coins (ou celui d\'un autre membre)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('utilisateur').setDescription('Le membre dont tu veux voir le solde').setRequired(false)
    ),

  async execute(interaction) {
    const store = interaction.client.store;
    const target = interaction.options.getUser('utilisateur') ?? interaction.user;
    if (target.bot) {
      return interaction.reply({ content: '🤖 Les bots ne jouent pas au casino !', ephemeral: true });
    }

    const user = await store.getUser(target.id);
    const invites = await store.getInviteCount(target.id);
    const totalInvites = invites.count + invites.imported;

    const embed = baseEmbed(COLORS.info)
      .setTitle(`💰 Solde de ${target.username}`)
      .addFields(
        { name: '🪙 Coins', value: `**${fmtCoins(user.balance)}**`, inline: true },
        { name: '🎟️ Invitations réussies', value: `**${totalInvites}**`, inline: true },
        { name: '🎁 Daily', value: totalInvites >= 1 ? '✅ Débloqué' : '🔒 Verrouillé (1 invitation requise)', inline: true }
      )
      .setDescription(
        target.id === interaction.user.id
          ? 'Continue d\'inviter des amis et de gagner au casino ! 💪'
          : `Solde affiché de ${userMention(target.id)}.`
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
