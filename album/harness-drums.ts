// アルバム「天問」ドラム・パート書き出し用の最小ハーネス。
// アプリの Demo UI とは完全に独立しており、?track=tenmon-NN で指定した
// トラックをオフラインレンダリングし、WAV を base64 として window に置く。
// scripts/album/render-drums.mjs から Playwright 経由で読み出される。

import { renderProject } from '../drums/src/audio/DrumEngine';
import { encodeWav } from '../drums/src/audio/export';
import { loadDemo } from '../drums/src/data/songs';
import { drumsTenmonTrack } from './data/drums';

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

  const demoSong = drumsTenmonTrack(id);
  const project = loadDemo(demoSong);

  // Short tail so cymbal/reverb decay isn't hard-cut, but short enough that
  // the WAV's total duration still lands within the ±1.0s tolerance the
  // locked album spec requires against the other 5 stems.
  const buffer = await renderProject(project, { loops: 1, tail: 0.8 });
  const wavBytes = encodeWav(buffer); // Uint8Array（24bit PCM WAV）
  const arrayBuf = wavBytes.buffer.slice(
    wavBytes.byteOffset,
    wavBytes.byteOffset + wavBytes.byteLength
  ) as ArrayBuffer;

  window.__wavBase64 = toBase64(arrayBuf);
  window.__wavDone = true;
  document.getElementById('app')!.textContent = `done: ${id}`;
}

main().catch((err) => {
  console.error(err);
  window.__wavError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const el = document.getElementById('app');
  if (el) el.textContent = `error: ${window.__wavError}`;
});
