'use strict';

/**
 * Tests de bout en bout du serveur : HTTP, auth, SSE, fournisseurs.
 *   node scripts/test.js
 *
 * Aucun framework : un faux Ollama sert de backend, on vérifie le comportement
 * réel des routes et du streaming.
 */

const { buildConfig } = require('../src/config');
const { createServer } = require('../src/server');
const { startMock } = require('./mock-ollama');

const results = [];
let failures = 0;

function check(name, condition, details = '') {
  results.push({ name, ok: Boolean(condition), details });
  if (!condition) failures += 1;
  const icon = condition ? '✅' : '❌';
  console.log(`  ${icon} ${name}${condition || !details ? '' : `\n       → ${details}`}`);
}

async function request(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* pas du JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function collectSse(base, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  if (!res.ok) return { status: res.status, events: [], text: rawText };
  const text = rawText;
  const events = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore */
      }
    }
  }
  return { status: res.status, events, text };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockProviders(mock) {
  return [
    {
      id: 'demo',
      label: 'Ollama simulé',
      kind: 'ollama',
      baseUrl: mock.url,
      apiKey: '',
      defaultModel: 'demo:mini',
      allowPull: true,
      hint: 'mock',
      remote: true,
    },
    {
      id: 'openai-demo',
      label: 'API OpenAI simulée',
      kind: 'openai',
      baseUrl: `${mock.url}/v1`,
      apiKey: 'demo-key',
      defaultModel: 'demo:mini',
      allowPull: false,
      hint: 'mock',
      remote: true,
    },
  ];
}

