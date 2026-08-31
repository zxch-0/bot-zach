// ============================================================
// ZachServices — Vérification statique (méthode 3, sans exécution)
//   1. Syntaxe : node --check sur chaque fichier
//   2. Chargement : toutes les commandes/événements/services
//   3. Contraintes Discord : longueurs, noms, options, boutons
//   4. Cohérence : constantes Discord.js, .env.example, package.json
// Lancer : npm run verify
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
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

function listFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
}

/* ---------- 1. Syntaxe de tous les fichiers JS ---------- */
console.log('\n━ 1. Syntaxe (node --check)');
const dirs = ['src/commands', 'src/events', 'src/services', 'src/games', 'src/storage', 'src/utils', 'src/flows', 'scripts'];
let syntaxErrors = 0;
for (const dir of dirs) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of listFiles(full)) {
    try {
      execFileSync(process.execPath, ['--check', path.join(full, file)], { stdio: 'pipe' });
    } catch (err) {
      syntaxErrors++;
      console.error(`  ❌ Syntaxe invalide : ${dir}/${file} — ${err.stderr}`);
    }
  }
}
for (const file of ['src/index.js', 'src/config.js', 'src/keepAlive.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  } catch (err) {
    syntaxErrors++;
    console.error(`  ❌ Syntaxe invalide : ${file}`);
  }
}
check('tous les fichiers JS passent node --check', syntaxErrors === 0);

/* ---------- 2. Chargement des commandes et événements ---------- */
console.log('\n━ 2. Chargement des modules');
const commands = new Map();
for (const file of listFiles(path.join(ROOT, 'src/commands'))) {
  const cmd = require(path.join(ROOT, 'src/commands', file));
  check(`commande /${cmd.data?.name} (depuis ${file})`, Boolean(cmd.data && typeof cmd.execute === 'function'));
  commands.set(cmd.data.name, { cmd, file });
}
const expectedCommands = ['balance', 'blackjack', 'daily', 'give', 'help', 'import-invites', 'invites', 'leaderboard', 'product', 'rps', 'shop'];
for (const name of expectedCommands) check(`commande attendue /${name} présente`, commands.has(name));

for (const file of listFiles(path.join(ROOT, 'src/events'))) {
  const evt = require(path.join(ROOT, 'src/events', file));
  check(`événement ${evt.name} (depuis ${file})`, Boolean(evt.name && typeof evt.execute === 'function'));
}
for (const mod of ['../src/services/economy', '../src/services/invites', '../src/services/shop', '../src/games/blackjack', '../src/games/blackjackGame', '../src/games/rps', '../src/flows/shopFlow', '../src/utils/permissions', '../src/keepAlive']) {
  try {
    require(mod);
    check(`module ${mod.split('/').pop()} charge`, true);
  } catch (err) {
    check(`module ${mod.split('/').pop()} charge`, false, err.message);
  }
}

