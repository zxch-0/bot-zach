// ============================================================
// /daily — 100 coins per day, for members with at least 1 successful invite on the server.
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
    .setDescription(`Get your ${config.dailyReward} daily coins (1 successful invite required)`)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const store = interaction.client.store;
    const result = await economy.claimDaily(store, interaction.user.id);

    if (result.status === 'ok') {
      const embed = baseEmbed(COLORS.success)
        .setTitle('🎁 Daily claimed !')
        .setDescription(
          `**+${fmtCoins(result.reward)}** are added to your balance, <@${interaction.user.id}>!\n\n`
            `💰 New balance: **${fmtCoins(result.balance)}**\n`
            `Next daily: ${discordRelative(Date.now() + config.dailyCooldownMs)}`
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (result.status === 'cooldown') {
      const embed = baseEmbed(COLORS.warning)
        .setTitle('⏳ Already claimed !')
        .setDescription(
          `Your daily has already been claimed.\nReclaim ${discordRelative(result.nextAvailableAt)} (in **${result.timeLeft}**).`
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // No successful invite
    const embed = baseEmbed(COLORS.error)
      .setTitle('🔒 Daily locked')
      .setDescription(
        `The daily is reserved for members with at least 1 successful invite on the server.\n\n**
Command to unlock:\n1️⃣ Create an invite link (on Discord: text channel ➕ *Invite people*, or Server Settings → Invitations)\n2️⃣ Send it to a friend and have them join\n3️⃣ As long as they remain on the server, their invite counts ✅\n\nCheck then with /invitations and claim your daily !`
      );

    if (!invites.isTrackingAvailable(interaction.guildId)) {
      embed.addFields({
        name: '⚠️ Note for admin',
        value: 'Invite tracking is **disabled**: the bot needs Manage Server permission (and Server Members intent).',
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};