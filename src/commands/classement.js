// ============================================================
// /classement — server leaderboard of richest users
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const economy = require('../services/economy');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Show top 10 richest users\' coin balances')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const store = interaction.client.store;
    const top = await economy.topBalances(store, 10);

    if (!top.length) {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('🏆 Leaderboard')
        .setDescription('No one has coins yet... Be the first to claim your `/daily` !');
      return interaction.reply({ embeds: [embed] });
    }

    const lines = top.map((entry, i) => {
      const medal = MEDALS[i] || `**${i + 1}.**`;
      return `${medal} <@${entry.userId}> — ${fmtCoins(entry.balance)}`;
    });

    const embed = baseEmbed(COLORS.warning)
      .setTitle('🏆 Leaderboard')
      .setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed] });
  },
};