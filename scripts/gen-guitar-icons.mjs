/*
 * Takibi Guitar のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-guitar-icons.mjs
 * サウンドホールと張られた弦を正面から見た、というモチーフ。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'guitar');

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** 単位座標 (0..1) の 1 点の色を返す。戻り値は [r,g,b,a] (0..255) */
function shade(x, y, opts) {
  const { padding, rounded } = opts;
  // セーフエリア（マスカブル用）に合わせて中身を縮める
  const s = 1 - padding * 2;
  const u = (x - padding) / s;
  const v = (y - padding) / s;

  if (rounded) {
    const r = 0.19;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }

  // 背景：焚火に照らされた木の面
  const grain = Math.sin(x * 46 + Math.sin(y * 7) * 2.2) * 0.5 + 0.5;
  const base = mix([64, 38, 22], [24, 14, 9], Math.min(1, y * 1.15));
  const glow = Math.max(0, 1 - Math.hypot(x - 0.3, y - 0.2) * 1.5) * 0.4;
  let bg = [...mix(mix(base, [88, 54, 30], grain * 0.16), [239, 138, 60], glow), 255];

  if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return bg;

  const cx = 0.5;
  const cy = 0.54;
  const holeR = 0.2;
  const rosetteR = 0.265;
  const d = Math.hypot(u - cx, v - cy);

  // --- ロゼッタ（サウンドホールの飾り輪） ---
  if (d < rosetteR && d >= holeR) {
    const t = (d - holeR) / (rosetteR - holeR);
    const ring = Math.abs(Math.sin(t * Math.PI * 2.4));
    const color = mix([164, 80, 26], [247, 187, 132], ring * 0.85);
    bg = [...color, 255];
  }

  // --- サウンドホール（中は暗い） ---
  if (d < holeR) {
    const t = d / holeR;
    // 内側の縁だけ光を受ける
    const edge = Math.pow(t, 6) * 0.55;
    const inner = mix([10, 6, 4], [150, 82, 34], edge);
    bg = [...inner, 255];
  }

  // --- 弦（縦に6本、下ほど太い） ---
  const stringTop = 0.06;
  const stringBottom = 0.94;
  if (v >= stringTop && v <= stringBottom) {
    for (let i = 0; i < 6; i++) {
      const sx = 0.215 + (i / 5) * 0.57;
      const w = 0.0038 + i * 0.0028;
      const dist = Math.abs(u - sx);
      if (dist < w) {
        const t = dist / w;
        const lit = 1 - t * t;
        // サウンドホールの上では弦がはっきり見える
        const over = d < holeR ? 1 : 0.82;
        const color = mix([150, 116, 82], [255, 240, 218], lit * over);
        bg = [...color, 255];
      }
    }
  }

  // --- ブリッジ（弦を留める黒い帯） ---
  if (v > 0.8 && v < 0.878 && u > 0.15 && u < 0.85) {
    const t = (v - 0.8) / 0.078;
    bg = [...mix([46, 26, 14], [16, 9, 5], t), 255];
    // サドル（白い線）
    if (v > 0.812 && v < 0.828) bg = [236, 220, 196, 255];
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
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [16, 11, 8] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
