/*
 * Hoshizora Vocal のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-vocal-icons.mjs
 * 星空にひとつ輝く星と、そこから広がる声の波、というモチーフ。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'vocal');

// ---------------------------------------------------------------- PNG writer

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** 背景に散らす小さな星（毎回同じ位置になるよう固定値で持つ） */
const STARS = [
  [0.18, 0.2, 0.9], [0.3, 0.12, 0.55], [0.78, 0.18, 0.8], [0.86, 0.34, 0.5],
  [0.14, 0.52, 0.6], [0.24, 0.78, 0.75], [0.72, 0.8, 0.6], [0.88, 0.62, 0.45],
  [0.5, 0.1, 0.5], [0.62, 0.28, 0.4],
];

/** 4方向にとがった星形（0..1 で内側ほど大きい） */
function sparkle(dx, dy, size) {
  const ax = Math.abs(dx) / size;
  const ay = Math.abs(dy) / size;
  const v = Math.sqrt(ax) + Math.sqrt(ay);
  return v < 1 ? 1 - v : 0;
}

/** 単位座標 (0..1) の 1 点の色を返す。戻り値は [r,g,b,a] (0..255) */
function shade(x, y, opts) {
  const { padding, rounded } = opts;
  const s = 1 - padding * 2;
  const u = (x - padding) / s;
  const v = (y - padding) / s;

  if (rounded) {
    const r = 0.19;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }

  // 夜空のグラデーション
  const grad = mix([22, 32, 60], [6, 9, 18], Math.min(1, y * 1.15));
  const glow = Math.max(0, 1 - Math.hypot(x - 0.26, y - 0.14) * 1.9) * 0.4;
  let color = mix(grad, [80, 140, 210], glow);

  if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return [...color, 255];

  // 小さな星
  for (const [sx, sy, bright] of STARS) {
    const k = sparkle(u - sx, v - sy, 0.035);
    if (k > 0) color = mix(color, [235, 245, 255], Math.min(1, k * 1.6 * bright));
  }

  // 声の波（中心の星から左右へ広がる弧）
  const dx = u - 0.5;
  const dy = v - 0.46;
  const dist = Math.hypot(dx, dy);
  const angle = Math.abs(Math.atan2(dy, dx));
  const horizontal = Math.min(angle, Math.PI - angle); // 0 が真横
  if (horizontal < 0.85) {
    const fade = 1 - horizontal / 0.85;
    for (let i = 0; i < 3; i++) {
      const r = 0.2 + i * 0.095;
      const width = 0.016 - i * 0.002;
      const d = Math.abs(dist - r);
      if (d < width) {
        const edge = 1 - d / width;
        const tint = i === 0 ? [255, 190, 220] : [150, 210, 255];
        color = mix(color, tint, Math.min(1, edge * fade * (0.95 - i * 0.18)));
      }
    }
  }

  // 中心の星
  const core = sparkle(dx, dy, 0.2);
  if (core > 0) {
    color = mix(color, [190, 230, 255], Math.min(1, core * 1.1));
    if (core > 0.55) color = mix(color, [255, 255, 255], (core - 0.55) / 0.45);
  }
  // 星のまわりのにじみ
  const halo = Math.max(0, 1 - dist * 6);
  color = mix(color, [150, 210, 255], halo * halo * 0.35);

  return [...color, 255];
}

function render(size, { padding = 0, rounded = true, opaqueBg = null } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 2; // スーパーサンプリング
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const c = shade(x, y, { padding, rounded });
          acc = acc.map((v, i) => v + c[i]);
        }
      }
      const n = ss * ss;
      let [r, g, b, a] = acc.map((v) => Math.round(v / n));
      if (opaqueBg && a < 255) {
        const t = a / 255;
        r = Math.round(opaqueBg[0] * (1 - t) + r * t);
        g = Math.round(opaqueBg[1] * (1 - t) + g * t);
        b = Math.round(opaqueBg[2] * (1 - t) + b * t);
        a = 255;
      }
      const o = (py * size + px) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
    }
  }
  return encodePng(size, size, buf);
}

mkdirSync(outDir, { recursive: true });

const files = [
  ['icon-192.png', render(192)],
  ['icon-512.png', render(512)],
  // マスカブルは全面塗り + 内側 80% に本体を配置
  ['icon-512-maskable.png', render(512, { padding: 0.1, rounded: false })],
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [7, 10, 20] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
