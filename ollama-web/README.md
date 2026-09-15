# 🤖 Ollama Web — votre Ollama (normalement local) dans le cloud

<p align="center">
  <b>Un site de chat prêt à déployer qui pilote un vrai serveur Ollama</b><br/>
  <i>Ollama Cloud · Ollama distant (Colab, VPS, tunnel) · Ollama local · conteneur « tout-en-un »</i><br/>
  <i>Zéro dépendance npm · hébergement gratuit possible · interface en français</i>
</p>

---

## ✨ Le principe en 30 secondes

Ollama, c'est génial, mais il tourne « chez vous » : il faut un PC allumé, une carte graphique,
et le port 11434 n'est joignable que depuis votre machine. Ce projet ajoute **le morceau qui
manque** : un site web (celui que vous consulterez depuis n'importe où) qui parle à Ollama —
que celui-ci tourne à côté du site, chez vous, sur un VPS, ou chez Ollama.

```
   Votre navigateur                Le site Ollama Web                    Ollama
  (PC, mobile, tablette)     (Render gratuit / HF Space / Docker)   (où vous voulez)
  ┌──────────────────┐        ┌───────────────────────────┐        ┌────────────────────┐
  │  http://…        │──HTTPS─▶│  pages + API + SSE        │─HTTP──▶│ api/chat (stream)  │
  │  streaming mot   │◀─SSE────│  0 dépendance, Node 18+   │◀─NDJSON┤ 1 · Ollama Cloud   │
  │  par mot         │        │  mot de passe, sessions   │        │ 2 · Colab/VPS/tunnel│
  └──────────────────┘        └───────────────────────────┘        │ 3 · même machine    │
                                                                   │ 4 · conteneur à côté│
                                                                   └────────────────────┘
```

Vous gardez **la même expérience que `ollama run`** : choix du modèle, streaming token par token,
`num_ctx`, température, `think` des modèles de raisonnement, `ollama pull` depuis l'interface.

---

## 🚀 Démarrage immédiat (2 commandes)

```bash
cd ollama-web
npm run demo          # 🧪 démo hors-ligne : interface complète, modèle simulé (aucun Ollama requis)
# → http://localhost:3000

npm start             # 🚀 le vrai site, branché sur VOTRE Ollama (voir « Brancher un Ollama »)
```

> Node 18 ou plus est requis. **Aucun `npm install` n'est nécessaire** : le site n'a aucune
> dépendance (pas de framework, pas de bundler, pas de build).

---

## 🔌 Brancher un Ollama : les 4 options

| | Où tournent les modèles | Ce qu'il faut | Coût | Latence |
|---|---|---|---|---|
| **1. Ollama Cloud** | chez Ollama | une clé API gratuite | 0 € (quota gratuit) | réseau |
| **2. Ollama distant** | Colab T4, VPS, votre PC | une URL + tunnel | 0 € (Colab) / ~4 €/mois (VPS) | réseau |
| **3. Ollama local** | votre machine | `ollama serve` | 0 € | instantanée |
| **4. Conteneur tout-en-un** | dans le conteneur du site | Docker | 0 € sur HF Spaces | CPU limité |

### 1. Ollama Cloud (le plus simple pour un vrai site en ligne)

```bash
# clé gratuite : https://ollama.com/settings/keys
echo 'OLLAMA_CLOUD_API_KEY=votre_cle' >> .env
npm start
```

Le site liste automatiquement les modèles cloud disponibles (`gpt-oss`, `qwen3`, `deepseek-r1`…)
via `ollama.com/api/tags`, puis discute en streaming avec `ollama.com/api/chat`.
Le **plan gratuit** d'Ollama Cloud accepte un usage léger (une session à la fois) : parfait pour
un outil personnel. Vérifiez les quotas sur <https://ollama.com/pricing>.

### 2. Ollama distant (Colab, VPS, PC maison + tunnel)

```bash
# A. sur la machine qui a le GPU/modèle
ollama serve                        # écoute sur 127.0.0.1:11434
./cloud/cloudflared-tunnel.sh       # affiche https://xxx.trycloudflare.com

# B. sur le site (ou dans les variables d'environnement de l'hébergeur)
OLLAMA_REMOTE_URL=https://xxx.trycloudflare.com
OLLAMA_REMOTE_LABEL=Colab T4
DEFAULT_PROVIDER=remote
```

Pour un GPU gratuit sans rien installer, ouvrez le notebook fourni :
**`cloud/ollama-colab.ipynb`** (runtime T4) → il installe Ollama, télécharge le modèle choisi,
ouvre le tunnel et affiche l'URL à coller dans `OLLAMA_REMOTE_URL`.

### 3. Ollama local (développement)

```bash
ollama serve            # dans un terminal
npm start               # dans un autre → http://localhost:3000
```
Rien à configurer : `OLLAMA_LOCAL_URL` vaut `http://127.0.0.1:11434` par défaut.

### 4. Tout-en-un dans un conteneur (Ollama + site)

```bash
docker compose up --build          # http://localhost:3000
docker compose exec ollama ollama pull qwen2.5:0.5b
```
Ou, pour héberger les deux **dans le cloud gratuitement** :
`Dockerfile.allinone` → Hugging Face Spaces (voir plus bas).

---

## ☁️ Déployer gratuitement

Il y a **trois chemins gratuits** ; choisissez selon ce que vous voulez :

| Chemin | Modèles | Difficulté | Sommeil |
|---|---|---|---|
| **A. Render + Ollama Cloud** ⭐ | les gros modèles d'Ollama | facile | non (service web toujours actif) |
| **B. Render + tunnel Colab** | le modèle de votre choix sur un T4 gratuit | moyen | non (mais Colab coupe au bout d'~90 min) |
| **C. Hugging Face Spaces** | petits modèles (0,5–3 B) sur CPU | facile | oui, réveil ~1 min |

### A. Render (site) + Ollama Cloud (modèles) — recommandé

1. Créez une clé gratuite : <https://ollama.com/settings/keys>.
2. Sur <https://render.com> → **New +** → **Blueprint** → choisissez ce dépôt GitHub.
   Comme le blueprint n'est pas à la racine, indiquez son chemin :
   **`ollama-web/render.yaml`** (Render permet désormais de placer le blueprint où vous voulez).
3. Render remplit tout seul la configuration, et vous demande seulement :
   - `APP_PASSWORD` → **le mot de passe du site** (obligatoire en pratique) ;
   - `OLLAMA_CLOUD_API_KEY` → votre clé ;
   - `OLLAMA_CLOUD_MODEL` → un modèle par défaut, p. ex. `gpt-oss:20b` ;
   - `OLLAMA_REMOTE_URL` → laissez vide si vous utilisez Ollama Cloud.
4. **Apply / Create** → Render construit (30 s) et vous donne une URL du type
   `https://ollama-web-xxxx.onrender.com`. Ouvrez-la, saisissez votre mot de passe : c'est prêt.

*Si vous préférez configurer à la main* : **New + → Web Service**, *Root Directory* = `ollama-web`,
*Build Command* = `npm install`, *Start Command* = `npm start`, puis ajoutez les mêmes variables.

> 💡 Le plan gratuit de Render **n'a pas besoin de « keep-alive » ici** : le site reçoit du trafic
> web dès que vous l'ouvrez, et il redémarre en quelques secondes s'il s'endort.

### B. Render + tunnel Colab

Faites la partie A (laissez `OLLAMA_CLOUD_API_KEY` vide), puis :
1. Ouvrez `ollama-web/cloud/ollama-colab.ipynb` dans <https://colab.research.google.com>
   (Exécution → Modifier le type d'exécution → **T4 GPU**), exécutez les cellules dans l'ordre.
2. La dernière cellule affiche une URL `https://….trycloudflare.com`.
3. Dans Render : *Environment* → `OLLAMA_REMOTE_URL` = cette URL → **Save** (le service redémarre).
4. Sur le site, choisissez le fournisseur « Ollama distant » : vos modèles T4 apparaissent.

⚠️ L'URL change à chaque nouvelle session Colab (il faut la remettre à jour), et Colab gratuit
coupe au bout de ~90 minutes d'inactivité. Pour du permanent → option A ou un petit VPS.

### C. Hugging Face Spaces (Ollama + site dans un seul conteneur, CPU)

1. Créez un Space : <https://huggingface.co/new-space> → **SDK Docker** → *Blank*.
2. Envoyez les fichiers du dossier `ollama-web/` dans le Space, en renommant
   **`Dockerfile.allinone` → `Dockerfile`**, et en ajoutant le fichier
   **`deploy/huggingface-space-README.md` → `README.md`** (il contient l'en-tête YAML exigé
   par Hugging Face, avec `app_port: 7860`).
3. *Settings → Variables and secrets* : `APP_PASSWORD` (secret) et `PULL_MODEL`
   (variable, p. ex. `qwen2.5:0.5b`).
4. Le Space build (~4 min), télécharge le modèle au démarrage, puis affiche l'app.

Sur CPU gratuit, restez sur `qwen2.5:0.5b` / `llama3.2:1b` (voir le tableau dans
`deploy/huggingface-space-README.md`). Les Spaces gratuits s'endorment et se réveillent en ~1 min.

### (Bonus) Docker / VPS auto-hébergé

```bash
docker build -t ollama-web .          # image du site : ~60 Mo, sans modèle
docker run -p 3000:3000 \
  -e APP_PASSWORD=motdepasse \
  -e OLLAMA_CLOUD_API_KEY=sk-… \
  ollama-web
```

---

## ⚙️ Variables d'environnement

Copiez `.env.example` en `.env` (le fichier est lu au démarrage, sans dépendance).

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute (Render/HF/Fly le fournissent eux-mêmes) |
| `HOST` | `0.0.0.0` | Interface d'écoute — laissez `0.0.0.0` en conteneur |
| `APP_PASSWORD` | *vide* | Mot de passe du site. **Vide = site public** (dangereux en ligne) |
| `SESSION_SECRET` | aléatoire | Signature des cookies ; fixez-le pour garder les sessions après redéploiement |
| `SESSION_TTL_DAYS` | `30` | Durée d'une session |
| `OLLAMA_CLOUD_API_KEY` | — | Clé Ollama Cloud : `https://ollama.com/settings/keys` |
| `OLLAMA_CLOUD_MODEL` | — | Modèle cloud proposé par défaut |
| `OLLAMA_REMOTE_URL` | — | URL d'un Ollama exposé (tunnel Colab, VPS, autre machine) |
| `OLLAMA_REMOTE_LABEL` | `Ollama distant` | Nom affiché dans le menu |
| `OLLAMA_REMOTE_API_KEY` | — | En-tête `Authorization` si votre proxy en exige un |
| `OLLAMA_LOCAL_URL` | `http://127.0.0.1:11434` | Ollama de la même machine |
| `DISABLE_LOCAL_PROVIDER` | — | `true` pour masquer le fournisseur local (site en ligne) |
| `OPENAI_BASE_URL` | — | N'importe quelle API compatible OpenAI (Groq, LM Studio, vLLM…) |
| `OPENAI_API_KEY` / `OPENAI_LABEL` / `OPENAI_MODEL` | — | Clé, nom et modèle par défaut de cette API |
| `PROVIDERS_EXTRA` | — | Fournisseurs supplémentaires : `id\|libellé\|type\|url\|clé\|modèle` |
| `DEFAULT_PROVIDER` | auto | Fournisseur sélectionné au démarrage (`cloud`, `remote`, `local`…) |
| `SYSTEM_PROMPT` | assistant francophone | Prompt système des nouvelles discussions |
| `ALLOW_PULL` | `true` | Autorise le bouton ⬇ (`ollama pull`) dans l'interface |
| `REQUEST_TIMEOUT_MS` | `300000` | Délai maximum d'une génération (5 min) |
| `MAX_MESSAGES` | `60` | Messages d'historique envoyés au modèle |
| `MAX_BODY_KB` | `512` | Taille maximale d'une requête |
| `MAX_CONTEXT_CHARS` | `48000` | Longueur d'historique conservée |
| `RATE_LIMIT_PER_MINUTE` | `60` | Limite de requêtes par IP (0 = illimité) |
| `VERBOSE` | `1` | `0` pour des logs silencieux |

---

## 🔐 Sécurité

- **Le navigateur ne voit jamais votre clé API** : elle reste côté serveur, le site ne fait que
  relayer les requêtes. Aucune clé n'est écrite dans les pages ni dans les logs d'erreur.
- `APP_PASSWORD` protège toutes les routes `/api/*` (liste des modèles, chat, pull). Les fichiers
  statiques restent publics — c'est ce qui permet d'afficher l'écran de connexion.
- Sessions : cookie `HttpOnly`, `SameSite=Lax`, signé en HMAC-SHA256, expiration intégrée.
  Ajoutez `COOKIE_SECURE=true` si votre proxy termine le HTTPS et que les cookies ne passent pas.
- Anti brute-force : 10 tentatives de mot de passe par IP et par 15 minutes ; limitation de débit
  sur `/api/chat` et `/api/pull`.
- Rendu markdown **sans `innerHTML` non échappé** : le texte du modèle est échappé avant mise en forme
  (testé contre l'injection de balises).
- Historique : stocké **dans votre navigateur** (`localStorage`). Le serveur ne conserve aucun message.

> ⚠️ Si vous exposez votre Ollama vous-même (option 2), souvenez-vous qu'**Ollama n'a pas
> d'authentification** : utilisez un tunnel temporaire ou un reverse-proxy protégé.

---

## 🖥️ L'interface

- Choix du **fournisseur** et du **modèle** (métadonnées : taille, quantification, paramètres) ;
- **Streaming** mot à mot, bouton **Arrêter**, statistiques (tokens, tokens/s, durée) ;
- Rendu **markdown** (titres, listes, citations, code avec bouton *Copier*), thème clair/sombre ;
- **Raisonnement** des modèles « thinking » (`deepseek-r1`, `qwen3`, `gpt-oss`) affichable ;
- **Historique** multi-discussions dans le navigateur + export `.md` ;
- **`ollama pull`** depuis l'interface avec barre de progression ;
- **Diagnostic serveur** (Réglages) : révèle en clair pourquoi un Ollama ne répond pas ;
- Responsive (mobile) et accessible au clavier (`Entrée` = envoyer, `Maj+Entrée` = retour à la ligne).

### API HTTP du site (au cas où vous voudriez l'automatiser)

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/healthz` | Sonde de vie (utilisée par Render/Docker) |
| `GET` | `/api/health` | État de chaque fournisseur (joignable, latence, nombre de modèles) |
| `GET` | `/api/config` | Fournisseurs, limites, recommandation (masqué sans session) |
| `POST` | `/api/login` | `{ "password": "…" }` → cookie de session |
| `GET` | `/api/models?provider=cloud` | Liste des modèles (`/api/tags` normalisé) |
| `POST` | `/api/chat` | **SSE** : `{ providerId, model, messages, options }` |
| `POST` | `/api/pull` | **SSE** : `{ providerId, model }` (progression du téléchargement) |

```bash
# Exemple : conversation en streaming, en ligne de commande
curl -N -c cookies.txt -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' -d '{"password":"motdepasse"}'

curl -N -b cookies.txt http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"cloud","model":"gpt-oss:20b","messages":[{"role":"user","content":"Bonjour !"}]}'
```

---

## 🧪 Tests

```bash
npm test          # 46 vérifications : HTTP, SSE, providers, erreurs, authentification
npm run demo      # démo visuelle avec un faux Ollama (aucune clé, aucun GPU)
```

Il existe aussi un test d'interface qui charge réellement la page dans un DOM simulé :

```bash
npm install --no-save jsdom   # dépendance facultative, uniquement pour ce test
npm run test:ui               # rendu, streaming, markdown, historique, écran de connexion
```

---

## 🧯 Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| « Aucun serveur Ollama ne répond » | Le fournisseur affiché n'a pas d'Ollama en face : ouvrez **Réglages → Diagnostic serveur** |
| Le fournisseur local échoue en ligne | Normal : ce n'est pas la même machine. Utilisez Ollama Cloud ou distant, ou `DISABLE_LOCAL_PROVIDER=true` |
| `401` côté Ollama Cloud | Clé invalide ou expirée → `OLLAMA_CLOUD_API_KEY` |
| `404 modèle introuvable` | Le modèle n'est pas installé : bouton ⬇ (`ollama pull`) ou nom exact du modèle |
| Réponses très lentes | Modèle trop gros pour la machine (surtout sur CPU gratuit) : essayez `qwen2.5:0.5b` |
| Le site se met en veille sur Render | Ouvrez-le : il redémarre en quelques secondes. Pour un service permanent, gardez-le chaud avec un pinger gratuit (UptimeRobot) |
| L'URL du tunnel ne marche plus | Une session Colab/tunnel s'arrête → relancez et mettez `OLLAMA_REMOTE_URL` à jour |
| Le port 3000 est pris | `PORT=4000 npm start` |

---

## 📉 Les limites, dites honnêtement

- **« Gratuit » a toujours un plafond** : Ollama Cloud gratuit = usage léger, une inférence à la fois ;
  Colab gratuit = ~90 min de session et GPU partagé ; Spaces/CPU gratuit = petits modèles seulement.
- Un site cloud **ne peut pas** faire tourner un gros modèle sans GPU : le calcul doit avoir lieu
  quelque part d'où il y a du GPU (Cloud, Colab, votre machine), et le site s'y connecte.
- Le plan gratuit de Render offre 512 Mo de RAM : largement assez pour ce site (il ne charge
  aucun modèle), mais pas pour héberger Ollama lui-même.
- Les discussions vivent dans le navigateur : vider le cache = perdre l'historique (exportez en `.md`).

---

## 📂 Structure

```
ollama-web/
├── src/
│   ├── index.js            # démarrage, bannière, arrêt propre
│   ├── server.js           # HTTP : statique, API JSON, SSE, limites, logs
│   ├── providers.js        # adaptateurs Ollama natif + API compatible OpenAI
│   ├── config.js           # .env, fournisseurs, limites
│   └── auth.js             # mot de passe, sessions HMAC, anti brute-force
├── public/                 # interface (HTML/CSS/JS natifs, aucun build)
├── scripts/
│   ├── mock-ollama.js      # faux serveur Ollama (démo + tests)
│   ├── demo.js             # `npm run demo`
│   ├── test.js             # `npm test` (46 vérifications)
│   └── test-ui.js          # `npm run test:ui` (nécessite jsdom)
├── cloud/
│   ├── ollama-colab.ipynb  # Colab T4 gratuit → serveur Ollama + tunnel
│   └── cloudflared-tunnel.sh
├── deploy/
│   └── huggingface-space-README.md   # en-tête à copier dans un Space HF
├── Dockerfile              # image du site seul (~60 Mo)
├── Dockerfile.allinone     # Ollama + site dans un conteneur (HF Spaces, Fly…)
├── docker-compose.yml      # Ollama + site en local
├── render.yaml             # blueprint Render (plan gratuit)
└── .env.example
```

## 📜 Licence

MIT — comme le reste du dépôt. Ollama est un projet indépendant
([ollama.com](https://ollama.com)) ; ce site n'est qu'un client de son API.
