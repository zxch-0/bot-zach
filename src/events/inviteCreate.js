// ============================================================
// Événement "inviteCreate" : un nouveau lien d'invitation
// est créé → on l'ajoute au snapshot pour un suivi fiable.
// ============================================================
const { Events } = require('discord.js');
const invitesService = require('../services/invites');

module.exports = {
  name: Events.InviteCreate,

  async execute(invite) {
    invitesService.onInviteCreate(invite);
  },
};
