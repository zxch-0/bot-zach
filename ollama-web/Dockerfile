# ============================================================
#  Ollama Web — image légère du site (aucun modèle embarqué)
#  Le site se connecte à Ollama Cloud, à un Ollama distant, ou au
#  conteneur Ollama lancé à côté (voir docker-compose.yml).
#
#  Build : docker build -t ollama-web ollama-web/
#  Run   : docker run -p 3000:3000 -e APP_PASSWORD=motdepasse ollama-web
# ============================================================
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# L'application n'a AUCUNE dépendance npm : on copie simplement le code.
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY .env.example ./

# Utilisateur non-root
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
