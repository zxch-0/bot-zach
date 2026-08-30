// ============================================================
// Événement "interactionCreate" : route les commandes slash,
// les boutons du blackjack et le flux d'achat de la boutique.
// ============================================================
const { Events } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const blackjackGame = require('../games/blackjackGame');
const shopFlow = require('../flows/shopFlow');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    try {
      // --- Commandes slash ---
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
          console.warn(`[commandes] Commande inconnue : ${interaction.commandName}`);
          return;
        }
        await command.execute(interaction);
        return;
      }

      // --- Menu de sélection de la boutique ---
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'shop:buy') {
          await shopFlow.handleBuySelect(interaction);
        }
        return;
      }

      // --- Modale "pseudo de livraison" de la boutique ---
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('shop:modal:')) {
          await shopFlow.handleModal(interaction);
        }
        return;
      }

      // --- Boutons du blackjack ---
      if (interaction.isButton()) {
        if (interaction.customId.startsWith('bj:')) {
          const game = blackjackGame.activeGames.get(interaction.user.id);
          if (game) {
            await blackjackGame.handleButton(interaction, game);
          } else if (interaction.isRepliable()) {
            await interaction.reply({
              embeds: [errorEmbed('Cette partie est déjà terminée. Lance-en une nouvelle avec `/blackjack` !')],
              ephemeral: true,
            });
          }
        }
        return;
      }
    } catch (err) {
      console.error(`[interaction] Erreur (${interaction.id}) :`, err);
      // Réponse d'erreur la plus gracieuse possible
      try {
        const payload = { embeds: [errorEmbed('Une erreur inattendue est survenue. Réessaie !')], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else if (interaction.isRepliable()) {
          await interaction.reply(payload);
        }
      } catch {}
    }
  },
};
