import path from 'node:path';

const CACHE = path.join(import.meta.dirname, '..', 'cache');

// Suffixe '@' : /bo1z (fichier) et /bo1z/five (dossier bo1z) coexistent sur disque.
export const entryPath = url =>
  path.join(CACHE, path.normalize(url.pathname)) + '@' + encodeURIComponent(url.search.slice(1));
