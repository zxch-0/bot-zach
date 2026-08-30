// ============================================================
// ZachServices — Boutique & livraison (produits dynamiques)
// Les produits sont stockés en base et gérés par les admins via
// /produit ajouter|retirer|liste. À l'achat :
//   1. le bot vérifie le solde,
//   2. un formulaire demande le pseudo Discord de livraison,
//   3. les coins sont débités (atomiquement),
//   4. chaque admin (ADMIN_USER_IDS) reçoit un MP : acheteur,
//      produit, prix et pseudo de livraison,
//   5. l'achat est aussi loggué dans PURCHASE_LOG_CHANNEL_ID si défini.
// ============================================================
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins, fmtDate } = require('../utils/format');

const NAME_MAX = 60;
const DESCRIPTION_MAX = 120;

/* ---------------- Validation des entrées admin ---------------- */

/** Emoji "sûr" : emoji unicode court, ou emoji custom <a?:nom:id>. */
function isSafeEmoji(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^<a?:[a-zA-Z0-9_]+:\d+>$/.test(s)) return true;
  return [...s].length <= 8 && !/[a-zA-Z0-9\s]/.test(s);
}

/** Transforme un nom en identifiant sûr : "Clé Premium 2" -> "cle-premium-2". */
function slugify(name) {
  const slug = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug || 'produit';
}

/**
 * Valide et crée un produit (commande /produit ajouter).
 * Retourne { ok: true, product } ou { ok: false, error }.
 */
async function addProduct(store, { name, price, description, emoji, actorId }) {
  const cleanName = String(name || '').trim();
  if (cleanName.length < 1 || cleanName.length > NAME_MAX) {
    return { ok: false, error: `Le nom doit contenir entre 1 et ${NAME_MAX} caractères.` };
  }
  const cleanPrice = Math.trunc(Number(price));
  if (!Number.isFinite(cleanPrice) || cleanPrice < 1 || cleanPrice > 10_000_000) {
    return { ok: false, error: 'Le prix doit être un entier entre 1 et 10 000 000 coins.' };
  }
  const cleanDescription = String(description || '').trim().slice(0, DESCRIPTION_MAX);
  const cleanEmoji = isSafeEmoji(emoji) ? String(emoji).trim() : '📦';

  const products = await store.listProducts();
  if (products.length >= config.maxProducts) {
    return { ok: false, error: `La boutique est pleine (${config.maxProducts} produits maximum, limite des menus Discord).` };
  }

  // Identifiant unique et sûr (pas de ":" pour ne pas casser les customId)
  let id = slugify(cleanName);
  const existingIds = new Set(products.map((p) => p.id));
  if (existingIds.has(id)) {
    for (let i = 2; i <= 99; i++) {
      const candidate = `${id}-${i}`.slice(0, 40);
      if (!existingIds.has(candidate)) {
        id = candidate;
        break;
      }
    }
  }

  const product = {
    id,
    name: cleanName,
    emoji: cleanEmoji,
    price: cleanPrice,
    description: cleanDescription,
    createdAt: Date.now() + products.length, // ordre stable
    createdBy: actorId || null,
  };
  await store.addProduct(product);
  return { ok: true, product };
}

/** Supprime un produit. Retourne { ok: true, product } ou { ok: false, error }. */
async function removeProduct(store, productId) {
  const product = await store.getProductById(productId);
  if (!product) {
    return { ok: false, error: `Produit \`${productId}\` introuvable. Utilise \`/produit liste\` pour voir les IDs.` };
  }
  await store.removeProduct(productId);
  return { ok: true, product };
}

async function getProduct(store, productId) {
  return store.getProductById(productId);
}

/* ---------------- Affichage ---------------- */

/** Embed du /shop (produits dynamiques). */
function buildShopEmbed(products) {
  const embed = baseEmbed(COLORS.primary)
    .setTitle('🛒 Boutique ZachServices')
    .setDescription(
      'Dépense tes coins durement gagnés au casino !\n' +
        'Sélectionne un produit ci-dessous pour l\'acheter.\n\n' +
        '📦 **Livraison** : après l\'achat, le bot te demandera ton **pseudo Discord** ' +
        'pour la livraison, puis préviendra le vendeur par message privé.'
    );

  for (const product of products.slice(0, config.maxProducts)) {
    embed.addFields({
      name: `${product.emoji} ${product.name}`.slice(0, 256),
      value: `**Prix :** ${fmtCoins(product.price)}\n${product.description || '—'}`.slice(0, 1024),
      inline: false,
    });
  }
  return embed;
}

