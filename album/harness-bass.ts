// album/harness-bass.ts
//
// Headless render harness for a single bass stem of the Tenmon album.
// Loaded by scripts/album/render-bass.mjs via Playwright with
// ?track=tenmon-NN in the URL. Renders the track offline, encodes it to
// a 24-bit WAV, and exposes the result on window.__wavBase64 /
// window.__wavDone for the driver script to pull out.
//
// Not part of the bass app itself — this file lives entirely under
// album/ and does not touch bass/src.

import { renderPerformance } from '../bass/src/audio/BassEngine';
import { encodeWav } from '../bass/src/audio/recorder';
import { DEFAULT_SETTINGS } from '../bass/src/audio/types';
import { applyPreset } from '../bass/src/audio/presets';
import { bassTenmonTrack } from './data/bass';

declare global {
  interface Window {
    __wavBase64?: string;
    __wavDone?: boolean;
    __wavError?: string;
  }
}

async function main() {
  const id = new URLSearchParams(location.search).get('track');
  if (!id) throw new Error('missing ?track= query param');

  const track = bassTenmonTrack(id);
  const settings = applyPreset(DEFAULT_SETTINGS, track.presetId);

  // Small tail so the last note's release/reverb isn't hard-cut, but short
  // enough that the exported WAV's total length stays within the album's
  // duration-lock tolerance versus the other 5 stems it will be mixed with.
  const buffer = await renderPerformance(track.events, settings, track.durationSec + 0.3);
  const blob = encodeWav(buffer);
  const arrayBuf = await blob.arrayBuffer();

  // base64-encode in chunks — spreading the whole Uint8Array into
  // String.fromCharCode at once blows the call stack for a ~3-minute WAV.
  const bytes = new Uint8Array(arrayBuf);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  window.__wavBase64 = btoa(binary);
  window.__wavDone = true;
}

main().catch((err) => {
  window.__wavError = String(err?.stack ?? err);
  window.__wavDone = true;
});
