import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const outDir = 'dist-web';
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

process.env.VITE_BASE = process.env.VITE_BASE || '/genius-trader/';
execSync(`npx vite build --outDir ${outDir}`, {
  stdio: 'inherit',
  env: process.env,
});

const full = join(outDir, 'full-screen.html');
const index = join(outDir, 'index.html');
if (existsSync(full)) {
  copyFileSync(full, index);
  console.log('copied full-screen.html -> index.html for Pages');
}
