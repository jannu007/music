// アルバム「天問」シンセ・パート（ジャズコンボ：ドラム／ベース／コンピング／リード）
// 書き出し用の最小ハーネス。アプリの Demo UI とは完全に独立しており、
// ?track=tenmon-NN で指定したトラックをオフラインレンダリングし、WAV を
// base64 として window に置く。scripts/album/render-synth.mjs から
// Playwright 経由で読み出される。

import { renderSong } from '../synthesizer/src/audio/render';
import { audioBufferToWav } from '../synthesizer/src/audio/wav';
import { synthTenmonTrack } from './data/synth';

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

  const data = synthTenmonTrack(id);
  // タイトなエンディングに寄せるため、リバーブ／リリースの余韻は短めに留める
  // （曲の長さ自体は6パート全体でぴったり揃える必要があるため、テールを伸ばしすぎない）。
  const buffer = await renderSong(data, { sampleRate: 48000, tail: 0.8 });
  const blob = audioBufferToWav(buffer, 24);
  const arrayBuf = await blob.arrayBuffer();

  window.__wavBase64 = toBase64(arrayBuf);
  window.__wavDone = true;
  document.getElementById('app')!.textContent = `done: ${id} (${buffer.duration.toFixed(3)}s)`;
}

main().catch((err) => {
  console.error(err);
  window.__wavError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const el = document.getElementById('app');
  if (el) el.textContent = `error: ${window.__wavError}`;
});
