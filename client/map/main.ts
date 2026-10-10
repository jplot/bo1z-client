import { createApp } from 'vue';
import { diagnostics } from '../game/diagnostics.ts';
import { horde, map } from '../game/pack.ts';
import { currentEngine, view } from '../game/session.ts';
import * as net from '../net/link.ts';
import MapScreen from './MapScreen.vue';
import './map.css';

document.title = horde ? `${map.name} · Mode Enfer` : map.name;
createApp(MapScreen).mount('#app');
// Handle for tests and the browser console; no module reads it.
const handle = { view, diagnostics, net, engine: currentEngine };
export type Handle = typeof handle;
Object.assign(globalThis, { bo1z: handle });
