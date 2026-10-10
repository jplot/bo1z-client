import { createApp } from 'vue';
import { diagnostics } from '../game/diagnostics.ts';
import { horde } from '../game/pack.ts';
import { currentEngine, startSession, view } from '../game/session.ts';
import * as net from '../net/link.ts';
import MapScreen from './MapScreen.vue';
import './map.css';

if (horde) document.title += ' · Mode Enfer';
createApp(MapScreen).mount('#screen');
// Handle for tests and the browser console; no module reads it.
const handle = { view, diagnostics, net, engine: currentEngine };
export type Handle = typeof handle;
Object.assign(globalThis, { bo1z: handle });
startSession();
