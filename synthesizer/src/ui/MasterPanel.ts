/**
 * Akatsuki Synth — マスター／センドエフェクト設定パネル
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { createKnob, createSelect, createToggle, moduleBox } from './widgets';

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const dbFmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`;

const DIVISIONS = [
  { value: '2', text: '2拍' },
  { value: '1', text: '1拍' },
  { value: '0.75', text: '付点8分' },
  { value: '0.5', text: '8分' },
  { value: '0.3333', text: '3連8分' },
  { value: '0.25', text: '16分' },
];

export function buildMasterPanel(container: HTMLElement, engine: AudioEngine, onChange: () => void) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'synth-grid';
  container.appendChild(grid);

  const s = engine.settings;
  const apply = () => {
    engine.applySettings(s);
    onChange();
  };

  let reverbTimer: number | null = null;
  const applyReverb = () => {
    apply();
    if (reverbTimer) window.clearTimeout(reverbTimer);
    reverbTimer = window.setTimeout(() => engine.rebuildReverb(), 180);
  };

  // ---- マスター ----
  grid.appendChild(
    moduleBox(
      'MASTER',
      createKnob({ label: 'Volume', min: 0, max: 1.2, value: s.volume, format: pctFmt, onChange: (v) => { s.volume = v; apply(); } }),
      createKnob({ label: 'Drive', min: 0, max: 1, value: s.drive, format: pctFmt, onChange: (v) => { s.drive = v; apply(); } }),
      createKnob({ label: 'Comp', min: 0, max: 1, value: s.compress, format: pctFmt, onChange: (v) => { s.compress = v; apply(); } }),
      createToggle('Limiter', s.limiter, (v) => { s.limiter = v; apply(); })
    )
  );

  // ---- EQ ----
  grid.appendChild(
    moduleBox(
      'MASTER EQ',
      createKnob({ label: 'Low', min: -15, max: 15, bipolar: true, value: s.eqLow, format: dbFmt, onChange: (v) => { s.eqLow = v; apply(); } }),
      createKnob({ label: 'Mid', min: -15, max: 15, bipolar: true, value: s.eqMid, format: dbFmt, onChange: (v) => { s.eqMid = v; apply(); } }),
      createKnob({ label: 'Mid Freq', min: 200, max: 6000, curve: 'log', value: s.eqMidFreq, format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`), onChange: (v) => { s.eqMidFreq = v; apply(); } }),
      createKnob({ label: 'High', min: -15, max: 15, bipolar: true, value: s.eqHigh, format: dbFmt, onChange: (v) => { s.eqHigh = v; apply(); } })
    )
  );

  // ---- リバーブ ----
  grid.appendChild(
    moduleBox(
      'REVERB',
      createKnob({ label: 'Mix', min: 0, max: 1, value: s.reverb.mix, format: pctFmt, onChange: (v) => { s.reverb.mix = v; apply(); } }),
      createKnob({ label: 'Size', min: 0.3, max: 8, value: s.reverb.size, format: (v) => `${v.toFixed(1)}s`, onChange: (v) => { s.reverb.size = v; applyReverb(); } }),
      createKnob({ label: 'Damp', min: 0, max: 1, value: s.reverb.damp, format: pctFmt, onChange: (v) => { s.reverb.damp = v; applyReverb(); } }),
      createKnob({ label: 'Pre Dly', min: 0, max: 0.25, value: s.reverb.preDelay, format: (v) => `${Math.round(v * 1000)}ms`, onChange: (v) => { s.reverb.preDelay = v; apply(); } }),
      createKnob({ label: 'Width', min: 0, max: 1, value: s.reverb.width, format: pctFmt, onChange: (v) => { s.reverb.width = v; applyReverb(); } })
    )
  );

  // ---- ディレイ ----
  const timeKnob = createKnob({ label: 'Time', min: 0.02, max: 2, curve: 'log', value: s.delay.time, format: (v) => `${Math.round(v * 1000)}ms`, onChange: (v) => { s.delay.time = v; apply(); } });
  const divSel = createSelect('音符', DIVISIONS, String(s.delay.division), (v) => { s.delay.division = Number(v); apply(); });
  const syncRefresh = () => {
    timeKnob.style.display = s.delay.sync ? 'none' : '';
    divSel.style.display = s.delay.sync ? '' : 'none';
  };
  const delayBox = moduleBox(
    'DELAY',
    createKnob({ label: 'Mix', min: 0, max: 1, value: s.delay.mix, format: pctFmt, onChange: (v) => { s.delay.mix = v; apply(); } }),
    createToggle('Tempo Sync', s.delay.sync, (v) => { s.delay.sync = v; syncRefresh(); apply(); }),
    timeKnob,
    divSel,
    createKnob({ label: 'Feedback', min: 0, max: 0.92, value: s.delay.feedback, format: pctFmt, onChange: (v) => { s.delay.feedback = v; apply(); } }),
    createKnob({ label: 'Tone', min: 0, max: 1, value: s.delay.tone, format: pctFmt, onChange: (v) => { s.delay.tone = v; apply(); } }),
    createToggle('Ping Pong', s.delay.pingPong, (v) => { s.delay.pingPong = v; apply(); })
  );
  syncRefresh();
  grid.appendChild(delayBox);

  // ---- コーラス ----
  grid.appendChild(
    moduleBox(
      'CHORUS',
      createKnob({ label: 'Mix', min: 0, max: 1, value: s.chorus.mix, format: pctFmt, onChange: (v) => { s.chorus.mix = v; apply(); } }),
      createKnob({ label: 'Rate', min: 0.05, max: 5, curve: 'log', value: s.chorus.rate, format: (v) => `${v.toFixed(2)}Hz`, onChange: (v) => { s.chorus.rate = v; apply(); } }),
      createKnob({ label: 'Depth', min: 0, max: 1, value: s.chorus.depth, format: pctFmt, onChange: (v) => { s.chorus.depth = v; apply(); } }),
      createKnob({ label: 'Width', min: 0, max: 1, value: s.chorus.spread, format: pctFmt, onChange: (v) => { s.chorus.spread = v; apply(); } })
    )
  );

}
