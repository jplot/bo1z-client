# bo1z

Black Ops Zombies dans le navigateur, à plusieurs. Le point de départ est le portage de https://vel.gg/bo1z : son site et son moteur compilé sont désormais dans ce dépôt, et seules les données du jeu peuvent encore venir de vel.gg. Le jeu tourne sur `http://127.0.0.1`, que les navigateurs traitent comme un contexte sécurisé : le moteur y a `SharedArrayBuffer` sans HTTPS.

## Organisation

- `server/` (Fastify, TypeScript exécuté tel quel par Node) : le relais (site, salons, pont UDP, cache des données du jeu).
- `client/` : le site en TypeScript, compilé par Vite. Le menu (`index.html`, `menu/`) et la page de carte (`map.html`, `map/` : écran de chargement, reprise de la souris, encart F3) en Vue ; la partie (`game/` : déroulé, pont avec le moteur, entrées, son, télémétrie), qui expose son état à l'interface ; le téléchargement des cartes dans le stockage du navigateur (`download/`, des workers) ; le réseau (`net/`) ; la liste de nos cartes (`catalog.ts`, partagée avec le serveur).
- `web/` : copié tel quel par Vite : la colle générée du moteur (`artifacts/KisakBlack-web.mjs`), modifiée à la main là où la page s'y branche.
- `dist/` : le site compilé que sert le relais (`npm run build`).
- `engine/KisakBlack-web.wasm` : le moteur compilé par vel.gg à partir de KisakBlack (C++, GPL-3.0). Seul fichier qu'on ne peut modifier qu'en le patchant.
- `patch/` : les patchs du wasm et le réécrivain qui les applique.
- branche `assets` : les données du jeu (cartes, manifestes, images, caches de shaders, vidéos), voir « Jouer sans vel.gg ».

## Lancer

```sh
node patch/build.mjs   # écrit overrides/bo1z/artifacts/KisakBlack-web.wasm
npm run build          # compile le site dans dist/ (à refaire après chaque modification de client/ ou web/)
node server/index.ts   # port 8484, ou PORT=... ; site à la racine, ou PREFIX=/bo1z pour le servir sous un chemin
```

Puis ouvrir http://127.0.0.1:8484 dans Chrome.

- Le relais sert d'abord `overrides/` (le moteur patché), puis `dist/`, puis les pages de carte rendues depuis `dist/map.html`, et enfin les données du jeu depuis `cache/`.
- `cache/` garde les données du jeu en clair, rangées comme sur vel.gg, sans jamais les rafraîchir ; le relais y découpe à la volée les morceaux `?part=k` que demande le jeu. Ce qui manque est téléchargé chez vel.gg.
- La télémétrie du site reste sur ce poste : seules les pages ouvertes sur cette machine l'envoient, ou toutes avec `TELEMETRY=1` (pour les joueurs du réseau local ; Heroku ne la pose pas). Chaque envoi (plantage avec les 300 dernières lignes de la console du moteur, erreurs, fin de session) est ajouté à `telemetry/<PORT>.jsonl`.
- `ws://127.0.0.1:<PORT>/kbnet` relie la page au port UDP `NET_PORT` (3074 par défaut, le port que le jeu prend quand `connect` n'en précise pas), ouvert sur le réseau local : le relais affiche au démarrage les adresses à donner aux autres joueurs.

## Patcher le moteur

`node patch/build.mjs` lit `engine/KisakBlack-web.wasm` et écrit le wasm patché dans `overrides/`, sans réseau : envoi, réception et `connect` vers une IPv4 passent par `kbnet.js`, la pause ne fige plus l'hôte d'une partie à plusieurs (en solo, Échap met toujours le jeu en pause), les assertions ne sont plus fatales. Le module JS qui charge le moteur (`web/artifacts/KisakBlack-web.mjs`) déclare les imports ajoutés et se modifie directement, comme tout le reste du site. `rm -r overrides` revient au moteur d'origine.

## Jouer à plusieurs

Deux façons de se rejoindre ; dans les deux cas, celui qui rejoint charge d'abord la carte en local, puis la page envoie `connect` dès que sa partie démarre.

### Salon (WebRTC)

Le menu (la racine du site, ou `PREFIX` ; les anciennes adresses en `/bo1z/…` y redirigent) a deux onglets. Solo montre les cartes par jeu, en mosaïque ou en liste, avec le Mode Enfer. Multijoueur liste les salons ouverts : code, carte, pseudos (l'hôte en premier) et places, quatre au plus. REJOINDRE ouvre la carte de l'hôte, REJOINDRE AVEC UN CODE prend les quatre lettres que l'hôte donne. + CRÉER UN SALON fait choisir la carte et tire un code de quatre consonnes encore libre ; SALON PRIVÉ le retire de la liste, on ne le rejoint plus qu'avec son code (`/rooms?code=<code>` le trouve). `/bo1z?room=<code>` ouvre la saisie du code déjà remplie. Le pseudo est retenu par le navigateur et envoyé au jeu (`name`) avant la connexion ; sans pseudo, le serveur renomme les doublons « Unknown Soldier 1 ». Le Mode Enfer ne s'applique qu'en solo pour l'instant.

La page de carte lance le téléchargement d'elle-même et affiche les étapes (liaison avec l'hôte, téléchargement, moteur, prêt) avec les pseudos du salon ; le seul geste demandé est le clic qui capture la souris. Chez celui qui rejoint, l'écran reste jusqu'à ce que les instantanés de l'hôte arrivent sans interruption, ce qui cache le chargement de la partie de l'hôte. Les erreurs (liaison impossible, hôte parti, téléchargement interrompu, stockage, navigateur, plantage du moteur) passent par la même page, en français, avec la reprise qui convient.

Sans passer par le menu, tous les joueurs ouvrent la même adresse avec `?room=<nom>`, par exemple `http://127.0.0.1:8484/nacht?room=soiree`. Le premier arrivé est l'hôte. Le serveur ne fait que présenter les navigateurs (`/signal`) ; les paquets du jeu passent ensuite directement de l'un à l'autre (sur le réseau local, ils ne quittent pas la box). Le moteur voit les joueurs sous des étiquettes `10.0.0.<n>` (l'hôte est `10.0.0.1`), puisque la page ne connaît pas les vraies adresses. `ICE_SERVERS` (JSON, STUN de Google par défaut) règle les serveurs utilisés pour traverser les box par internet. Si la liaison directe échoue ou n'est pas ouverte au bout de 5 s (box trop strictes, partage 4G, réseau d'entreprise), l'invité passe par le relais du serveur : les paquets suivent la connexion `/signal`, avec un peu plus de latence, et l'écran de chargement montre un point bleu sur l'hôte. Un serveur TURN dans `ICE_SERVERS` reste possible pour garder une liaison sans détour par le serveur.

