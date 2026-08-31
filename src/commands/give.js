// ============================================================
// /give — commande admin : crédite ou retire des coins.
// Est admin du bot si (au choix, voir .env) :
//   • ID listé dans ADMIN_USER_IDS / ADMIN_USER_ID
//   • porteur du rôle ADMIN_ROLE_ID
//   • permission Discord "Administrateur" (fonctionne sans config)
// Un retrait est plafonné au solde actuel (jamais négatif).
// ============================================================
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const economy = require('../services/economy');
const { isAdminInteraction } = require('../utils/permissions');
const { baseEmbed, COLORS, errorEmbed } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('(Admin) Ajoute ou retire des coins à un membre')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) => option.setName('user').setDescription('The member to credit').setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Positive to add, negative to remove')
        .setRequired(true)
        .setMinValue(-10_000_000)
        .setMaxValue(10_000_000)
    ),

  async execute(interaction) {
    if (!isAdminInteraction(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed('Commande réservée aux administrateurs du bot (voir la configuration `ADMIN_USER_IDS`).')],
        ephemeral: true,
      });
    }

    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (amount === 0) {
      return interaction.reply({ embeds: [errorEmbed('Le montant ne peut pas être 0.')], ephemeral: true });
    }
    if (!target || target.bot) {
      return interaction.reply({ embeds: [errorEmbed('Cible invalide (les bots ne peuvent pas recevoir de coins).')], ephemeral: true });
    }

    const store = interaction.client.store;
    const { balance, clamped } = await economy.adminAdjust(store, target.id, amount);

    const description =
      `${amount > 0 ? '➕ Ajouté' : '➖ Retiré'} **${fmtCoins(Math.abs(amount))}** à <@${target.id}>.\n` +
      `💰 Nouveau solde : **${fmtCoins(balance)}**` +
      (clamped ? '\nℹ️ Le retrait a été plafonné au solde disponible (le solde ne descend jamais sous 0).' : '');

    const embed = baseEmbed(COLORS.success).setTitle('🪙 Coins modifiés').setDescription(description);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
