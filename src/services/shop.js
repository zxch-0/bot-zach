// ============================================================
// ZachServices — Boutique & livraison
// /shop liste les produits (config.js). À l'achat :
//   1. le bot vérifie le solde,
//   2. un formulaire demande le pseudo Discord de livraison,
//   3. les coins sont débités (atomiquement),
//   4. l'admin reçoit un MP : acheteur + produit + pseudo de livraison,
//   5. l'achat est aussi loggué dans PURCHASE_LOG_CHANNEL_ID si défini.
// ============================================================
const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../config');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins, fmtDate } = require('../utils/format');

function getProduct(productId) {
  return config.products.find((p) => p.id === productId) || null;
}

/** Réponse à /shop : liste des produits + menu d'achat */
function buildShopEmbed() {
  const embed = baseEmbed(COLORS.primary)
    .setTitle('🛒 Boutique ZachServices')
    .setDescription(
      'Dépense tes coins durement gagnés au casino !\n' +
        'Sélectionne un produit ci-dessous pour l\'acheter.\n\n' +
        '📦 **Livraison** : après l\'achat, le bot te demandera ton **pseudo Discord** ' +
        'pour la livraison, puis préviendra le vendeur par message privé.'
    );

  for (const product of config.products) {
    embed.addFields({
      name: `${product.emoji} ${product.name}`,
      value: `**Prix :** ${fmtCoins(product.price)}\n${product.description}`,
      inline: false,
    });
  }
  return embed;
}

function buildShopRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop:buy')
    .setPlaceholder('Choisis un produit à acheter…')
    .addOptions(
      config.products.map((p) => ({
        label: `${p.name}`,
        description: `${p.price} coins — ${p.description}`.slice(0, 100),
        value: p.id,
        emoji: p.emoji,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

/** Modale demandant le pseudo Discord de livraison */
function buildDeliveryModal(product) {
  const modal = new ModalBuilder()
    .setCustomId(`shop:modal:${product.id}`)
    .setTitle(`Acheter ${product.name}`);
  const input = new TextInputBuilder()
    .setCustomId('delivery_username')
    .setLabel('Pseudo Discord pour la livraison')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(60)
    .setPlaceholder('Ex : zach');
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/** MP envoyé à l'admin pour livrer la commande */
function buildAdminDmEmbed({ buyer, product, deliveryUsername, purchaseId }) {
  return baseEmbed(COLORS.warning)
    .setTitle('🛒 Nouvel achat à livrer !')
    .setDescription('Un membre vient d\'acheter un produit dans la boutique.')
    .addFields(
      { name: '👤 Acheteur', value: `<@${buyer.id}> — \`${buyer.username}\` (${buyer.id})`, inline: false },
      { name: '📦 Produit', value: `${product.emoji} **${product.name}**`, inline: true },
      { name: '💰 Prix', value: fmtCoins(product.price), inline: true },
      { name: '📨 Pseudo de livraison', value: `**${deliveryUsername}**`, inline: false },
      { name: '🆔 Commande', value: `#${purchaseId}`, inline: true },
      { name: '🗓️ Date', value: fmtDate(Date.now()), inline: true }
    )
    .setFooter({ text: `ZachServices • Commande #${purchaseId} sur le serveur` });
}

/** Confirmation envoyée à l'acheteur */
function buildBuyerConfirmEmbed({ product, deliveryUsername, balance, purchaseId }) {
  return baseEmbed(COLORS.success)
    .setTitle('✅ Achat confirmé !')
    .setDescription(
      `Tu as acheté **${product.emoji} ${product.name}** pour **${fmtCoins(product.price)}**.\n\n` +
        `📨 Livraison au pseudo : **${deliveryUsername}**\n` +
        `Le vendeur a été prévenu par message privé et te contactera.\n\n` +
        `Il te reste **${fmtCoins(balance)}**.`
    )
    .setFooter({ text: `ZachServices • Commande #${purchaseId}` });
}

/** Log optionnel dans un salon */
function buildPurchaseLogEmbed({ buyer, product, deliveryUsername, purchaseId, guildName }) {
  return baseEmbed(COLORS.info)
    .setTitle('🧾 Journal des achats')
    .addFields(
      { name: '👤 Acheteur', value: `<@${buyer.id}> (\`${buyer.username}\`)`, inline: true },
      { name: '📦 Produit', value: `${product.emoji} ${product.name}`, inline: true },
      { name: '💰 Prix', value: fmtCoins(product.price), inline: true },
      { name: '📨 Livraison', value: deliveryUsername, inline: true },
      { name: '🆔 Commande', value: `#${purchaseId}`, inline: true },
      { name: '🏰 Serveur', value: guildName || '—', inline: true }
    );
}

/**
 * Traite l'achat après validation de la modale :
 * débit atomique + enregistrement + notifications. 
 * Retourne { ok: true, purchaseId, balance } ou { ok: false, reason: 'insufficient', missing } 
 * ou { ok:false, reason:'error', message }.
 */
async function processPurchase({ store, buyer, product, deliveryUsername, guildName }) {
  // Débit atomique : impossible d'acheter si le solde a bougé entre-temps
  const newBalance = await store.debit(buyer.id, product.price);
  if (newBalance === null) {
    const user = await store.getUser(buyer.id);
    return { ok: false, reason: 'insufficient', missing: product.price - user.balance };
  }

  const purchaseId = await store.addPurchase({
    userId: buyer.id,
    username: buyer.username,
    deliveryUsername,
    productId: product.id,
    price: product.price,
    createdAt: Date.now(),
  });

  return { ok: true, purchaseId, balance: newBalance };
}

/**
 * Envoie le MP à l'admin (ADMIN_USER_ID) + log salon éventuel.
 * Retourne la liste des canaux qui ont échoué.
 */
async function notifyPurchase({ client, buyer, product, deliveryUsername, purchaseId, guildName }) {
  const failures = [];

  if (config.adminUserId) {
    try {
      const admin = await client.users.fetch(config.adminUserId);
      await admin.send({ embeds: [buildAdminDmEmbed({ buyer, product, deliveryUsername, purchaseId })] });
    } catch (err) {
      failures.push('admin_dm');
      console.error('[boutique] Impossible de MP l\'admin :', err.message);
    }
  } else {
    failures.push('admin_not_configured');
  }

  if (config.purchaseChannelId) {
    try {
      const channel = await client.channels.fetch(config.purchaseChannelId);
      if (channel && channel.isTextBased()) {
        await channel.send({
          embeds: [buildPurchaseLogEmbed({ buyer, product, deliveryUsername, purchaseId, guildName })],
        });
      }
    } catch (err) {
      failures.push('log_channel');
      console.error('[boutique] Impossible de logguer l\'achat dans le salon :', err.message);
    }
  }

  return failures;
}

module.exports = {
  getProduct,
  buildShopEmbed,
  buildShopRow,
  buildDeliveryModal,
  buildBuyerConfirmEmbed,
  processPurchase,
  notifyPurchase,
};
