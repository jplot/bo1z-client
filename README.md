# bo1z-lan

Relais local de https://vel.gg/bo1z. Le jeu tourne sur `http://127.0.0.1`, que les navigateurs traitent comme un contexte sécurisé : le moteur y a `SharedArrayBuffer` sans HTTPS. C'est la base pour patcher le moteur vers un multijoueur en réseau local.

## Lancer

```sh
node proxy.mjs   # port 8484, ou PORT=...
```

Puis ouvrir http://127.0.0.1:8484/bo1z dans Chrome.

- `cache/` garde chaque réponse de vel.gg telle quelle, sans jamais la rafraîchir. Supprimer le dossier pour reprendre la version en ligne.
- Un fichier posé à `overrides/<chemin>` remplace `/<chemin>`, par exemple `overrides/bo1z/artifacts/KisakBlack-web.wasm`.
- La télémétrie du site reste sur ce poste : chaque envoi (plantage avec les 300 dernières lignes de la console du moteur, erreurs, fin de session) est ajouté à `telemetry/<PORT>.jsonl`.
- `ws://127.0.0.1:<PORT>/kbnet` relie la page au port UDP `NET_PORT` (3074 par défaut, le port que le jeu prend quand `connect` n'en précise pas), ouvert sur le réseau local : le relais affiche au démarrage les adresses à donner aux autres joueurs.

## Patcher le moteur

```sh
node patch/build.mjs
```

Le script télécharge si besoin les fichiers moteur de vel.gg dans `cache/`, puis écrit dans `overrides/` le wasm patché (envoi, réception et `connect` vers une IPv4 passent par `kbnet.js`), le module JS qui le charge, `kbnet.js`, `ring.js`, `engine.js` et `input.js`. Si vel.gg change son moteur, il s'arrête sur le patch qui ne trouve plus son site. `rm -r overrides` revient au jeu d'origine.

## Jouer à plusieurs

Deux façons de se rejoindre ; dans les deux cas, celui qui rejoint charge d'abord la carte en local, puis la page envoie `connect` dès que sa partie démarre.

### Salon (WebRTC)

Tous les joueurs ouvrent la même adresse avec `?room=<nom>`, par exemple `http://127.0.0.1:8484/bo1z/nacht?room=soiree`. Le premier arrivé est l'hôte. Le serveur ne fait que présenter les navigateurs (`/signal`) ; les paquets du jeu passent ensuite directement de l'un à l'autre (sur le réseau local, ils ne quittent pas la box). Le moteur voit les joueurs sous des étiquettes `10.0.0.<n>` (l'hôte est `10.0.0.1`), puisque la page ne connaît pas les vraies adresses. `ICE_SERVERS` (JSON, STUN de Google par défaut) règle les serveurs utilisés pour traverser les box par internet ; deux joueurs derrière des box trop strictes auront besoin d'un serveur TURN.

### Relais UDP (vraies adresses IP)

- Chaque joueur lance son relais et ouvre la carte sur son propre `127.0.0.1`.
- L'hôte joue normalement. Les autres ajoutent `?connect=<ip de l'hôte>` à l'URL de la carte, par exemple `http://127.0.0.1:8484/bo1z/nacht?connect=192.168.1.20` : la carte se charge d'abord en local, puis la page envoie `connect` dès que la partie démarre.
- Sur un seul Mac, le second joueur lance `PORT=8485 NET_PORT=3075 node proxy.mjs` et ouvre `http://127.0.0.1:8485/bo1z/nacht?connect=127.0.0.1:3074`.
- `kbnet` dans la console de la page donne les paquets envoyés, reçus et perdus ; `kbnet.command('connect 192.168.1.20')` envoie une commande à la console du jeu.

## Héberger sur Heroku

```sh
heroku create <nom> --region eu
heroku config:set BO1Z_PASSWORD=<mot de passe>
git push heroku main
```

Les joueurs ouvrent `https://<nom>.herokuapp.com/bo1z/nacht?room=<salon>` ; le navigateur demande le mot de passe (n'importe quel identifiant). Le build de déploiement (`heroku-postbuild`) patche le moteur tel que vel.gg le sert ce jour-là ; le `Procfile` démarre sans pont UDP (`NET_PORT=0`, Heroku n'en reçoit pas) et sans cache disque (`CACHE=0`, disque éphémère) : les packs transitent par le serveur à chaque premier chargement. Il faut une offre qui ne se met pas en veille (Basic), sinon les parties sont coupées après 30 minutes sans visite.

L'adresse étant publique, elle relaie le jeu d'Activision et le code de vel.gg : garder `BO1Z_PASSWORD` et un usage privé.

## Tests

`npm test` fait passer un datagramme d'un relais à l'autre, vérifie le salon (numérotation, acheminement, départs, origine, mot de passe), les files partagées avec de vrais threads et le réécrivain de wasm sur un module minimal.

Node 22.15 ou plus récent (zstd dans `node:zlib`) ; Heroku utilise Node 24.
