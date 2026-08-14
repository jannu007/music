import { TRACK_IDS, applyKit, createTracks } from './kits';
import {
  DEFAULT_MASTER,
  PATTERN_COUNT,
  STEP_MAX,
  emptyPattern,
  makeStep,
  type Pattern,
  type Project,
  type Step,
  type TrackPattern,
} from './types';

export const PATTERN_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function createProject(kitId = 'analog'): Project {
  return {
    version: 1,
    name: '新しいパターン',
    kitId,
    bpm: 120,
    swing: 50,
    humanize: 0,
    stepsPerBeat: 4,
    tracks: createTracks(kitId),
    patterns: PATTERN_NAMES.map((n) => emptyPattern(n, TRACK_IDS, 16)),
    current: 0,
    song: [{ pattern: 0, repeats: 2 }],
    songMode: false,
    master: { ...DEFAULT_MASTER },
  };
}

/**
 * 打ち込みを文字で書くための記法。
 *   `.` `-` 休み / `o` ゴースト / `x` 通常 / `X` アクセント
 *   `r` 2連打 / `R` 3連打 / `?` 50%の確率で鳴る / `|` は区切り（無視）
 */
export function parseSteps(notation: string): (Step | null)[] {
  const steps: (Step | null)[] = new Array(STEP_MAX).fill(null);
  let i = 0;
  for (const ch of notation) {
    if (ch === ' ' || ch === '|') continue;
    if (i >= STEP_MAX) break;
    switch (ch) {
      case 'o': steps[i] = makeStep(0.34); break;
      case 'x': steps[i] = makeStep(0.7); break;
      case 'X': steps[i] = makeStep(1); break;
      case 'r': steps[i] = makeStep(0.7, 1, 2); break;
      case 'R': steps[i] = makeStep(0.85, 1, 3); break;
      case '?': steps[i] = makeStep(0.7, 0.5); break;
      default: steps[i] = null; break;
    }
    i++;
  }
  return steps;
}

/** 文字数（区切りを除く）＝ステップ数 */
export function notationLength(notation: string): number {
  let n = 0;
  for (const ch of notation) if (ch !== ' ' && ch !== '|') n++;
  return n;
}

export interface PatternSource {
  name: string;
  length?: number;
  /** トラックID → 記法。書かれていないトラックは無音 */
  rows: Record<string, string>;
  /** トラックID → 独自の長さ（ポリメーター） */
  polymeter?: Record<string, number>;
}

export function buildPattern(src: PatternSource): Pattern {
  const length =
    src.length ?? Math.max(1, ...Object.values(src.rows).map((r) => notationLength(r)));
  const pattern = emptyPattern(src.name, TRACK_IDS, Math.min(STEP_MAX, length));
  for (const [id, notation] of Object.entries(src.rows)) {
    const tp: TrackPattern = { steps: parseSteps(notation), length: src.polymeter?.[id] ?? 0 };
    pattern.tracks[id] = tp;
  }
  return pattern;
}

// ------------------------------------------------------------------- 保存形式

type EncodedStep = 0 | number | Step;

function encodeStep(step: Step | null): EncodedStep {
  if (!step) return 0;
  if (step.p === 1 && step.r === 1 && step.s === 0) return step.v;
  return step;
}

function decodeStep(raw: unknown): Step | null {
  if (!raw) return null;
  if (typeof raw === 'number') return makeStep(raw);
  const s = raw as Partial<Step>;
  return makeStep(s.v ?? 0.7, s.p ?? 1, s.r ?? 1, s.s ?? 0);
}

/** localStorage / ファイル保存用に小さくする */
export function encodeProject(project: Project): unknown {
  return {
    ...project,
    patterns: project.patterns.map((p) => ({
      name: p.name,
      length: p.length,
      tracks: Object.fromEntries(
        Object.entries(p.tracks).map(([id, tp]) => {
          const limit = Math.max(p.length, tp.length);
          const steps = tp.steps.slice(0, limit).map(encodeStep);
          // 末尾の空きを削る
          while (steps.length > 0 && steps[steps.length - 1] === 0) steps.pop();
          return [id, { steps, length: tp.length }];
        })
      ),
    })),
  };
}

export function decodeProject(raw: any): Project | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.patterns)) return null;
  const base = createProject(typeof raw.kitId === 'string' ? raw.kitId : 'analog');
  const project: Project = {
    ...base,
    name: typeof raw.name === 'string' ? raw.name : base.name,
    bpm: clamp(raw.bpm ?? base.bpm, 40, 240),
    swing: clamp(raw.swing ?? base.swing, 50, 75),
    humanize: clamp(raw.humanize ?? base.humanize, 0, 1),
    stepsPerBeat: [3, 4, 6].includes(raw.stepsPerBeat) ? raw.stepsPerBeat : 4,
    current: clamp(raw.current ?? 0, 0, PATTERN_COUNT - 1),
    songMode: !!raw.songMode,
    master: { ...base.master, ...(raw.master ?? {}) },
  };

  if (Array.isArray(raw.tracks)) {
    project.tracks = applyKit(base.tracks, project.kitId).map((track) => {
      const saved = raw.tracks.find((t: any) => t?.id === track.id);
      if (!saved) return track;
      return {
        ...track,
        params: { ...track.params, ...(saved.params ?? {}) },
        mute: !!saved.mute,
        solo: !!saved.solo,
      };
    });
  }

  project.patterns = base.patterns.map((fallback, index) => {
    const saved = raw.patterns[index];
    if (!saved) return fallback;
    const pattern = emptyPattern(
      typeof saved.name === 'string' ? saved.name : fallback.name,
      TRACK_IDS,
      clamp(saved.length ?? 16, 1, STEP_MAX)
    );
    const tracks = saved.tracks ?? {};
    for (const id of TRACK_IDS) {
      const tp = tracks[id];
      if (!tp || !Array.isArray(tp.steps)) continue;
      const steps: (Step | null)[] = new Array(STEP_MAX).fill(null);
      tp.steps.slice(0, STEP_MAX).forEach((s: unknown, i: number) => {
        steps[i] = decodeStep(s);
      });
      pattern.tracks[id] = { steps, length: clamp(tp.length ?? 0, 0, STEP_MAX) };
    }
    return pattern;
  });

  if (Array.isArray(raw.song) && raw.song.length > 0) {
    project.song = raw.song
      .filter((s: any) => s && typeof s.pattern === 'number')
      .map((s: any) => ({
        pattern: clamp(s.pattern, 0, PATTERN_COUNT - 1),
        repeats: clamp(s.repeats ?? 1, 1, 16),
      }));
    if (project.song.length === 0) project.song = [{ pattern: 0, repeats: 2 }];
  }

  return project;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
}

/** パターンが空かどうか（デモ読み込みの判定などに使う） */
export function isPatternEmpty(pattern: Pattern): boolean {
  return Object.values(pattern.tracks).every((tp) => tp.steps.every((s) => !s));
}

export function clonePattern(pattern: Pattern): Pattern {
  return {
    name: pattern.name,
    length: pattern.length,
    tracks: Object.fromEntries(
      Object.entries(pattern.tracks).map(([id, tp]) => [
        id,
        { length: tp.length, steps: tp.steps.map((s) => (s ? { ...s } : null)) },
      ])
    ),
  };
}
