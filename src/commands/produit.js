// ============================================================
// /produit — commande admin : gère la boutique.
//   /produit ajouter nom prix [description] [emoji]
//   /produit retirer produit   (avec autocomplétion)
//   /produit liste
// Mêmes droits que /give : ADMIN_USER_IDS, ADMIN_ROLE_ID ou
// permission Discord "Administrateur".
// ============================================================
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const shopService = require('../services/shop');
const { isAdminInteraction } = require('../utils/permissions');
const { baseEmbed, COLORS, errorEmbed } = require('../utils/embeds');
const { fmtCoins, cut } = require('../utils/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('produit')
    .setDescription('(Admin) Gère les produits de la boutique')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajoute un produit à la boutique')
        .addStringOption((option) =>
          option.setName('nom').setDescription('Nom affiché dans la boutique').setRequired(true).setMaxLength(shopService.NAME_MAX)
        )
        .addIntegerOption((option) =>
          option
            .setName('prix')
            .setDescription('Price in coins (1 to 10 000 000)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10_000_000)
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Courte description affichée dans la boutique')
            .setRequired(false)
            .setMaxLength(shopService.DESCRIPTION_MAX)
        )
        .addStringOption((option) =>
          option.setName('emoji').setDescription('Emoji du produit (ex : 🧰)').setRequired(false).setMaxLength(64)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retire un produit de la boutique')
        .addStringOption((option) =>
          option.setName('produit').setDescription('Le produit à retirer').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Liste les produits de la boutique')),

  async execute(interaction) {
    if (!isAdminInteraction(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed('Commande réservée aux administrateurs du bot (voir la configuration `ADMIN_USER_IDS`).')],
        ephemeral: true,
      });
    }

    const store = interaction.client.store;
    const sub = interaction.options.getSubcommand();

    // --- /produit ajouter ---
    if (sub === 'ajouter') {
      const result = await shopService.addProduct(store, {
        name: interaction.options.getString('nom'),
        price: interaction.options.getInteger('prix'),
        description: interaction.options.getString('description'),
        emoji: interaction.options.getString('emoji'),
        actorId: interaction.user.id,
      });

      if (!result.ok) {
        return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
      }

      const p = result.product;
      const embed = baseEmbed(COLORS.success)
        .setTitle('✅ Product added to shop')
        .setDescription(`${p.emoji} **${p.name}** est maintenant en vente dans \`/shop\` !`)
        .addFields(
          { name: '🏷️ Prix', value: fmtCoins(p.price), inline: true },
          { name: '🆔 Identifiant', value: `\`${p.id}\``, inline: true },
          { name: '📝 Description', value: p.description || '—', inline: false }
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /produit retirer ---
    if (sub === 'retirer') {
      const productId = interaction.options.getString('produit');
      const result = await shopService.removeProduct(store, productId);
      if (!result.ok) {
        return interaction.reply({ embeds: [errorEmbed(result.error)], ephemeral: true });
      }
      const p = result.product;
      const embed = baseEmbed(COLORS.success)
        .setTitle('🗑️ Produit retiré')
        .setDescription(`${p.emoji} **${p.name}** (\`${p.id}\`) n't on sale anymore.\nLes commandes déjà passées restent enregistrées.`)
        .setFooter({ text: `ZachServices • ${fmtCoins(p.price)}` });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- /produit liste ---
    const products = await store.listProducts();
    if (!products.length) {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('📦 Produits')
        .setDescription('La boutique est vide. Ajoute des produits avec `/produit ajouter`.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const lines = cut(products
      .map((p) => `${p.emoji} **${p.name}** — ${fmtCoins(p.price)} • id : \`${p.id}\``)
      .join('\n'), 4000);
    const embed = baseEmbed(COLORS.info)
      .setTitle(`📦 Produits de la boutique (${products.length}/${config.maxProducts})`)
      .setDescription(lines)
      .addFields({
        name: 'ℹ️ Gestion',
        value: 'Ajouter : `/produit ajouter nom prix [description] [emoji]`\nRetirer : `/produit retirer produit`',
      });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /** Autocomplétion de l'option "produit" de /produit retirer */
  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      if (!focused || focused.name !== 'produit') return interaction.respond([]);
      const store = interaction.client.store;
      const products = await store.listProducts();
      const query = String(focused.value || '').toLowerCase();
      const choices = products
        .filter((p) => p.name.toLowerCase().includes(query) || p.id.includes(query))
        .slice(0, 25)
        .map((p) => ({
          name: `${p.emoji} ${p.name} — ${p.price} coins (${p.id})`.slice(0, 100),
          value: p.id,
        }));
      return interaction.respond(choices);
    } catch (err) {
      console.error('[produit] Erreur d\'autocomplétion :', err.message);
      try { await interaction.respond([]); } catch {}
    }
  },
};
