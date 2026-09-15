#!/usr/bin/env bash
# ============================================================
#  Démarrage du conteneur « tout-en-un » :
#    1. lance le serveur Ollama
#    2. attend qu'il réponde
#    3. télécharge le modèle demandé (PULL_MODEL) s'il n'est pas déjà là
#    4. démarre le site web qui pointe sur ce serveur Ollama
# ============================================================
set -euo pipefail

export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"
MODEL="${PULL_MODEL:-qwen2.5:0.5b}"

echo "▶ Démarrage du serveur Ollama sur ${OLLAMA_HOST}…"
ollama serve >/var/log/ollama.log 2>&1 &
OLLAMA_PID=$!

echo "▶ Attente de l'API Ollama…"
for __ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
    echo "✔ Ollama est prêt ($(curl -fsS http://127.0.0.1:11434/api/version))"
    break
  fi
  sleep 1
done

if [ -n "${MODEL}" ]; then
  echo "▶ Vérification du modèle « ${MODEL} » (téléchargement au premier démarrage)…"
  if ollama list | awk '{print $1}' | grep -qx "${MODEL}"; then
    echo "✔ ${MODEL} déjà présent"
  else
    echo "  … téléchargement, cela peut prendre plusieurs minutes"
    ollama pull "${MODEL}" || echo "⚠️  Échec du téléchargement de ${MODEL} — vous pourrez le relancer depuis l'interface (bouton ⬇)"
  fi
fi

# Le site parle au serveur Ollama local du conteneur.
export OLLAMA_LOCAL_URL="http://127.0.0.1:11434"
export OLLAMA_LOCAL_MODEL="${MODEL}"
export DEFAULT_PROVIDER="${DEFAULT_PROVIDER:-local}"

echo "▶ Lancement du site web sur le port ${PORT:-3000}…"
exec node /app/src/index.js
