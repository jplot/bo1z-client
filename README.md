# bo1z

Black Ops Zombies in the browser, multiplayer. The starting point is the port at https://vel.gg/bo1z: its site and its compiled engine now live in this repository, and only the game data can still come from vel.gg. The game runs on `http://127.0.0.1`, which browsers treat as a secure context: the engine gets `SharedArrayBuffer` there without HTTPS.

## Layout

- `server/` (Fastify, TypeScript run as is by Node): the relay (site, lobbies, UDP bridge, game data cache).
- `client/`: the site in TypeScript, built by Vite. A single page (`index.html`, `main.ts`) that opens the menu (`menu/`) or a map (`map/`: loading screen, mouse recapture, F3 panel) depending on the address, in Vue; the game session (`game/`: flow, bridge with the engine, input, sound, telemetry), which exposes its state to the interface; map downloads into the browser's storage (`download/`, workers); networking (`net/`); the English and French texts (`i18n/`, vue-i18n); our list of maps (`catalog.ts`, shared with the server).
- `dist/`: the built site the relay serves (`npm run build`).
- `engine/`: the engine compiled by vel.gg from KisakBlack (C++, GPL-3.0), `KisakBlack-web.wasm`, which can only be changed by patching it, and its generated glue, `KisakBlack-web.mjs`, edited by hand where the page hooks into it.
- `patch/`: the wasm patches and the rewriter that applies them.
- The game data (maps, manifests, images, shader caches, videos) is not here: it lives in the private repository `jplot/bo1z-assets`, see "Playing without vel.gg".

## Running

```sh
npm run build          # builds the site and patches the engine into dist/ (again after any change to client/, engine/ or patch/)
node server/index.ts   # port 8484, or PORT=...; site at the root, or PREFIX=/bo1z to serve it under a path
```

Then open http://127.0.0.1:8484 in Chrome.

- The relay serves `dist/`, then `dist/index.html` at each map's address, and finally the game data from `cache/`.
- `cache/` keeps the game data uncompressed, laid out as on vel.gg, never refreshed; the relay cuts the `?part=k` pieces the game asks for on the fly. Whatever is missing is downloaded from vel.gg.
- The site's telemetry stays on this machine: only pages opened on this machine send it, or every page with `TELEMETRY=1` (for players on the local network; Heroku does not set it). Each report (crash with the engine console's last 300 lines, errors, end of session) is appended to `telemetry/<PORT>.jsonl`.
- `ws://127.0.0.1:<PORT>/kbnet` connects the page to the UDP port `NET_PORT` (3074 by default, the port the game uses when `connect` gives none), open on the local network: on startup the relay prints the addresses to give the other players.

## Patching the engine

`npm run build` patches `engine/KisakBlack-web.wasm` (`patch/engine.mjs`) and writes it into `dist/artifacts/` next to the glue, without network: sending, receiving and `connect` to an IPv4 address go through `kbnet.js`, pausing no longer freezes the host of a multiplayer game (in solo, Esc still pauses the game), assertions are no longer fatal. The glue (`engine/KisakBlack-web.mjs`) declares the added imports and is edited directly, like the rest of the site.

## Playing together

Two ways to join; either way, the joining player first loads the map locally, then the page sends `connect` as soon as their game starts.

### Lobby (WebRTC)

The menu (the site root, or `PREFIX`; the old `/bo1z/…` addresses redirect there) has two tabs. Solo shows the maps by game, as a grid or a list, with Hell Mode. Multiplayer lists the open lobbies: code, map, names (host first) and slots, four at most. JOIN opens the host's map, JOIN WITH A CODE takes the four letters the host gives. + CREATE A LOBBY asks for the map and requests a free four-consonant code from the server (`POST /rooms`); PRIVATE LOBBY keeps it off the list, so it can only be joined with its code (`/rooms?code=<code>` finds it). `/bo1z?room=<code>` opens the code entry already filled in. The browser remembers the player's name and sends it to the game (`name`) before connecting; without a name, the server renames duplicates "Unknown Soldier 1". Hell Mode only applies to solo games for now.

The map page starts the download by itself and shows the steps (link with the host, download, engine, ready) with the lobby's names; the only action asked of the player is the click that captures the mouse. For the joining player, the screen stays up until their engine has received the host's game (`CA_PRIMED` in its console), which hides that game's loading. The lobby's names arrive over the `/signal` connection, on every arrival or departure. Errors (link impossible, host gone, download interrupted, storage, browser, engine crash) go through the same page, with the matching way to resume.

