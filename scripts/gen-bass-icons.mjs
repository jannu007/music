/*
 * Kurogane Bass のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-bass-icons.mjs
 * 斜めに構えたエレキベース（ボディ・ピックアップ・ネック・4本の弦）というモチーフ。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'bass');

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const AMBER = [240, 161, 60];
const AMBER_DEEP = [150, 88, 22];
const WOOD = [74, 50, 35];
const WOOD_DARK = [38, 24, 17];
const STRING = [239, 232, 216];
const METAL = [186, 194, 202];

/**
 * ベースのボディ（回転後の座標 u=長手方向 / v=幅方向）。
 * 大きさの違う2つの円を重ねると、くびれのあるギター／ベースらしい輪郭になる。
 * 戻り値は輪郭までの距離（負ならボディの内側）。
 */
function bodyDistance(u, v) {
  // ネック方向へ伸ばした2つの楕円。重ねるとくびれのある輪郭になる
  const lower = Math.hypot((u + 0.325) / 1.5, v) - 0.132;    // 下ボウ（大きい方）
  const upper = Math.hypot((u + 0.135) / 1.32, v * 1.2) - 0.108; // 上ボウ
  return Math.min(lower, upper);
}

function neckHalfWidth(u) {
  if (u < -0.06 || u > 0.33) return 0;
  // ナットへ向かって少しずつ細くなる
  return 0.062 - (u + 0.06) * 0.038;
}

function headHalfWidth(u) {
  if (u < 0.31 || u > 0.45) return 0;
  const t = (u - 0.31) / 0.14;
  return 0.038 + t * 0.048;
}

/** 単位座標 (0..1) の 1 点の色を返す。戻り値は [r,g,b,a] (0..255) */
function shade(x, y, opts) {
  const { padding, rounded } = opts;
  const s = 1 - padding * 2;
  const px = (x - padding) / s;
  const py = (y - padding) / s;

  // --- 背景（黒いアンプのトーレックス地）---
  if (rounded) {
    const r = 0.19;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
  }
  const grad = mix([32, 39, 48], [8, 10, 13], Math.min(1, y * 1.05));
  const glow = Math.max(0, 1 - Math.hypot(x - 0.3, y - 0.2) * 1.6) * 0.3;
  const bg = [...mix(grad, AMBER, glow), 255];

  if (px < -0.05 || px > 1.05 || py < -0.05 || py > 1.05) return bg;

  // --- ベースを斜めに配置する（左下がボディ、右上がヘッド）---
  const angle = -0.62; // rad
  const cx = px - 0.5;
  const cy = py - 0.5;
  const u = cx * Math.cos(angle) - cy * Math.sin(angle);
  const v = cx * Math.sin(angle) + cy * Math.cos(angle);
  const av = Math.abs(v);

  const bodyD = bodyDistance(u, v);
  const nw = neckHalfWidth(u);
  const hw = headHalfWidth(u);
  const inNeck = nw > 0 && av <= nw;
  const inHead = hw > 0 && av <= hw;
  if (bodyD >= 0 && !inNeck && !inHead) return bg;

  const edge = inHead || inNeck ? Math.max(nw, hw) - av : -bodyD;

  // --- ヘッド（ペグ付き）---
  if (hw > 0 && u > 0.31) {
    if (edge < 0.012) return [...mix(AMBER_DEEP, [20, 14, 9], 0.5), 255];
    // 4つのペグ（片側2つずつ）
    const pegU = [0.35, 0.41];
    for (const pu of pegU) {
      for (const sign of [-1, 1]) {
        if (Math.hypot(u - pu, v - sign * 0.055) < 0.021) return [...METAL, 255];
      }
    }
    return [...mix(WOOD, WOOD_DARK, 0.4), 255];
  }

  // --- ネック（指板・フレット・弦）---
  if (nw > 0 && u > -0.06 && u <= 0.33) {
    if (edge < 0.008) return [...mix(WOOD_DARK, [0, 0, 0], 0.35), 255];
    let color = mix(WOOD, WOOD_DARK, 0.25 + av * 1.5);
    // ナット
    if (Math.abs(u - 0.305) < 0.011) color = [232, 226, 210];
    // フレット
    for (const fu of [0.02, 0.1, 0.175, 0.24]) {
      if (Math.abs(u - fu) < 0.0075) color = METAL;
    }
    // ポジションマーク
    if (Math.abs(u - 0.14) < 0.016 && av < 0.016) color = [226, 216, 194];
    return [...color, 255];
  }

  // --- ボディ ---
  if (edge < 0.014) {
    // 縁のハイライト（バインディング）
    return [...mix(AMBER, [255, 236, 200], 0.5), 255];
  }
  const t = (u + 0.49) / 0.48;
  let color = mix(AMBER, AMBER_DEEP, Math.min(1, Math.max(0, t * 0.75 + av * 0.9)));

  // ピックアップ（2つのボウが重なるくびれのあたり）
  if (u > -0.265 && u < -0.215 && av < 0.078) {
    color = [26, 22, 19];
    if (Math.abs(av - 0.042) < 0.017) color = mix(METAL, [120, 126, 134], 0.3);
  }
  // ブリッジ
  if (u > -0.175 && u < -0.145 && av < 0.062) color = mix(METAL, [88, 94, 102], 0.35);

  return [...color, 255];
}

/** 弦（ボディのブリッジからヘッドのペグまで）を重ねて描く */
function strings(x, y, opts) {
  const { padding } = opts;
  const s = 1 - padding * 2;
  const px = (x - padding) / s;
  const py = (y - padding) / s;
  const angle = -0.62;
  const cx = px - 0.5;
  const cy = py - 0.5;
  const u = cx * Math.cos(angle) - cy * Math.sin(angle);
  const v = cx * Math.sin(angle) + cy * Math.cos(angle);

  if (u < -0.17 || u > 0.36) return null;
  // 弦は4本。ブリッジ側で広がり、ナット側で狭まる
  const spread = 0.058 - (u + 0.17) * 0.028;
  for (let i = 0; i < 4; i++) {
    const offset = (i - 1.5) * (spread * 0.66);
    const thickness = 0.0075 - i * 0.0013;
    if (Math.abs(v - offset) < thickness) {
      const shine = 1 - Math.abs(v - offset) / thickness;
      return [...mix([150, 146, 136], STRING, shine), 255];
    }
  }
  return null;
}

function render(size, { padding = 0, rounded = true, opaqueBg = null } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // スーパーサンプリング
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const base = shade(x, y, { padding, rounded });
          const str = base[3] > 0 ? strings(x, y, { padding }) : null;
          const c = str ?? base;
          acc = acc.map((val, i) => val + c[i]);
        }
      }
      const n = ss * ss;
      let [r, g, b, a] = acc.map((val) => Math.round(val / n));
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
