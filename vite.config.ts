import path from 'node:path';
import { defineConfig } from 'vite';

// Nos modules (client/) sortent sous leur nom, exports gardés : la colle du moteur importe ../kbnet.js, play.js ./perf-overlay.js.
// Le reste du site (web/) est copié tel quel : le code de vel.gg tire ses adresses de l'emplacement de son propre fichier.
export default defineConfig({
  root: 'client',
  base: './',
  publicDir: path.resolve(import.meta.dirname, 'web'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2024',
    rolldownOptions: {
      input: Object.fromEntries(['kbnet', 'perf-overlay'].map(name => [name, path.resolve(import.meta.dirname, `client/${name}.ts`)])),
      preserveEntrySignatures: 'exports-only',
      output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
    },
  },
});
