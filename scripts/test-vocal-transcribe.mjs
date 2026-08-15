/*
 * Hoshizora Vocal の「録音 → 音符」解析を Node 上で検証する。
 *   node scripts/test-vocal-transcribe.mjs
 *
 * マイクで実際に歌う代わりに、既知の音程・長さの歌声を合成して流し込み、
 *   - 基本周波数を正しく測れるか（セント単位）
 *   - 音符の数・音程・並びが合っているか
 *   - 拍へのスナップで重なりや長さの破綻が起きないか
 *   - 母音の推定がフォルマントに追随するか
 * を数値で確認する。外部ライブラリは使わない（TypeScript の変換だけ esbuild に任せる）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000;

// ------------------------------------------------- TypeScript を読めるようにする

const { build } = await import('esbuild');
const outDir = mkdtempSync(resolve(tmpdir(), 'vocal-transcribe-'));
const outFile = resolve(outDir, 'transcribe.mjs');
await build({
  entryPoints: [resolve(here, '..', 'vocal', 'src', 'audio', 'transcribe.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { analyzeRecording, detectPitch, quantizeToBeats, resample } = await import(
  pathToFileURL(outFile).href
);

// ------------------------------------------------------------------- helpers

let checks = 0;
let failures = 0;
function check(label, ok, detail = '') {
  checks++;
  if (!ok) failures++;
  const mark = ok ? '[  ok  ]' : '[ FAIL ]';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const centsBetween = (a, b) => 1200 * Math.log2(a / b);

/** 倍音を重ねた「歌声らしい」波形（軽いビブラート付き） */
function sing(freq, seconds, { gain = 0.5, harmonics = 12, vibrato = 0.25 } = {}) {
  const out = new Float32Array(Math.round(seconds * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = freq * (1 + (vibrato / 100) * Math.sin(2 * Math.PI * 5.2 * t));
    phase += (2 * Math.PI * f) / SR;
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(phase * h) / h;
    // 頭とお尻を少しなめらかにして、切れ目のノイズを避ける
    const fade = Math.min(1, i / (0.012 * SR), (out.length - i) / (0.012 * SR));
    out[i] = v * gain * 0.35 * fade;
  }
  return out;
}

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 2次共振器でフォルマントを付ける（母音らしさを作る） */
function resonate(input, freq, q = 12) {
  const w0 = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function mix(a, b, ratio = 0.5) {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) * (1 - ratio) + (b[i] ?? 0) * ratio;
  return out;
}

function normalize(buf, target = 0.5) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-9) return buf;
  const gain = target / peak;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * gain;
  return out;
}

// ------------------------------------------------------------------ リサンプル

console.log('— リサンプル —');
{
  const tone = sing(440, 0.5, { harmonics: 1, vibrato: 0 });
  const down = resample(tone, SR, 16000);
  check('16kHz へ落とすと長さが 1/3 になる', Math.abs(down.length - tone.length / 3) <= 2,
    `${tone.length} → ${down.length}`);
  const { freq } = detectPitch(down, 1600, 16000);
  check('落としても音程が変わらない (440Hz)', Math.abs(centsBetween(freq, 440)) < 10,
    `${freq.toFixed(2)} Hz`);
}

// -------------------------------------------------------------- ピッチ検出

console.log('\n— ピッチ検出 —');
for (const midi of [45, 57, 60, 69, 76, 84]) {
  const freq = midiToFreq(midi);
  const tone = resample(sing(freq, 0.5), SR, 16000);
  const { freq: measured, confidence } = detectPitch(tone, 1600, 16000);
  const cents = centsBetween(measured, freq);
  check(`MIDI ${midi} (${freq.toFixed(1)} Hz)`, Math.abs(cents) < 20 && confidence > 0.7,
    `実測 ${measured.toFixed(2)} Hz / ${cents.toFixed(1)} セント / 確度 ${confidence.toFixed(2)}`);
}
{
  const noise = new Float32Array(16000);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.3;
  const { confidence } = detectPitch(noise, 1600, 16000);
  check('雑音は確度が低い', confidence < 0.6, `確度 ${confidence.toFixed(2)}`);
}

// ------------------------------------------------------------ 音符の取り出し

console.log('\n— 音符の取り出し —');
{
  const wanted = [60, 64, 67, 72];
  const parts = [silence(0.2)];
  for (const midi of wanted) {
    parts.push(sing(midiToFreq(midi), 0.5));
    parts.push(silence(0.2));
  }
  const samples = concat(parts);
  const notes = await analyzeRecording({ samples, sampleRate: SR }, { sensitivity: 0.5 });

  check('4音を4つの音符として取り出す', notes.length === wanted.length, `${notes.length} 個`);
  const gotMidi = notes.map((n) => n.midi);
  check('音程が合っている', JSON.stringify(gotMidi) === JSON.stringify(wanted),
    `${gotMidi.join(', ')}（期待 ${wanted.join(', ')}）`);
  if (notes.length === wanted.length) {
    const startOk = notes.every((n, i) => Math.abs(n.startSec - (0.2 + i * 0.7)) < 0.06);
    check('開始位置が合っている', startOk, notes.map((n) => n.startSec.toFixed(2)).join(', '));
    const lengthOk = notes.every((n) => Math.abs(n.lengthSec - 0.5) < 0.09);
    check('長さが合っている', lengthOk, notes.map((n) => n.lengthSec.toFixed(2)).join(', '));
  }
}

