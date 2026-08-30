// ============================================================
// ZachServices — Simulation d'intégration (sans Discord)
// Exécute les VRAIES commandes et les VRAIS flux avec de fausses
// interactions Discord : /daily, /shop, achat complet (modale +
// MP admin), /produit, /give, /blackjack et /rps.
// Lancer : npm run simulate
// ============================================================
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.ADMIN_USER_IDS = '999000999000999000,999000999000999001'; // admins de test

const { JsonStore } = require('../src/storage/json');
const config = require('../src/config');
config.adminUserIds.push('999000999000999000', '999000999000999001');

const daily = require('../src/commands/daily');
const solde = require('../src/commands/solde');
const shop = require('../src/commands/shop');
const give = require('../src/commands/give');
const produit = require('../src/commands/produit');
const rps = require('../src/commands/rps');
const aide = require('../src/commands/aide');
const classement = require('../src/commands/classement');
const invitationsCmd = require('../src/commands/invitations');
const shopFlow = require('../src/flows/shopFlow');
const blackjackGame = require('../src/games/blackjackGame');

let passed = 0;
let failed = 0;
function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${extra}`);
  }
}

/* ---------- Faux objets Discord ---------- */

function makeClient(store) {
  const sentDMs = [];
  return {
    store,
    commands: new Map(),
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          sentDMs.push({ to: id, payload });
          return payload;
        },
      }),
    },
    channels: { fetch: async () => null },
    _sentDMs: sentDMs,
  };
}

/** Interaction de commande slash factice */
function makeCommandInteraction({ client, user, options = {}, memberPermissionsHas = false, ...rest } = {}) {
  const interaction = {
    client,
    user: user ?? { id: '100000000000000001', username: 'joueur', bot: false },
    guild: { id: '500000000000000001', name: 'ServeurTest' },
    guildId: '500000000000000001',
    memberPermissions: { has: () => memberPermissionsHas },
    member: null,
    replied: false,
    deferred: false,
    replies: [],
    options,
    async reply(payload) {
      this.replied = true;
      this.replies.push(payload);
      return {};
    },
    async followUp(payload) {
      this.replies.push(payload);
      return {};
    },
    ...rest,
  };
  return interaction;
}

function embedText(payload) {
  if (!payload || !payload.embeds || !payload.embeds[0]) return '';
  const embed = payload.embeds[0];
  const data = embed.data || embed;
  const fields = (data.fields || []).map((f) => `${f.name} ${f.value}`).join(' ');
  return `${data.title || ''} ${data.description || ''} ${fields}`;
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `zachservices-sim-${Date.now()}.json`);
  const store = new JsonStore(dbFile);
  await store.init();
  const client = makeClient(store);
  const joueur = { id: '100000000000000001', username: 'joueur', bot: false };
  const admin = { id: '999000999000999000', username: 'admin', bot: false };

  console.log('\n━ 🎁 /daily — verrouillage par invitation');
  let it = makeCommandInteraction({ client, user: joueur });
  await daily.execute(it);
  check('refusé sans invitation', /verrouillé|invitation/i.test(embedText(it.replies[0])) && it.replies[0].ephemeral === true);

  await store.recordJoin('100000000000000002', joueur.id);
  it = makeCommandInteraction({ client, user: joueur });
  await daily.execute(it);
  check('accepté avec 1 invitation (+100)', /daily récupéré/i.test(embedText(it.replies[0])));
  check('solde = 100 après daily', (await store.getUser(joueur.id)).balance === 100);

  it = makeCommandInteraction({ client, user: joueur });
  await daily.execute(it);
  check('cooldown immédiat', /déjà récupéré/i.test(embedText(it.replies[0])));

  console.log('\n━ 💰 /solde, /classement, /invitations, /aide');
  it = makeCommandInteraction({ client, user: joueur, options: { getUser: () => joueur } });
  await solde.execute(it);
  check('/solde affiche 100 coins', /100/.test(embedText(it.replies[0])));

  it = makeCommandInteraction({ client, user: joueur });
  await classement.execute(it);
  check('/classement liste le joueur', /joueur|100/.test(embedText(it.replies[0])));

  it = makeCommandInteraction({ client, user: joueur, options: { getUser: () => joueur } });
  await invitationsCmd.execute(it);
  check('/invitations affiche 1 invitation', /1.*invitation/i.test(embedText(it.replies[0])));

  it = makeCommandInteraction({ client, user: joueur });
  await aide.execute(it);
  check('/aide se construit sans erreur', it.replies.length === 1);

  console.log('\n━ 🛠️  /give (admin)');
  it = makeCommandInteraction({ client, user: joueur, options: { getUser: () => joueur, getInteger: () => 5000 } });
  await give.execute(it);
  check('/give refusé pour un non-admin', /réservée/i.test(embedText(it.replies[0])));

  it = makeCommandInteraction({ client, user: admin, options: { getUser: () => joueur, getInteger: () => 5000 } });
  await give.execute(it);
  check('/give admin crédite 5000 (total 5100)', /5 100/.test(embedText(it.replies[0]).replace(/\u202f/g, ' ')));

  it = makeCommandInteraction({ client, user: admin, options: { getUser: () => joueur, getInteger: () => -999999 } });
  await give.execute(it);
  check('/give retrait plafonné (solde 0)', /0\s*🪙|plafonné/i.test(embedText(it.replies[0]).replace(/\u202f/g, ' ')));
  await store.credit(joueur.id, 5100); // restaure pour la suite

  console.log('\n━ 📦 /produit (admin, boutique dynamique)');
  it = makeCommandInteraction({
    client,
    user: joueur,
    options: { getSubcommand: () => 'liste' },
  });
  await produit.execute(it);
  check('/produit refusé pour un non-admin', /réservée/i.test(embedText(it.replies[0])));

  it = makeCommandInteraction({
    client,
    user: admin,
    options: {
      getSubcommand: () => 'ajouter',
      getString: (name) => ({ nom: 'Checker Doré', description: 'Édition limitée', emoji: '🏆' }[name] ?? null),
      getInteger: () => 2500,
    },
  });
  await produit.execute(it);
  const productsAfterAdd = await store.listProducts();
  check('produit ajouté via /produit ajouter', productsAfterAdd.some((p) => p.id === 'checker-dore'));

  it = makeCommandInteraction({
    client,
    user: admin,
    options: { getSubcommand: () => 'retirer', getString: () => 'checker-dore' },
  });
  await produit.execute(it);
  check('produit retiré via /produit retirer', !(await store.listProducts()).some((p) => p.id === 'checker-dore'));

  it = makeCommandInteraction({ client, user: admin, options: { getSubcommand: () => 'liste' } });
  await produit.execute(it);
  check('/produit liste fonctionne', it.replies.length === 1);

  // Autocomplétion
  const autoIt = {
    client,
    user: admin,
    options: { getFocused: () => ({ name: 'produit', value: 'zach' }) },
    responded: false,
    async respond(choices) {
      this.responded = true;
      this.choices = choices;
    },
  };
  await produit.autocomplete(autoIt);
  check('autocomplétion propose les produits', autoIt.responded && autoIt.choices.length >= 2 && autoIt.choices[0].value === 'zach-checker');

  console.log('\n━ 🛒 /shop + achat complet (modale → débit → MP admin)');
  it = makeCommandInteraction({ client, user: joueur });
  await shop.execute(it);
  check('/shop affiche produits + menu', it.replies[0].embeds.length === 1 && it.replies[0].components.length === 1);

  // Achat : solde insuffisant (Premium = 5000, solde 5100-? -> on vide d'abord)
  await store.debit(joueur.id, 4100); // solde = 1000
  const selectIt = {
    client,
    user: joueur,
    guild: { id: '500000000000000001', name: 'ServeurTest' },
    values: ['zach-checker-premium'],
    replies: [],
    modals: [],
    async reply(p) { this.replies.push(p); return {}; },
    async update(p) { this.replies.push(p); return {}; },
    async showModal(m) { this.modals.push(m); },
  };
  await shopFlow.handleBuySelect(selectIt);
  check('achat refusé : solde insuffisant (message éphémère)', /insuffisant/i.test(embedText(selectIt.replies[0])) && selectIt.replies[0].ephemeral === true);

  await store.credit(joueur.id, 4000); // solde = 5000
  await shopFlow.handleBuySelect(selectIt);
  check('achat ouvre la modale pseudo de livraison', selectIt.modals.length === 1 && /shop:modal:zach-checker-premium/.test(selectIt.modals[0].data.custom_id));

  const modalIt = {
    client,
    user: joueur,
    guild: { id: '500000000000000001', name: 'ServeurTest' },
    customId: 'shop:modal:zach-checker-premium',
    fields: { getTextInputValue: () => 'pseudo-livraison' },
    replies: [],
    async reply(p) { this.replies.push(p); return {}; },
  };
  await shopFlow.handleModal(modalIt);
  check('achat confirmé à l\'acheteur', /confirmé/i.test(embedText(modalIt.replies[0])));
  check('5000 coins débités', (await store.getUser(joueur.id)).balance === 0);
  const dm = client._sentDMs[0];
  check('MP envoyé à l\'admin 1', !!dm && /Nouvel achat/.test(embedText(dm.payload)));
  check('MP contient acheteur + produit + pseudo', /joueur/.test(embedText(dm.payload)) && /Premium/.test(embedText(dm.payload)) && /pseudo-livraison/.test(embedText(dm.payload)));
  check('MP envoyé à l\'admin 2 aussi', client._sentDMs.some((d) => d.to === '999000999000999001'));

  console.log('\n━ 🃏 /blackjack (partie complète simulée)');
  await store.credit(joueur.id, 500);
  const bjReplies = [];
  const bjInteraction = {
    client,
    user: joueur,
    guild: { id: 'g', name: 'ServeurTest' },
    replied: false,
    deferred: false,
    async reply(payload) {
      this.replied = true;
      bjReplies.push(payload);
      return { id: '1' };
    },
    async fetchReply() {
      return {
        createMessageComponentCollector: () => ({ on() {}, stop() {} }),
      };
    },
  };
  // On relance jusqu'à obtenir une partie non immédiate (pas de blackjack naturel d'office)
  let attempts = 0;
  let game = null;
  while (attempts++ < 50 && !game) {
    if (blackjackGame.isPlaying(joueur.id)) {
      // nettoie une éventuelle partie instantanée
      const g = blackjackGame.activeGames.get(joueur.id);
      if (g) { g.finished = true; blackjackGame.activeGames.delete(joueur.id); }
    }
    const balanceBefore = (await store.getUser(joueur.id)).balance;
    await blackjackGame.startBlackjack(bjInteraction, 100);
    const g = blackjackGame.activeGames.get(joueur.id);
    if (g) {
      game = g;
      check('mise de 100 débitée au lancement', (await store.getUser(joueur.id)).balance === balanceBefore - 100);
    } else {
      // partie instantanée (blackjack naturel) : on crédite pour retenter
      await store.credit(joueur.id, 100);
    }
  }
  check('une partie interactive démarre', !!game);

  if (game) {
    const updates = [];
    const btn = {
      user: joueur,
      customId: 'bj:stand',
      async update(payload) { updates.push(payload); return {}; },
      async reply(p) { updates.push(p); return {}; },
    };
    // marque la réponse initiale comme effectuée
    await blackjackGame.handleButton(btn, game);
    check('partie soldée après "Rester"', updates.length === 1);
    const text = embedText(updates[0]);
    check('résultat + nouveau solde affichés', /Nouveau solde/.test(text));
    check('boutons désactivés à la fin', updates[0].components[0].components.every((b) => b.data.disabled === true));
    check('plus de partie active après la fin', !blackjackGame.isPlaying(joueur.id));

    const balanceAfter = (await store.getUser(joueur.id)).balance;
    check('solde cohérent (400 perdant / 500 égalité / 600 gagnant)', [400, 500, 600].includes(balanceAfter));
  }

  // Double partie interdite
  await store.credit(joueur.id, 100);
  const bjIt1 = makeCommandInteraction({
    client,
    user: joueur,
    async fetchReply() {
      return { createMessageComponentCollector: () => ({ on() {}, stop() {} }) };
    },
  });
  const bjIt2 = makeCommandInteraction({
    client,
    user: joueur,
    async fetchReply() {
      return { createMessageComponentCollector: () => ({ on() {}, stop() {} }) };
    },
  });
  await blackjackGame.startBlackjack(bjIt1, 50);
  await blackjackGame.startBlackjack(bjIt2, 50);
  check('double partie détectée', /déjà une.*partie/i.test(embedText(bjIt2.replies[0])));
  const g2 = blackjackGame.activeGames.get(joueur.id);
  if (g2) { g2.finished = true; blackjackGame.activeGames.delete(joueur.id); await store.credit(joueur.id, 50); }

  console.log('\n━ ✂️  /rps');
  await store.credit(joueur.id, 100);
  const balanceBeforeRps = (await store.getUser(joueur.id)).balance;
  const rpsIt = makeCommandInteraction({
    client,
    user: joueur,
    options: { getInteger: () => 50, getString: () => 'pierre' },
  });
  await rps.execute(rpsIt);
  check('/rps se joue et affiche le résultat', /Pierre|Égalité|bot gagne/i.test(embedText(rpsIt.replies[0])));
  const afterRps = (await store.getUser(joueur.id)).balance;
  check('solde cohérent après /rps (débit + gain nul/remboursé/doublé)', [balanceBeforeRps - 50, balanceBeforeRps, balanceBeforeRps + 50].includes(afterRps));

  console.log('\n━ 🛡️  Gestion d\'erreur');
  const errIt = makeCommandInteraction({ client, user: admin, options: { getUser: () => null, getInteger: () => 10 } });
  await give.execute(errIt); // admin sans cible valide
  check('cible invalide gérée proprement', /invalide/i.test(embedText(errIt.replies[0])));

  await store.close();
  try { fs.unlinkSync(dbFile); } catch {}

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} test(s) réussi(s)  |  ❌ ${failed} échec(s)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Erreur pendant la simulation :', err);
  process.exit(1);
});
