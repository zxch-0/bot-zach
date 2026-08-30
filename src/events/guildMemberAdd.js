// ============================================================
// Événement "guildMemberAdd" : un membre arrive.
// On compare les invitations avant/après pour trouver l'inviteur,
// puis on crédite une invitation réussie.
// Anti-triche : s'inviter soi-même (lien créé par soi) ne compte pas.
// ============================================================
const { Events } = require('discord.js');
const invitesService = require('../services/invites');

module.exports = {
  name: Events.GuildMemberAdd,

  async execute(member) {
    if (member.user.bot) return; // les bots ne comptent pas comme invitations

    const { client, guild } = member;
    const attributed = await invitesService.attributeJoin(guild);

    if (!attributed) {
      console.log(`[invitations] ${member.user.tag} a rejoint ${guild.name} — lien non identifié (vanity ou non suivi)`);
      return;
    }

    const { inviterId } = attributed;

    if (inviterId === member.id) {
      console.log(`[invitations] ${member.user.tag} a utilisé son propre lien — invitation ignorée (anti-triche)`);
      return;
    }

    const counted = await client.store.recordJoin(member.id, inviterId);
    if (counted) {
      console.log(`[invitations] ${member.user.tag} a été invité par <@${inviterId}> sur ${guild.name}`);
    }
  },
};
