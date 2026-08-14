/*
 * Aozora Grand Piano のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-piano-icons.mjs
 * グランドピアノを真上から見たシルエット + 鍵盤、というモチーフ。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'piano');

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** 単位座標 (0..1) の 1 点の色を返す。戻り値は [r,g,b,a] (0..255) */
function shade(x, y, opts) {
  const { padding, rounded } = opts;
  // セーフエリア（マスカブル用）に合わせて中身を縮める
  const s = 1 - padding * 2;
  const u = (x - padding) / s;
  const v = (y - padding) / s;

  // 背景（角丸の黒鏡面）
  let bg = [0, 0, 0, 0];
  if (rounded) {
    const r = 0.19;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }
  const grad = mix([46, 36, 28], [10, 8, 7], Math.min(1, y * 1.05));
  const sheen = Math.max(0, 1 - Math.hypot(x - 0.28, y - 0.16) * 1.7) * 0.35;
  bg = [...mix(grad, [216, 162, 74], sheen), 255];

  if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return bg;

  // --- 鍵盤（下部） ---
  const kbTop = 0.60;
  const kbBottom = 0.88;
  const kbLeft = 0.11;
  const kbRight = 0.89;
  if (v >= kbTop && v <= kbBottom && u >= kbLeft && u <= kbRight) {
    const t = (u - kbLeft) / (kbRight - kbLeft);
    const whites = 7;
    const idx = Math.floor(t * whites);
    const frac = t * whites - idx;
    const depth = (v - kbTop) / (kbBottom - kbTop);
    // 白鍵
    let color = mix([255, 252, 245], [206, 196, 178], depth * 0.85);
    if (frac < 0.045) color = [26, 21, 18]; // 鍵の隙間
    // 黒鍵（C# D# / F# G# A#）
    const blackAt = [0.5, 1.5, 3.5, 4.5, 5.5];
    for (const b of blackAt) {
      const center = b / whites;
      const half = 0.3 / whites;
      if (Math.abs(t - center) < half && depth < 0.62) {
        color = mix([58, 52, 46], [8, 7, 6], depth / 0.62);
      }
    }
    return [...color, 255];
  }

  // --- グランドピアノのボディ（上部・真上から見た曲線） ---
  const bodyTop = 0.16;
  const bodyBottom = 0.58;
  if (v >= bodyTop && v <= bodyBottom) {
    const p = (v - bodyTop) / (bodyBottom - bodyTop);
    const left = 0.11;
    const right = 0.89 - 0.34 * Math.pow(p, 1.7);
    if (u >= left && u <= right) {
      const edge = Math.min(u - left, right - u, v - bodyTop, bodyBottom - v);
      const brass = mix([232, 196, 138], [156, 108, 34], p * 0.9 + (u - left) * 0.25);
      if (edge < 0.012) return [...mix(brass, [255, 244, 220], 0.7), 255];
      // 弦のライン
      const stringT = (u - left) / Math.max(0.001, right - left);
      const lines = Math.abs(Math.sin(stringT * Math.PI * 26));
      const inner = mix([44, 30, 20], brass, 0.18 + lines * 0.22);
      return [...inner, 255];
    }
  }

  return bg;
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
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [16, 13, 11] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
