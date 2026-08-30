// ============================================================
// /daily — 100 coins par jour, réservé aux membres ayant
// au moins 1 invitation réussie sur le serveur.
// ============================================================
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const economy = require('../services/economy');
const invites = require('../services/invites');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtCoins, discordRelative } = require('../utils/format');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription(`Récupère tes ${config.dailyReward} coins quotidiens (1 invitation réussie requise)`)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const store = interaction.client.store;
    const result = await economy.claimDaily(store, interaction.user.id);

    if (result.status === 'ok') {
      const embed = baseEmbed(COLORS.success)
        .setTitle('🎁 Daily récupéré !')
        .setDescription(
          `**+${fmtCoins(result.reward)}** viennent s'ajouter à ta bourse, <@${interaction.user.id}> !\n\n` +
            `💰 Nouveau solde : **${fmtCoins(result.balance)}**\n` +
            `⏳ Prochain daily : ${discordRelative(Date.now() + config.dailyCooldownMs)}`
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (result.status === 'cooldown') {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('⏳ Déjà récupéré !')
        .setDescription(
          `Ton daily a déjà été récupéré.\nReviens ${discordRelative(result.nextAvailableAt)} (dans **${result.timeLeft}**).`
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Pas d'invitation réussie
    const embed = baseEmbed(COLORS.error)
      .setTitle('🔒 Daily verrouillé')
      .setDescription(
        `Le daily est réservé aux membres qui ont **au moins 1 invitation réussie** sur le serveur.\n\n` +
          '**Comment débloquer :**\n' +
          '1️⃣ Crée un lien d\'invitation (sur Discord : salon texte → icône ➕ *Inviter des personnes*, ou Paramètres du serveur → Invitations)\n' +
          '2️⃣ Envoie-le à un ami et fais-le rejoindre\n' +
          '3️⃣ Tant qu\'il reste sur le serveur, ton invitation compte ✅\n\n' +
          'Vérifie ensuite avec `/invitations` puis reviens récupérer ton daily !'
      );

    if (!invites.isTrackingAvailable(interaction.guildId)) {
      embed.addFields({
        name: '⚠️ Note pour l\'admin',
        value: 'Le tracking d\'invitations est **désactivé** : le bot a besoin de la permission **Gérer le serveur** (et de l\'intent *Server Members*).',
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
