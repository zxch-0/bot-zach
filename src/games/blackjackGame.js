// ============================================================
// ZachServices — Blackjack interactif (boutons Discord)
// Piocher / Rester / Doubler. Un seul joueur par partie,
// inactivité 90 s = rester automatique.
// ============================================================
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const core = require('./blackjack');
const economy = require('../services/economy');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins } = require('../utils/format');

const IDLE_TIMEOUT_MS = 90_000;

// userId -> partie en cours (empêche plusieurs parties simultanées)
const activeGames = new Map();

function isPlaying(userId) {
  return activeGames.has(userId);
}

function canDouble(game) {
  return game.player.length === 2 && !game.doubled;
}

function buttonsRow(game, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj:hit').setLabel('Piocher').setEmoji('🃏').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('bj:stand').setLabel('Rester').setEmoji('✋').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('bj:double').setLabel('Doubler').setEmoji('⏫').setStyle(ButtonStyle.Success).setDisabled(disabled || !canDouble(game))
  );
}

function gameEmbed(game, { revealDealer = false, outcome = null, note = null } = {}) {
  const playerVal = core.handValue(game.player).total;
  const embed = baseEmbed(outcome ? (outcome.result === 'win' ? COLORS.success : outcome.result === 'push' ? COLORS.warning : COLORS.error) : COLORS.casino)
    .setTitle(`🃏 Blackjack — mise : ${fmtCoins(game.stake)}`)
    .addFields(
      {
        name: `🙋 Ta main (${interactionTag(game)})`,
        value: `${core.formatHand(game.player)}\n**Valeur : ${playerVal}**`,
        inline: true,
      },
      {
        name: '🎩 Croupier',
        value: revealDealer
          ? `${core.formatHand(game.dealer)}\n**Valeur : ${core.handValue(game.dealer).total}**`
          : `${core.formatHand(game.dealer, true)}\n**Valeur : ?**`,
        inline: true,
      }
    );

  if (note) embed.setDescription(note);
  if (outcome) embed.setDescription(outcome.text);
  return embed;
}

function interactionTag(game) {
  return `<@${game.userId}>`;
}

/** Calcule l'issue, crédite les gains et nettoie. Retourne l'embed final, ou null si la partie était déjà réglée. */
async function settle(game, { result, natural = false, note = '' } ) {
  // Garde anti-double-règlement : le premier appel gagne, les suivants (clic et
  // timeout simultanés, double clic…) sont ignorés — impossible de créditer 2×.
  if (game.settled) return null;
  game.settled = true;

  const payout = core.payoutFor(result, game.stake, natural);
  if (payout > 0) {
    game.balanceAfter = await economy.credit(game.store, game.userId, payout);
  } else {
    const user = await game.store.getUser(game.userId);
    game.balanceAfter = user.balance;
  }
  const profit = payout - game.stake;

  let text;
  if (result === 'win') {
    text = natural
      ? `🂡 **BLACKJACK !** Payé 2,5× : tu récupères **${fmtCoins(payout)}** (bénéfice **+${fmtCoins(profit)}**)`
      : `🎉 **Tu gagnes !** Tu récupères **${fmtCoins(payout)}** (bénéfice **+${fmtCoins(profit)}**)`;
  } else if (result === 'push') {
    text = `🤝 **Égalité** — mise remboursée (${fmtCoins(payout)})`;
  } else {
    text = core.handValue(game.player).total > 21
      ? `💥 **Bust !** Tu dépasses 21 et perds ta mise (${fmtCoins(game.stake)}).`
      : `😞 **Le croupier gagne.** Tu perds ta mise (${fmtCoins(game.stake)}).`;
  }

  text += `\n💰 Nouveau solde : **${fmtCoins(game.balanceAfter)}**`;
  if (note) text += `\n${note}`;

  game.finished = true;
  cleanup(game);
  return gameEmbed(game, { revealDealer: true, outcome: { result, text } });
}

