// ============================================================
// /aide — présentation de toutes les commandes et règles
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Présente ZachServices : commandes, règles et boutique'),

  async execute(interaction) {
    const embed = baseEmbed(COLORS.primary)
      .setTitle('👑 ZachServices — Aide')
      .setDescription(
        'Bienvenue sur **ZachServices** ! Gagne des coins, joue au casino et dépense-les dans la boutique.'
      )
      .addFields(
        {
          name: '🎟️ Invitations & /daily',
          value:
            `• \`/invitations\` — vois tes invitations réussies\n` +
            `• \`/daily\` — **${fmtCoins(config.dailyReward)}** toutes les 24 h, débloqué après **1 invitation réussie** ` +
            '(un membre rejoint via ton lien et reste sur le serveur)',
        },
        {
          name: '🎰 Casino',
          value:
            '• `/blackjack mise` — contre le croupier : **gain ×2**, blackjack naturel **×2,5**, égalité remboursée\n' +
            '• `/rps mise choix` — pierre-feuille-ciseaux contre le bot : **gain ×2**, égalité remboursée',
        },
        {
          name: '🛒 Boutique & divers',
          value:
            '• `/shop` — achète des produits avec tes coins (livraison par MP après achat)\n' +
            '• `/solde [utilisateur]` — ton solde de coins\n' +
            '• `/classement` — top 10 des bourses\n' +
            '• `/invitations` — suis tes invitations',
        },
        {
          name: '📦 Produits en vente',
          value: config.products.map((p) => `${p.emoji} **${p.name}** — ${fmtCoins(p.price)}`).join('\n'),
        }
      )
      .setFooter({ text: 'ZachServices • /aide' });

    return interaction.reply({ embeds: [embed] });
  },
};
