// ============================================================
// /give — (admin) crédite ou retire des coins à un membre.
// Réservé à ADMIN_USER_ID (fichier .env).
// ============================================================
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const economy = require('../services/economy');
const { baseEmbed, COLORS, errorEmbed } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('(Admin) Ajoute ou retire des coins à un membre')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) => option.setName('utilisateur').setDescription('Le membre à créditer').setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName('montant')
        .setDescription('Positif pour ajouter, négatif pour retirer')
        .setRequired(true)
        .setMinValue(-10_000_000)
        .setMaxValue(10_000_000)
    ),

  async execute(interaction) {
    if (!config.adminUserId || interaction.user.id !== config.adminUserId) {
      return interaction.reply({ embeds: [errorEmbed('Commande réservée à l\'administrateur du bot.')], ephemeral: true });
    }

    const target = interaction.options.getUser('utilisateur');
    const amount = interaction.options.getInteger('montant');
    if (amount === 0 || target.bot) {
      return interaction.reply({ embeds: [errorEmbed('Montant invalide ou cible bot.')], ephemeral: true });
    }

    const store = interaction.client.store;
    const newBalance = await economy.credit(store, target.id, amount);

    const embed = baseEmbed(COLORS.success)
      .setTitle('🪙 Coins modifiés')
      .setDescription(
        `${amount > 0 ? '➕ Ajouté' : '➖ Retiré'} **${fmtCoins(Math.abs(amount))}** à <@${target.id}>.\n` +
          `💰 Nouveau solde : **${fmtCoins(newBalance)}**`
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
