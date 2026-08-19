// アルバム「天問」ボーカル・パート（スキャット）書き出し用の最小ハーネス。
// アプリの Demo UI とは完全に独立しており、?track=tenmon-NN で指定した
// トラックをオフラインレンダリングし、WAV を base64 として window に置く。
// scripts/album/render-vocal.mjs から Playwright 経由で読み出される。

import { compileSong } from '../vocal/src/audio/compile';
import { renderSong } from '../vocal/src/audio/VocalEngine';
import { encodeWav } from '../vocal/src/audio/export';
import { vocalTenmonTrack } from './data/vocal';

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

  const song = vocalTenmonTrack(id);
  const compiled = compileSong(song);
  // tail はコンパイル済み長さに足す余韻（既定 2.6 秒）。アルバム・ミックスでは
  // 他5パートと拍単位でぴったり揃える必要があるため、短い自然減衰分だけ残す。
  const buffer = await renderSong(compiled, song.settings, song.bpm, { tail: 0.3 });
  const blob = encodeWav(buffer);
  const arrayBuf = await blob.arrayBuffer();

  window.__wavBase64 = toBase64(arrayBuf);
  window.__wavDone = true;
  document.getElementById('app')!.textContent = `done: ${id} (${compiled.duration.toFixed(3)}s compiled)`;
}

main().catch((err) => {
  console.error(err);
  window.__wavError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const el = document.getElementById('app');
  if (el) el.textContent = `error: ${window.__wavError}`;
});
