// Copies MediaPipe's WebAssembly files from the installed package into public/, so the app
// serves them itself (at /app/mediapipe/wasm/) instead of loading them from a CDN. Runs
// before every dev server start and every build (predev, prebuild), so the files always
// match the installed version. The hand model is checked in at public/mediapipe/.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe', 'wasm');
mkdirSync(to, { recursive: true });
// The classic (non-module) loaders: the SIMD build, and the fallback for browsers without SIMD.
const files = readdirSync(from).filter(f => /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(f));
if (files.length !== 4) throw new Error(`Expected 4 MediaPipe wasm files, found: ${files.join(', ')}`);
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`[mediapipe] copied ${files.length} files to public/mediapipe/wasm`);
