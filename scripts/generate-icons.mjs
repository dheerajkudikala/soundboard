import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const iconsDir = join(publicDir, "icons");
mkdirSync(iconsDir, { recursive: true });

const INDIGO = [99, 102, 241, 255];
const VIOLET = [124, 58, 237, 255];
const WHITE = [250, 250, 250, 255];

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function crc32(buf) {
  return createHash("md5"); // placeholder, replaced below
}

function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const t = Buffer.from(tag);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function png(size) {
  const radius = size * 0.22;
  const bars = [
    [0.28, 0.62, 0.44],
    [0.4, 0.38, 0.68],
    [0.52, 0.28, 0.78],
    [0.64, 0.48, 0.58],
  ];
  const thick = Math.max(2, Math.floor(size / 18));
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (2 * Math.max(size - 1, 1));
      let color = lerp(INDIGO, VIOLET, t);
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      if (dx < radius && dy < radius) {
        const ox = radius - 0.5 - dx;
        const oy = radius - 0.5 - dy;
        if (ox * ox + oy * oy > radius * radius) color = [0, 0, 0, 0];
      }
      for (const [cx, top, bot] of bars) {
        const bx = Math.round(size * cx);
        const y0 = Math.round(size * top);
        const y1 = Math.round(size * bot);
        if (Math.abs(x - bx) <= thick / 2 && y >= y0 && y <= y1) color = WHITE;
      }
      row.push(...color);
    }
    rows.push(Buffer.from(row));
  }
  const raw = Buffer.concat(rows);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(publicDir, "apple-touch-icon.png"), png(180));
writeFileSync(join(iconsDir, "icon-192.png"), png(192));
writeFileSync(join(iconsDir, "icon-512.png"), png(512));
console.log("icons written");
void crc32;
