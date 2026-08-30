# 👑 ZachServices

<p align="center">
  <b>Bot Discord tout-en-un : invitations · daily coins · casino · boutique</b>
  <br/>
  <i>100 % gratuit &amp; open source — hébergeable gratuitement 24 h/24</i>
</p>

---

## 📖 Présentation

**ZachServices** est un bot Discord d'économie pour votre serveur :

1. **🎟️ Invitations** — le bot suit **lui-même** les liens d'invitation du serveur (aucun bot externe requis). Chaque membre qui rejoint via le lien d'un autre membre crédite son inviteur d'une **invitation réussie**. Si le membre invité repart, l'invitation est décomptée.
2. **🎁 Daily coins** — la commande `/daily` donne **100 coins** toutes les **24 h**, mais elle est **verrouillée** tant que le membre n'a pas au moins **1 invitation réussie**.
3. **🎰 Casino** — deux jeux contre le bot pour tenter de **doubler ses coins** :
   - `/blackjack` — blackjack complet avec boutons **Piocher / Rester / Doubler** ;
   - `/rps` — pierre-feuille-ciseaux contre le bot.
4. **🛒 Boutique** — les coins se dépensent dans le `/shop` :

   | Produit | Prix |
   |---|---|
   | 🧰 **Zach-checker** | 1 000 coins |
   | 💎 **Zach-checker Premium** | 5 000 coins |

   À l'achat, le bot demande le **pseudo Discord de livraison**, débite les coins puis **envoie un message privé à l'administrateur** (vous) contenant : le pseudo de l'acheteur, le produit acheté, le prix et le pseudo de livraison — tout ce qu'il faut pour livrer la commande.

> 💡 **Zéro dépendance payante** : stockage local (fichier JSON) ou base PostgreSQL **gratuite** (Neon), et un guide d'hébergement 100 % gratuit est fourni plus bas.

---

## 🧾 Toutes les commandes

| Commande | Description | Accès |
|---|---|---|
| `/daily` | Récupère **100 coins** (24 h de cooldown) — **1 invitation réussie requise** | Tous |
| `/invitations [utilisateur]` | Affiche les invitations réussies d'un membre | Tous |
| `/solde [utilisateur]` | Affiche le solde de coins | Tous |
| `/classement` | Top 10 des plus grosses bourses | Tous |
| `/blackjack mise` | Blackjack contre le croupier (boutons interactifs) | Tous |
| `/rps mise choix` | Pierre-feuille-ciseaux contre le bot | Tous |
| `/shop` | Boutique — achat de produits avec livraison | Tous |
| `/aide` | Rappel des commandes et des règles | Tous |
| `/give utilisateur montant` | Ajoute/retire des coins (montant négatif = retrait) | **Admin du bot** |
| `/import-invites` | Importe les invitations existantes du serveur | **Gérer le serveur** |

### ⚖️ Règles du casino

| Situation | Gain |
|---|---|
| Blackjack gagné | Mise **×2** (bénéfice = mise) |
| Blackjack naturel (21 en 2 cartes) | Mise **×2,5** |
| Blackjack égalité (push) | Mise **remboursée** |
| Pierre-feuille-ciseaux gagné | Mise **×2** |
| Pierre-feuille-ciseaux égalité | Mise **remboursée** |
| Perdu | Mise perdue |

Le croupier du blackjack tire jusqu'à atteindre 17 et s'arrête. La mise est **débitée au lancement** de la partie ; les gains sont crédités à la fin. Une seule partie de blackjack à la fois par joueur ; après **90 s d'inactivité** la main est "restée" automatiquement.

### 🎟️ Comment fonctionne le suivi des invitations

