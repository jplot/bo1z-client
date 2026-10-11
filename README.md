# bo1z

Call of Duty: Black Ops zombies in the browser, solo or with up to four players. A fork of the browser port at https://vel.gg/bo1z: its site and its compiled engine live in this repository.

## How it works

- `server/`: a Fastify relay, TypeScript run as is by Node. It serves the site, introduces players to each other for lobbies, bridges the engine's UDP traffic, and serves the game data from `cache/` or from vel.gg.
- `client/`: the site, built by Vite into `dist/`. A single page opens the menu (`menu/`) or a map (`map/`) depending on the address, both in Vue. `game/` runs a game session and talks to the engine, `download/` stores the map files in the browser (OPFS), `net/` carries the engine's packets between players, `i18n/` holds the English and French texts, `catalog.ts` lists the maps.
- `engine/`: the engine, KisakBlack (C++, GPL-3.0) compiled to WebAssembly by vel.gg, and its generated JavaScript glue, edited by hand where the page hooks into it.
  Its native code reads in [SwagSoftware/KisakBlack](https://github.com/SwagSoftware/KisakBlack) and, for the zombies, single-player and mod parts, [MisaDev4/bo1-zombies-decompiled](https://github.com/MisaDev4/bo1-zombies-decompiled). vel.gg's web layer (`websys`, `webd3d`, `websound`) is not published.
  The game's Direct3D 9 shaders come translated ahead of time, by [MojoShader](https://github.com/icculus/mojoshader) into GLSL ES for WebGL 2, then by [Naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga) into WGSL for WebGPU; they ship with each map's data (`pack/web/shaders/`, `artifacts/<map>-pipelines.json`) and cannot be rebuilt from this repository.
- `patch/`: the patches applied to the wasm at build time (networking through the page, no pause in multiplayer, a guest joining with no map or server of its own, the mod's script run after the map's, crash guards, no stack trace per collision-tree update), and the rewriter that applies them.
- `mod/`: game scripts (GSC) the engine reads over the game's own, as the mod `mods/bo1z` (`fs_game`): a player who joins a game already under way is placed near the team and can play.

## Requirements

- Node 22.18 or later (TypeScript is run without compilation).
- Chrome or Edge on a computer, with hardware acceleration.
- The game data: fetched from vel.gg on demand, or read from a local `cache/` directory laid out as on vel.gg (`cache/bo1z/…`).

## Running

```sh
npm install
npm run build          # builds the site and patches the engine into dist/
node server/index.ts
```

Then open http://127.0.0.1:8484. Browsers treat `127.0.0.1` as a secure context, which the engine needs for `SharedArrayBuffer`.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8484` | HTTP port. |
| `HOST` | `127.0.0.1` | Address to listen on; `0.0.0.0` for the local network. |
| `PREFIX` | empty | Serves the site under a path, for example `/bo1z`. |
| `NET_PORT` | `3074` | UDP port of the bridge; `0` disables it. |
| `CACHE` | on | `0` serves the game data straight from vel.gg without writing `cache/`. |
| `ICE_SERVERS` | Google STUN | JSON list of WebRTC servers used to connect players over the internet. |
| `TELEMETRY` | off | `1` records telemetry from every page, not only those opened on this machine. |
| `KBNET_TRACE` | off | `1` logs every datagram crossing the UDP bridge. |

Telemetry reports (crashes with the last lines of the engine console, errors, end of session) are appended to `telemetry/<PORT>.jsonl`. `node prefetch.ts` downloads the game data of every map into `cache/`, checking each file against the SHA-256 in its manifest.

## Multiplayer

From the menu, the Multiplayer tab lists the open lobbies. Join enters one, Join with a code enters a private one, and + Create a lobby picks a map and gets a four-letter code from the server. Without the menu, players open the same map address with `?room=<name>`: the first one hosts.

Players connect directly through WebRTC, with the server only introducing them (`/signal`). When no direct link opens within 5 s, packets go through the server instead. Each player first loads the map on their own machine, then joins the host's game.

Over the UDP bridge, with real addresses, each player runs their own relay. Guests add `?connect=<host ip>` to the map address, for example `http://127.0.0.1:8484/nacht?connect=192.168.1.20`. On one machine, the second player runs `PORT=8485 NET_PORT=3075 node server/index.ts` and opens `http://127.0.0.1:8485/nacht?connect=127.0.0.1:3074`.

In a map page's console, `bo1z.net.traffic` counts packets sent, received and lost, and `bo1z.net.command('…')` sends a command to the engine console.

## Deploying

```sh
heroku create <name> --region eu
git push heroku main
```

The build (`heroku-postbuild`) builds the site and patches the engine. The `Procfile` serves at the root, without the UDP bridge or a disk cache: game data comes from vel.gg. The site has no authentication.

## Tests

`npm test` checks the types, builds, then runs:

- the unit tests (`test/`): the UDP bridge, lobbies and their packet relay, the WebSocket keep-alive, the site and cache serving, the shared queues, the wasm rewriter, the translations;
- the browser tests (`e2e/`, Playwright with the installed Chrome): the menu, entering each map, pause, two-player and private lobbies, language, download errors.

The browser tests open visible Chrome windows that must stay in front: Chrome only grants mouse capture to a foreground window. They run in French. Chrome profiles are kept in `.cache/e2e`, so each map downloads once.