### Relais UDP (vraies adresses IP)

- Chaque joueur lance son relais et ouvre la carte sur son propre `127.0.0.1`.
- L'hôte joue normalement. Les autres ajoutent `?connect=<ip de l'hôte>` à l'URL de la carte, par exemple `http://127.0.0.1:8484/nacht?connect=192.168.1.20` : la carte se charge d'abord en local, puis la page envoie `connect` dès que la partie démarre.
- Sur un seul Mac, le second joueur lance `PORT=8485 NET_PORT=3075 node server/index.ts` et ouvre `http://127.0.0.1:8485/nacht?connect=127.0.0.1:3074`.
- `bo1z.net.traffic` dans la console de la page donne les paquets envoyés, reçus et perdus ; `bo1z.net.command('connect 192.168.1.20')` envoie une commande à la console du jeu.

## Jouer sans vel.gg

La branche `assets` contient les données du jeu servies par vel.gg le 2026-10-09 : les 10 cartes en vrais fichiers, leurs manifestes, les images et les caches de shaders (5,4 Go dans git, 9 Go sur le disque). Les 13 fichiers de plus de 95 Mo passent par Git LFS (GitHub refuse les fichiers de plus de 100 Mio). Elle ne doit vivre que dans un dépôt privé. Dans un clone, avec `git-lfs` installé :

```sh
git lfs install --local
git worktree add cache assets
```

Le relais sert alors tout depuis le disque, pages de salon et reprises par plage comprises. `node prefetch.ts` vérifie chaque fichier du jeu contre le SHA-256 du manifeste de vel.gg et retélécharge ce qui manquerait.

GitHub refuse un envoi de plus de 2 Go : la branche se pousse commit par commit (un par carte).

```sh
for c in $(git rev-list --reverse assets); do git push origin "${c}:refs/heads/assets"; done
```

## Héberger sur Heroku

```sh
heroku create <nom> --region eu
git push heroku main
```

Les joueurs ouvrent `https://<nom>.herokuapp.com/`. Le build de déploiement (`heroku-postbuild`) patche `engine/` sans contacter vel.gg et compile le site dans `dist/` (Vite). Le `Procfile` démarre à la racine (`PREFIX=` vide), sans pont UDP (`NET_PORT=0`, Heroku n'en reçoit pas) et sans cache disque (`CACHE=0`, disque éphémère) : seules les données du jeu transitent depuis vel.gg, à chaque premier chargement. La branche `assets` n'y part pas : Heroku refuse les dépôts de plus de 1 Go. Il faut une offre qui ne se met pas en veille (Basic), sinon les parties sont coupées après 30 minutes sans visite.

Le site n'a pas de mot de passe : quiconque connaît l'adresse peut y jouer, et elle relaie le jeu d'Activision.

## Tests

`npm test` fait passer un datagramme d'un relais à l'autre, vérifie le salon (numérotation, acheminement, départs, origine, ping de maintien), le service du site, des pages de carte et du cache (longueur, plages, pages de salon), les files partagées avec de vrais threads et le réécrivain de wasm sur un module minimal.

Puis Playwright (`e2e/`) dans le Chrome installé, fenêtres visibles : sans fenêtre, Chrome refuse la capture de la souris et le clic à « Prêt » n'entre pas en jeu. Il vérifie le menu (les dix cartes, le Mode Enfer, les salons publics sans les privés, le code, la création d'un salon, les options), l'entrée en jeu en un clic sur chaque carte sans son introuvable, la pause en solo et son absence en salon, un salon à deux (liaison directe, départ de l'hôte), un salon privé rejoint par son code, et l'écran d'un téléchargement coupé. Les profils de Chrome restent dans `.cache/e2e` : le premier lancement télécharge les dix cartes (environ 9 Go, 5 minutes), les suivants les trouvent sur place. Le relais de test les sert depuis `cache` (branche `assets`) ; sans lui, il les tire de vel.gg.

Node 22.18 ou plus récent (TypeScript exécuté sans compilation, zstd dans `node:zlib`) ; Heroku utilise Node 24.
