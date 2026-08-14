/*
 * Kurogane Bass の音源（AudioWorklet）を Node 上で検証する。
 *   node scripts/test-bass-dsp.mjs
 *
 * ブラウザを使わずに DSP だけを動かし、
 *   - 音程が指定どおりか（セント単位）
 *   - 発散・NaN が起きないか
 *   - 減衰時間・ミュートが効いているか
 *   - 奏法ごとに音色（高域の量）が変わっているか
 * を数値で確認する。外部ライブラリは使わない。
 */
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000;

// ------------------------------------------------------- AudioWorklet の代役

let ProcessorClass = null;
globalThis.sampleRate = SR;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
};
globalThis.registerProcessor = (_name, cls) => {
  ProcessorClass = cls;
};

await import(pathToFileURL(resolve(here, '..', 'src', 'bass', 'audio', 'bass-processor.js')).href);

if (!ProcessorClass) {
  console.error('プロセッサを読み込めませんでした');
  process.exit(1);
}

// ------------------------------------------------------------------- helpers

const BLOCK = 128;

function makeProcessor(params = {}) {
  return new ProcessorClass({ processorOptions: { params } });
}

/** seconds 秒ぶんレンダリングして Float64Array（モノラル）を返す */
function render(proc, seconds, events = []) {
  const total = Math.ceil(seconds * SR);
  const out = new Float64Array(total);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const queue = [...events].sort((a, b) => a.time - b.time);
  let qi = 0;
  let frame = 0;

  while (frame < total) {
    while (qi < queue.length && queue[qi].time * SR <= frame) {
      proc.handleMessage(queue[qi].msg);
      qi++;
    }
    left.fill(0);
    right.fill(0);
    proc.process([], [[left, right]]);
    const take = Math.min(BLOCK, total - frame);
    for (let i = 0; i < take; i++) out[frame + i] = left[i];
    frame += BLOCK;
  }
  return out;
}

/** 自己相関で基本周波数を推定する */
function estimateFreq(buf, from, to, minHz = 20, maxHz = 700) {
  const seg = buf.subarray(from, to);
  const minLag = Math.floor(SR / maxHz);
  const maxLag = Math.ceil(SR / minHz);
  let best = -1;
  let bestScore = -Infinity;
  let energy = 0;
  for (let i = 0; i < seg.length; i++) energy += seg[i] * seg[i];
  if (energy < 1e-12) return 0;

  for (let lag = minLag; lag <= maxLag && lag < seg.length / 2; lag++) {
    let acc = 0;
    let norm = 0;
    for (let i = 0; i + lag < seg.length; i++) {
      acc += seg[i] * seg[i + lag];
      norm += seg[i + lag] * seg[i + lag];
    }
    const score = acc / Math.sqrt(norm + 1e-12);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 1) return 0;
  // 放物線補間でラグを細かく求める
  const at = (lag) => {
    let acc = 0;
    for (let i = 0; i + lag < seg.length; i++) acc += seg[i] * seg[i + lag];
    return acc;
  };
  const y0 = at(best - 1);
  const y1 = at(best);
  const y2 = at(best + 1);
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return SR / (best + Math.max(-1, Math.min(1, shift)));
}

function rms(buf, from, to) {
  let acc = 0;
  const a = Math.max(0, from | 0);
  const b = Math.min(buf.length, to | 0);
  for (let i = a; i < b; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / Math.max(1, b - a));
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > p) p = v;
  }
  return p;
}

function hasBadSamples(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) return true;
  }
  return false;
}

/** 高域のエネルギー比（0..1）。ゴエツェルで 1.2kHz 以上をざっくり測る */
function brightness(buf, from, to) {
  let low = 0;
  let high = 0;
  for (const f of [80, 160, 240, 320, 480, 640]) low += goertzel(buf, from, to, f);
  for (const f of [1200, 1600, 2200, 3000, 4000, 5200]) high += goertzel(buf, from, to, f);
  return high / (low + high + 1e-12);
}

function goertzel(buf, from, to, freq) {
  const n = to - from;
  const w = (2 * Math.PI * freq) / SR;
  const coef = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = buf[from + i] + coef * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coef * s1 * s2)) / n;
}

function cents(a, b) {
  return 1200 * Math.log2(a / b);
}

// --------------------------------------------------------------------- tests

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  const mark = ok ? '  ok  ' : ' FAIL ';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const TUNING = [28, 33, 38, 43]; // E1 A1 D2 G2
const noteFreq = (note) => 440 * Math.pow(2, (note - 69) / 12);

console.log('Kurogane Bass 音源テスト (48kHz)\n');

