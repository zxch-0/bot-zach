// ============================================================
// ZachServices — Flux d'achat de la boutique
// (menu de sélection -> modale pseudo de livraison -> débit + MP admin)
// ============================================================
const shopService = require('../services/shop');
const { errorEmbed } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

/** L'utilisateur a choisi un produit dans le menu du /shop */
async function handleBuySelect(interaction) {
  const productId = interaction.values && interaction.values[0];
  const store = interaction.client.store;
  const product = productId ? await shopService.getProduct(store, productId) : null;
  if (!product) {
    return interaction.update({ embeds: [errorEmbed('Ce produit n\'existe plus (boutique mise à jour). Relance `/shop`.')] });
  }

  const user = await store.getUser(interaction.user.id);
  if (user.balance < product.price) {
    const missing = product.price - user.balance;
    return interaction.reply({
      embeds: [
        errorEmbed(
          `Solde insuffisant pour **${product.emoji} ${product.name}** !\n` +
            `Prix : **${fmtCoins(product.price)}** — ton solde : **${fmtCoins(user.balance)}**\n` +
            `Il te manque **${fmtCoins(missing)}**. 💪 Récupère ton \`/daily\`, invite des amis ou tente le casino !`
        ),
      ],
      ephemeral: true,
    });
  }

  return interaction.showModal(shopService.buildDeliveryModal(product));
}

/** La modale "pseudo Discord de livraison" a été validée */
async function handleModal(interaction) {
  const productId = interaction.customId.split(':')[2];
  const store = interaction.client.store;
  const product = await shopService.getProduct(store, productId);
  if (!product) {
    return interaction.reply({ embeds: [errorEmbed('Ce produit n\'existe plus. Relance `/shop`.')], ephemeral: true });
  }

  const deliveryUsername = (interaction.fields.getTextInputValue('delivery_username') || '').trim();
  if (!deliveryUsername) {
    return interaction.reply({ embeds: [errorEmbed('Pseudo de livraison manquant.')], ephemeral: true });
  }

  const result = await shopService.processPurchase({
    store,
    buyer: interaction.user,
    product,
    deliveryUsername,
  });

  if (!result.ok) {
    if (result.reason === 'insufficient') {
      return interaction.reply({
        embeds: [errorEmbed(`Solde insuffisant — il te manque **${fmtCoins(result.missing)}**.`)],
        ephemeral: true,
      });
    }
    return interaction.reply({ embeds: [errorEmbed('Erreur pendant l\'achat, réessaie.')], ephemeral: true });
  }

  // Prévenir les admins (+ journal salon)
  const failures = await shopService.notifyPurchase({
    client: interaction.client,
    buyer: interaction.user,
    product,
    deliveryUsername,
    purchaseId: result.purchaseId,
    guildName: interaction.guild ? interaction.guild.name : 'DM',
  });

  const confirm = shopService.buildBuyerConfirmEmbed({
    product,
    deliveryUsername,
    balance: result.balance,
    purchaseId: result.purchaseId,
  });

  if (failures.includes('admin_dm') || failures.includes('admin_not_configured')) {
    confirm.addFields({
      name: '⚠️ Important',
      value: `Le vendeur n'a **pas pu être prévenu par MP**. Garde ta commande **#${result.purchaseId}** et contacte directement un administrateur pour être livré.`,
    });
  }

  return interaction.reply({ embeds: [confirm], ephemeral: true });
}

module.exports = { handleBuySelect, handleModal };
