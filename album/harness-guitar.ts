/**
 * album/harness-guitar.ts
 *
 * Playwright から `?track=tenmon-NN` 付きで開かれる、レンダー専用の
 * 最小限のハーネス。UI は一切持たず、実際の音声エンジン
 * (GuitarEngine.renderPerformance) をそのまま呼び出して WAV を書き出す。
 * 結果は window.__wavBase64 / window.__wavDone に置く（download は
 * サンドボックスされた環境では効かないため使わない）。
 */
import { renderPerformance } from '../guitar/src/audio/GuitarEngine';
import { encodeWav } from '../guitar/src/audio/recorder';
import { DEFAULT_SETTINGS, type GuitarSettings } from '../guitar/src/audio/types';
import { PRESETS } from '../guitar/src/audio/presets';
import { guitarTenmonTrack } from './data/guitar';

declare global {
  interface Window {
    __wavBase64?: string;
    __wavDone?: boolean;
    __wavError?: string;
  }
}

function arrayBufferToBase64Chunked(buf: ArrayBuffer): string {
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
  if (!id) throw new Error('missing ?track= query param');

  const track = guitarTenmonTrack(id);
  const preset = PRESETS.find((p) => p.id === track.presetId);
  const settings: GuitarSettings = { ...DEFAULT_SETTINGS, ...(preset?.settings ?? {}) };

  const buffer = await renderPerformance(track.events, settings, track.tuning, track.durationSec + 1.0);
  const blob = encodeWav(buffer);
  const arrayBuf = await blob.arrayBuffer();

  window.__wavBase64 = arrayBufferToBase64Chunked(arrayBuf);
  window.__wavDone = true;
}

main().catch((err) => {
  window.__wavError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  window.__wavDone = true;
});
