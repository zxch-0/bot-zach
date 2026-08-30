// ============================================================
// /blackjack <mise> — blackjack interactif contre le croupier.
// Gain : mise ×2 • Blackjack naturel : ×2,5 • Égalité : remboursé.
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const blackjackGame = require('../games/blackjackGame');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Joue au blackjack contre le croupier — double ta mise !')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('mise')
        .setDescription('Le nombre de coins à miser')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1_000_000)
    ),

  async execute(interaction) {
    if (interaction.user.bot) return;
    const bet = interaction.options.getInteger('mise');
    return blackjackGame.startBlackjack(interaction, bet);
  },
};