function cleanup(game) {
  if (game.collector) {
    game.collector.stop('finished');
    game.collector = null;
  }
  activeGames.delete(game.userId);
}

/** Le croupier joue puis on compare. */
async function dealerTurn(game) {
  game.dealer = core.dealerPlay(game.dealer, game.deck);
  const result = core.compareHands(game.player, game.dealer);
  return settle(game, { result });
}

/** Démarre une partie. `interaction` = la commande /blackjack. */
async function startBlackjack(interaction, bet) {
  const store = interaction.client.store;
  const userId = interaction.user.id;

  if (activeGames.has(userId)) {
    return interaction.reply({
      embeds: [errorEmbedGame('Tu as déjà une **partie en cours** ! Termine-la avant d\'en recommencer une.')],
      ephemeral: true,
    });
  }

  const newBalance = await economy.tryDebit(store, userId, bet);
  if (newBalance === null) {
    const user = await store.getUser(userId);
    const missing = bet - user.balance;
    return interaction.reply({
      embeds: [errorEmbedGame(`Solde insuffisant ! Il te manque **${fmtCoins(missing)}**.\nTon solde : **${fmtCoins(user.balance)}** — récupère ton \`/daily\` ou gagne au casino !`)],
      ephemeral: true,
    });
  }

  const game = {
    userId,
    store,
    bet,
    stake: bet,
    doubled: false,
    finished: false,
    settled: false, // anti double-crédit (clic + timeout simultanés)
    busy: false,
    deck: core.createDeck(1),
    player: [],
    dealer: [],
    message: null,
    collector: null,
  };
  game.player.push(game.deck.pop(), game.deck.pop());
  game.dealer.push(game.deck.pop(), game.deck.pop());
  activeGames.set(userId, game);

  // Blackjacks naturels : la partie se termine immédiatement
  const playerNatural = core.isNatural(game.player);
  const dealerNatural = core.isNatural(game.dealer);
  if (playerNatural || dealerNatural) {
    const result = playerNatural && dealerNatural ? 'push' : playerNatural ? 'win' : 'lose';
    const embed = await settle(game, { result, natural: playerNatural && !dealerNatural });
    if (!embed) return; // déjà réglée (cas impossible ici, par sécurité)
    return interaction.reply({ embeds: [embed] });
  }

  await interaction.reply({
    embeds: [
      gameEmbed(game, {
        note: `Mise engagée : **${fmtCoins(game.bet)}** — Piocher, Rester ou Doubler ?\n_Inactivité 90 s = Rester automatique._`,
      }),
    ],
    components: [buttonsRow(game)],
  });

  // Si le message de partie est inaccessible (raté réseau), on rembourse et on
  // nettoie : sans message, la partie ne peut pas continuer et le joueur
  // resterait bloqué (« déjà une partie en cours ») avec une mise avalée.
  try {
    game.message = await interaction.fetchReply();
  } catch (err) {
    console.error('[blackjack] Impossible de récupérer le message de partie :', err.message);
    await economy.credit(game.store, game.userId, game.stake);
    cleanup(game);
    const { errorEmbed } = require('../utils/embeds');
    const payload = { embeds: [errorEmbed('Impossible d\'afficher la partie — ta mise a été **remboursée**. Relance `/blackjack`.')], ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {}
    return;
  }

  const collector = game.message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: IDLE_TIMEOUT_MS,
  });
  game.collector = collector;

  collector.on('collect', (buttonInteraction) => handleButton(buttonInteraction, game));

  collector.on('end', async (_collected, reason) => {
    if (game.finished || game.settled || game.busy || reason === 'finished') return;
    // Inactivité : on reste automatiquement
    try {
      game.dealer = core.dealerPlay(game.dealer, game.deck);
      const result = core.compareHands(game.player, game.dealer);
      const embed = await settle(game, { result, note: '⏰ Temps écoulé — tu es resté automatiquement.' });
      if (!embed) return; // déjà réglé par un clic simultané
      await game.message.edit({ embeds: [embed], components: [buttonsRow(game, true)] });
    } catch (err) {
      console.error('[blackjack] Fin par inactivité échouée :', err.message);
      cleanup(game);
    }
  });
}

