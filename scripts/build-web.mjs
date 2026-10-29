import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
  // Pages HTML 会被 CDN 缓存约 10 分钟；给入口脚本加部署戳，强制换新包
  const stamp = Date.now().toString(36);
  let html = readFileSync(full, 'utf8');
  html = html.replace(
    /(\/(?:assets\/)?full-screen-[^\"']+\.js)(\?[^\"']*)?/g,
    `$1?v=${stamp}`,
  );
  html = html.replace(
    /(src="\.\/assets\/full-screen-[^\"']+\.js)(\?[^\"']*)?/g,
    `$1?v=${stamp}`,
  );
  writeFileSync(full, html);
  copyFileSync(full, index);
  console.log('copied full-screen.html -> index.html for Pages (bust=' + stamp + ')');
}
