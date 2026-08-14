/**
 * Akatsuki Synth — 標準MIDIファイル（SMF フォーマット1）書き出し
 * 作った曲を他の DAW（Cubase / Logic / FL Studio 等）へ持ち込めるようにします。
 */
import type { Sequencer } from './Sequencer';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from './Sequencer';
import type { DrumType } from './types';

const TICKS_PER_QUARTER = 480;

/** ドラム音色を GM のパーカッションノート番号へ対応づける */
const GM_DRUM_MAP: Record<DrumType, number> = {
  kick: 36,
  kick2: 35,
  snare: 38,
  rim: 37,
  clap: 39,
  hatClosed: 42,
  hatOpen: 46,
  tomLow: 41,
  tomMid: 45,
  tomHigh: 48,
  crash: 49,
  ride: 51,
  cowbell: 56,
  shaker: 70,
  clave: 75,
};

function writeVarLen(bytes: number[], value: number) {
  let buffer = value & 0x7f;
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= 0x80;
    buffer |= value & 0x7f;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
}

function pushString(bytes: number[], str: string) {
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
}

function chunk(id: string, data: number[]): number[] {
  const out: number[] = [];
  pushString(out, id);
  out.push((data.length >> 24) & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff);
  return out.concat(data);
}

interface MidiEvent {
  tick: number;
  data: number[];
  order: number;
}

function buildTrackChunk(events: MidiEvent[], name: string): number[] {
  const body: number[] = [];
  // トラック名
  writeVarLen(body, 0);
  body.push(0xff, 0x03, name.length);
  pushString(body, name);

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  for (const ev of events) {
    writeVarLen(body, Math.max(0, Math.round(ev.tick - last)));
    body.push(...ev.data);
    last = ev.tick;
  }
  writeVarLen(body, 0);
  body.push(0xff, 0x2f, 0x00); // End of Track
  return chunk('MTrk', body);
}

/**
 * シーケンサーの内容を SMF に変換する。
 * @param bars 書き出す小節数（省略時はソング全長／パターン長）
 */
export function exportMidi(seq: Sequencer, bars?: number): Blob {
  const data = seq.toJSON();
  const ticksPerStep = TICKS_PER_QUARTER / STEPS_PER_BEAT;

  const songBars =
    data.mode === 'song'
      ? Math.max(1, data.scenes.reduce((s, sc) => s + Math.max(1, sc.bars), 0))
      : Math.max(
          1,
          ...data.tracks.map((t) => Math.ceil((t.patterns[t.activePattern]?.length ?? 16) / STEPS_PER_BAR))
        );
  const totalBars = bars ?? songBars;
  const totalSteps = totalBars * STEPS_PER_BAR;

  // --- テンポトラック ---
  const tempoEvents: MidiEvent[] = [];
  const usPerQuarter = Math.round(60000000 / data.bpm);
  tempoEvents.push({
    tick: 0,
    order: 0,
    data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
  });
  tempoEvents.push({ tick: 0, order: 1, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] }); // 4/4

  const chunks: number[][] = [buildTrackChunk(tempoEvents, 'Tempo')];

  let nextChannel = 0;
  const takeChannel = () => {
    if (nextChannel % 16 === 9) nextChannel++; // ch10 はドラム専用なので飛ばす
    return nextChannel++ % 16;
  };
  for (const track of data.tracks) {
    const isDrum = track.patch.kind === 'drum';
    const ch = isDrum ? 9 : takeChannel();
    const events: MidiEvent[] = [];
    let activePattern = track.activePattern;
    const songScenes = data.scenes;

    for (let step = 0; step < totalSteps; step++) {
      if (data.mode === 'song') {
        let t = step;
        for (const sc of songScenes) {
          const len = Math.max(1, sc.bars) * STEPS_PER_BAR;
          if (t < len) {
            const p = sc.patterns?.[track.id];
            if (p !== undefined) activePattern = p;
            break;
          }
          t -= len;
        }
      }
      const pat = track.patterns[activePattern] ?? track.patterns[0];
      if (!pat || pat.length <= 0) continue;
      const local = step % pat.length;
      for (const note of pat.notes) {
        if (note.step !== local) continue;
        const pitch = isDrum ? GM_DRUM_MAP[track.patch.drum.type] ?? 36 : note.pitch;
        const vel = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
        const onTick = step * ticksPerStep;
        const offTick = onTick + Math.max(ticksPerStep * 0.5, note.length * ticksPerStep * 0.94);
        events.push({ tick: onTick, order: 1, data: [0x90 | ch, pitch & 0x7f, vel] });
        events.push({ tick: offTick, order: 0, data: [0x80 | ch, pitch & 0x7f, 0] });
      }
    }
    chunks.push(buildTrackChunk(events, track.name));
  }

  const header = chunk('MThd', [
    0, 1, // format 1
    (chunks.length >> 8) & 0xff, chunks.length & 0xff,
    (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
  ]);

  const all = header.concat(...chunks);
  return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
}
