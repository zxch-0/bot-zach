// ============================================================
// /rps <bet> <choice> — pierre-feuille-ciseaux contre le bot.
// Gagné : mise ×2 • Égalité : remboursée • Perdu : mise perdue.
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const rps = require('../games/rps');
const economy = require('../services/economy');
const { baseEmbed, COLORS, errorEmbed } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Pierre-feuille-ciseaux contre le bot — double ta mise !')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('bet')
        .setDescription('The number of coins to bet')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1_000_000)
    )
    .addStringOption((option) =>
      option
        .setName('choice')
        .setDescription('Ton coup')
        .setRequired(true)
        .addChoices(
          { name: '🪨 Rock', value: 'rock' },
          { name: '📄 Paper', value: 'paper' },
          { name: '✂️ Scissors', value: 'scissors' }
        )
    ),

  async execute(interaction) {
    const store = interaction.client.store;
    const bet = interaction.options.getInteger('bet');
    const playerChoice = interaction.options.getString('choice');

    // La mise est débitée immédiatement (atomique)
    const balanceAfterBet = await economy.tryDebit(store, interaction.user.id, bet);
    if (balanceAfterBet === null) {
      const user = await store.getUser(interaction.user.id);
      return interaction.reply({
        embeds: [errorEmbed(`Solde insuffisant ! Il te manque **${fmtCoins(bet - user.balance)}**.\nTon solde : **${fmtCoins(user.balance)}**`)],
        ephemeral: true,
      });
    }

    const botChoice = rps.botPick();
    const outcome = rps.resolveRps(playerChoice, botChoice);
    const payout = rps.payoutFor(outcome, bet);
    const newBalance = payout > 0 ? await economy.credit(store, interaction.user.id, payout) : balanceAfterBet;
    const profit = payout - bet;

    const resultText = {
      win: `🎉 **Tu gagnes !** Ta mise est **doublée** : tu récupères **${fmtCoins(payout)}** (bénéfice **+${fmtCoins(profit)}**)`,
      tie: `🤝 **Égalité !** Ta mise t'est remboursée (${fmtCoins(payout)}).`,
      lose: `😵 **Le bot gagne !** Tu perds ta mise (${fmtCoins(bet)}).`,
    }[outcome];

    const embed = baseEmbed(outcome === 'win' ? COLORS.success : outcome === 'tie' ? COLORS.warning : COLORS.error)
      .setTitle('✂️ Pierre · Feuille · Ciseaux')
      .setDescription(
        `🙋 <@${interaction.user.id}> : **${rps.CHOICES[playerChoice].label}** ${rps.CHOICES[playerChoice].emoji}\n` +
          `🤖 ZachServices : **${rps.CHOICES[botChoice].label}** ${rps.CHOICES[botChoice].emoji}\n\n` +
          `${resultText}\n\n💰 Nouveau solde : **${fmtCoins(newBalance)}**`
      );

    return interaction.reply({ embeds: [embed] });
  },
};