{
  // 息継ぎのない、続けて音程が変わるフレーズ（無音では切れない）
  const wanted = [62, 64, 65, 64];
  const samples = concat(wanted.map((midi) => sing(midiToFreq(midi), 0.4)));
  const notes = await analyzeRecording({ samples, sampleRate: SR }, { sensitivity: 0.5 });
  check('繋がった歌でも音程の変わり目で割る', notes.length === wanted.length, `${notes.length} 個`);
  check('繋がった歌の音程が合っている',
    JSON.stringify(notes.map((n) => n.midi)) === JSON.stringify(wanted),
    notes.map((n) => n.midi).join(', '));
}

{
  const samples = silence(1.5);
  const notes = await analyzeRecording({ samples, sampleRate: SR }, { sensitivity: 0.5 });
  check('無音からは音符を作らない', notes.length === 0, `${notes.length} 個`);
}

{
  // 弱い声でも感度を上げれば拾える
  const samples = concat([silence(0.2), sing(midiToFreq(60), 0.5, { gain: 0.02 }), silence(0.2)]);
  const quiet = await analyzeRecording({ samples, sampleRate: SR }, { sensitivity: 0.95 });
  check('感度を上げると小さな声も拾う', quiet.length === 1 && quiet[0].midi === 60,
    `${quiet.length} 個 / ${quiet.map((n) => n.midi).join(',')}`);
}

// ---------------------------------------------------------------- 母音の推定

console.log('\n— 母音の推定 —');
{
  // 低い声（男声）のフォルマントで あ・い・う・え・お を作る
  const table = { あ: [775, 1163], い: [263, 2263], う: [363, 1300], え: [475, 1738], お: [550, 838] };
  let hit = 0;
  const got = [];
  for (const [kana, [f1, f2]] of Object.entries(table)) {
    const source = sing(midiToFreq(48), 0.6, { harmonics: 40, vibrato: 0.1 });
    const shaped = normalize(mix(resonate(source, f1, 11), resonate(source, f2, 11), 0.45));
    const samples = concat([silence(0.15), shaped, silence(0.15)]);
    const notes = await analyzeRecording(
      { samples, sampleRate: SR },
      { sensitivity: 0.6, detectVowels: true }
    );
    const vowel = notes[0]?.vowel ?? null;
    got.push(`${kana}→${vowel ?? '？'}`);
    if (vowel === kana) hit++;
  }
  check('5母音のうち4つ以上を当てる', hit >= 4, `${hit}/5（${got.join(' ')}）`);
}

// ------------------------------------------------------------------ 拍に合わせる

console.log('\n— 拍に合わせる —');
{
  // BPM 120 なら 1拍 = 0.5秒。0.5秒の音が並んでいれば 1拍ずつになる
  const detected = [
    { startSec: 0.0, lengthSec: 0.48, midi: 60, vel: 0.8, vowel: null },
    { startSec: 0.51, lengthSec: 0.24, midi: 62, vel: 0.7, vowel: null },
    { startSec: 0.76, lengthSec: 0.49, midi: 64, vel: 0.9, vowel: null },
  ];
  const notes = quantizeToBeats(detected, { bpm: 120, snap: 0.25 });
  check('拍に直る', JSON.stringify(notes.map((n) => n.start)) === JSON.stringify([0, 1, 1.5]),
    notes.map((n) => n.start).join(', '));
  check('長さが拍に直る', JSON.stringify(notes.map((n) => n.length)) === JSON.stringify([1, 0.5, 1]),
    notes.map((n) => n.length).join(', '));
  check('音符が重ならない',
    notes.every((n, i) => i === 0 || n.start >= notes[i - 1].start + notes[i - 1].length - 1e-9));
}
{
  const detected = [
    { startSec: 1.3, lengthSec: 0.5, midi: 60, vel: 0.8, vowel: null },
    { startSec: 1.85, lengthSec: 0.5, midi: 62, vel: 0.8, vowel: null },
  ];
  const trimmed = quantizeToBeats(detected, { bpm: 120, snap: 0.25, trimStart: true });
  check('前の無音を詰められる', trimmed[0].start === 0, `${trimmed[0].start}`);
  const shifted = quantizeToBeats(detected, { bpm: 120, snap: 0.25, trimStart: true, offsetBeats: 8 });
  check('挿入位置をずらせる', shifted[0].start === 8, `${shifted[0].start}`);
}
{
  // ごく短い音でも最短の長さが確保され、順番が崩れない
  const detected = Array.from({ length: 6 }, (_, i) => ({
    startSec: i * 0.06,
    lengthSec: 0.04,
    midi: 60 + i,
    vel: 0.7,
    vowel: null,
  }));
  const notes = quantizeToBeats(detected, { bpm: 120, snap: 0.25 });
  check('短すぎる音でも長さが残る', notes.every((n) => n.length >= 0.25));
  check('短すぎる音でも順番が保たれる',
    notes.every((n, i) => i === 0 || n.start >= notes[i - 1].start + notes[i - 1].length - 1e-9),
    notes.map((n) => `${n.start}+${n.length}`).join(' '));
}

rmSync(outDir, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} 件成功`);
process.exit(failures === 0 ? 0 : 1);