The site is in English or French: the choice made in the menu's Options, else the first of these two languages among the browser's, else English. The game's own menus stay in English.

Without the menu, every player opens the same address with `?room=<name>`, for example `http://127.0.0.1:8484/nacht?room=party`. The first to arrive is the host. The server only introduces the browsers to each other (`/signal`); the game packets then go directly from one to the other (on a local network, they never leave the router). The engine sees players as `10.0.0.<n>` labels (the host is `10.0.0.1`), since the page does not know the real addresses. `ICE_SERVERS` (JSON, Google's STUN by default) sets the servers used to get through routers over the internet. If the direct link fails or is not open after 5 s (strict routers, mobile hotspot, corporate network), the guest goes through the server's relay: packets follow the `/signal` connection, with a little more latency, and the loading screen shows a blue dot on the host. A TURN server in `ICE_SERVERS` remains possible to keep a link that does not detour through the server.

### UDP relay (real IP addresses)

- Each player runs their own relay and opens the map on their own `127.0.0.1`.
- The host plays normally. The others add `?connect=<host ip>` to the map's URL, for example `http://127.0.0.1:8484/nacht?connect=192.168.1.20`: the map first loads locally, then the page sends `connect` as soon as the game starts.
- On a single Mac, the second player runs `PORT=8485 NET_PORT=3075 node server/index.ts` and opens `http://127.0.0.1:8485/nacht?connect=127.0.0.1:3074`.
- `bo1z.net.traffic` in the page's console gives the packets sent, received and lost; `bo1z.net.command('connect 192.168.1.20')` sends a command to the game's console.

## Playing without vel.gg

The `assets` branch of the private repository `jplot/bo1z-assets` holds the game data vel.gg served on 2026-10-09: the 10 maps as plain files, their manifests, the images and the shader caches (5.4 GB in git, 9 GB on disk). The 13 files over 95 MB go through Git LFS (GitHub refuses files over 100 MiB). It must only ever live in a private repository. In a clone of this repository, with `git-lfs` installed and access to `bo1z-assets`:

```sh
git lfs install --local
git remote add assets git@github.com:jplot/bo1z-assets.git
git fetch assets
git worktree add cache assets
```

The relay then serves everything from disk, lobby pages and range resumes included. `node prefetch.ts` checks every game file against the SHA-256 in vel.gg's manifest and downloads again whatever is missing.

GitHub refuses a push over 2 GB: the branch is pushed one commit at a time (one per map).

```sh
for c in $(git rev-list --reverse assets); do git push assets "${c}:refs/heads/assets"; done
```

## Hosting on Heroku

```sh
heroku create <name> --region eu
git push heroku main
```

Players open `https://<name>.herokuapp.com/`. The deployment build (`heroku-postbuild`) builds the site and patches the engine into `dist/` (Vite), without contacting vel.gg. The `Procfile` starts at the root (empty `PREFIX=`), without the UDP bridge (`NET_PORT=0`, Heroku receives none) and without a disk cache (`CACHE=0`, ephemeral disk): only the game data passes through from vel.gg, on each first load. The game data does not go there, since it lives in its own repository: Heroku refuses repositories over 1 GB. It needs a plan that does not sleep (Basic), otherwise games are cut after 30 minutes without a visit.

The site has no password: anyone who knows the address can play, and it relays Activision's game.

## Tests

`npm test` passes a datagram from one relay to the other, checks the lobby (numbering, routing, departures, origin, keep-alive ping), the serving of the site, map pages and cache (length, ranges, lobby pages), the queues shared with real threads, the wasm rewriter on a minimal module, and the translations (every key the code uses exists, every map has its texts, every message formats in both languages).

Then Playwright (`e2e/`) in the installed Chrome, with visible windows: without a window, Chrome refuses to capture the mouse and the click at "Ready" does not enter the game. The tests run in French. They check the menu (the ten maps, Hell Mode, public lobbies without the private ones, the code, creating a lobby, the options, the language picked from the browser or in Options), entering the game in one click on each map without a missing sound, pausing in solo and its absence in a lobby, a two-player lobby (direct link, host leaving), a private lobby joined by its code, and the screen of an interrupted download. Chrome profiles stay in `.cache/e2e`: the first run downloads the ten maps (about 9 GB, 5 minutes), later runs find them in place. The test relay serves them from `cache` (the `assets` branch of `bo1z-assets`); without it, it pulls them from vel.gg.

Node 22.18 or later (TypeScript run without compilation, zstd in `node:zlib`); Heroku uses Node 24.
