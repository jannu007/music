/*
 * 素材の取り込み。
 *
 * ここは**アプリの中でいちばん外の世界に触れる場所**なので、
 * 受け取ったものを信用しないという前提で書いてある。
 *
 *   - 大きさと長さに上限を設ける（端末を固まらせないため）
 *   - 拡張子ではなく、実際に音として読めるかどうかで判断する
 *   - 復号は decodeAudioData に任せる（ブラウザ側の実装。自前でパースしない）
 *   - 読めなかったときは、理由が分かる形で失敗させる（黙って無視しない）
 *
 * 自前でファイル形式を解析しないのは意図的。壊れたファイルや細工された
 * ファイルの扱いは、ブラウザに任せた方が安全で、確実に速い。
 */

import { MAX_FILE_BYTES, MAX_SAMPLE_SECONDS } from './store';
import type { SampleMeta } from './types';

export type ImportFailure = 'tooLarge' | 'tooLong' | 'notAudio' | 'empty' | 'silent';

export class ImportError extends Error {
  constructor(
    readonly reason: ImportFailure,
    message: string
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * ファイル名から表示名を作る。
 * パスの区切り・制御文字・前後の空白を落とす（画面にも書き出し名にも使うため）
 */
export function safeSampleName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  const withoutExt = base.replace(/\.[a-z0-9]{1,8}$/i, '');
  const cleaned = withoutExt.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'sample').slice(0, 60);
}

let counter = 0;
function newId(): string {
  counter++;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `s-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

export interface ImportedSample {
  meta: SampleMeta;
  channels: Float32Array[];
}

/**
 * 音声ファイルを読み込む。
 *
 * ctx は復号のためだけに使う。復号後の周波数は ctx に合わせられるので、
 * 実際に鳴らす AudioContext と同じものを渡すこと。
 */
export async function importAudioFile(file: File, ctx: BaseAudioContext): Promise<ImportedSample> {
  if (file.size === 0) throw new ImportError('empty', 'empty file');
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError('tooLarge', `${(file.size / 1048576).toFixed(0)} MB`);
  }

  const bytes = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    // decodeAudioData は渡した ArrayBuffer を手放す実装があるので、複製を渡す
    buffer = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new ImportError('notAudio', 'not audio');
  }

  if (buffer.length === 0) throw new ImportError('empty', 'no frames');
  if (buffer.duration > MAX_SAMPLE_SECONDS) {
    throw new ImportError('tooLong', `${buffer.duration.toFixed(0)}s`);
  }

  // 3チャンネル以上は先頭2つだけ使う（5.1ch などをそのまま抱えない）
  const channelCount = Math.min(2, buffer.numberOfChannels);
  const channels: Float32Array[] = [];
  let peak = 0;
  for (let c = 0; c < channelCount; c++) {
    const data = new Float32Array(buffer.length);
    buffer.copyFromChannel(data, c);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      // 壊れた値が混じっていても、そのまま音にはしない
      if (!Number.isFinite(v)) data[i] = 0;
      else peak = Math.max(peak, Math.abs(v));
    }
    channels.push(data);
  }
  if (peak < 1e-5) throw new ImportError('silent', 'silent');

  return {
    meta: {
      id: newId(),
      name: safeSampleName(file.name),
      sampleRate: buffer.sampleRate,
      frames: buffer.length,
      channels: channelCount,
      origin: 'import',
    },
    channels,
  };
}

/** マイクで録った音を素材にする */
export function fromRecording(
  channels: Float32Array[],
  sampleRate: number,
  name: string
): ImportedSample {
  const frames = channels[0]?.length ?? 0;
  return {
    meta: {
      id: newId(),
      name: safeSampleName(name),
      sampleRate,
      frames,
      channels: channels.length,
      origin: 'record',
    },
    channels,
  };
}

/** 前後の無音を落とす。取り込んだ直後の素材はたいてい頭に間がある */
export function trimSilence(channels: Float32Array[], threshold = 0.004): Float32Array[] {
  const len = channels[0]?.length ?? 0;
  if (len === 0) return channels;
  const loud = (i: number) => channels.some((ch) => Math.abs(ch[i]) > threshold);

  let start = 0;
  while (start < len && !loud(start)) start++;
  if (start >= len) return channels; // どこも鳴っていない
  let end = len - 1;
  while (end > start && !loud(end)) end--;
  if (start === 0 && end === len - 1) return channels;
  // 立ち上がりを削り取らないよう、少し手前から残す
  const pad = Math.min(start, 64);
  return channels.map((ch) => ch.slice(start - pad, end + 1));
}
