import vue from '@vitejs/plugin-vue';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { patchEngine } from './patch/engine.mjs';

const client = (file: string) => path.resolve(import.meta.dirname, 'client', file);
const engine = (file: string) => readFile(path.resolve(import.meta.dirname, 'engine', file));

// The glue spawns its threads from its own URL and the engine runs the wasm next to it: both stay out of the bundle, in artifacts/.
const artifacts: Plugin = {
  name: 'bo1z-engine',
  async generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'artifacts/KisakBlack-web.mjs', source: await engine('KisakBlack-web.mjs') });
    this.emitFile({ type: 'asset', fileName: 'artifacts/KisakBlack-web.wasm', source: patchEngine(await engine('KisakBlack-web.wasm')) });
  },
};

// The glue imports ../kbnet.js from artifacts/: this entry keeps that name and its exports.
export default defineConfig({
  root: 'client',
  plugins: [vue(), artifacts],
  base: './',
  publicDir: false,
  worker: { format: 'es' },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2024',
    rolldownOptions: {
      input: { index: client('index.html'), map: client('map.html'), kbnet: client('net/engine.ts') },
      preserveEntrySignatures: 'exports-only',
      output: { entryFileNames: chunk => (chunk.name === 'kbnet' ? 'kbnet.js' : 'assets/[name]-[hash].js') },
    },
  },
});