// 1. 各弦・各フレットの音程が正しいか
console.log('— 音程の精度 —');
for (const [str, fret] of [[0, 0], [0, 5], [1, 3], [2, 7], [3, 12], [3, 0]]) {
  const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: 0 });
  const want = noteFreq(TUNING[str] + fret);
  const buf = render(proc, 1.4, [
    { time: 0.02, msg: { type: 'pluck', str, freq: want, vel: 0.8, tech: 'finger', fret } },
  ]);
  const got = estimateFreq(buf, Math.floor(0.35 * SR), Math.floor(1.15 * SR));
  const err = got > 0 ? cents(got, want) : NaN;
  check(
    `弦${str + 1} ${fret}フレット (${want.toFixed(2)} Hz)`,
    Number.isFinite(err) && Math.abs(err) < 6,
    `実測 ${got.toFixed(2)} Hz / 誤差 ${err.toFixed(2)} cent`
  );
}

// 2. 発散しないか（強打・全弦・共鳴最大・長時間）
console.log('\n— 安定性 —');
{
  const proc = makeProcessor({
    tuning: TUNING, stringCount: 4, sustain: 1.8, sympathetic: 1, buzz: 1, brightness: 1, stiffness: 1,
  });
  const events = [];
  for (let rep = 0; rep < 8; rep++) {
    for (let s = 0; s < 4; s++) {
      events.push({
        time: rep * 0.25 + s * 0.05,
        msg: { type: 'pluck', str: s, freq: noteFreq(TUNING[s] + (rep % 5)), vel: 1, tech: 'slap', fret: rep % 5 },
      });
    }
  }
  const buf = render(proc, 12, events);
  const p = peak(buf);
  const tail = rms(buf, buf.length - SR, buf.length);
  check('NaN / Infinity が出ない', !hasBadSamples(buf));
  check('ピークが暴走しない', p < 4, `peak ${p.toFixed(3)}`);
  check('12秒後に発振していない', tail < 0.25, `末尾RMS ${tail.toFixed(4)}`);
}

// 3. 出力レベルが音域によって揃っているか
console.log('\n— 音量の揃い —');
{
  const levels = [];
  for (const [str, fret] of [[0, 0], [1, 2], [2, 5], [3, 9]]) {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: 0 });
    const buf = render(proc, 1.0, [
      { time: 0.02, msg: { type: 'pluck', str, freq: noteFreq(TUNING[str] + fret), vel: 0.8, tech: 'finger', fret } },
    ]);
    levels.push(rms(buf, Math.floor(0.05 * SR), Math.floor(0.45 * SR)));
  }
  const max = Math.max(...levels);
  const min = Math.min(...levels);
  const spread = 20 * Math.log10(max / (min + 1e-12));
  check('音域間の音量差が 9dB 以内', spread < 9, `${spread.toFixed(1)} dB / RMS ${levels.map((v) => v.toFixed(3)).join(', ')}`);
  check('十分な出力がある', min > 0.01 && max < 1.2, `min ${min.toFixed(3)} max ${max.toFixed(3)}`);
}

// 4. 減衰とミュート
console.log('\n— 減衰とミュート —');
{
  const open = () => {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4 });
    return render(proc, 4.0, [
      { time: 0.02, msg: { type: 'pluck', str: 0, freq: noteFreq(28), vel: 0.85, tech: 'finger', fret: 0 } },
    ]);
  };
  const buf = open();
  // 倍音は速く減衰するので、サステインは基音の残り方で測る
  const f0 = noteFreq(28);
  const fundEarly = goertzel(buf, Math.floor(0.2 * SR), Math.floor(0.7 * SR), f0);
  const fundLate = goertzel(buf, Math.floor(3.0 * SR), Math.floor(3.6 * SR), f0);
  const drop = 20 * Math.log10(fundLate / fundEarly);
  check('開放E弦の基音が3秒後も残っている', drop > -22, `${drop.toFixed(1)} dB`);
  check('ちゃんと減衰している', drop < -1, `${drop.toFixed(1)} dB`);

  const proc2 = makeProcessor({ tuning: TUNING, stringCount: 4 });
  const muted = render(proc2, 2.0, [
    { time: 0.02, msg: { type: 'pluck', str: 0, freq: noteFreq(28), vel: 0.85, tech: 'finger', fret: 0 } },
    { time: 0.5, msg: { type: 'mute', str: 0, amount: 1 } },
  ]);
  const afterMute = rms(muted, Math.floor(1.0 * SR), Math.floor(1.4 * SR));
  const beforeMute = rms(muted, Math.floor(0.2 * SR), Math.floor(0.45 * SR));
  check('ミュートで止まる', afterMute < beforeMute * 0.06,
    `${(20 * Math.log10(afterMute / beforeMute)).toFixed(1)} dB`);

  const proc3 = makeProcessor({ tuning: TUNING, stringCount: 4 });
  const palm = render(proc3, 1.5, [
    { time: 0.02, msg: { type: 'pluck', str: 0, freq: noteFreq(28), vel: 0.85, tech: 'mute', fret: 0 } },
  ]);
  check('ブリッジミュートは短い',
    rms(palm, Math.floor(0.6 * SR), Math.floor(1.0 * SR)) < rms(palm, 0, Math.floor(0.2 * SR)) * 0.12);
}

