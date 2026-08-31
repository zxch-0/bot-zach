// ============================================================
// ZachServices — Auto-test (sans Discord)
// Vérifie la logique métier : stockage, économie, /daily,
// invitations, blackjack, RPS et boutique.
// Lancer : npm run selftest
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const { JsonStore } = require('../src/storage/json');
const economy = require('../src/services/economy');
const blackjack = require('../src/games/blackjack');
const rps = require('../src/games/rps');
const shopService = require('../src/services/shop');
const invitesService = require('../src/services/invites');
const config = require('../src/config');
const { cut } = require('../src/utils/format');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

(async () => {
  const dbFile = path.join(os.tmpdir(), `zachservices-test-${Date.now()}.json`);
  const store = new JsonStore(dbFile);
  await store.init();

  console.log('\n━ 🗄️  Stockage & économie');
  check('solde initial à 0', (await store.getUser('u1')).balance === 0);
  check('crédit 500', (await store.credit('u1', 500)) === 500);
  check('débit 200', (await store.debit('u1', 200)) === 300);
  check('débit refusé si solde insuffisant', (await store.debit('u1', 301)) === null);
  check('le solde reste 300', (await store.getUser('u1')).balance === 300);
  await store.credit('u2', 1000);
  const top = await store.topBalances(10);
  check('classement ordonné', top[0].userId === 'u2' && top.length === 2);

  console.log('\n━ 🎟️  Invitations');
  check('compteur vide au départ', (await store.getInviteCount('inv1')).count === 0);
  await store.recordJoin('m1', 'inv1');
  check('+1 après l\'arrivée du membre invité', (await store.getInviteCount('inv1')).count === 1);
  await store.recordJoin('m1', 'inv1'); // doublon ignoré
  check('doublon non compté deux fois', (await store.getInviteCount('inv1')).count === 1);
  await store.recordLeave('m1');
  check('-1 quand le membre part', (await store.getInviteCount('inv1')).count === 0);
  await store.recordJoin('m1', 'inv2'); // il revient via un autre lien
  check('rejoin crédite le nouvel inviteur', (await store.getInviteCount('inv2')).count === 1);
  await store.recordJoin('m2', 'inv2', Date.now());
  await store.recordLeave('m2', Date.now());
  check('compteur jamais négatif', (await store.getInviteCount('inv2')).count === 1);
  await store.importInvites({ inv1: 7 });
  check('import ok', (await store.getInviteCount('inv1')).imported === 7);

  console.log('\n━ 🎁 /daily');
  const noInvite = await economy.claimDaily(store, 'u3');
  check('refusé sans invitation', noInvite.status === 'no_invite');
  await store.recordJoin('friend', 'u3');
  const ok1 = await economy.claimDaily(store, 'u3');
  check('accepté avec 1 invitation', ok1.status === 'ok');
  check(`récompense de ${ok1.reward} coins`, ok1.reward === 100 && ok1.balance === 100);
  const cooldown = await economy.claimDaily(store, 'u3');
  check('cooldown de 24 h actif', cooldown.status === 'cooldown');

  console.log('\n━ 🃏 Blackjack (logique pure)');
  const C = (rank, suit = '♠️') => ({ rank, suit });
  check('A+K = 21 (soft)', blackjack.handValue([C('A'), C('K')]).total === 21);
  check('A+A = 12', blackjack.handValue([C('A'), C('A')]).total === 12);
  check('A+9+A = 21', blackjack.handValue([C('A'), C('9'), C('A')]).total === 21);
  check('K+Q+5 = 25 (bust)', blackjack.handValue([C('K'), C('Q'), C('5')]).total === 25);
  check('10+A = 21 naturel', blackjack.isNatural([C('10'), C('A')]) === true);
  check('7+7+7 n\'est pas un naturel', blackjack.isNatural([C('7'), C('7'), C('7')]) === false);
  check('le croupier tire à 16', blackjack.dealerShouldHit([C('10'), C('6')]) === true);
  check('le croupier s\'arrête à 17', blackjack.dealerShouldHit([C('10'), C('7')]) === false);
  check('sabot de 52 cartes', blackjack.createDeck(1).length === 52);
  check('sabot de 6 jeux = 312 cartes', blackjack.createDeck(6).length === 312);
  // Croupier avec un sabot contrôlé : il doit s'arrêter à 17
  // (deck.pop() pioche depuis la fin : il tirera le 2 puis s'arrêterait sur 17)
  const riggedDeck = [C('5'), C('2')];
  const dealerFinal = blackjack.dealerPlay([C('10'), C('5')], riggedDeck);
  check('le croupier joue jusqu\'à 17', blackjack.handValue(dealerFinal).total === 17);
  check('victoire payée 2x', blackjack.payoutFor('win', 100) === 200);
  check('blackjack naturel payé 2,5x', blackjack.payoutFor('win', 100, true) === 250);
  check('égalité remboursée', blackjack.payoutFor('push', 100) === 100);
  check('défaite payée 0', blackjack.payoutFor('lose', 100) === 0);
  check('21 vs 20 = win', blackjack.compareHands([C('A'), C('K')], [C('10'), C('Q')]) === 'win');
  check('18 vs 18 = push', blackjack.compareHands([C('10'), C('8')], [C('9'), C('9')]) === 'push');

  console.log('\n━ ✂️  Pierre-feuille-ciseaux');
  check('pierre bat ciseaux', rps.resolveRps('rock', 'scissors') === 'win');
  check('ciseaux battent feuille', rps.resolveRps('scissors', 'paper') === 'win');
  check('feuille bat pierre', rps.resolveRps('paper', 'rock') === 'win');
  check('pierre vs pierre = tie', rps.resolveRps('rock', 'rock') === 'tie');
  check('pierre vs feuille = lose', rps.resolveRps('rock', 'paper') === 'lose');
  check('victoire payée 2x', rps.payoutFor('win', 100) === 200);
  check('égalité remboursée', rps.payoutFor('tie', 100) === 100);
  const picks = new Set(Array.from({ length: 200 }, () => rps.botPick()));
  check('le bot choisit parmi les 3 coups', [...picks].every((p) => rps.CHOICE_KEYS.includes(p)) && picks.size >= 1);

  console.log('\n━ 🛒 Boutique & produits');
  const buyer = { id: 'u2', username: 'acheteur-test' };
  const product = await shopService.getProduct(store, 'zach-checker');
  check('produit 1 : Zach-checker à 1000 coins', product && product.price === 1000);
  const premium = await shopService.getProduct(store, 'zach-checker-premium');
  check('produit 2 : Zach-checker Premium à 5000 coins', premium && premium.price === 5000);
  check('produits par défaut créés automatiquement', (await store.listProducts()).length === 2);
  const before = (await store.getUser(buyer.id)).balance; // 1000
  const poor = await shopService.processPurchase({ store, buyer: { id: 'u1', username: 'pauvre' }, product: premium, deliveryUsername: 'pauvre' });
  check('achat refusé si solde insuffisant', poor.ok === false && poor.reason === 'insufficient');
  const purchase = await shopService.processPurchase({ store, buyer, product, deliveryUsername: 'livraison-test' });
  check('achat accepté si solde suffisant', purchase.ok === true);
  check('coins débités du bon montant', (await store.getUser(buyer.id)).balance === before - product.price);

  console.log('\n━ 🛠️  /product (gestion dynamique)');
  const added = await shopService.addProduct(store, { name: 'Checker Doré', price: 2500, description: 'Édition dorée', emoji: '🏆', actorId: 'admin1' });
  check('ajout produit (slug sans accents)', added.ok === true && added.product.id === 'checker-dore');
  const duplicate = await shopService.addProduct(store, { name: 'Checker Doré', price: 100, description: '', emoji: '' });
  check('nom dupliqué → id suffixé', duplicate.ok === true && duplicate.product.id === 'checker-dore-2');
  const badPrice = await shopService.addProduct(store, { name: 'Cassé', price: 0 });
  check('prix invalide refusé', badPrice.ok === false);
  const badName = await shopService.addProduct(store, { name: '', price: 100 });
  check('nom vide refusé', badName.ok === false);
  const badEmoji = await shopService.addProduct(store, { name: 'Emoji Test', price: 100, emoji: 'texte pas emoji' });
  check('emoji non valide remplacé par 📦', badEmoji.ok === true && badEmoji.product.emoji === '📦');
  const okEmoji = await shopService.addProduct(store, { name: 'Emoji Valide', price: 100, emoji: '🚀' });
  check('emoji unicode accepté', okEmoji.ok === true && okEmoji.product.emoji === '🚀');
  const customEmoji = await shopService.addProduct(store, { name: 'Emoji Custom', price: 100, emoji: '<a:spin:123456789012345678>' });
  check('emoji custom <:nom:id> accepté', customEmoji.ok === true && customEmoji.product.emoji === '<a:spin:123456789012345678>');
  const slug = shopService.slugify('Ça c\'est un Super Produit !');
  check('slug sans accents ni caractères spéciaux', slug === 'ca-c-est-un-super-produit');
  check('isSafeEmoji refuse un texte long', shopService.isSafeEmoji('bonjour') === false);
  check('menu boutique : null si vide', shopService.buildShopRow([]) === null);
  const row = shopService.buildShopRow(await store.listProducts());
  check('menu boutique construit avec les produits', row !== null && row.components.length === 1);
  const modal = shopService.buildDeliveryModal({ id: 'x'.repeat(40), name: 'N'.repeat(60) });
  check('titre de modale tronqué à 45 caractères', modal.data.title.length <= 45);
  const removed = await shopService.removeProduct(store, 'checker-dore');
  check('retrait produit', removed.ok === true && removed.product.id === 'checker-dore');
  const removedTwice = await shopService.removeProduct(store, 'checker-dore');
  check('retrait d\'un produit absent refusé', removedTwice.ok === false);
  check(' limite 25 produits respectée', config.maxProducts === 25);

  console.log('\n━ 🪙 /give (ajustement admin)');
  await store.credit('u5', 300);
  const add = await economy.adminAdjust(store, 'u5', 200);
  check('ajout simple 300+200=500', add.balance === 500 && add.clamped === false);
  const removeTooMuch = await economy.adminAdjust(store, 'u5', -1000);
  check('retrait plafonné au solde (jamais négatif)', removeTooMuch.balance === 0 && removeTooMuch.clamped === true);
  await economy.adminAdjust(store, 'u5', 100);
  const removeSome = await economy.adminAdjust(store, 'u5', -40);
  check('retrait partiel 100-40=60', removeSome.balance === 60 && removeSome.clamped === false);

  console.log('\n━ 🎟️  Attribution des invitations (service, faux serveur)');
  invitesService.resetTrackingState();
  const mkInvite = (code, uses, inviterId) => ({ code, uses, inviter: { id: inviterId } });
  let invitesList = [mkInvite('aaa', 5, 'invA'), mkInvite('bbb', 3, 'invB')];
  const fakeGuild = {
    id: 'guild-test',
    name: 'ServeurTest',
    vanityURLCode: null,
    invites: { fetch: async () => new Map(invitesList.map((i) => [i.code, i])) },
    fetchVanityURL: async () => ({ uses: 0 }),
  };
  check('syncGuild ok avec la permission', (await invitesService.syncGuild(fakeGuild)) === true);

  // 1) compteur qui monte → bon inviteur
  invitesList = [mkInvite('aaa', 6, 'invA'), mkInvite('bbb', 3, 'invB')];
  let attr = await invitesService.attributeJoin(fakeGuild);
  check('compteur +1 → inviteur crédité', attr && attr.inviterId === 'invA');

  // 2) nouveau lien créé et utilisé entre deux photos
  invitesList = [mkInvite('aaa', 6, 'invA'), mkInvite('bbb', 3, 'invB'), mkInvite('ccc', 1, 'invC')];
  attr = await invitesService.attributeJoin(fakeGuild);
  check('nouveau lien utilisé → son créateur crédité', attr && attr.inviterId === 'invC');

  // 3) invitation à usage unique : lien SUPPRIMÉ par Discord quand il sert
  invitesList = [mkInvite('once', 0, 'invOnce'), mkInvite('aaa', 6, 'invA')];
  await invitesService.syncGuild(fakeGuild);
  invitesService.onInviteDelete({ code: 'once', guild: { id: fakeGuild.id } }); // Discord supprime le lien épuisé
  invitesList = [mkInvite('aaa', 6, 'invA')]; // le lien a disparu des invitations
  attr = await invitesService.attributeJoin(fakeGuild);
  check('lien à usage unique épuisé → créateur retrouvé via la mémoire courte', attr && attr.inviterId === 'invOnce');

  // 4) cas ambigu : deux liens supprimés récemment → on ne devine pas
  invitesService.onInviteDelete({ code: 'x1', guild: { id: fakeGuild.id } });
  // (x1 inconnu du snapshot → non mémorisé ; on mémorise via le snapshot cette fois)
  invitesList = [mkInvite('y1', 2, 'invY1'), mkInvite('y2', 2, 'invY2')];
  await invitesService.syncGuild(fakeGuild);
  invitesService.onInviteDelete({ code: 'y1', guild: { id: fakeGuild.id } });
  invitesService.onInviteDelete({ code: 'y2', guild: { id: fakeGuild.id } });
  invitesList = [];
  attr = await invitesService.attributeJoin(fakeGuild);
  check('deux suppressions récentes → aucune attribution hasardeuse', attr === null);

  // 5) arrivées simultanées sérialisées : chacune voit l'état mis à jour
  invitesService.resetTrackingState();
  let fetchCount = 0;
  invitesList = [mkInvite('aaa', 10, 'invA')];
  const seqGuild = {
    id: 'guild-seq',
    name: 'ServeurTest',
    vanityURLCode: null,
    invites: {
      fetch: async () => {
        fetchCount += 1;
        return new Map([[ 'aaa', mkInvite('aaa', 10 + fetchCount, 'invA') ]]);
      },
    },
    fetchVanityURL: async () => ({ uses: 0 }),
  };
  await invitesService.syncGuild(seqGuild);
  const [r1, r2] = await Promise.all([
    invitesService.attributeJoin(seqGuild),
    invitesService.attributeJoin(seqGuild),
  ]);
  check('arrivées simultanées : la 1re voit 11, la 2e voit 12 (sérialisées)',
    r1 && r1.inviterId === 'invA' && r2 && r2.inviterId === 'invA' && fetchCount === 3);
  invitesService.resetTrackingState();

  console.log('\n━ ✂️  Troncature sûre (anti emoji coupé)');
  const riskyTitle = 'Acheter ' + 'A'.repeat(36) + '🧰'; // l'emoji commence pile à l'indice 44
  const cutTitle = cut(riskyTitle, 45);
  const lastUnit = cutTitle.charCodeAt(cutTitle.length - 1);
  check('cut() ne coupe jamais une paire de substitution', !(lastUnit >= 0xd800 && lastUnit <= 0xdbff));
  check('cut() respecte la longueur demandée (points de code ET unités UTF-16)', Array.from(cutTitle).length <= 45 && cutTitle.length <= 45);
  check('cut() garde les chaînes courtes intactes', cut('abc', 45) === 'abc');
  check('cut() tronque bien les longues chaînes', cut('a'.repeat(50), 45) === 'a'.repeat(45));
  check('cut() accepte null/undefined', cut(null, 10) === '' && cut(undefined, 10) === '');
  const modalRisky = shopService.buildDeliveryModal({ id: 'x', name: 'A'.repeat(36) + '🧰' }); // titre = 46 unités UTF-16 avant troncature
  const modalTitle = modalRisky.data.title;
  check('titre de modale sans orphelin', !(modalTitle.charCodeAt(modalTitle.length - 1) >= 0xd800 && modalTitle.charCodeAt(modalTitle.length - 1) <= 0xdbff));

  console.log('\n━ ⚡ Concurrence (débits simultanés)');
  await store.credit('u9', 1000);
  const races = await Promise.all(Array.from({ length: 30 }, () => store.debit('u9', 100)));
  check('30 débits concurrents : exactement 10 passent', races.filter((r) => r !== null).length === 10);
  check('solde jamais négatif après la course', (await store.getUser('u9')).balance === 0);

  console.log('\n━ 🃏 Intégrité du sabot');
  const deck = blackjack.createDeck(1);
  const uniques = new Set(deck.map((c) => c.rank + c.suit));
  check('52 cartes toutes uniques', deck.length === 52 && uniques.size === 52);
  const counts = {};
  for (let i = 0; i < 5200; i++) {
    const d = blackjack.createDeck(1);
    const card = d[d.length - 1]; // carte piochée par pop()
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }
  const seen = Object.values(counts);
  check('mélange plausible (13 rangs, 150-650 sorties sur 5200)', seen.length === 13 && seen.every((v) => v > 150 && v < 650));

  console.log('\n━ 🛒 Plafond de 25 produits (limite des menus Discord)');
  const limStore = new JsonStore(path.join(os.tmpdir(), `zachservices-lim-${Date.now()}.json`));
  await limStore.init();
  for (let i = 0; i < 40; i++) {
    await shopService.addProduct(limStore, { name: `Produit ${i}`, price: 10, description: '', emoji: '' });
  }
  check('boutique plafonnée à 25 produits (2 défauts + 23 ajouts)', (await limStore.listProducts()).length === 25);
  const refused = await shopService.addProduct(limStore, { name: 'Trop', price: 10 });
  check('ajout refusé au-delà du plafond', refused.ok === false && /pleine/.test(refused.error));
  await limStore.close();
  try { fs.unlinkSync(limStore.filePath); } catch {}

  await store.close();
  try { fs.unlinkSync(dbFile); } catch {}

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} test(s) réussi(s)  |  ❌ ${failed} échec(s)`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Erreur pendant les tests :', err);
  process.exit(1);
});
