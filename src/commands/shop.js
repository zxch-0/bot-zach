// ============================================================
// /shop — boutique ZachServices (produits gérés par les admins
// via /produit ajouter|retirer|liste). À l'achat, un formulaire
// demande le pseudo Discord de livraison, puis les admins
// reçoivent un MP pour livrer la commande.
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const shopService = require('../services/shop');
const { baseEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Parcoure la boutique et achète des produits avec tes coins')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const store = interaction.client.store;
    const products = await store.listProducts();

    if (!products.length) {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('🛒 Boutique ZachServices')
        .setDescription(
          'La boutique est vide pour le moment ! 📭\n' +
            'Un administrateur peut ajouter des produits avec `/produit ajouter`.'
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    return interaction.reply({
      embeds: [shopService.buildShopEmbed(products)],
      components: [shopService.buildShopRow(products)],
      ephemeral: true,
    });
  },
};
