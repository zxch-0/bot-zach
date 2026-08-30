// ============================================================
// Événement "guildMemberRemove" : un membre part.
// Si un inviteur avait été crédité pour lui, on décompte
// (une invitation réussie = un membre invité TOUJOURS présent).
// ============================================================
const { Events } = require('discord.js');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    const removed = await member.client.store.recordLeave(member.id);
    if (removed) {
      console.log(`[invitations] ${member.user.tag} a quitté ${member.guild.name} — invitation décomptée`);
    }
  },
};