function errorEmbedGame(message) {
  // import tardif pour éviter une dépendance circulaire
  const { errorEmbed } = require('../utils/embeds');
  return errorEmbed(message);
}

/** Met à jour le message avec le résultat final (rien à faire si déjà réglée). */
async function finishUpdate(interaction, game, embed) {
  if (!embed) return; // partie déjà réglée par un événement concurrent
  await interaction.update({ embeds: [embed], components: [buttonsRow(game, true)] });
}

/** Bouton pressé (bj:hit / bj:stand / bj:double) */
async function handleButton(interaction, game) {
  if (interaction.user.id !== game.userId) {
    return interaction.reply({
      embeds: [errorEmbedGame("Ce n'est pas ta partie ! Lance ta propre partie avec `/blackjack`.")],
      ephemeral: true,
    });
  }
  // Anti-hijack : le bouton doit venir du message DE cette partie. Sans ce
  // contrôle, un joueur ayant sa propre partie en cours pourrait cliquer sur
  // les boutons du message d'un autre et faire avancer SA partie chez l'autre.
  if (game.message && interaction.message && game.message.id !== interaction.message.id) {
    return interaction.reply({
      embeds: [errorEmbedGame("Ce n'est pas ta partie ! Lance ta propre partie avec `/blackjack`.")],
      ephemeral: true,
    });
  }
  if (game.finished || game.settled || game.busy) return;

  game.busy = true;
  try {
    const action = interaction.customId;

    if (action === 'bj:hit') {
      game.player.push(game.deck.pop());
      const total = core.handValue(game.player).total;

      if (total > 21) {
        const embed = await settle(game, { result: 'lose' });
        return await finishUpdate(interaction, game, embed);
      }
      if (total === 21) {
        game.dealer = core.dealerPlay(game.dealer, game.deck);
        const result = core.compareHands(game.player, game.dealer);
        const embed = await settle(game, { result });
        return await finishUpdate(interaction, game, embed);
      }
      return await interaction.update({
        embeds: [gameEmbed(game, { note: `Tu pioches… **${total}**. Piocher, Rester ou Doubler ?` })],
        components: [buttonsRow(game)],
      });
    }

    if (action === 'bj:stand') {
      const embed = await dealerTurn(game);
      return await finishUpdate(interaction, game, embed);
    }

    if (action === 'bj:double') {
      if (!canDouble(game)) {
        return await interaction.reply({
          embeds: [errorEmbedGame('Tu ne peux doubler qu\'au premier coup.')],
          ephemeral: true,
        });
      }
      const extra = await economy.tryDebit(game.store, game.userId, game.bet);
      if (extra === null) {
        return await interaction.reply({
          embeds: [errorEmbedGame(`Solde insuffisant pour doubler (il faut encore **${fmtCoins(game.bet)}**).`)],
          ephemeral: true,
        });
      }
      game.doubled = true;
      game.stake = game.bet * 2;
      game.player.push(game.deck.pop());
      const total = core.handValue(game.player).total;

      if (total > 21) {
        const embed = await settle(game, { result: 'lose' });
        return await finishUpdate(interaction, game, embed);
      }
      const embed = await dealerTurn(game);
      return await finishUpdate(interaction, game, embed);
    }
  } catch (err) {
    console.error('[blackjack] Erreur pendant le tour :', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ embeds: [errorEmbedGame('Une erreur est survenue pendant la partie.')], ephemeral: true });
      }
    } catch {}
  } finally {
    game.busy = false;
  }
}

module.exports = { startBlackjack, handleButton, isPlaying, activeGames };
