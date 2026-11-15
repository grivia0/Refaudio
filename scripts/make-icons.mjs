#!/usr/bin/env node
// Generates the PWA icon set as real PNGs with zero dependencies.
// Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ------------------------------- PNG writer ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- artwork ------------------------------- */

const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius <= 0;
}

// Five rounded equaliser bars, tallest in the middle: reads as "audio" at 32 px.
const BARS = [
  { x: 0.3, h: 0.24 },
  { x: 0.4, h: 0.42 },
  { x: 0.5, h: 0.62 },
  { x: 0.6, h: 0.4 },
  { x: 0.7, h: 0.22 },
];

function render(size, { maskable }) {
  const scale = 2;
  const n = size * scale;
  const pixels = Buffer.alloc(n * n * 4);
  const corner = maskable ? 0 : n * 0.22;
  const barHalfWidth = n * 0.028;
  const barRadius = barHalfWidth;

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const index = (y * n + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      if (!maskable && !insideRoundRect(px, py, n / 2, n / 2, n / 2, n / 2, corner)) continue;

      const t = (x / n) * 0.35 + (y / n) * 0.65;
      let r = lerp(26, 6, t);
      let g = lerp(26, 7, t);
      let b = lerp(38, 12, t);

      const dx = (px - n * 0.5) / n;
      const dy = (py - n * 0.58) / n;
      const glow = Math.max(0, 1 - Math.hypot(dx, dy) / 0.52);
      r += glow * 12;
      g += glow * 58;
      b += glow * 28;

      for (const bar of BARS) {
        const halfHeight = (n * bar.h) / 2;
        if (insideRoundRect(px, py, n * bar.x, n * 0.5, barHalfWidth, halfHeight, barRadius)) {
          const mix = (py / n - 0.5) * 1.6;
          r = lerp(126, 30, Math.min(1, Math.max(0, mix)));
          g = lerp(240, 219, Math.min(1, Math.max(0, mix)));
          b = lerp(174, 114, Math.min(1, Math.max(0, mix)));
        }
      }

      pixels[index] = Math.round(r);
      pixels[index + 1] = Math.round(g);
      pixels[index + 2] = Math.round(b);
      pixels[index + 3] = 255;
    }
  }

  // Box-filter down to the requested size (cheap antialiasing).
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const i = ((y * scale + sy) * n + (x * scale + sx)) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
        }
      }
      const count = scale * scale;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  // iOS masks the touch icon itself, so ship a full-bleed square.
  ['apple-touch-icon.png', 180, { maskable: true }],
  ['favicon.png', 32, { maskable: false }],
];

for (const [name, size, options] of targets) {
  const png = encodePng(size, size, render(size, options));
  writeFileSync(resolve(OUT, name), png);
  console.log(`wrote icons/${name} (${size}×${size}, ${png.length} bytes)`);
}
