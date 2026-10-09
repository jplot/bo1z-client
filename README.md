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

Node 20.11 ou plus récent.
