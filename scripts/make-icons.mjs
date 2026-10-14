import sharp from 'sharp';
import { mkdir, copyFile, access } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, 'assets', 'icon-source.png'),
  join(root, 'assets', 'icon-source.jpg'),
  'C:\\Users\\YJJ\\.cursor\\projects\\c-Users-YJJ-Projects-genius-trader\\assets\\icon-source.jpg',
];

async function findSource() {
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {}
  }
  throw new Error('icon source not found');
}

const outDir = join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });
const src = await findSource();
await mkdir(join(root, 'assets'), { recursive: true });
await copyFile(src, join(root, 'assets', 'icon-source.jpg')).catch(() => {});

for (const size of [16, 48, 128]) {
  await sharp(src)
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`));
}

console.log('icons ready:', outDir);