/** Ligne du menu d'achat — null si la boutique est vide. */
function buildShopRow(products) {
  if (!products || products.length === 0) return null;
  const options = products.slice(0, config.maxProducts).map((p) => {
    const builder = new StringSelectMenuOptionBuilder()
      .setLabel(String(p.name).slice(0, 100))
      .setDescription(`${p.price} coins — ${p.description || 'Produit ZachServices'}`.slice(0, 100))
      .setValue(p.id);
    // emoji invalide => aucun emoji plutôt qu'une erreur API
    if (isSafeEmoji(p.emoji)) builder.setEmoji(p.emoji);
    return builder;
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop:buy')
    .setPlaceholder('Choisis un produit à acheter…')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

/** Modale demandant le pseudo Discord de livraison (titre limité à 45 caractères). */
function buildDeliveryModal(product) {
  const modal = new ModalBuilder()
    .setCustomId(`shop:modal:${product.id}`)
    .setTitle(`Acheter ${product.name}`.slice(0, 45));
  const input = new TextInputBuilder()
    .setCustomId('delivery_username')
    .setLabel('Pseudo Discord pour la livraison')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(60)
    .setPlaceholder('Ex : zach');
  // ActionRowBuilder non générique (syntaxe JS) : cast pour la vérification tsc
  modal.addComponents(/** @type {any} */ (new ActionRowBuilder().addComponents(input)));
  return modal;
}

/** MP envoyé à chaque admin pour livrer la commande */
function buildAdminDmEmbed({ buyer, product, deliveryUsername, purchaseId }) {
  return baseEmbed(COLORS.warning)
    .setTitle('🛒 Nouvel achat à livrer !')
    .setDescription('Un membre vient d\'acheter un produit dans la boutique.')
    .addFields(
      { name: '👤 Acheteur', value: `<@${buyer.id}> — \`${buyer.username}\` (${buyer.id})`.slice(0, 1024), inline: false },
      { name: '📦 Produit', value: `${product.emoji} **${product.name}**`, inline: true },
      { name: '💰 Prix', value: fmtCoins(product.price), inline: true },
      { name: '📨 Pseudo de livraison', value: `**${deliveryUsername}**`.slice(0, 1024), inline: false },
      { name: '🆔 Commande', value: `#${purchaseId}`, inline: true },
      { name: '🗓️ Date', value: fmtDate(Date.now()), inline: true }
    )
    .setFooter({ text: `ZachServices • Commande #${purchaseId}`.slice(0, 2048) });
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
      { name: '👤 Acheteur', value: `<@${buyer.id}> (\`${buyer.username}\`)`.slice(0, 1024), inline: true },
      { name: '📦 Produit', value: `${product.emoji} ${product.name}`.slice(0, 1024), inline: true },
      { name: '💰 Prix', value: fmtCoins(product.price), inline: true },
      { name: '📨 Livraison', value: deliveryUsername.slice(0, 1024), inline: true },
      { name: '🆔 Commande', value: `#${purchaseId}`, inline: true },
      { name: '🏰 Serveur', value: guildName || '—', inline: true }
    );
}

/* ---------------- Traitement ---------------- */

/**
 * Traite l'achat après validation de la modale : débit atomique + enregistrement.
 * Retourne { ok: true, purchaseId, balance } ou { ok:false, reason:'insufficient', missing }
 * ou { ok:false, reason:'error', message }.
 */
async function processPurchase({ store, buyer, product, deliveryUsername }) {
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
 * Envoie le MP à tous les admins (ADMIN_USER_IDS) + log salon éventuel.
 * Retourne la liste des canaux qui ont échoué.
 */
async function notifyPurchase({ client, buyer, product, deliveryUsername, purchaseId, guildName }) {
  const failures = [];

  if (config.adminUserIds.length) {
    for (const adminId of config.adminUserIds) {
      try {
        const admin = await client.users.fetch(adminId);
        await admin.send({ embeds: [buildAdminDmEmbed({ buyer, product, deliveryUsername, purchaseId })] });
      } catch (err) {
        failures.push('admin_dm');
        console.error(`[boutique] Impossible de MP l'admin ${adminId} :`, err.message);
      }
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
  addProduct,
  removeProduct,
  getProduct,
  listProducts: (store) => store.listProducts(),
  buildShopEmbed,
  buildShopRow,
  buildDeliveryModal,
  buildBuyerConfirmEmbed,
  processPurchase,
  notifyPurchase,
  isSafeEmoji,
  slugify,
  NAME_MAX,
  DESCRIPTION_MAX,
};
