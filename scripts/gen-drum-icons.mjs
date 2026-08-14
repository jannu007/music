/*
 * Hibiki Drum Machine のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-drum-icons.mjs
 * ステップシーケンサーの光るマス目、というモチーフ。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'drums');

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** 光らせるマス（4×4のステップグリッド。上からキック/スネア/ハット/パーカッション） */
const LIT = [
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [1, 1, 1, 1],
  [0, 1, 0, 0],
];

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

  // 背景（黒いアルミ筐体）
  const grad = mix([38, 45, 55], [10, 12, 15], Math.min(1, y * 1.1));
  const sheen = Math.max(0, 1 - Math.hypot(x - 0.26, y - 0.14) * 1.6) * 0.3;
  const bg = [...mix(grad, [242, 163, 60], sheen), 255];

  if (u < 0 || u > 1 || v < 0 || v > 1) return bg;

  // --- 4×4 のパッド ---
  const left = 0.13;
  const top = 0.17;
  const size = 0.74;
  const cell = size / 4;
  const gap = cell * 0.16;
  const radius = cell * 0.2;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x0 = left + col * cell + gap * 0.5;
      const y0 = top + row * cell + gap * 0.5;
      const w = cell - gap;
      if (u < x0 || u > x0 + w || v < y0 || v > y0 + w) continue;

      // 角丸の外側は背景のまま
      const dx = Math.max(x0 + radius - u, 0, u - (x0 + w - radius));
      const dy = Math.max(y0 + radius - v, 0, v - (y0 + w - radius));
      if (Math.hypot(dx, dy) > radius) continue;

      const depth = (v - y0) / w;
      if (LIT[row][col]) {
        // 点灯（上が明るいアンバー）
        const color = mix([255, 216, 150], [214, 126, 20], depth);
        return [...color, 255];
      }
      const color = mix([44, 53, 65], [23, 28, 35], depth);
      return [...color, 255];
    }
  }

  // --- 下の帯（トランスポート） ---
  if (v > 0.93 && v < 0.985 && u > 0.13 && u < 0.87) {
    return [...mix([70, 82, 96], [40, 48, 58], (v - 0.93) / 0.055), 255];
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
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [12, 15, 19] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
