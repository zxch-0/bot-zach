// ============================================================
// ZachServices — Tests du pilote PostgreSQL (base émulée pg-mem)
// Exécute les VRAIES requêtes du PostgresStore contre un PostgreSQL
// émulé en mémoire : schéma, seed produits, économie atomique,
// invitations (transactions), achats et produits dynamiques.
// Lancer : npm run test-pg
// ============================================================
const { newDb } = require('pg-mem');
const { PostgresStore } = require('../src/storage/postgres');
const economy = require('../src/services/economy');
const shopService = require('../src/services/shop');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

async function main() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const store = new PostgresStore(null, { pool: new Pool() });

  console.log('\n━ 🗄️  Schéma + seed');
  await store.init();
  check('schéma créé sans erreur', true);
  const products = await store.listProducts();
  check('2 produits par défaut insérés', products.length === 2);
  check('produits ordonnés (checker puis premium)', products[0].id === 'zach-checker' && products[1].id === 'zach-checker-premium');
  try {
    await store.init(); // second init : idempotent sur un vrai PostgreSQL
    check('init() idempotent (pas de doublon de seed)', (await store.listProducts()).length === 2);
  } catch (err) {
    // Limite connue de pg-mem (pas de PostgreSQL) : il ne relit pas l'AST des
    // contraintes d'un CREATE TABLE IF NOT EXISTS sur une table existante.
    // On vérifie qu'il s'agit bien de CETTE limite et pas d'une erreur SQL réelle.
    const isEmulatorLimit = /Not supported/i.test(err.message) && /primary key|default|not null/i.test(err.message);
    check('init() re-run : SQL valide (limite pg-mem identifiée, pas une erreur SQL)', isEmulatorLimit, err.message.split('\n')[0]);
    check('produits non dupliqués malgré tout', (await store.listProducts()).length === 2);
  };

  console.log('\n━ 💰 Économie (SQL atomique)');
  check('solde initial 0', (await store.getUser('u1')).balance === 0);
  check('crédit 500', (await store.credit('u1', 500)) === 500);
  check('débit 200', (await store.debit('u1', 200)) === 300);
  check('débit refusé au-delà du solde', (await store.debit('u1', 301)) === null);
  check('solde inchangé après refus', (await store.getUser('u1')).balance === 300);

  // 30 débits concurrents de 100 sur un solde de 1000 : exactement 10 doivent passer
  await store.credit('u2', 1000);
  const results = await Promise.all(Array.from({ length: 30 }, () => store.debit('u2', 100)));
  const okCount = results.filter((r) => r !== null).length;
  check('30 débits concurrents : exactement 10 passent', okCount === 10, `(obtenu ${okCount})`);
  check('solde après course : 0 (jamais négatif)', (await store.getUser('u2')).balance === 0);

  // CAS du daily
  const cas1 = await store.setLastDailyIfUnchanged('u3', null, 111);
  check('CAS ok quand lastDaily inchangé', cas1 === true);
  const cas2 = await store.setLastDailyIfUnchanged('u3', null, 222);
  check('CAS refusé quand lastDaily a changé', cas2 === false);
  const cas3 = await store.setLastDailyIfUnchanged('u3', 111, 333);
  check('CAS ok avec la bonne valeur précédente', cas3 === true);

  await store.credit('u4', 700);
  await store.credit('u5', 400); // distinct de u1 (300) pour éviter tout ex-æquo
  const top = await store.topBalances(10);
  check('classement trié par solde décroissant', top[0].userId === 'u4' && top[1].userId === 'u5' && top[2].userId === 'u1');

  console.log('\n━ 🎟️  Invitations (transactions)');
  check('compteur vide au départ', (await store.getInviteCount('inv1')).count === 0);
  check('arrivée comptée (+1)', (await store.recordJoin('m1', 'inv1')) === true);
  check('doublon d\'arrivée non compté', (await store.recordJoin('m1', 'inv1')) === false);
  check('compteur = 1', (await store.getInviteCount('inv1')).count === 1);
  check('départ décompté', (await store.recordLeave('m1')) === true);
  check('compteur = 0 après départ', (await store.getInviteCount('inv1')).count === 0);
  check('second départ ignoré', (await store.recordLeave('m1')) === false);
  check('rejoin crédite le nouvel inviteur', (await store.recordJoin('m1', 'inv2')) === true);
  check('inv2 = 1, inv1 = 0', (await store.getInviteCount('inv2')).count === 1 && (await store.getInviteCount('inv1')).count === 0);
  await store.recordJoin('m2', 'inv2');
  await store.recordLeave('m2');
  check('compteur jamais négatif (GREATEST)', (await store.getInviteCount('inv2')).count === 1);
  const imported = await store.importInvites({ inv1: 7 });
  check('import 7 invitations', imported[0].imported === 7);
  const importedAgain = await store.importInvites({ inv1: 3 });
  check('import conservé si plus petit (GREATEST)', importedAgain[0].imported === 7);

  console.log('\n━ 🎁 /daily (via economy sur SQL)');
  const noInvite = await economy.claimDaily(store, 'u6');
  check('refusé sans invitation', noInvite.status === 'no_invite');
  await store.recordJoin('friend', 'u6');
  const daily1 = await economy.claimDaily(store, 'u6');
  check('accepté après 1 invitation (+100)', daily1.status === 'ok' && daily1.balance === 100);
  const daily2 = await economy.claimDaily(store, 'u6');
  check('cooldown actif', daily2.status === 'cooldown');

  console.log('\n━ 🛒 Achats + produits (SQL)');
  const buyer = { id: 'u4', username: 'acheteur' }; // u4 = 700
  const premium = await store.getProductById('zach-checker-premium');
  const tooExpensive = await shopService.processPurchase({ store, buyer: { id: 'u5', username: 'pauvre' }, product: premium, deliveryUsername: 'x' });
  check('achat refusé si solde insuffisant (premium)', tooExpensive.ok === false);
  const product = await store.getProductById('zach-checker');
  const purchase = await shopService.processPurchase({ store, buyer, product, deliveryUsername: 'pseudo-livraison' });
  check('achat refusé pour u4 (700 < 1000)', purchase.ok === false && purchase.reason === 'insufficient');
  await store.credit('u4', 1000); // u4 = 1700
  const purchase2 = await shopService.processPurchase({ store, buyer, product, deliveryUsername: 'pseudo-livraison' });
  check('achat réussi après créditation (id numérique)', purchase2.ok === true && Number.isInteger(purchase2.purchaseId) && purchase2.purchaseId >= 1);
  check('solde exact après achat (1700 - 1000)', (await store.getUser('u4')).balance === 1700 - 1000);

  const added = await shopService.addProduct(store, { name: 'Checker Doré', price: 2500, description: 'Or', emoji: '🏆', actorId: 'admin' });
  check('ajout produit', added.ok === true && added.product.id === 'checker-dore');
  check('produit relisible depuis SQL', (await store.getProductById('checker-dore')).price === 2500);
  const dup = await shopService.addProduct(store, { name: 'Checker Doré', price: 100 });
  check('slug dupliqué suffixé', dup.ok === true && dup.product.id === 'checker-dore-2');
  const removed = await shopService.removeProduct(store, 'checker-dore-2');
  check('suppression produit', removed.ok === true);
  const removedAgain = await shopService.removeProduct(store, 'checker-dore-2');
  check('suppression d\'un absent refusée', removedAgain.ok === false);

  console.log('\n━ 🛑 Vérification de l\'erreur amie (DATABASE_URL vide)');
  try {
    new PostgresStore('');
    check('constructeur sans URL → erreur claire', false);
  } catch (err) {
    check('constructeur sans URL → erreur claire', /DATABASE_URL est vide/.test(err.message));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${passed} test(s) réussi(s)  |  ❌ ${failed} échec(s)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Erreur pendant les tests PostgreSQL :', err);
  process.exit(1);
});
