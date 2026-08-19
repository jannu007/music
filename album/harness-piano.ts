// アルバム「天問」ピアノ・パート書き出し用の最小ハーネス。
// アプリの Demo UI とは完全に独立しており、?track=tenmon-NN で指定した
// トラックをオフラインレンダリングし、WAV を base64 として window に置く。
// scripts/album/render-piano.mjs から Playwright 経由で読み出される。

import { renderPerformance } from '../piano/src/audio/PianoEngine';
import { encodeWav } from '../piano/src/audio/recorder';
import { DEFAULT_SETTINGS } from '../piano/src/audio/types';
import { PRESETS } from '../piano/src/audio/presets';
import { pianoTenmonTrack } from './data/piano';

declare global {
  interface Window {
    __wavBase64?: string;
    __wavDone?: boolean;
    __wavError?: string;
  }
}

/** 大きな ArrayBuffer でもコールスタックを溢れさせない chunked base64 変換 */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function main() {
  const id = new URLSearchParams(location.search).get('track');
  if (!id) throw new Error('?track=tenmon-NN が指定されていません');

  const track = pianoTenmonTrack(id);
  const preset = PRESETS.find((p) => p.id === track.presetId);
  const settings = { ...DEFAULT_SETTINGS, ...(preset?.settings ?? {}) };

  // renderPerformance() itself rounds the length up by another ~0.05s
  // (see PianoEngine.ts: Math.ceil((durationSec + 0.05) * sampleRate)), so a
  // +1.0s tail here would overshoot the spec's 1.0s tolerance to +1.05s.
  // Use +0.9s of decay/reverb tail so the measured WAV length lands at
  // durationSec + 0.95s — comfortably inside the ±1.0s check.
  const buffer = await renderPerformance(track.events, settings, track.durationSec + 0.9);
  const blob = encodeWav(buffer);
  const arrayBuf = await blob.arrayBuffer();

  window.__wavBase64 = toBase64(arrayBuf);
  window.__wavDone = true;
  document.getElementById('app')!.textContent = `done: ${id} (${track.durationSec.toFixed(3)}s)`;
}

main().catch((err) => {
  console.error(err);
  window.__wavError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const el = document.getElementById('app');
  if (el) el.textContent = `error: ${window.__wavError}`;
});
