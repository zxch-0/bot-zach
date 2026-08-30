// ============================================================
// ZachServices — Mini serveur web "keep-alive"
// Les hébergeurs gratuits (Render…) endorment les apps sans
// trafic HTTP et exigent un port ouvert. UptimeRobot (gratuit)
// pinge cette page toutes les 5 minutes pour garder le bot
// éveillé 24/7. Les erreurs de port (EADDRINUSE…) sont logguées
// sans faire planter le bot.
// ============================================================
const http = require('http');

function startKeepAlive(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        bot: 'ZachServices',
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
  });

  // Un port occupé ou une erreur réseau ne doit pas planter le bot
  server.on('error', (err) => {
    const code = err && err['code']; // code présent sur les erreurs réseau (non typé sur Error)
    if (code === 'EADDRINUSE') {
      console.warn(`⚠️ [keep-alive] Port ${port} déjà utilisé — le serveur web ne démarre pas (le bot continue).`);
    } else {
      console.error('⚠️ [keep-alive] Erreur du serveur web :', err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive actif sur le port ${port} (à pinger avec UptimeRobot)`);
  });

  return server;
}

module.exports = { startKeepAlive };
