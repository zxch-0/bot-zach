// ============================================================
// ZachServices — Mini serveur web "keep-alive"
// Les hébergeurs gratuits (Render…) endorment les apps sans
// trafic HTTP. UptimeRobot (gratuit) pinge cette page toutes
// les 5 minutes pour garder le bot éveillé 24/7.
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

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Keep-alive actif sur le port ${port} (à pinger avec UptimeRobot)`);
  });

  return server;
}

module.exports = { startKeepAlive };
