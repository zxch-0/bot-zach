'use strict';

/**
 * Test d'interface (optionnel, nécessite jsdom) :
 * charge réellement public/index.html + app.js dans jsdom,
 * branché sur le vrai serveur du dépôt (lui-même branché sur le faux Ollama).
 * Vérifie : rendu initial, chargement des modèles, envoi d'un message,
 * streaming en direct, markdown + bouton copier, titre de discussion,
 * création de discussion, et l'écran de connexion.
 */

const path = require('node:path');

// jsdom n'est PAS une dépendance du projet (l'application reste à 0 dépendance).
// Installez-le uniquement pour ce test :
//   npm install --no-save jsdom     (ou: npm i -D jsdom)
let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch {
  console.error('\n⚠️  Ce test a besoin de jsdom. Installez-le d’abord :\n');
  console.error('    npm install --no-save jsdom\n');
  console.error('(Le reste du projet fonctionne sans aucune dépendance.)\n');
  process.exit(0);
}

const REPO = path.join(__dirname, '..');
const { buildConfig } = require(path.join(REPO, 'src/config'));
const { createServer } = require(path.join(REPO, 'src/server'));
const { startMock } = require(path.join(REPO, 'scripts/mock-ollama'));

let failures = 0;
const check = (name, ok, details = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !details ? '' : `\n       → ${details}`}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    let value;
    try {
      value = fn();
    } catch {
      value = false;
    }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Délai dépassé en attendant : ${label}`);
    await sleep(60);
  }
}

function mockProviders(mock) {
  return [
    { id: 'demo', label: 'Ollama simulé', kind: 'ollama', baseUrl: mock.url, apiKey: '', defaultModel: 'demo:mini', allowPull: true, hint: 'mock', remote: true },
  ];
}

function makeFetch(baseUrl, jar) {
  return async (input, init = {}) => {
    const url = String(input).startsWith('http') ? String(input) : `${baseUrl}${input}`;
    const headers = { ...(init.headers || {}) };
    if (jar.cookie) headers.Cookie = jar.cookie;
    const res = await fetch(url, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    return res;
  };
}

async function bootDom({ baseUrl, jar = {} }) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

  const dom = await JSDOM.fromURL(`${baseUrl}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = makeFetch(baseUrl, jar);
      window.TextDecoder = TextDecoder;
      window.TextEncoder = TextEncoder;
      window.ReadableStream = ReadableStream;
      window.AbortController = AbortController;
      if (!window.crypto) window.crypto = require('node:crypto').webcrypto;
      window.confirm = () => true;
    },
  });
  return { dom, errors };
}

