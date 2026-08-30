// ============================================================
// /shop — boutique ZachServices
// Zach-checker : 1000 coins • Zach-checker Premium : 5000 coins
// (l'achat ouvre un formulaire demandant le pseudo Discord
//  de livraison, puis prévient l'admin par MP)
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const shopService = require('../services/shop');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Parcoure la boutique et achète des produits avec tes coins')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    return interaction.reply({
      embeds: [shopService.buildShopEmbed()],
      components: [shopService.buildShopRow()],
      ephemeral: true,
    });
  },
};
