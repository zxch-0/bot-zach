// ============================================================
// /classement — top 10 des bourses du serveur
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const economy = require('../services/economy');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Affiche le top 10 des plus grosses bourses de coins')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const store = interaction.client.store;
    const top = await economy.topBalances(store, 10);

    if (!top.length) {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('🏆 Classement')
        .setDescription('Personne n\'a encore de coins… Sois le premier à récupérer ton `/daily` !');
      return interaction.reply({ embeds: [embed] });
    }

    const lines = top.map((entry, i) => {
      const medal = MEDALS[i] || `**${i + 1}.**`;
      return `${medal} <@${entry.userId}> — **${fmtCoins(entry.balance)}**`;
    });

    const embed = baseEmbed(COLORS.warning)
      .setTitle('🏆 Classement des bourses')
      .setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed] });
  },
};
