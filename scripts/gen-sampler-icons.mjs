/*
 * Yamabiko Sampler のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-sampler-icons.mjs
 *
 * 波形と、その下に返ってくる薄い波形。「山彦（やまびこ）」——
 * 入れた音がそのまま返ってくる、というモチーフ。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'sampler');

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * 波形の高さ。決まった形にしておきたいので、いくつかの正弦波を重ねて作る。
 * u は 0..1（左から右）。返す値は 0..1（振幅）。
 */
function amplitude(u) {
  const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.7;
  const detail =
    0.55 +
    0.28 * Math.sin(u * 41.3) +
    0.18 * Math.sin(u * 17.1 + 1.2) +
    0.12 * Math.sin(u * 83.7 + 0.4);
  return Math.max(0.04, Math.min(1, env * detail));
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

  // 背景。深い水の色に、左上から光を当てる
  const grad = mix([27, 47, 54], [12, 23, 27], Math.min(1, y * 1.15));
  const sheen = Math.max(0, 1 - Math.hypot(x - 0.28, y - 0.16) * 1.5) * 0.34;
  const bg = [...mix(grad, [111, 199, 205], sheen), 255];

  if (u < 0 || u > 1 || v < 0 || v > 1) return bg;

  const left = 0.12;
  const right = 0.88;
  if (u < left || u > right) return bg;
  const t = (u - left) / (right - left);

  // 元の波形（上）と、返ってくる波形（下）
  const upperMid = 0.38;
  const lowerMid = 0.72;
  const upperHeight = amplitude(t) * 0.26;
  // 返る側は少し遅れて、小さくなる
  const lowerHeight = amplitude(Math.max(0, t - 0.045)) * 0.15;

  if (Math.abs(v - upperMid) <= upperHeight) {
    const depth = (v - (upperMid - upperHeight)) / (upperHeight * 2);
    return [...mix([186, 240, 243], [79, 168, 175], depth), 255];
  }
  if (Math.abs(v - lowerMid) <= lowerHeight) {
    const depth = (v - (lowerMid - lowerHeight)) / (lowerHeight * 2);
    return [...mix([73, 133, 139], [42, 86, 92], depth), 255];
  }

  // 二つを隔てる細い水平線（水面）
  if (Math.abs(v - 0.55) < 0.004) return [...mix([111, 199, 205], bg.slice(0, 3), 0.55), 255];

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
        const k = a / 255;
        r = Math.round(opaqueBg[0] * (1 - k) + r * k);
        g = Math.round(opaqueBg[1] * (1 - k) + g * k);
        b = Math.round(opaqueBg[2] * (1 - k) + b * k);
        a = 255;
      }
      const o = (py * size + px) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
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
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [16, 26, 29] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
