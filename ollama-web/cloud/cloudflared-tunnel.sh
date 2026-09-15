#!/usr/bin/env bash
# ============================================================
#  Expose votre Ollama (local, VPS, Colab, Raspberry Pi…) à Internet
#  via un tunnel Cloudflare, SANS compte et SANS ouvrir de port.
#
#  Usage :
#     ./cloud/cloudflared-tunnel.sh                 # tunnel vers http://127.0.0.1:11434
#     ./cloud/cloudflared-tunnel.sh 11434 my.domain # tunnel nommé (compte Cloudflare requis)
#
#  Prérequis : ollama doit tourner (ollama serve) et cloudflared doit être installé.
#     Linux :  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && sudo install /tmp/cloudflared /usr/local/bin/cloudflared
#     macOS :  brew install cloudflared
#
#  ⚠️ Le tunnel rend votre Ollama accessible publiquement : Ollama n'a
#     aucune authentification intégrée. Lancez le tunnel uniquement pour
#     une session courte, ou mettez un reverse-proxy avec mot de passe devant.
# ============================================================
set -euo pipefail

PORT="${1:-11434}"
HOSTNAME="${2:-}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ cloudflared introuvable. Installez-le :"
  echo "   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/api/version" >/dev/null 2>&1; then
  echo "⚠️  Aucun Ollama ne répond sur http://127.0.0.1:${PORT}"
  echo "   Démarrez-le d'abord :  ollama serve"
  echo "   (on continue quand même : le tunnel fonctionnera dès qu'Ollama sera lancé)"
fi

echo "🔌 Ouverture du tunnel vers http://127.0.0.1:${PORT} …"
echo "   L'URL publique s'affiche ci-dessous (ligne « https://xxx.trycloudflare.com »)."
echo "   → Collez-la dans OLLAMA_REMOTE_URL (site Ollama Web) puis redémarrez le site."
echo ""

if [ -n "${HOSTNAME}" ]; then
  exec cloudflared tunnel --url "http://127.0.0.1:${PORT}" --http-host-header "localhost:${PORT}" --hostname "${HOSTNAME}"
fi

exec cloudflared tunnel --url "http://127.0.0.1:${PORT}" --http-host-header "localhost:${PORT}"
