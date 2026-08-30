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

  console.log('\n━ 🃏 /blackjack — régressions sécurité (double règlement, hijack, fetchReply)');
  // Le joueur garde une partie A active ; un autre joueur B a aussi sa partie.
  await store.credit(joueur.id, 400);
  await store.credit('100000000000000003', 400);
  const otherUser = { id: '100000000000000003', username: 'autre', bot: false };

  const startFor = async (user) => {
    const it = makeCommandInteraction({
      client,
      user,
      async fetchReply() {
        return { id: `msg-${user.id}`, createMessageComponentCollector: () => ({ on() {}, stop() {} }) };
      },
    });
    await blackjackGame.startBlackjack(it, 100);
    return blackjackGame.activeGames.get(user.id);
  };

  // Relance jusqu'à obtenir une partie interactive (ni blackjack naturel)
  let gameA = null;
  for (let i = 0; i < 50 && !gameA; i++) {
    gameA = await startFor(joueur);
    if (gameA) break;
    await store.credit(joueur.id, 100);
  }
  let gameB = null;
  for (let i = 0; i < 50 && !gameB; i++) {
    gameB = await startFor(otherUser);
    if (gameB) break;
    await store.credit('100000000000000003', 100);
  }
  check('deux parties indépendantes actives', !!gameA && !!gameB && gameA !== gameB);

  // BUG corrigé 1 : B (qui a SA partie en cours) clique sur les boutons du
  // message de A → doit être refusé. On passe la partie de B au handler, comme
  // le ferait le routeur (activeGames.get(B)) : seul le garde "message" peut
  // détecter le détournement.
  const hijackReplies = [];
  const hijackBtn = {
    user: otherUser, // B...
    message: { id: gameA.message.id }, // ...clique sur le message de A
    customId: 'bj:stand',
    async reply(p) { hijackReplies.push(p); return {}; },
    async update(p) { hijackReplies.push(p); return {}; },
  };
  const balanceBBefore = (await store.getUser(otherUser.id)).balance;
  await blackjackGame.handleButton(hijackBtn, gameB);
  check('hijack refusé : clic de B sur le message de A', /pas ta partie/i.test(embedText(hijackReplies[0])) && hijackReplies[0].ephemeral === true);
  check('la partie de B reste intacte (non réglée, solde inchangé)', gameB.settled === false && (await store.getUser(otherUser.id)).balance === balanceBBefore);

  // BUG corrigé 2 : double règlement — stand puis re-stand simultané
  const balanceBeforeStand = (await store.getUser(joueur.id)).balance;
  const standBtn = {
    user: joueur,
    message: { id: gameA.message.id },
    customId: 'bj:stand',
    updates: [],
    async update(p) { this.updates.push(p); return {}; },
    async reply(p) { this.updates.push(p); return {}; },
  };
  await blackjackGame.handleButton(standBtn, gameA); // 1er stand → règle la partie
  const balanceAfterStand = (await store.getUser(joueur.id)).balance;
  await blackjackGame.handleButton(standBtn, gameA); // 2e stand (déjà réglée) → ignoré
  const balanceAfterDoubleStand = (await store.getUser(joueur.id)).balance;
  check('un seul règlement (pas de double crédit)', balanceAfterStand === balanceAfterDoubleStand);
  // la mise (100) a été débitée AU LANCEMENT : perte = +0, égalité = +100, gain = +200
  check('partie soldée une fois (perte / remboursement / gain)', [balanceBeforeStand, balanceBeforeStand + 100, balanceBeforeStand + 200].includes(balanceAfterStand));
  // le 1er update = plateau final (boutons désactivés), le 2e clic reçoit « partie terminée »
  check('boutons désactivés après le règlement', standBtn.updates.length >= 1 && standBtn.updates[0].components[0].components.every((b) => b.data.disabled === true));
  check('clic après la fin → message « partie terminée »', standBtn.updates.length >= 2 && /termin\u00e9e/i.test(embedText(standBtn.updates[1])) && standBtn.updates[1].ephemeral === true);

  // BUG corrigé 3 : fetchReply qui échoue → remboursement + partie nettoyée
  // (utilise un 3e utilisateur : les deux premiers ont déjà une partie active)
  const thirdUser = { id: '100000000000000004', username: 'troisieme', bot: false };
  const failReplies = [];
  const failIt = makeCommandInteraction({
    client,
    user: thirdUser,
    async fetchReply() { throw new Error('raté réseau'); },
    async followUp(p) { failReplies.push(p); return {}; },
  });
  // Un blackjack naturel (~5 %) règle la partie AVANT fetchReply : on retente
  // jusqu'à atteindre le vrai chemin fetchReply (solde remis à 300 à chaque tour)
  let fetchReplyPathReached = false;
  for (let i = 0; i < 40 && !fetchReplyPathReached; i++) {
    const bal = (await store.getUser(thirdUser.id)).balance;
    if (bal > 300) await store.debit(thirdUser.id, bal - 300);
    else if (bal < 300) await store.credit(thirdUser.id, 300 - bal);
    failReplies.length = 0;
    await blackjackGame.startBlackjack(failIt, 100);
    fetchReplyPathReached = failReplies.length > 0;
  }
  check('échec fetchReply → mise remboursée', fetchReplyPathReached && (await store.getUser(thirdUser.id)).balance === 300);
  check('échec fetchReply → aucune partie bloquée', !blackjackGame.isPlaying(thirdUser.id));
  check('échec fetchReply → message d\'erreur envoyé', fetchReplyPathReached && /remboursée/i.test(embedText(failReplies[0])));

  // Nettoyage de la partie B restante pour la suite
  if (gameB && blackjackGame.activeGames.has(otherUser.id)) {
    gameB.settled = true;
    gameB.finished = true;
    blackjackGame.activeGames.delete(otherUser.id);
    await store.credit(otherUser.id, 100);
  }

  console.log('\n━ 🃏 /blackjack (déroulé normal)');
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
    const balanceBefore = (await store.getUser(joueur.id)).balance; // après débit de la mise
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
    // mise (100) déjà débitée au lancement : perte = solde inchangé, égalité = +100, gain = +200
    check('solde cohérent après règlement', [balanceBefore, balanceBefore + 100, balanceBefore + 200].includes(balanceAfter));
  }

  // Double partie interdite (un blackjack naturel sur la 1re partie laisserait
  // la 2e démarrer : on boucle jusqu'au vrai cas "partie déjà en cours")
  await store.credit(joueur.id, 100);
  const makeBjIt = () => makeCommandInteraction({
    client,
    user: joueur,
    async fetchReply() {
      return { createMessageComponentCollector: () => ({ on() {}, stop() {} }) };
    },
  });
  let sawDoubleGame = false;
  for (let i = 0; i < 40 && !sawDoubleGame; i++) {
    await blackjackGame.startBlackjack(makeBjIt(), 50);
    const second = makeBjIt();
    await blackjackGame.startBlackjack(second, 50);
    sawDoubleGame = /déjà une.*partie/i.test(embedText(second.replies[0]));
    if (!sawDoubleGame) {
      // la 1re était un naturel ET la 2e a démarré : on nettoie la partie en cours
      const g = blackjackGame.activeGames.get(joueur.id);
      if (g) { g.settled = true; g.finished = true; blackjackGame.activeGames.delete(joueur.id); await store.credit(joueur.id, 50); }
    }
  }
  check('double partie détectée', sawDoubleGame);
  const g2 = blackjackGame.activeGames.get(joueur.id);
  if (g2) { g2.settled = true; g2.finished = true; blackjackGame.activeGames.delete(joueur.id); await store.credit(joueur.id, 50); }

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
