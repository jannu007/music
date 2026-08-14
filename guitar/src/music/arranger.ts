import type { PerformanceEvent } from '../audio/types';
import { cachedVoicing, type Chord } from './chords';
import { slotToString } from './fretting';
import { stepTime, type RhythmPattern } from './strum';
import type { Tuning } from './tunings';

export interface ArrangeBar {
  chord: Chord;
  /** その小節だけパターンを差し替えたいとき */
  pattern?: RhythmPattern;
}

export interface ArrangeOptions {
  bpm: number;
  /** 隣り合う弦を弾く間隔（秒）。大きいほど「ジャラーン」と広がる */
  strumSpread?: number;
  /** 人間らしいゆらぎ 0..1 */
  humanize?: number;
  /** 先頭のオフセット（秒） */
  startTime?: number;
  /** ブリッジミュートの量（chug などで使う） */
  palm?: number;
  /** 押さえる位置の下限（ハイポジションで弾かせたいとき） */
  minFret?: number;
}

/**
 * コード進行 + リズムパターンから演奏イベントを組み立てる。
 * 自動伴奏とデモ再生の両方がこの関数を使う。
 */
export function arrange(
  tuning: Tuning,
  bars: ArrangeBar[],
  pattern: RhythmPattern,
  options: ArrangeOptions
): PerformanceEvent[] {
  const events: PerformanceEvent[] = [];
  const bpm = Math.max(30, options.bpm);
  const spread = options.strumSpread ?? 0.014;
  const human = options.humanize ?? 0.25;
  let time = options.startTime ?? 0;

  if (options.palm !== undefined) {
    events.push({ time: Math.max(0, time - 0.01), type: 'palm', value: options.palm });
  }

  // 直前の小節で鳴らしていた弦（コードが変わるときに止めるため）
  let previous: number[] | null = null;

  for (const bar of bars) {
    const pat = bar.pattern ?? pattern;
    const voicing = cachedVoicing(tuning, bar.chord, options.minFret ?? 0);
    const frets = voicing.frets;
    const barLength = (pat.beats * 60) / bpm;

    // 押さえ替えで鳴らなくなる弦は、小節のあたまで止める
    if (previous) {
      for (let s = 0; s < frets.length; s++) {
        if (previous[s] >= 0 && frets[s] < 0) {
          events.push({ time, type: 'damp', string: s, amount: 1 });
        }
      }
    }
    previous = frets;

    for (let step = 0; step < pat.steps.length; step++) {
      const item = pat.steps[step];
      if (item.kind === 'rest') continue;
      const at = time + stepTime(step, bpm, pat.swing);

      if (item.kind === 'pick') {
        const string = slotToString(frets, item.slot);
        if (string < 0) continue;
        events.push({
          time: at + jitter(human, 0.006),
          type: 'pluck',
          string,
          fret: frets[string],
          vel: clamp01(item.vel * (1 + jitter(human, 0.09))),
        });
        continue;
      }

      // ---- ストローク ----
      const low = item.low ?? 0;
      const high = item.high ?? frets.length - 1;
      const order: number[] = [];
      for (let s = 0; s < frets.length; s++) {
        if (s < low || s > high) continue;
        if (!item.mute && frets[s] < 0) continue;
        order.push(s);
      }
      if (item.dir === 'up') order.reverse();
      // アップストロークは高音弦側から入るので、少し速く鳴らす
      const gap = spread * (item.dir === 'up' ? 0.75 : 1) * (1 + jitter(human, 0.2));

      order.forEach((s, i) => {
        // 低音弦から順に、わずかに時間をずらして弾く＝ストロークの「ジャラン」感
        const t = at + i * gap + jitter(human, 0.004);
        // ダウンは低音弦が、アップは高音弦が強く出る
        const positional = item.dir === 'down' ? 1 - i * 0.02 : 0.9 - i * 0.015;
        events.push({
          time: Math.max(0, t),
          type: 'pluck',
          string: s,
          fret: item.mute ? -1 : frets[s],
          vel: clamp01(item.vel * positional * (1 + jitter(human, 0.1))),
        });
      });
    }

    time += barLength;
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

/** 各小節の開始時刻（秒）。再生中にいまのコードを表示するのに使う */
export function barTimes(bars: ArrangeBar[], pattern: RhythmPattern, bpm: number): number[] {
  const times: number[] = [];
  let t = 0;
  for (const bar of bars) {
    times.push(t);
    const pat = bar.pattern ?? pattern;
    t += (pat.beats * 60) / Math.max(30, bpm);
  }
  return times;
}

/** 進行の総再生時間（秒） */
export function arrangeDuration(bars: ArrangeBar[], pattern: RhythmPattern, bpm: number): number {
  let total = 0;
  for (const bar of bars) {
    const pat = bar.pattern ?? pattern;
    total += (pat.beats * 60) / Math.max(30, bpm);
  }
  return total;
}

function jitter(amount: number, scale: number): number {
  if (amount <= 0) return 0;
  return (Math.random() * 2 - 1) * amount * scale;
}

function clamp01(v: number): number {
  return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}
