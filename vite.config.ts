import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';

const client = (file: string) => path.resolve(import.meta.dirname, 'client', file);

// The engine glue, served outside the bundle, imports ../kbnet.js from artifacts/: this entry keeps that name and its exports.
// The rest of web/ is copied as is.
export default defineConfig({
  root: 'client',
  plugins: [vue()],
  base: './',
  publicDir: path.resolve(import.meta.dirname, 'web'),
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