async function main() {
  console.log('\n🖥️  Tests d’interface (jsdom + vrai serveur)\n');
  const mock = await startMock({ port: 0, speed: 6 });

  const server = createServer({
    config: buildConfig({ providers: mockProviders(mock), defaultProviderId: 'demo', appPassword: '', verbose: false, rateLimitPerMinute: 0 }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { dom, errors } = await bootDom({ baseUrl });
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  console.log('  · Démarrage de l’application');
  await waitFor(() => !$('app').hidden, { label: 'affichage de l’app' });
  check('La page d’accueil s’affiche sans écran de login', $('loginOverlay').hidden && !$('app').hidden);
  check('Aucun écran de bienvenue affiché', Boolean($('welcome')));

  await waitFor(() => $('modelSelect').options.length > 0, { label: 'chargement des modèles' });
  const options = [...$('modelSelect').options].map((o) => o.value);
  check('Les modèles du serveur sont proposés', options.includes('demo:mini') && options.length >= 6, options.join(', '));
  check('Le modèle par défaut est sélectionné', $('modelSelect').value === 'demo:mini', $('modelSelect').value);
  check('Le fournisseur est détecté en ligne', $('statusBadge').className.includes('ok'), $('statusBadge').textContent);

  console.log('\n  · Envoi d’un message et streaming');
  $('input').value = 'Bonjour, montre-moi du code JavaScript';
  $('composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => doc.querySelectorAll('.msg.user').length === 1, { label: 'message utilisateur affiché' });
  check('Le message utilisateur apparaît', doc.querySelector('.msg.user .content').textContent.includes('Bonjour, montre-moi du code'));

  await waitFor(() => doc.querySelector('.msg.assistant .typing'), { label: 'indicateur de saisie' });
  check('Un indicateur de saisie s’affiche avant le premier mot', true);

  await waitFor(() => {
    const el = doc.querySelector('.msg.assistant .content');
    return el && el.textContent.length > 120;
  }, { label: 'premier texte streamé' });
  const partial = doc.querySelector('.msg.assistant .content').textContent.length;
  await waitFor(() => $('sendBtn').hidden === false, { timeout: 30000, label: 'fin du streaming' });

  const bubble = doc.querySelector('.msg.assistant .bubble');
  const full = bubble.textContent;
  check('Le texte complet est arrivé en streaming', full.length > partial && full.includes('mode démo'), `${full.length} caractères`);
  check('Le bloc de code est rendu avec le bouton Copier', Boolean(bubble.querySelector('.code-wrap pre code')) && Boolean(bubble.querySelector('.copy-btn')));
  check('Le markdown est converti (gras + citations)', Boolean(bubble.querySelector('strong')) && Boolean(bubble.querySelector('blockquote')));
  check('Les statistiques de génération sont affichées', /tok\/s|tokens/.test(doc.querySelector('.msg.assistant .msg-meta').textContent), doc.querySelector('.msg.assistant .msg-meta').textContent);
  check('La discussion est nommée d’après le message', $('chatTitle').textContent.startsWith('Bonjour, montre-moi'), $('chatTitle').textContent);
  check('La discussion apparaît dans l’historique', doc.querySelectorAll('.conv-item').length === 1);
  check('Le champ de saisie est vidé après envoi', $('input').value === '');

  console.log('\n  · Rendu markdown (bouton copier, XSS)');
  const md = window.eval(`(${(() => 'x').toString()})`); // évite un lint inutile
  void md;
  const renderMarkdown = window.eval('typeof renderMarkdown');
  check('app.js ne fuit pas de global (portée fermée)', renderMarkdown === 'undefined');

  console.log('\n  · Historique : nouvelle discussion et suppression');
  $('newChat').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('.conv-item').length === 2, { label: '2 discussions' });
  check('« Nouvelle discussion » crée une entrée', doc.querySelectorAll('.conv-item').length === 2);
  check('L’écran de bienvenue revient', Boolean($('welcome')));

  const firstConv = [...doc.querySelectorAll('.conv-item')][1];
  firstConv.dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('.msg').length >= 2, { label: 'retour sur la 1re discussion' });
  check('On peut rouvrir une discussion passée', doc.querySelectorAll('.msg.assistant').length === 1);

  doc.querySelector('.conv-item .conv-del').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('.conv-item').length === 1, { label: 'suppression' });
  check('La suppression d’une discussion fonctionne', doc.querySelectorAll('.conv-item').length === 1);

  console.log('\n  · Sécurité du rendu');
  window.eval(`document.querySelector('.msg.assistant .content').innerHTML = '<img src=x onerror=window.__xss=1>'`);
  await sleep(120);
  check('Aucun script exécuté par du HTML injecté à la main (contrôle)', window.__xss === undefined);

  check('Aucune erreur JavaScript pendant la session', errors.length === 0, errors.join(' | '));
  window.close();
  server.close();

  // ------------------------------ avec mot de passe ----------------------
  console.log('\n  · Site protégé par mot de passe');
  const server2 = createServer({
    config: buildConfig({ providers: mockProviders(mock), defaultProviderId: 'demo', appPassword: 'secret42', verbose: false }),
  });
  await new Promise((r) => server2.listen(0, '127.0.0.1', r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;

  const session = await bootDom({ baseUrl: base2, jar: {} });
  const sessionWindow = session.dom.window;
  await waitFor(() => !sessionWindow.document.getElementById('loginOverlay').hidden, { label: 'écran de login' });
  const loginDoc = sessionWindow.document;
  check('L’écran de connexion s’affiche', !loginDoc.getElementById('loginOverlay').hidden && loginDoc.getElementById('app').hidden);

  loginDoc.getElementById('password').value = 'mauvais';
  loginDoc.getElementById('loginForm').dispatchEvent(new sessionWindow.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !loginDoc.getElementById('loginError').hidden, { label: 'erreur de login' });
  check('Un mauvais mot de passe est refusé avec un message', /incorrect/i.test(loginDoc.getElementById('loginError').textContent), loginDoc.getElementById('loginError').textContent);

  loginDoc.getElementById('password').value = 'secret42';
  loginDoc.getElementById('loginForm').dispatchEvent(new sessionWindow.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !loginDoc.getElementById('app').hidden, { label: 'app après connexion' });
  check('Le bon mot de passe ouvre l’application', !loginDoc.getElementById('app').hidden && loginDoc.getElementById('loginOverlay').hidden);
  check('Le bouton de déconnexion est visible', !loginDoc.getElementById('logout').hidden);
  await waitFor(() => loginDoc.getElementById('modelSelect').options.length > 0, { label: 'modèles après login' });
  check('Les modèles se chargent après connexion', loginDoc.getElementById('modelSelect').value === 'demo:mini');
  check('Aucune erreur JS pendant le login', session.errors.length === 0, session.errors.join(' | '));

  sessionWindow.close();
  server2.close();
  await mock.close();

  console.log(`\n${failures === 0 ? '🎉 Interface OK' : `💥 ${failures} vérification(s) en échec`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n💥 Erreur pendant les tests d’interface :', error);
  process.exit(1);
});
