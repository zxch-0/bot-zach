'use strict';

/**
 * `npm run demo`
 *
 * Lance l'interface complète SANS Ollama : un faux serveur Ollama est démarré
 * en mémoire, puis le site est branché dessus. Pratique pour :
 *   • montrer le site (démo, capture d'écran, validation) ;
 *   • tester l'interface sans GPU ni clé API.
 *
 * L'interface, le streaming SSE, le markdown et le stockage local sont réels :
 * seul le modèle est simulé (les réponses le disent explicitement).
 */

const fs = require('node:fs');
const path = require('node:path');

const { loadDotEnv, buildConfig } = require('../src/config');
const { createServer } = require('../src/server');
const { startMock, MODELS } = require('./mock-ollama');

async function main() {
  loadDotEnv();

  const argv = process.argv.slice(2);
  const argPort = argv.find((a) => a.startsWith('--port='))?.split('=')[1];
  const port = Number(argPort || process.env.PORT || 3000);

  const mock = await startMock({ port: 0, host: '127.0.0.1', speed: Number(process.env.DEMO_SPEED || 1) });

  const providers = [
    {
      id: 'demo',
      label: 'Ollama simulé (démo)',
      kind: 'ollama',
      baseUrl: mock.url,
      apiKey: '',
      defaultModel: 'demo:mini',
      allowPull: true,
      hint: 'Faux Ollama en mémoire — réponses simulées',
      remote: true,
    },
    {
      id: 'openai-demo',
      label: 'API OpenAI simulée (démo)',
      kind: 'openai',
      baseUrl: `${mock.url}/v1`,
      apiKey: 'demo',
      defaultModel: 'demo:mini',
      allowPull: false,
      hint: 'Même faux serveur, protocole OpenAI',
      remote: true,
    },
  ];

  // La démo fournit ses propres fournisseurs : on masque « Ollama local »
  // (sinon il apparaîtrait hors ligne sans raison).
  if (process.env.DISABLE_LOCAL_PROVIDER === undefined) {
    process.env.DISABLE_LOCAL_PROVIDER = 'true';
  }

  // On garde aussi les vrais fournisseurs configurés dans .env, s'il y en a.
  const real = buildConfig();
  for (const provider of real.providers) {
    if (!providers.some((p) => p.id === provider.id)) providers.push(provider);
  }

  const config = buildConfig({
    providers,
    defaultProviderId: 'demo',
    appPassword: process.env.APP_PASSWORD || '',
    verbose: process.env.VERBOSE !== '0',
    port,
  });

  const server = createServer({ config });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  const address = server.address();
  const url = `http://localhost:${address.port}`;

  console.log('');
  console.log('  🧪  DÉMO — Ollama simulé (aucun modèle réel chargé)');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  Site web     : ${url}`);
  console.log(`  Faux Ollama  : ${mock.url}`);
  console.log(`  Modèles      : ${MODELS.map((m) => m.name).join(', ')}`);
  console.log(`  Mot de passe : ${config.appPassword ? 'activé' : 'désactivé (démo publique en local)'}`);
  console.log('');
  console.log('  Ouvrez le site, écrivez un message : la réponse arrive en streaming.');
  console.log('  Pour de vraies réponses : lancez `npm start` avec OLLAMA_CLOUD_API_KEY');
  console.log('  ou OLLAMA_REMOTE_URL / un Ollama local (voir README.md).');
  console.log('');

  const shutdown = async () => {
    server.close();
    await mock.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Marqueur utilisé par les scripts de vérification / captures d'écran.
  if (process.env.DEMO_READY_FILE) {
    try {
      fs.writeFileSync(process.env.DEMO_READY_FILE, String(address.port));
    } catch {
      /* ignore */
    }
  }
  void path;
}

main().catch((error) => {
  console.error('Démo impossible :', error.message);
  process.exit(1);
});