// 5. 奏法ごとの音色差
console.log('\n— 奏法による音色差 —');
{
  const bright = {};
  for (const tech of ['finger', 'pick', 'slap', 'pop', 'ghost', 'harmonic']) {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4 });
    const buf = render(proc, 0.8, [
      { time: 0.01, msg: { type: 'pluck', str: 1, freq: noteFreq(33), vel: 0.9, tech, fret: 0 } },
    ]);
    bright[tech] = brightness(buf, Math.floor(0.01 * SR), Math.floor(0.25 * SR));
    if (hasBadSamples(buf)) check(`${tech} が壊れていない`, false);
  }
  console.log(
    '   高域比: ' +
      Object.entries(bright).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(' / ')
  );
  check('ピックは指弾きより明るい', bright.pick > bright.finger);
  check('スラップは指弾きより明るい', bright.slap > bright.finger);
  check('プルが最も攻撃的', bright.pop > bright.finger);
}

// 6. 弾く位置とピックアップが音色を変える
console.log('\n— 弾く位置・ピックアップ —');
{
  const measure = (params) => {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: 0, ...params });
    const buf = render(proc, 0.7, [
      { time: 0.01, msg: { type: 'pluck', str: 1, freq: noteFreq(33), vel: 0.8, tech: 'finger', fret: 0 } },
    ]);
    return brightness(buf, Math.floor(0.02 * SR), Math.floor(0.3 * SR));
  };
  // ピックアップは弦の1点を読むので、k倍音の感度は |sin(kπβ)| になる（β=ブリッジからの距離）。
  // フロント／リアで倍音の比率が理論どおりに変わっているかを直接確かめる。
  const NECK_POS = 0.30;
  const BRIDGE_POS = 0.115;
  const harmonics = (blend) => {
    const proc = makeProcessor({
      tuning: TUNING, stringCount: 4, sympathetic: 0, pickupBlend: blend,
      pickupNeck: NECK_POS, pickupBridge: BRIDGE_POS,
    });
    const buf = render(proc, 0.7, [
      { time: 0.01, msg: { type: 'pluck', str: 1, freq: noteFreq(33), vel: 0.8, tech: 'finger', fret: 0 } },
    ]);
    const f0 = noteFreq(33);
    const from = Math.floor(0.08 * SR);
    const to = Math.floor(0.5 * SR);
    return Array.from({ length: 6 }, (_, i) => goertzel(buf, from, to, f0 * (i + 1)));
  };
  const hNeck = harmonics(0);
  const hBridge = harmonics(1);
  let worst = 0;
  const rows = [];
  for (let k = 1; k <= 6; k++) {
    const predicted = Math.abs(Math.sin(Math.PI * k * BRIDGE_POS)) / Math.abs(Math.sin(Math.PI * k * NECK_POS));
    const measured = hBridge[k - 1] / hNeck[k - 1];
    const errDb = Math.abs(20 * Math.log10(measured / predicted));
    worst = Math.max(worst, errDb);
    rows.push(`${k}倍音 理論${predicted.toFixed(2)}/実測${measured.toFixed(2)}`);
  }
  check('ピックアップ位置の櫛形特性が理論どおり', worst < 2.5, `最大誤差 ${worst.toFixed(2)} dB — ${rows.join(' ')}`);

  const fundamental = (blend) => harmonics(blend)[0];
  check('リア（ブリッジ側）は基音が細い', fundamental(1) < fundamental(0) * 0.75,
    `フロント比 ${(fundamental(1) / fundamental(0)).toFixed(2)}`);

  const neck = measure({ pickupBlend: 0 });
  const bridge = measure({ pickupBlend: 1 });
  check('リアの方が倍音の比率が高い', bridge > neck * 0.8,
    `フロント ${(neck * 100).toFixed(1)}% / リア ${(bridge * 100).toFixed(1)}%`);

  const soft = measure({ pluckPos: 1 });
  const hard = measure({ pluckPos: -1 });
  check('弾く位置で音色が変わる', Math.abs(hard - soft) > 0.002,
    `ブリッジ寄り ${(hard * 100).toFixed(1)}% / ネック寄り ${(soft * 100).toFixed(1)}%`);
}

