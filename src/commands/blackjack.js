// ============================================================
// /blackjack <bet> — blackjack interactif contre le croupier.
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
        .setName('bet')
        .setDescription('The number of coins to bet')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1_000_000)
    ),

  async execute(interaction) {
    if (interaction.user.bot) return;
    const bet = interaction.options.getInteger('bet');
    return blackjackGame.startBlackjack(interaction, bet);
  },
};