- Le bot photographie les compteurs de **tous les liens d'invitation** du serveur.
- Quand un membre arrive, le lien dont le compteur a monté identifie **l'inviteur**, qui est crédité.
- Une invitation est **réussie** tant que le membre invité **reste** sur le serveur (s'il part, elle est décomptée).
- 🛡️ Anti-triche : rejoindre avec **son propre** lien d'invitation ne compte pas ; les bots ne comptent pas.
- ⚠️ Les liens **vanity** (`discord.gg/mon-serveur`) n'ont pas de créateur : ces arrivées ne crédite­nt personne.
- ⚠️ Le bot doit être **en ligne** au moment de l'arrivée pour tracker. Pour créditer les invitations antérieures à l'installation du bot, un admin peut lancer `/import-invites`.

---

## 🚀 Installation locale (5 minutes)

### 1. Prérequis

- **Node.js 18 ou plus** (idéalement la LTS 20+) : https://nodejs.org (choisir *LTS*).
- Un compte Discord (et idéalement un serveur de test où vous êtes propriétaire).

Vérifiez votre installation :

```bash
node --version   # doit afficher v18.x, v20.x ou plus
npm --version
```

### 2. Télécharger le code

```bash
git clone https://github.com/zxch-0/bot-zach.git
cd bot-zach
npm install
```

*(Ou téléchargez le ZIP via le bouton vert **Code** de GitHub, décompressez-le, puis `npm install` dans le dossier.)*

### 3. Créer l'application Discord (pas à pas)

1. Ouvrez le **Discord Developer Portal** : https://discord.com/developers/applications
2. Cliquez sur **New Application** (en haut à droite), donnez-lui le nom **ZachServices**, acceptez les conditions.
3. Dans le menu de gauche, onglet **Bot** :
   - Cliquez sur **Reset Token** → **Copy** : c'est votre **DISCORD_TOKEN**. Gardez-le secret, ne le partagez jamais.
   - ⚠️ **Privileged Gateway Intents** (plus bas sur la même page) : activez **Server Members Intent**. *Sans cela, le bot ne peut pas détecter les arrivées de membres et le suivi d'invitations ne fonctionnera pas.*
4. Dans le menu de gauche, onglet **General Information** : copiez l'**APPLICATION ID** : c'est votre **CLIENT_ID**.
5. **Invitez le bot sur votre serveur** — remplacez `VOTRE_CLIENT_ID` dans cette URL et ouvrez-la dans votre navigateur :

   ```
   https://discord.com/oauth2/authorize?client_id=VOTRE_CLIENT_ID&permissions=85024&scope=bot%20applications.commands
   ```

   Sélectionnez votre serveur et autorisez. Le chiffre `85024` correspond aux permissions suivantes :

   | Permission | Utilité |
   |---|---|
   | Gérer le serveur | **Lire les liens d'invitations** (suivi des invitations) |
   | Voir les salons / Envoyer des messages / Intégrer des liens | Fonctionnement de base, embeds |
   | Lire l'historique des messages | Boutons du blackjack |

### 4. Récupérer votre ID Discord (pour les MP de livraison)

1. Dans Discord : **Paramètres utilisateur → Avancé → Mode développeur** : activé.
2. Clic droit sur **votre pseudo** → **Copier l'identifiant utilisateur** : c'est votre **ADMIN_USER_ID**.

### 5. Configurer le bot

Créez votre fichier de configuration à partir du modèle :

```bash
# Linux / macOS
cp .env.example .env
# Windows (PowerShell)
copy .env.example .env
```

Ouvrez `.env` et remplissez au minimum :

```env
DISCORD_TOKEN=le_token_copié_à_l'étape_3
CLIENT_ID=l_application_id_copié_à_l'étape_3
ADMIN_USER_ID=votre_id_discord
```

Toutes les variables :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Le token du bot |
| `CLIENT_ID` | ✅ | L'ID de l'application |
| `ADMIN_USER_ID` | ✅* | Votre ID — reçoit les **MP d'achat** et seul à pouvoir utiliser `/give` |
| `GUILD_ID` | — | ID d'un serveur de test pour des commandes **instantanées** (dev uniquement) |
| `PURCHASE_LOG_CHANNEL_ID` | — | Salon où journaliser les achats **en plus** du MP |
| `DATABASE_DRIVER` | — | `json` (par défaut) ou `postgres` (hébergement gratuit, voir plus bas) |
| `DATABASE_URL` | — | Chaîne de connexion PostgreSQL (si `postgres`) |
| `DAILY_REWARD` | — | Coins du `/daily` (défaut : `100`) |
| `DAILY_COOLDOWN_HOURS` | — | Cooldown du daily en heures (défaut : `24`) |
| `KEEP_ALIVE` | — | `true` = démarre le mini serveur web anti-endormissement (Render…) |
| `PORT` | — | Port du keep-alive (défaut : `3000`, fourni automatiquement par Render) |

### 6. Lancer le bot 🎉

```bash
npm start
```

Vous devez voir :

```
📦 10 commande(s) chargée(s)
🗄️  Stockage prêt (pilote : json)
✅ Connecté en tant que ZachServices#....
📜 10 commande(s) enregistrée(s) globalement
🎟️ Invitations suivies sur "Votre Serveur"
🚀 ZachServices est opérationnel !
```

> ⏳ Les commandes globales peuvent mettre **jusqu'à 1 h** à apparaître sur Discord.
> Pour du test immédiat : définissez `GUILD_ID` (ID de votre serveur — Mode développeur → clic droit sur le serveur → Copier l'identifiant) puis relancez le bot.

### 7. Tester le bot

- Dans Discord, tapez `/aide` → le bot présente tout.
- `/solde` → 0 coins. `/daily` → verrouillé (explique comment inviter).
- Invitez un ami avec **votre** lien d'invitation (salon → icône ➕ *Inviter des personnes* → *Modifier les paramètres du lien* → réglez pour que **le lien ne expire jamais** pour faciliter le suivi).
- L'ami rejoint → `/invitations` → **1 invitation** → `/daily` → **+100 coins** 🎉
- `/blackjack 50`, `/rps 50 pierre` → jouez !
- `/shop` → achetez quand vous avez assez de coins → **vous recevez un MP** avec l'acheteur, le produit et le pseudo de livraison.
- Admin : `/give @membre 10000` pour créditer des coins de test.

---

## ☁️ Héberger le bot GRATUITEMENT, 24 h/24

Deux solutions 100 % gratuites :

| Solution | Coût | Difficulté | Données |
|---|---|---|---|
| **A. Render + Neon + UptimeRobot** (recommandé) | 0 € | Moyenne | ✅ Persistantes (PostgreSQL gratuit) |
| **B. Votre PC / Raspberry Pi** | 0 € | Facile | ✅ Persistantes (fichier local) |

> ⚠️ **À savoir** : les hébergeurs gratuits comme Render **effacent le disque** à chaque redémarrage. C'est pourquoi la solution A utilise une base PostgreSQL **gratuite et persistante** chez Neon. Ne tentez pas d'héberger le bot sur Render avec le stockage `json` : les coins seraient perdus à chaque redémarrage !

---

### Solution A — Render (hébergement) + Neon (base de données) + UptimeRobot (anti-sommeil)

#### A.1 — Mettre le code sur GitHub

1. Créez un compte sur https://github.com si besoin.
2. Créez un **nouveau dépôt** (repository), par exemple `bot-zach`, **en privé**.
3. Envoyez le code (depuis le dossier du bot) :

```bash
git init
git add .
git commit -m "ZachServices"
git remote add origin https://github.com/VOTRE-PSEUDO/bot-zach.git
git branch -M main
git push -u origin main
```

> 🔒 Le fichier `.env` est automatiquement ignoré par `.gitignore` : votre token ne sera **jamais** envoyé sur GitHub. Vérifiez avec `git status` que `.env` et `data/` n'apparaissent pas.

#### A.2 — Créer la base PostgreSQL gratuite (Neon)

1. Allez sur https://neon.tech → **Sign up** (avec GitHub, c'est plus simple). Aucune carte bancaire requise.
2. **Create project** → nommez-le `zachservices`, choisissez la région la plus proche (ex. `Paris (aws-eu-west-3)` ou `Frankfurt`).
3. Sur le tableau de bord du projet, cherchez **Connection string** et copiez l'URL affichée, du type :
   ```
   postgresql://utilisateur:motdepasse@ep-xxxx-xxxx.aws.eu-west-1.neon.tech/neondb?sslmode=require
   ```
   C'est votre **DATABASE_URL** — gardez-la pour A.3.

> 💡 Neon gratuit : 0,5 Go de stockage, largement suffisant pour des milliers de membres.

#### A.3 — Créer le service gratuit sur Render

1. Allez sur https://render.com → **Get Started** (connexion avec GitHub).
2. **New +** → **Web Service**.
3. Connectez votre dépôt `bot-zach` (Render demande l'accès à GitHub la première fois — autorisez, puis sélectionnez le dépôt).
4. Configurez le service :
   - **Name** : `zachservices`
   - **Region** : la plus proche (ex. Francfort)
   - **Branch** : `main`
   - **Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : **Free** ✅
5. Ouvrez **Environment** (à gauche) et ajoutez les variables d'environnement — **c'est ici que vous mettez le contenu du `.env`**, sans jamais l'envoyer sur GitHub :

   | Clé | Valeur |
   |---|---|
   | `DISCORD_TOKEN` | votre token |
   | `CLIENT_ID` | votre application ID |
   | `ADMIN_USER_ID` | votre ID Discord |
   | `DATABASE_DRIVER` | `postgres` |
   | `DATABASE_URL` | la chaîne Neon copiée en A.2 |
   | `KEEP_ALIVE` | `true` |
   | `GUILD_ID` *(optionnel)* | ID du serveur pour des commandes instantanées |
   | `PURCHASE_LOG_CHANNEL_ID` *(optionnel)* | ID du salon de journal des achats |

6. Cliquez **Create Web Service** → Render installe les dépendances et démarre le bot.
   Dans les logs vous devez voir :
   ```
   ✅ Connecté en tant que ZachServices#....
   🗄️  Stockage prêt (pilote : postgres)
   🌐 Keep-alive actif sur le port ...
   🚀 ZachServices est opérationnel !
   ```
7. En haut de la page, notez l'**URL publique** du service (ex. `https://zachservices.onrender.com`).

> 🔄 À chaque `git push`, Render redéploie automatiquement le bot avec le nouveau code.

#### A.4 — Empêcher le bot de s'endormir (UptimeRobot)

Les services gratuits de Render **s'endorment après 15 min sans trafic web** — or un bot Discord ne reçoit pas de trafic web ! D'où le keep-alive intégré + un pinger gratuit :

1. Créez un compte sur https://uptimerobot.com (plan **Free**).
2. **Add New Monitor** :
   - **Monitor Type** : `HTTP(s)`
   - **Friendly Name** : `ZachServices`
   - **URL** : l'URL Render de A.3 (ex. `https://zachservices.onrender.com`)
   - **Monitoring Interval** : `5 minutes`
3. **Create Monitor**. C'est fini : UptimeRobot pinge le bot toutes les 5 min, le keep-alive répond `{"status":"ok"}` et Render ne l'endort plus jamais.

> 🧠 Si le bot s'est quand même endormi (par exemple après un déploiement), le premier ping peut prendre ~30 s — c'est normal.

---

### Solution B — Héberger chez soi (PC, Raspberry Pi…)

Le stockage reste le fichier local `data/zach.json` (persistant, aucune configuration).

1. Installez **Node.js 18+** sur la machine.
2. Copiez le dossier du bot, puis :
   ```bash
   npm install
   cp .env.example .env   # puis remplissez DISCORD_TOKEN, CLIENT_ID, ADMIN_USER_ID
   npm start
   ```
3. Pour le lancer en tâche de fond et le relancer au démarrage, installez **pm2** :
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name zachservices
   pm2 save
   pm2 startup   # suit les instructions affichées pour lancer au démarrage
   pm2 logs zachservices   # voir les logs
   ```

> ⚠️ Le bot ne tourne que si la machine est allumée et connectée à Internet.

### Autres alternatives gratuites (en bref)

- **Railway** (https://railway.app) : très simple, mais le plan gratuit est un essai limité en crédits — pratique pour tester.
- **Oracle Cloud Always Free** (https://cloud.oracle.com/free) : une vraie VM gratuite à vie (Arm, 24 Go RAM) — plus technique (SSH, Linux) mais imbattable, avec stockage local persistant.
- **Fly.io** : petit crédit gratuit à l'inscription, nécessite une carte bancaire.

---

## 🔧 Personnaliser le bot

| Quoi | Où |
|---|---|
| Produits, prix, descriptions de la boutique | tableau `products` dans `src/config.js` |
| Récompense du daily / cooldown | variables `DAILY_REWARD` et `DAILY_COOLDOWN_HOURS` du `.env` |
| Mise maximale du casino | `.setMaxValue(...)` dans `src/commands/blackjack.js` et `src/commands/rps.js` |
| Paiement du blackjack (×2, ×2,5…) | fonction `payoutFor` dans `src/games/blackjack.js` |
| Textes et couleurs des messages | `src/commands/*` et `src/utils/embeds.js` |

Exemple — ajouter un produit dans `src/config.js` :

```js
products: [
  // ...
  {
    id: 'zach-custom',
    name: 'Mon produit',
    emoji: '🎯',
    price: 2500,
    description: 'La description affichée dans /shop.',
  },
],
```

---

## 🧪 Tests automatisés

Le dépôt inclut 47 auto-tests de la logique métier (économie, daily, invitations, blackjack, RPS, boutique) :

```bash
npm run selftest
```

---

## 🆘 Dépannage (FAQ)

| Problème | Solution |
|---|---|
| `An invalid token was provided` | Reset le token (Developer Portal → Bot → **Reset Token**) et mettez à jour `DISCORD_TOKEN` (ou la variable Render). |
| `Used disallowed intents` | Activez **Server Members Intent** (Developer Portal → Bot → *Privileged Gateway Intents*), puis redémarrez le bot. |
| Les commandes `/...` n'apparaissent pas | Patientez jusqu'à 1 h (propagation globale) ; sinon définissez `GUILD_ID` pour un effet immédiat sur ce serveur ; vérifiez que le lien d'invitation contient `scope=bot applications.commands`. |
| Les invitations ne comptent pas | 1) Le bot doit avoir la permission **Gérer le serveur** (relancez l'URL d'invitation de l'étape 3). 2) *Server Members Intent* activé. 3) Le membre a-t-il utilisé un lien **vanity** ou rejoint pendant que le bot était hors ligne ? 4) Utilisez `/import-invites` pour créditer les anciennes invitations. |
| Je ne reçois pas les MP d'achat | Vérifiez `ADMIN_USER_ID` (ou la variable Render) ; le bot doit partager un serveur avec vous ; vérifiez que vous n'avez pas bloqué le bot. Un salon `PURCHASE_LOG_CHANNEL_ID` peut servir de secours. |
| Les coins disparaissent après un redéploiement Render | Vous utilisez le stockage `json` sur un disque éphémère. Passez à `DATABASE_DRIVER=postgres` + `DATABASE_URL` Neon (solution A). |
| Le bot s'endort / se coupe sur Render | Configurez `KEEP_ALIVE=true` **et** un moniteur UptimeRobot (A.4). |
| `Solde insuffisant` pendant un test | Utilisez `/give @vous 10000` (réservé à `ADMIN_USER_ID`). |
| Un membre a perdu ses coins suite à un doublon de commande | Les achats sont listés avec un numéro `#id` — retrouvez-les dans la table `purchases` (PostgreSQL) ou `data/zach.json` (local). |

---

## 📁 Structure du projet

```
bot-zach/
├── src/
│   ├── index.js              # Point d'entrée (client, chargements, arrêt propre)
│   ├── config.js             # Configuration (.env) + produits de la boutique
│   ├── keepAlive.js          # Mini serveur web anti-endormissement (UptimeRobot)
│   ├── storage/
│   │   ├── index.js          # Fabrique de stockage (interface commune)
│   │   ├── json.js           # Pilote fichier local data/zach.json
│   │   └── postgres.js       # Pilote PostgreSQL (Neon, transactions atomiques)
│   ├── services/
│   │   ├── economy.js        # Solde, /daily (invitation + cooldown), mises
│   │   ├── invites.js        # Tracking des invitations (snapshots, attribution)
│   │   └── shop.js           # Boutique, achat atomique, MP admin, journal
│   ├── games/
│   │   ├── blackjack.js      # Logique pure du blackjack (testable)
│   │   ├── blackjackGame.js  # Partie interactive (boutons Discord)
│   │   └── rps.js            # Pierre-feuille-ciseaux (logique pure)
│   ├── flows/
│   │   └── shopFlow.js       # Menu /shop → modale pseudo → validation achat
│   ├── commands/             # 10 commandes slash (daily, solde, classement,
│   │                         # invitations, blackjack, rps, shop, aide, give, import-invites)
│   ├── events/               # ready, guildMemberAdd/Remove, inviteCreate/Delete,
│   │                         # guildCreate, interactionCreate
│   └── utils/                # Embeds et formatage (coins, durées, dates)
├── scripts/
│   └── selftest.js           # 47 tests automatisés (npm run selftest)
├── .env.example              # Modèle de configuration
├── package.json
└── README.md
```

---

## 🔒 Sécurité & bonnes pratiques

- **Ne partagez jamais votre token**. Si celui-ci fuite : *Reset Token* immédiatement dans le Developer Portal.
- Ne **committez jamais** le fichier `.env` (il est exclu par `.gitignore`).
- Sur Render, les secrets vont dans **Environment**, jamais dans le code.
- Le bot applique des **débits atomiques** (impossible de passer en solde négatif, même en cas de clics simultanés) et bloque la **self-invitation** (rejoindre avec son propre lien). Gardez toutefois un œil sur les invitations de comptes fraîchement créés (multicomptes) avant de livrer des produits payants en coins.
- Le casino est un jeu : rappelez à vos membres que les coins sont virtuels et n'ont aucune valeur réelle.

---

## 📜 Licence

MIT — voir [LICENSE](LICENSE).
