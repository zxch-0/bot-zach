'use strict';

/**
 * Point d'entrée : Ollama Web.
 *
 *   node src/index.js
 *
 * Le service écoute un port HTTP et sert l'interface de chat. Il ne fait
 * AUCUN téléchargement de modèle lui-même : il pilote un serveur Ollama
 * (local, distant, Ollama Cloud, ou un conteneur Ollama à côté).
 */

const { loadDotEnv, buildConfig, VERSION } = require('./config');
const { createServer } = require('./server');

loadDotEnv();
const config = buildConfig();

function banner(config, address) {
  const lines = [];
  lines.push('');
  lines.push('  ┌────────────────────────────────────────────────────────┐');
  lines.push('  │  🤖  Ollama Web — votre Ollama dans le cloud           │');
  lines.push('  └────────────────────────────────────────────────────────┘');
  lines.push(`  Version        : ${VERSION}  (Node ${process.version})`);
  lines.push(`  Interface      : ${address}`);
  lines.push(`  Mot de passe   : ${config.appPassword ? 'activé ✅' : 'désactivé ⚠️  (site public)'}`);
  lines.push('  Fournisseurs   :');
  if (!config.providers.length) {
    lines.push('    ⚠️  aucun fournisseur configuré — ouvrez .env.example');
  }
  for (const provider of config.providers) {
    const key = provider.apiKey ? 'clé ✅' : provider.remote ? 'clé ⚠️' : '—';
    const mark = provider.id === config.defaultProviderId ? '★' : '•';
    lines.push(`   ${mark} ${provider.label} (${provider.id}) → ${provider.baseUrl}  [${key}]`);
  }
  lines.push('');
  lines.push('  Astuce : `npm run demo` lance l’interface sans Ollama (modèle simulé).');
  lines.push('');
  return lines.join('\n');
}

function start() {
  const server = createServer({ config });

  server.listen(config.port, config.host, () => {
    const { port, address } = server.address();
    const shown = config.host === '0.0.0.0' && (address === '::' || address === '0.0.0.0')
      ? `http://localhost:${port}`
      : `http://${address}:${port}`;
    console.log(banner(config, shown));
    if (!config.providers.length) {
      console.log('  ⚠️  Ajoutez au moins OLLAMA_CLOUD_API_KEY ou OLLAMA_REMOTE_URL dans .env\n');
    }
    if (!config.appPassword) {
      console.log('  ⚠️  Aucun APP_PASSWORD : toute personne ayant l’URL peut utiliser votre clé API.\n');
    }
    if (config.sessionSecretGenerated && config.appPassword) {
      console.log('  ℹ️  SESSION_SECRET non défini : les sessions expirent à chaque redémarrage.\n');
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  ✗ Le port ${config.port} est déjà utilisé. Changez PORT dans .env ou libérez le port.\n`);
    } else {
      console.error('\n  ✗ Erreur serveur :', error.message, '\n');
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`\n  ${signal} reçu — arrêt du serveur…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start, config };
