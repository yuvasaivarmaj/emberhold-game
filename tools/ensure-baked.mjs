// Bakes the world map if it's missing or older than its sources.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const out = new URL('public/data/verdance.h16', root);
const sources = ['tools/bake-world.ts', 'src/world/Layout.ts', 'src/world/Noise.ts'].map((f) => new URL(f, root));
const stale = !fs.existsSync(out) || sources.some((s) => fs.statSync(s).mtimeMs > fs.statSync(out).mtimeMs);
if (stale) execSync('npm run bake', { stdio: 'inherit', cwd: root });
else console.log('World map is up to date.');