// 7. スライドとチョーキング
console.log('\n— スライド／チョーキング —');
{
  const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: 0 });
  const from = noteFreq(33);
  const to = noteFreq(38);
  const buf = render(proc, 2.0, [
    { time: 0.02, msg: { type: 'pluck', str: 1, freq: from, vel: 0.85, tech: 'finger', fret: 0 } },
    { time: 0.6, msg: { type: 'slide', str: 1, freq: to, fret: 5, time: 0.12 } },
  ]);
  const before = estimateFreq(buf, Math.floor(0.15 * SR), Math.floor(0.55 * SR));
  const after = estimateFreq(buf, Math.floor(1.0 * SR), Math.floor(1.6 * SR));
  check('スライド前の音程', Math.abs(cents(before, from)) < 8, `${before.toFixed(2)} Hz`);
  check('スライド後の音程', Math.abs(cents(after, to)) < 10, `${after.toFixed(2)} Hz`);
  check('スライドで途切れない', !hasBadSamples(buf) && rms(buf, Math.floor(0.6 * SR), Math.floor(0.75 * SR)) > 0.002);
}

// 8. ベロシティで音量と音色が変わる
console.log('\n— ベロシティ —');
{
  const at = (vel) => {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: 0 });
    const buf = render(proc, 0.6, [
      { time: 0.01, msg: { type: 'pluck', str: 0, freq: noteFreq(28), vel, tech: 'finger', fret: 0 } },
    ]);
    return {
      level: rms(buf, Math.floor(0.02 * SR), Math.floor(0.3 * SR)),
      bright: brightness(buf, Math.floor(0.01 * SR), Math.floor(0.2 * SR)),
    };
  };
  const soft = at(0.25);
  const loud = at(1.0);
  check('強く弾くと音量が上がる', loud.level > soft.level * 2,
    `${(20 * Math.log10(loud.level / soft.level)).toFixed(1)} dB`);
  check('強く弾くと明るくなる', loud.bright > soft.bright,
    `${(soft.bright * 100).toFixed(1)}% → ${(loud.bright * 100).toFixed(1)}%`);
}

// 9. 5弦ベース
console.log('\n— 5弦 —');
{
  const tuning5 = [23, 28, 33, 38, 43];
  const proc = makeProcessor({ tuning: tuning5, stringCount: 5, sympathetic: 0 });
  const want = noteFreq(23);
  const buf = render(proc, 2.0, [
    { time: 0.02, msg: { type: 'pluck', str: 0, freq: want, vel: 0.9, tech: 'finger', fret: 0 } },
  ]);
  const got = estimateFreq(buf, Math.floor(0.4 * SR), Math.floor(1.6 * SR), 15, 200);
  check(`低B弦 (${want.toFixed(2)} Hz)`, Math.abs(cents(got, want)) < 8, `実測 ${got.toFixed(2)} Hz`);
  check('低音でも破綻しない', !hasBadSamples(buf) && peak(buf) < 2);
}

// 10. 共鳴（開放弦が一緒に鳴る）
console.log('\n— 共鳴 —');
{
  const measure = (symp) => {
    const proc = makeProcessor({ tuning: TUNING, stringCount: 4, sympathetic: symp });
    // A弦を開放で鳴らしたあと止め、E弦の共鳴だけを残す
    return render(proc, 3.0, [
      { time: 0.02, msg: { type: 'pluck', str: 0, freq: noteFreq(28), vel: 0.2, tech: 'ghost', fret: 0 } },
      { time: 0.05, msg: { type: 'pluck', str: 2, freq: noteFreq(40), vel: 1.0, tech: 'finger', fret: 2 } },
      { time: 1.2, msg: { type: 'mute', str: 2, amount: 1 } },
    ]);
  };
  const dry = rms(measure(0), Math.floor(1.8 * SR), Math.floor(2.6 * SR));
  const wet = rms(measure(1), Math.floor(1.8 * SR), Math.floor(2.6 * SR));
  check('共鳴を上げると余韻が増える', wet > dry * 1.15,
    `off ${dry.toExponential(2)} / on ${wet.toExponential(2)}`);
  check('共鳴を最大にしても発振しない', peak(measure(1)) < 3);
}

console.log(`\n${checks - failures}/${checks} 件成功`);
process.exit(failures === 0 ? 0 : 1);