/* ---------- 3. Contraintes Discord ---------- */
console.log('\n━ 3. Contraintes Discord');
const { Events, StringSelectMenuBuilder, ModalBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

for (const [name, { cmd, file }] of commands) {
  const json = cmd.data.toJSON();
  const label = `/${name}`;
  check(`${label} : nom valide (1-32, minuscules)`, /^[a-z0-9_-]{1,32}$/.test(name));
  check(`${label} : description ≤ 100`, (json.description || '').length <= 100, `(${(json.description || '').length})`);
  const options = json.options || [];
  for (const opt of options) {
    check(`${label} option "${opt.name}" : description ≤ 100`, (opt.description || '').length <= 100);
    if (opt.type === 4) {
      // INTEGER : bornes cohérentes
      if (opt.min_value !== undefined && opt.max_value !== undefined) {
        check(`${label} option "${opt.name}" : min ≤ max`, opt.min_value <= opt.max_value);
      }
    }
  }
  // Sous-commandes de /product
  if (name === 'product') {
    const subs = options.filter((o) => o.type === 1).map((o) => o.name);
    check('/product : sous-commandes add/remove/list', ['add', 'remove', 'list'].every((s) => subs.includes(s)));
    check('/product remove : autocomplétion activée', options.some((o) => o.name === 'remove' && o.options?.some((x) => x.name === 'product' && x.autocomplete === true)));
  }
}

// Boutons et menus du blackjack/boutique : construction réelle
const { buildShopRow, buildDeliveryModal, buildShopEmbed } = require('../src/services/shop');
const products = require('../src/config').defaultProducts;
try {
  const row = buildShopRow(products).toJSON();
  check('menu /shop : customId + ≤ 25 options + valeurs ≤ 100', row.components[0].custom_id === 'shop:buy' && row.components[0].options.length <= 25 && row.components[0].options.every((o) => o.value.length <= 100 && o.label.length <= 100 && (o.description || '').length <= 100));
} catch (err) {
  check('menu /shop construit', false, err.message);
}
try {
  const modal = buildDeliveryModal(products[0]).toJSON();
  check('modale boutique : customId ≤ 100 + titre ≤ 45', modal.custom_id.length <= 100 && modal.title.length <= 45);
} catch (err) {
  check('modale boutique construite', false, err.message);
}
try {
  const embed = buildShopEmbed(products).toJSON();
  const total = JSON.stringify(embed).length;
  check('embed /shop : total raisonnable (< 5500 caractères)', total < 5500, `(${total})`);
} catch (err) {
  check('embed /shop construit', false, err.message);
}

// Boutons blackjack
try {
  const { ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
  const row = new ARB().addComponents(
    new BB().setCustomId('bj:hit').setLabel('Piocher').setStyle(BS.Primary),
    new BB().setCustomId('bj:stand').setLabel('Rester').setStyle(BS.Secondary),
    new BB().setCustomId('bj:double').setLabel('Doubler').setStyle(BS.Success)
  ).toJSON();
  check('boutons blackjack : customIds valides', row.components.length === 3 && row.components.every((b) => /^[a-z]+:[a-z]+$/.test(b.custom_id)));
} catch (err) {
  check('boutons blackjack construits', false, err.message);
}

// Constantes d'événements utilisées
check('Events.ClientReady défini', typeof Events.ClientReady === 'string');
check('Events.InteractionCreate défini', typeof Events.InteractionCreate === 'string');
check('Events.GuildMemberAdd/Remove définis', typeof Events.GuildMemberAdd === 'string' && typeof Events.GuildMemberRemove === 'string');
check('Events.InviteCreate/Delete définis', typeof Events.InviteCreate === 'string' && typeof Events.InviteDelete === 'string');

/* ---------- 4. Cohérence du déploiement ---------- */
console.log('\n━ 4. Cohérence du déploiement');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('package.json : script start présent', pkg.scripts && typeof pkg.scripts.start === 'string');
check('package.json : engines node >= 18', parseInt(String(pkg.engines?.node).match(/\d+/)?.[0] || '0', 10) >= 18);
check('package.json : discord.js ^14', pkg.dependencies?.['discord.js']?.startsWith('^14'));
check('package.json : main existe', fs.existsSync(path.join(ROOT, pkg.main)));

const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
for (const key of ['DISCORD_TOKEN', 'CLIENT_ID', 'ADMIN_USER_IDS', 'ADMIN_ROLE_ID', 'DATABASE_DRIVER', 'DATABASE_URL', 'KEEP_ALIVE', 'PORT', 'DAILY_REWARD']) {
  check(`.env.example documente ${key}`, envExample.includes(key));
}

check('.gitignore exclut .env', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('.env'));
check('.gitignore exclut data/', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('data/'));
check('.env.example ne contient aucun vrai token', !/[A-Za-z\d]{24}\.[\w-]{6}\.[\w-]{27}/.test(envExample));
check('render.yaml présent (blueprint Render)', fs.existsSync(path.join(ROOT, 'render.yaml')));
check('.node-version présent', fs.existsSync(path.join(ROOT, '.node-version')));

// Aucun token en dur dans les sources
let tokenLeak = false;
for (const dir of dirs) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of listFiles(full)) {
    const content = fs.readFileSync(path.join(full, file), 'utf8');
    if (/[A-Za-z\d]{24}\.[\w-]{6}\.[\w-]{27}/.test(content)) {
      tokenLeak = true;
      console.error(`  ⚠️ Possible token en dur : ${dir}/${file}`);
    }
  }
}
check('aucun token en dur dans le code', !tokenLeak);

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${passed} vérification(s) réussie(s)  |  ❌ ${failed} échec(s)`);
process.exit(failed > 0 ? 1 : 0);
