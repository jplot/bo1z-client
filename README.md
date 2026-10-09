# bo1z-lan

Relais local de https://vel.gg/bo1z. Le jeu tourne sur `http://127.0.0.1`, que les navigateurs traitent comme un contexte sécurisé : le moteur y a `SharedArrayBuffer` sans HTTPS. C'est la base pour patcher le moteur vers un multijoueur en réseau local.

## Lancer

```sh
node proxy.mjs   # port 8484, ou PORT=...
```

Puis ouvrir http://127.0.0.1:8484/bo1z dans Chrome.

- `cache/` garde chaque réponse de vel.gg telle quelle, sans jamais la rafraîchir. Supprimer le dossier pour reprendre la version en ligne.
- Un fichier posé à `overrides/<chemin>` remplace `/<chemin>`, par exemple `overrides/bo1z/artifacts/KisakBlack-web.wasm`.
- La télémétrie du site est coupée (404 sur `/telemetry`).
- `ws://127.0.0.1:<PORT>/kbnet` relie la page au port UDP `NET_PORT` (3074 par défaut, le port que le jeu prend quand `connect` n'en précise pas), ouvert sur le réseau local : le relais affiche au démarrage les adresses à donner aux autres joueurs.

## Patcher le moteur

Une fois une carte chargée au moins une fois (le wasm de vel.gg est alors dans `cache/`) :

```sh
node patch/build.mjs
```

Le script écrit dans `overrides/` le wasm patché (envoi, réception et `connect` vers une IPv4 passent par le relais), le module JS qui le charge, `kbnet.js` et `engine.js`. `rm -r overrides` revient au jeu d'origine.

## Jouer à plusieurs

- Chaque joueur lance son relais et ouvre la carte sur son propre `127.0.0.1`.
- L'hôte joue normalement. Les autres ajoutent `?connect=<ip de l'hôte>` à l'URL de la carte, par exemple `http://127.0.0.1:8484/bo1z/nacht?connect=192.168.1.20`.
- Sur un seul Mac, le second joueur lance `PORT=8485 NET_PORT=3075 node proxy.mjs` et ouvre `http://127.0.0.1:8485/bo1z/nacht?connect=127.0.0.1:3074`.
- `kbnet` dans la console de la page donne les paquets envoyés, reçus et perdus.

`npm test` fait passer un datagramme d'un relais à l'autre et vérifie le réécrivain de wasm sur un module minimal.

Node 22.15 ou plus récent (zstd dans `node:zlib`).
