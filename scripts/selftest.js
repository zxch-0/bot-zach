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
  check('pierre bat ciseaux', rps.resolveRps('pierre', 'ciseaux') === 'win');
  check('ciseaux battent feuille', rps.resolveRps('ciseaux', 'feuille') === 'win');
  check('feuille bat pierre', rps.resolveRps('feuille', 'pierre') === 'win');
  check('pierre vs pierre = tie', rps.resolveRps('pierre', 'pierre') === 'tie');
  check('pierre vs feuille = lose', rps.resolveRps('pierre', 'feuille') === 'lose');
  check('victoire payée 2x', rps.payoutFor('win', 100) === 200);
  check('égalité remboursée', rps.payoutFor('tie', 100) === 100);
  const picks = new Set(Array.from({ length: 200 }, () => rps.botPick()));
  check('le bot choisit parmi les 3 coups', [...picks].every((p) => rps.CHOICE_KEYS.includes(p)) && picks.size >= 1);

  console.log('\n━ 🛒 Boutique');
  const buyer = { id: 'u2', username: 'acheteur-test' };
  const product = shopService.getProduct('zach-checker');
  check('produit 1 : Zach-checker à 1000 coins', product && product.price === 1000);
  const premium = shopService.getProduct('zach-checker-premium');
  check('produit 2 : Zach-checker Premium à 5000 coins', premium && premium.price === 5000);
  const before = (await store.getUser(buyer.id)).balance; // 1000
  const poor = await shopService.processPurchase({ store, buyer: { id: 'u1', username: 'pauvre' }, product: premium, deliveryUsername: 'pauvre' });
  check('achat refusé si solde insuffisant', poor.ok === false && poor.reason === 'insufficient');
  const purchase = await shopService.processPurchase({ store, buyer, product, deliveryUsername: 'livraison-test', guildName: 'ServeurTest' });
  check('achat accepté si solde suffisant', purchase.ok === true);
  check('coins débités du bon montant', (await store.getUser(buyer.id)).balance === before - product.price);

  await store.close();
  try { fs.unlinkSync(dbFile); } catch {}

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} test(s) réussi(s)  |  ❌ ${failed} échec(s)`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Erreur pendant les tests :', err);
  process.exit(1);
});
