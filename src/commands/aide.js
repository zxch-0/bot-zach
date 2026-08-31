// ============================================================
// /aide — overview of all commands and rules
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Present ZachServices: commands, rules, and shop'),

  async execute(interaction) {
    // Real shop items (not static config list)
    let products = [];
    try {
      products = await interaction.client.store.listProducts();
    } catch {
      products = config.defaultProducts;
    }

    const embed = baseEmbed(COLORS.primary)
      .setTitle('👑 ZachServices — Help')
      .setDescription('Welcome to ZachServices ! Earn coins, play casino, and spend them in the shop.')
      .addFields(
        {
          name: '🎟️ Invites & /daily',
          value:
            '• `/invitations` — view your successful invites\n' +
            '• `/daily` — **' +
            fmtCoins(config.dailyReward) +
            ' every 24 h, unlocked after 1 successful invite\n' +
            '(a member joins via your link and stays on the server)',
        },
        {
          name: '🎰 Casino',
          value:
            '• `/blackjack bet` — against the dealer: **win ×2**, natural blackjack **×2.5**, tie refunded\n' +
            '• `/rps bet choice` — rock-paper-scissors against the bot: **win ×2**, tie refunded',
        },
        {
          name: '🛒 Shop & misc',
          value:
            '• `/shop` — buy products with your coins (delivery via DM after purchase)\n' +
            '• `/solde [user]` — your coin balance\n' +
            '• `/ranking` — top 10 richest\n' +
            '• `/invitations` — track your invites',
        },
        {
          name: '📦 Items for sale',
          value:
            products.length
              ? products.map((p) => `${p.emoji} **${p.name}** — ${fmtCoins(p.price)}`).join('\n')
              : 'Shop is empty for now\n_(full and up-to-date list in `/shop`)_',
        },
        {
          name: '🛠️ Admin commands',
          value:
            '• `/give user amount` — add/remove coins\n' +
            '• `/product add|remove|list` — manage the shop',
        }
      )
      .setFooter({ text: 'ZachServices • /aide' });

    return interaction.reply({ embeds: [embed] });
  },
};