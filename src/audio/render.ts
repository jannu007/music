/**
 * Akatsuki Synth — オフライン書き出し（バウンス）
 *
 * OfflineAudioContext 上に再生時とまったく同じ音声グラフを組み直し、
 * 全ノートイベントを事前に流し込んで一気にレンダリングします。
 * リアルタイム録音と違い、CPU 負荷による音切れが原理的に発生せず、
 * 実時間より高速に高品質な WAV を書き出せます。
 */
import { AudioEngine, loadWorklets, type MasterSettings } from './AudioEngine';
import { collectEvents, Sequencer, STEPS_PER_BAR, Track } from './Sequencer';
import { normalizePatch } from './presets';

export interface RenderOptions {
  sampleRate?: number;
  /** 書き出す小節数（未指定ならパターン／ソング長から自動計算） */
  bars?: number;
  /** 繰り返し回数 */
  repeats?: number;
  /** 余韻（リバーブ・リリース）の追加秒数 */
  tail?: number;
  onProgress?: (ratio: number) => void;
}

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

/** パターンモードで「全トラックが一巡する」長さ（ステップ数）を求める */
export function naturalLoopSteps(data: ReturnType<Sequencer['toJSON']>): number {
  const lengths = data.tracks
    .filter((t) => !t.muted && (t.patterns[t.activePattern]?.notes.length ?? 0) > 0)
    .map((t) => Math.max(1, t.patterns[t.activePattern]?.length ?? 16));
  if (lengths.length === 0) return STEPS_PER_BAR;
  let steps = lengths.reduce((a, b) => lcm(a, b), 1);
  // 現実的な上限（16小節）に丸める
  const max = STEPS_PER_BAR * 16;
  while (steps > max) steps = Math.ceil(steps / 2);
  return Math.max(STEPS_PER_BAR, steps);
}

export async function renderSong(
  data: ReturnType<Sequencer['toJSON']>,
  options: RenderOptions = {}
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 48000;
  const repeats = Math.max(1, options.repeats ?? 1);
  const tail = options.tail ?? 3.5;

  const songSteps =
    data.mode === 'song'
      ? Math.max(1, data.scenes.reduce((s, sc) => s + Math.max(1, sc.bars), 0)) * STEPS_PER_BAR
      : naturalLoopSteps(data);
  const totalSteps = (options.bars ? options.bars * STEPS_PER_BAR : songSteps) * repeats;

  const stepDur = 60 / data.bpm / 4;
  const durationSeconds = totalSteps * stepDur + tail;
  const frames = Math.ceil(durationSeconds * sampleRate);

  const OfflineCtor: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext ?? (window as any).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, frames, sampleRate);
  await loadWorklets(ctx);

  const master: MasterSettings = data.master;
  const engine = new AudioEngine(ctx, JSON.parse(JSON.stringify(master)));
  engine.bpm = data.bpm;
  engine.applySettings(engine.settings, true);
  engine.rebuildReverb();

  const events = collectEvents(data, totalSteps, 0.02);
  for (const td of data.tracks) {
    const track = new Track(engine, td.id, td.name, normalizePatch(td.patch), events.get(td.id) ?? []);
    track.setVolume(td.volume);
    track.setPan(td.pan);
  }

  options.onProgress?.(0.05);
  // ワークレットの初期化メッセージが確実に処理されてからレンダリングを開始する
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rendered = await ctx.startRendering();
  options.onProgress?.(1);
  return rendered;
}
