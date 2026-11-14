// Generates PWA PNG icons from SVG sources. Run with `npm run icons`.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const svg = await readFile(`${root}favicon.svg`);

// Maskable: full-bleed background, glyph inside the 80% safe zone.
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#0E9F6E"/>
  <g transform="translate(9.6 9.6) scale(0.7)">
    <path d="M32 11 50 18v13c0 11.5-7.6 19.4-18 22.6C21.6 50.4 14 42.5 14 31V18z" fill="#FFFFFF" opacity="0.16"/>
    <path d="M21 22h22v6h-8v20h-6V28h-8z" fill="#FFFFFF"/>
    <circle cx="44" cy="44" r="6" fill="#FFFFFF"/>
    <circle cx="44" cy="44" r="2.6" fill="#0E9F6E"/>
  </g>
</svg>`);

await mkdir(`${root}icons`, { recursive: true });
const jobs = [
  [svg, 192, 'icons/icon-192.png'],
  [svg, 512, 'icons/icon-512.png'],
  [maskable, 512, 'icons/icon-maskable-512.png'],
  [maskable, 180, 'apple-touch-icon.png'],
];
for (const [src, size, out] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`${root}${out}`);
  console.log(`wrote public/${out}`);
}
