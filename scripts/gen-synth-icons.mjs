/*
 * Akatsuki Synth のアイコンを生成する（外部ライブラリ不要）。
 *   node scripts/gen-synth-icons.mjs
 *
 * 暁（あかつき）の空と、そこに立ち上がるフィルターの曲線。
 *
 * 共振の山は、シンセをいじる人には「カットオフを上げたときの形」に見え、
 * そうでない人には夜明けの山の稜線に見える。名前と絵で同じことを言っている。
 * 他の6本（波形・鍵盤・マス目・指板・マイク）とも、ひと目で区別がつく。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'synthesizer');

// ------------------------------------------------------------------ drawing

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** lo から hi のあいだで、0 から 1 へなめらかに立ち上がる */
function fade(t, lo, hi) {
  const k = clamp((t - lo) / (hi - lo));
  return k * k * (3 - 2 * k);
}

/** 地平の高さ */
const HORIZON = 0.68;

/**
 * フィルターの応答。低いところは平らで、カットオフで持ち上がり、その先で落ちる。
 * u は 0..1（左から右）。返すのは v 座標（上ほど小さい）。
 */
function curve(u) {
  const cutoff = 0.56;
  const resonance = 0.315 * Math.exp(-Math.pow((u - cutoff) / 0.088, 2));
  const rolloff = 1 / (1 + Math.pow(Math.max(0, u - cutoff) / 0.17, 2.3));
  return HORIZON - (0.155 * rolloff + resonance);
}

/** 空に散らす星。数を増やすと安っぽくなるので、少しだけ */
const STARS = [
  [0.19, 0.17, 0.011],
  [0.33, 0.29, 0.007],
  [0.76, 0.15, 0.010],
  [0.86, 0.31, 0.007],
  [0.62, 0.09, 0.008],
  [0.12, 0.38, 0.006],
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

  // --- 空。上は夜のまま、地平へ近づくほど紫から赤紫へ ---
  const height = clamp(v / HORIZON);
  let color = mix([26, 15, 40], [88, 32, 72], Math.pow(height, 1.7));

  // 地平のあたりの明るみ。夜明けの光はここから広がる
  const dawn = Math.exp(-Math.pow((v - HORIZON) / 0.20, 2)) * Math.exp(-Math.pow((u - 0.5) / 0.46, 2));
  color = mix(color, [236, 138, 128], dawn * 0.5);

  // --- 地平から下。空より暗く落として、線を引かずに境目を出す ---
  if (v > HORIZON) {
    const depth = clamp((v - HORIZON) / (1 - HORIZON));
    color = mix([32, 16, 38], [11, 7, 16], Math.pow(depth, 0.65));
    // 水面のような、ごく淡い映り込み
    const echo = Math.exp(-Math.pow((v - HORIZON) / 0.13, 2)) * 0.28;
    color = mix(color, [150, 92, 140], echo * (1 - depth));
  }

  // --- 星。地平より上だけ ---
  if (v < HORIZON - 0.04) {
    for (const [sx, sy, sr] of STARS) {
      const d = Math.hypot(u - sx, v - sy);
      if (d < sr * 3.2) {
        const k = Math.pow(clamp(1 - d / (sr * 3.2)), 2.2);
        color = mix(color, [255, 238, 250], k * 0.9);
      }
    }
  }

  // --- フィルターの曲線 ---
  {
    const cy = curve(u);
    // 両端は消していく。ここで断ち切ると、縦にまっすぐな切り口が残って
    // 「描き切れていない絵」に見えてしまう
    const ends = Math.min(fade(u, 0.05, 0.17), fade(1 - u, 0.05, 0.17));

    // 曲線の下を淡く塗る。線だけだと細くて弱い
    if (v > cy && v < HORIZON) {
      const k = clamp((HORIZON - v) / (HORIZON - cy));
      color = mix(color, [186, 142, 255], Math.pow(k, 1.5) * 0.30 * ends);
    }

    // 線そのもの。真ん中を明るく、外側へにじませる
    const d = Math.abs(v - cy);
    const core = 0.0125;
    const glow = 0.055;
    if (d < glow) {
      const inner = clamp(1 - d / core);
      const outer = Math.pow(clamp(1 - d / glow), 2.4);
      color = mix(color, [244, 142, 200], outer * 0.55 * ends);
      color = mix(color, [255, 226, 244], Math.pow(inner, 0.7) * ends);
    }
  }

  return [...color.map((c) => Math.round(clamp(c, 0, 255))), 255];
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
  ['apple-touch-icon.png', render(180, { rounded: false, opaqueBg: [13, 10, 17] })],
];

for (const [name, data] of files) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`generated ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}
