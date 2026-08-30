// ============================================================
// Événement "inviteDelete" : un lien d'invitation est supprimé
// → on le retire du snapshot.
// ============================================================
const { Events } = require('discord.js');
const invitesService = require('../services/invites');

module.exports = {
  name: Events.InviteDelete,

  async execute(invite) {
    invitesService.onInviteDelete(invite);
  },
};
