import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createZstdDecompress } from 'node:zlib';
import { entryPath } from '../lib/cache.mjs';

const WASM = '/bo1z/artifacts/KisakBlack-web.wasm';
const ROOT = path.join(import.meta.dirname, '..');
const DECODERS = { br: createBrotliDecompress, gzip: createGunzip, zstd: createZstdDecompress };

const cached = entryPath(new URL(WASM, 'http://127.0.0.1'));
const encoding = JSON.parse(await readFile(`${cached}.json`, 'utf8')).headers['content-encoding'];
const original = path.join(ROOT, 'build', 'original.wasm');
await mkdir(path.dirname(original), { recursive: true });
await pipeline(createReadStream(cached), ...(encoding ? [DECODERS[encoding]()] : []), createWriteStream(original));

// Binaire vers binaire : le parseur texte de binaryen rejette les `delegate` (exceptions legacy) de ce wasm.
const output = path.join(ROOT, 'overrides', WASM);
await mkdir(path.dirname(output), { recursive: true });
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'wasm-opt'), [original, '--all-features', '--debuginfo', '-o', output], { stdio: 'inherit' });
console.log(output);
