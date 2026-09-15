---
title: Ollama Web
emoji: 🤖
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: Chat avec un vrai Ollama, hébergé gratuitement
---

# 🤖 Ollama Web — Space « tout-en-un »

Ce Space fait tourner **Ollama** et le **site de chat** dans un seul conteneur.

## Comment l'utiliser

1. Créez un Space gratuit : <https://huggingface.co/new-space> → **SDK : Docker** → *Blank*.
2. Dans le Space, onglet **Files** → ajoutez ces fichiers (glisser-déposer) :
   - `Dockerfile` ← **renommez** `Dockerfile.allinone` du dépôt en `Dockerfile`
   - tout le contenu de `ollama-web/` (`src/`, `public/`, `scripts/`, `docker/`, `package.json`)
   - ce fichier `README.md`
3. Onglet **Settings** → *Variables and secrets* : ajoutez
   - `APP_PASSWORD` → votre mot de passe (secret)
   - `PULL_MODEL` → le modèle à télécharger au démarrage, p. ex. `qwen2.5:0.5b` (variable)
4. Le Space redémarre et construit l'image (3–5 min). Ouvrez l'onglet **App**.

## Modèles réalistes sur un Space CPU gratuit

| Modèle | Taille | Vitesse indicative (CPU 2 vCPU) |
|---|---|---|
| `qwen2.5:0.5b` | ≈0,4 Go | ~15–30 mots/s |
| `llama3.2:1b` | ≈1,3 Go | ~8–15 mots/s |
| `qwen2.5:3b` | ≈2 Go | ~3–6 mots/s |

Au-delà de ~3 B de paramètres, les offres gratuites CPU deviennent trop lentes :
visez dans ce cas **Ollama Cloud** ou un **Ollama distant** (Colab T4, petit VPS).

## Limites à connaître

- Les Spaces gratuits **s'endorment** après une période d'inactivité (le premier réveil prend
  ~1 minute) et sont limités en CPU/RAM. Pour un service permanent : Render + Ollama Cloud.
- Le disque du Space n'est pas garanti persistant : au redémarrage, le modèle peut devoir
  être re-téléchargé (quelques minutes). C'est le prix du gratuit.
- Un Space public est accessible à tout le monde : mettez **impérativement** `APP_PASSWORD`.