async function main() {
  console.log('\n🧪 Tests Ollama Web\n');

  const mock = await startMock({ port: 0, speed: 8 });

  const config = buildConfig({
    providers: mockProviders(mock),
    defaultProviderId: 'demo',
    appPassword: '',
    verbose: false,
    rateLimitPerMinute: 0,
  });
  const server = createServer({ config });
  const base = await listen(server);

  // ------------------------------------------------ statique & santé -----
  console.log('  · Fichiers statiques et endpoints de santé');
  const health = await request(base, '/healthz');
  check('GET /healthz répond status=ok', health.status === 200 && health.json?.status === 'ok', JSON.stringify(health.json));

  const index = await request(base, '/');
  check('GET / sert la page HTML', index.status === 200 && index.text.includes('Ollama Web'), `status=${index.status}`);
  check('La page charge app.js', (await request(base, '/app.js')).status === 200);
  check('La page charge styles.css', (await request(base, '/styles.css')).status === 200);
  check('Route inconnue → SPA (index.html)', (await request(base, '/discussion/42')).status === 200);

  const traversal = await request(base, '/../src/config.js');
  check('Protection contre la traversée de répertoire', traversal.status === 404 || traversal.status === 403 || !traversal.text.includes('buildConfig'), `status=${traversal.status}`);

  // ------------------------------------------------------- /api/config ----
  console.log('\n  · Configuration et fournisseurs');
  const cfg = await request(base, '/api/config');
  check('GET /api/config liste les fournisseurs', cfg.json?.providers?.length === 2, JSON.stringify(cfg.json?.providers?.map((p) => p.id)));
  check('Aucune clé API exposée au navigateur', !JSON.stringify(cfg.json).includes('demo-key'));
  check('Fournisseur recommandé calculé', cfg.json?.recommendedProviderId === 'demo' || cfg.json?.recommendedProviderId === 'openai-demo', String(cfg.json?.recommendedProviderId));

  const healthApi = await request(base, '/api/health');
  check('GET /api/health sonde les fournisseurs', healthApi.json?.providers?.length === 2 && healthApi.json.providers.every((p) => p.reachable), JSON.stringify(healthApi.json));

  // ------------------------------------------------------ /api/models -----
  console.log('\n  · Liste des modèles');
  const models = await request(base, '/api/models?provider=demo');
  check('GET /api/models renvoie les modèles Ollama', models.json?.ok && models.json.models.length >= 5, `${models.json?.models?.length} modèle(s)`);
  check('Les métadonnées du modèle sont normalisées', Boolean(models.json.models[0].parameterSize), JSON.stringify(models.json.models[0]));
  const modelsOpenai = await request(base, '/api/models?provider=openai-demo');
  check('Un fournisseur compatible OpenAI fonctionne aussi', modelsOpenai.json?.ok && modelsOpenai.json.models.length >= 5);

  // -------------------------------------------------------- /api/chat -----
  console.log('\n  · Chat en streaming (protocole Ollama)');
  const chat = await collectSse(base, '/api/chat', {
    providerId: 'demo',
    model: 'demo:mini',
    messages: [{ role: 'user', content: 'Bonjour, explique-moi un truc.' }],
  });
  const deltas = chat.events.filter((e) => e.type === 'delta');
  const done = chat.events.find((e) => e.type === 'done');
  const text = deltas.map((d) => d.text).join('');
  check('Le flux SSE démarre par un événement start', chat.events[0]?.type === 'start');
  check('Des morceaux de texte arrivent en streaming', deltas.length > 20, `${deltas.length} morceaux`);
  check('Le texte contient du markdown', text.includes('**') && text.includes('`'));
  check('Un événement done clôt le flux avec des stats', Boolean(done?.stats?.outputTokens), JSON.stringify(done?.stats));
  check('Le mode démo est annoncé dans la réponse', /mode démo/i.test(text));

  const thinkingChat = await collectSse(base, '/api/chat', {
    providerId: 'demo',
    model: 'qwen3:4b',
    messages: [{ role: 'user', content: 'raisonne' }],
  });
  check('Les modèles « thinking » envoient leur raisonnement', thinkingChat.events.some((e) => e.type === 'thinking' && e.text));

  console.log('\n  · Chat en streaming (protocole OpenAI)');
  const chatOpenai = await collectSse(base, '/api/chat', {
    providerId: 'openai-demo',
    model: 'demo:mini',
    messages: [{ role: 'user', content: 'Bonjour via OpenAI' }],
  });
  const openaiText = chatOpenai.events.filter((e) => e.type === 'delta').map((d) => d.text).join('');
  check('Le fournisseur OpenAI diffuse aussi du texte', openaiText.length > 100, `${openaiText.length} caractères`);
  check('Les statistiques d’usage sont récupérées', Boolean(chatOpenai.events.find((e) => e.type === 'done')?.stats?.outputTokens));

  console.log('\n  · Validation des entrées');
  const fallbackModel = await collectSse(base, '/api/chat', { providerId: 'demo', model: '', messages: [{ role: 'user', content: 'x' }] });
  check('Modèle vide → repli sur le modèle par défaut du fournisseur', fallbackModel.events[0]?.type === 'start' && fallbackModel.events[0].model === 'demo:mini', JSON.stringify(fallbackModel.events[0]));
  const noModelServer = createServer({
    config: buildConfig({ providers: [{ id: 'sansmodele', label: 'Sans modèle', kind: 'ollama', baseUrl: 'http://127.0.0.1:1', apiKey: '', allowPull: true, remote: true }], defaultProviderId: 'sansmodele', appPassword: '', verbose: false }),
  });
  const noModelBase = await listen(noModelServer);
  const noModel = await collectSse(noModelBase, '/api/chat', { providerId: 'sansmodele', model: '', messages: [{ role: 'user', content: 'x' }] });
  check('Aucun modèle disponible → 400', noModel.status === 400, `status=${noModel.status}`);
  noModelServer.close();
  const noMessages = await collectSse(base, '/api/chat', { providerId: 'demo', model: 'demo:mini', messages: [] });
  check('Messages vides → 400', noMessages.status === 400);
  const badProvider = await collectSse(base, '/api/chat', { providerId: 'inexistant', model: 'demo:mini', messages: [{ role: 'user', content: 'x' }] });
  check('Fournisseur inconnu → 400', badProvider.status === 400);
  const badJson = await request(base, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  check('JSON invalide → 400', badJson.status === 400);
  const tooBig = await request(base, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'demo', model: 'demo:mini', messages: [{ role: 'user', content: 'x'.repeat(config.maxBodyBytes + 1000) }] }),
  });
  check('Corps trop volumineux → 413', tooBig.status === 413, `status=${tooBig.status}`);
  const getChat = await request(base, '/api/chat');
  check('GET /api/chat → 405', getChat.status === 405);

  // -------------------------------------------------------- /api/pull -----
  console.log('\n  · Téléchargement de modèles');
  const pull = await collectSse(base, '/api/pull', { providerId: 'demo', model: 'qwen2.5:0.5b' });
  const progresses = pull.events.filter((e) => e.type === 'progress');
  check('Le pull diffuse des progressions', progresses.length > 3, `${progresses.length} événements`);
  check('Le pourcentage atteint 100 %', progresses.some((p) => p.percent === 100));
  check('Le pull se termine par done', pull.events.at(-1)?.type === 'done');
  const pullOpenai = await collectSse(base, '/api/pull', { providerId: 'openai-demo', model: 'demo:mini' });
  check('Pull refusé sur une API compatible OpenAI', pullOpenai.events.some((e) => e.type === 'error'));
  const pullInvalid = await collectSse(base, '/api/pull', { providerId: 'demo', model: 'a b c' });
  check('Nom de modèle invalide → erreur explicite', pullInvalid.events.some((e) => e.type === 'error'));

  // --------------------------------------------- gestion d'une panne ------
  console.log('\n  · Résilience');
  const deadProviders = [
    { id: 'mort', label: 'Ollama absent', kind: 'ollama', baseUrl: 'http://127.0.0.1:59999', apiKey: '', allowPull: true, remote: true },
  ];
  const deadServer = createServer({
    config: buildConfig({ providers: deadProviders, defaultProviderId: 'mort', appPassword: '', verbose: false }),
  });
  const deadBase = await listen(deadServer);
  const deadModels = await request(deadBase, '/api/models?provider=mort');
  check('Serveur injoignable → message d’erreur clair', deadModels.json?.ok === false && /Connexion refusée|injoignable|refused/i.test(deadModels.json.error.message), deadModels.json?.error?.message);
  const deadChat = await collectSse(deadBase, '/api/chat', { providerId: 'mort', model: 'x', messages: [{ role: 'user', content: 'coucou' }] });
  check('Le chat sur un serveur mort renvoie une erreur SSE', deadChat.events.some((e) => e.type === 'error'));
  check('Pas de fuite de clé API dans les erreurs', !deadChat.text.includes('demo-key'));
  deadServer.close();

  // ---------------------------------------------------------- auth --------
  console.log('\n  · Authentification (APP_PASSWORD)');
  const authServer = createServer({
    config: buildConfig({ providers: mockProviders(mock), defaultProviderId: 'demo', appPassword: 'secret42', verbose: false }),
  });
  const authBase = await listen(authServer);

  const anonConfig = await request(authBase, '/api/config');
  check('Sans session : /api/config ne révèle rien', anonConfig.status === 200 && anonConfig.json.authenticated === false && !anonConfig.json.providers);
  const anonModels = await request(authBase, '/api/models?provider=demo');
  check('Sans session : /api/models → 401', anonModels.status === 401);
  const anonChat = await request(authBase, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('Sans session : /api/chat → 401', anonChat.status === 401);

  const badLogin = await request(authBase, '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'mauvais' }) });
  check('Mauvais mot de passe → 401', badLogin.status === 401);
  const goodLogin = await request(authBase, '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret42' }) });
  const cookie = (goodLogin.headers.get('set-cookie') || '').split(';')[0];
  check('Bon mot de passe → cookie de session', goodLogin.status === 200 && cookie.startsWith('ow_session='), cookie);
  check('Cookie HttpOnly', /HttpOnly/i.test(goodLogin.headers.get('set-cookie') || ''));

  const authedModels = await request(authBase, '/api/models?provider=demo', { headers: { Cookie: cookie } });
  check('Avec session : /api/models fonctionne', authedModels.status === 200 && authedModels.json.ok);
  const authedChat = await collectSse(authBase, '/api/chat', { providerId: 'demo', model: 'demo:mini', messages: [{ role: 'user', content: 'salut' }] }, { Cookie: cookie });
  check('Avec session : le chat diffuse', authedChat.events.some((e) => e.type === 'delta'));

  const forged = await request(authBase, '/api/models?provider=demo', { headers: { Cookie: 'ow_session=9999999999999.faux' } });
  check('Cookie falsifié refusé', forged.status === 401);
  const futureExpiry = Date.now() + 3600000;
  const forged2 = await request(authBase, '/api/models?provider=demo', { headers: { Cookie: `ow_session=${futureExpiry}.faux` } });
  check('Signature invalide refusée', forged2.status === 401);
  authServer.close();

  server.close();
  await mock.close();

  console.log(`\n${failures === 0 ? '🎉 Tous les tests passent' : `💥 ${failures} test(s) en échec`} — ${results.length} vérifications\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n💥 Erreur pendant les tests :', error);
  process.exit(1);
});
