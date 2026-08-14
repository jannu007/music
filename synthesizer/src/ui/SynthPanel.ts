/**
 * Akatsuki Synth — シンセ・パラメーターパネル
 */
import { createKnob, createSelect, createToggle, moduleBox } from './widgets';
import { createEnvelopeView, createFilterView } from './Visualizers';
import type {
  ArpParams, ArpMode, DrumType, Envelope, FilterModel, FilterType, LfoParams, LfoTarget, LfoWave,
  ModWheelTarget, OscParams, OscWave, Patch, SubWave, VoiceMode,
} from '../audio/types';

const WAVE_OPTIONS: { value: OscWave; text: string }[] = [
  { value: 'sawtooth', text: 'Saw' },
  { value: 'square', text: 'Square' },
  { value: 'pulse', text: 'Pulse' },
  { value: 'triangle', text: 'Triangle' },
  { value: 'sine', text: 'Sine' },
  { value: 'superSaw', text: 'Super Saw' },
  { value: 'noise', text: 'Noise' },
];

const SUB_WAVE_OPTIONS: { value: SubWave; text: string }[] = [
  { value: 'sine', text: 'Sine' },
  { value: 'triangle', text: 'Triangle' },
  { value: 'square', text: 'Square' },
];

const FILTER_TYPE_OPTIONS: { value: FilterType; text: string }[] = [
  { value: 'lowpass', text: 'Low Pass' },
  { value: 'highpass', text: 'High Pass' },
  { value: 'bandpass', text: 'Band Pass' },
  { value: 'notch', text: 'Notch' },
];

const FILTER_MODEL_OPTIONS: { value: FilterModel; text: string }[] = [
  { value: 'ladder', text: 'Ladder (太い)' },
  { value: 'svf', text: 'Clean SVF' },
];

const LFO_WAVE_OPTIONS: { value: LfoWave; text: string }[] = [
  { value: 'triangle', text: 'Triangle' },
  { value: 'sine', text: 'Sine' },
  { value: 'sawtooth', text: 'Saw' },
  { value: 'square', text: 'Square' },
  { value: 'sampleHold', text: 'S&H' },
];

const LFO_TARGET_OPTIONS: { value: LfoTarget; text: string }[] = [
  { value: 'none', text: 'Off' },
  { value: 'pitch', text: 'Pitch' },
  { value: 'osc2Pitch', text: 'OSC2 Pitch' },
  { value: 'pulseWidth', text: 'Pulse Width' },
  { value: 'filter', text: 'Cutoff' },
  { value: 'amp', text: 'Amp' },
  { value: 'pan', text: 'Pan' },
  { value: 'fm', text: 'FM Amount' },
];

const DIVISION_OPTIONS = [
  { value: '4', text: '1小節' },
  { value: '2', text: '2拍' },
  { value: '1', text: '1拍' },
  { value: '0.5', text: '1/2拍' },
  { value: '0.25', text: '1/4拍' },
  { value: '0.1667', text: '3連符' },
];

const VOICE_MODE_OPTIONS: { value: VoiceMode; text: string }[] = [
  { value: 'poly', text: 'Poly' },
  { value: 'mono', text: 'Mono' },
  { value: 'legato', text: 'Legato' },
];

const MOD_TARGET_OPTIONS: { value: ModWheelTarget; text: string }[] = [
  { value: 'none', text: 'Off' },
  { value: 'lfo1', text: 'LFO1 Depth' },
  { value: 'lfo2', text: 'LFO2 Depth' },
  { value: 'filter', text: 'Cutoff' },
];

const ARP_MODE_OPTIONS: { value: ArpMode; text: string }[] = [
  { value: 'up', text: 'Up' },
  { value: 'down', text: 'Down' },
  { value: 'updown', text: 'Up/Down' },
  { value: 'random', text: 'Random' },
  { value: 'order', text: 'Order' },
  { value: 'chord', text: 'Chord' },
];

const DRUM_OPTIONS: { value: DrumType; text: string }[] = [
  { value: 'kick', text: 'Kick (Analog)' },
  { value: 'kick2', text: 'Kick (808 Deep)' },
  { value: 'snare', text: 'Snare' },
  { value: 'rim', text: 'Rim Shot' },
  { value: 'clap', text: 'Hand Clap' },
  { value: 'hatClosed', text: 'Hi-Hat Closed' },
  { value: 'hatOpen', text: 'Hi-Hat Open' },
  { value: 'tomLow', text: 'Tom Low' },
  { value: 'tomMid', text: 'Tom Mid' },
  { value: 'tomHigh', text: 'Tom High' },
  { value: 'crash', text: 'Crash Cymbal' },
  { value: 'ride', text: 'Ride Cymbal' },
  { value: 'cowbell', text: 'Cowbell' },
  { value: 'shaker', text: 'Shaker' },
  { value: 'clave', text: 'Clave' },
];

const secFmt = (v: number) => (v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`);
const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const hzFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : `${Math.round(v)}Hz`);

export interface SynthPanelOptions {
  patch: Patch;
  arp: ArpParams;
  onChange: () => void;
  onArpChange: () => void;
  onPreviewDrum: () => void;
}

export function buildSynthPanel(container: HTMLElement, opts: SynthPanelOptions) {
  const { patch, arp } = opts;
  const change = () => opts.onChange();
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'synth-grid';
  container.appendChild(grid);

  if (patch.kind === 'drum') {
    buildDrumPanel(grid, opts);
    return;
  }

  // ------------------------------------------------------------ OSC
  const oscModule = (title: string, o: OscParams, showSpread: boolean) =>
    moduleBox(
      title,
      createSelect('波形', WAVE_OPTIONS, o.wave, (v) => {
        o.wave = v;
        change();
      }),
      createKnob({ label: 'Octave', min: -3, max: 3, step: 1, bipolar: true, value: o.octave, format: (v) => (v > 0 ? `+${v}` : `${v}`), onChange: (v) => { o.octave = v; change(); } }),
      createKnob({ label: 'Semi', min: -12, max: 12, step: 1, bipolar: true, value: o.semitone, format: (v) => (v > 0 ? `+${v}` : `${v}`), onChange: (v) => { o.semitone = v; change(); } }),
      createKnob({ label: 'Detune', min: -50, max: 50, bipolar: true, value: o.detune, format: (v) => `${v.toFixed(0)}c`, onChange: (v) => { o.detune = v; change(); } }),
      createKnob({ label: 'Level', min: 0, max: 1, value: o.level, format: pctFmt, onChange: (v) => { o.level = v; change(); } }),
      createKnob({ label: 'P.Width', min: 0.03, max: 0.97, value: o.pulseWidth, format: pctFmt, onChange: (v) => { o.pulseWidth = v; change(); } }),
      showSpread
        ? createKnob({ label: 'Spread', min: 0, max: 1, value: o.spread, format: pctFmt, onChange: (v) => { o.spread = v; change(); } })
        : null
    );

  grid.appendChild(oscModule('OSC 1', patch.osc1, true));
  grid.appendChild(oscModule('OSC 2', patch.osc2, true));

  // ------------------------------------------------------------ MIX
  grid.appendChild(
    moduleBox(
      'MIXER / MOD',
      createKnob({ label: 'OSC Mix', min: 0, max: 1, bipolar: true, value: patch.oscMix, format: (v) => (v < 0.5 ? `OSC1 ${Math.round((1 - v * 2) * 100)}%` : v > 0.5 ? `OSC2 ${Math.round((v - 0.5) * 200)}%` : 'CENTER'), onChange: (v) => { patch.oscMix = v; change(); } }),
      createKnob({ label: 'FM', min: 0, max: 1, value: patch.fmAmount, format: pctFmt, onChange: (v) => { patch.fmAmount = v; change(); } }),
      createSelect('SUB波形', SUB_WAVE_OPTIONS, patch.sub.wave, (v) => { patch.sub.wave = v; change(); }),
      createKnob({ label: 'Sub Lv', min: 0, max: 1, value: patch.sub.level, format: pctFmt, onChange: (v) => { patch.sub.level = v; change(); } }),
      createKnob({ label: 'Sub Oct', min: -2, max: -1, step: 1, value: patch.sub.octave, format: (v) => `${v}`, onChange: (v) => { patch.sub.octave = v === -2 ? -2 : -1; change(); } }),
      createSelect('Noise', [{ value: 'white', text: 'White' }, { value: 'pink', text: 'Pink' }] as const, patch.noise.type, (v) => { patch.noise.type = v; change(); }),
      createKnob({ label: 'Noise Lv', min: 0, max: 1, value: patch.noise.level, format: pctFmt, onChange: (v) => { patch.noise.level = v; change(); } }),
      createToggle('Ring Mod', patch.ringMod, (v) => { patch.ringMod = v; change(); }),
      createToggle('Osc Sync', patch.oscSync, (v) => { patch.oscSync = v; change(); })
    )
  );

  // ------------------------------------------------------------ FILTER
  const filterView = createFilterView(() => patch.filter);
  const filterChange = () => {
    filterView.update();
    change();
  };
  const filterModule = moduleBox(
    'FILTER',
    createSelect('モデル', FILTER_MODEL_OPTIONS, patch.filter.model, (v) => { patch.filter.model = v; filterChange(); }),
    createSelect('タイプ', FILTER_TYPE_OPTIONS, patch.filter.type, (v) => { patch.filter.type = v; filterChange(); }),
    createSelect('スロープ', [{ value: '12', text: '12 dB/oct' }, { value: '24', text: '24 dB/oct' }], String(patch.filter.slope), (v) => { patch.filter.slope = v === '24' ? 24 : 12; filterChange(); }),
    createKnob({ label: 'Cutoff', min: 20, max: 18000, curve: 'log', value: patch.filter.cutoff, format: hzFmt, onChange: (v) => { patch.filter.cutoff = v; filterChange(); } }),
    createKnob({ label: 'Reso', min: 0, max: 1, value: patch.filter.resonance, format: pctFmt, onChange: (v) => { patch.filter.resonance = v; filterChange(); } }),
    createKnob({ label: 'Drive', min: 0, max: 1, value: patch.filter.drive, format: pctFmt, onChange: (v) => { patch.filter.drive = v; change(); } }),
    createKnob({ label: 'EG Amt', min: -1, max: 1, bipolar: true, value: patch.filter.envAmount, format: pctFmt, onChange: (v) => { patch.filter.envAmount = v; change(); } }),
    createKnob({ label: 'Key Trk', min: 0, max: 1, value: patch.filter.keyTrack, format: pctFmt, onChange: (v) => { patch.filter.keyTrack = v; change(); } }),
    createKnob({ label: 'Vel→Cut', min: 0, max: 1, value: patch.filter.velAmount, format: pctFmt, onChange: (v) => { patch.filter.velAmount = v; change(); } })
  );
  filterModule.querySelector('.module-body')?.appendChild(filterView.element);
  grid.appendChild(filterModule);

  // ------------------------------------------------------------ EG
  const envModule = (title: string, e: Envelope) => {
    const view = createEnvelopeView(() => e);
    const upd = () => {
      view.update();
      change();
    };
    const box = moduleBox(
      title,
      createKnob({ label: 'Attack', min: 0.001, max: 6, curve: 'log', value: e.attack, format: secFmt, onChange: (v) => { e.attack = v; upd(); } }),
      createKnob({ label: 'Decay', min: 0.005, max: 8, curve: 'log', value: e.decay, format: secFmt, onChange: (v) => { e.decay = v; upd(); } }),
      createKnob({ label: 'Sustain', min: 0, max: 1, value: e.sustain, format: pctFmt, onChange: (v) => { e.sustain = v; upd(); } }),
      createKnob({ label: 'Release', min: 0.005, max: 10, curve: 'log', value: e.release, format: secFmt, onChange: (v) => { e.release = v; upd(); } })
    );
    box.querySelector('.module-body')?.appendChild(view.element);
    return box;
  };
  grid.appendChild(envModule('AMP EG', patch.ampEnv));
  grid.appendChild(envModule('FILTER EG', patch.filterEnv));

  // ------------------------------------------------------------ LFO
  const lfoModule = (title: string, l: LfoParams) => {
    const rateKnob = createKnob({ label: 'Rate', min: 0.02, max: 24, curve: 'log', value: l.rate, format: (v) => `${v.toFixed(2)}Hz`, onChange: (v) => { l.rate = v; change(); } });
    const divSelect = createSelect('同期', DIVISION_OPTIONS, String(l.division), (v) => { l.division = Number(v); change(); });
    const refresh = () => {
      rateKnob.style.display = l.sync ? 'none' : '';
      divSelect.style.display = l.sync ? '' : 'none';
    };
    const box = moduleBox(
      title,
      createSelect('波形', LFO_WAVE_OPTIONS, l.wave, (v) => { l.wave = v; change(); }),
      createSelect('変調先', LFO_TARGET_OPTIONS, l.target, (v) => { l.target = v; change(); }),
      createToggle('Tempo Sync', l.sync, (v) => { l.sync = v; refresh(); change(); }),
      rateKnob,
      divSelect,
      createKnob({ label: 'Amount', min: 0, max: 1, value: l.amount, format: pctFmt, onChange: (v) => { l.amount = v; change(); } }),
      createKnob({ label: 'Fade In', min: 0, max: 5, value: l.fade, format: secFmt, onChange: (v) => { l.fade = v; change(); } }),
      createToggle('Key Retrig', l.retrigger, (v) => { l.retrigger = v; change(); })
    );
    refresh();
    return box;
  };
  grid.appendChild(lfoModule('LFO 1', patch.lfo1));
  grid.appendChild(lfoModule('LFO 2', patch.lfo2));

  // ------------------------------------------------------------ VOICE
  grid.appendChild(
    moduleBox(
      'VOICE',
      createSelect('モード', VOICE_MODE_OPTIONS, patch.voiceMode, (v) => { patch.voiceMode = v; change(); }),
      createKnob({ label: 'Glide', min: 0, max: 2, value: patch.glide, format: secFmt, onChange: (v) => { patch.glide = v; change(); } }),
      createKnob({ label: 'Bend', min: 0, max: 24, step: 1, value: patch.bendRange, format: (v) => `±${v.toFixed(0)}`, onChange: (v) => { patch.bendRange = v; change(); } }),
      createKnob({ label: 'Vel→Amp', min: 0, max: 1, value: patch.velSens, format: pctFmt, onChange: (v) => { patch.velSens = v; change(); } }),
      createSelect('MOD Wheel', MOD_TARGET_OPTIONS, patch.modWheel.target, (v) => { patch.modWheel.target = v; change(); }),
      createKnob({ label: 'MOD Amt', min: 0, max: 1, value: patch.modWheel.amount, format: pctFmt, onChange: (v) => { patch.modWheel.amount = v; change(); } }),
      createKnob({ label: 'Volume', min: 0, max: 1, value: patch.volume, format: pctFmt, onChange: (v) => { patch.volume = v; change(); } }),
      createKnob({ label: 'Pan', min: -1, max: 1, bipolar: true, value: patch.pan, format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`), onChange: (v) => { patch.pan = v; change(); } })
    )
  );

  grid.appendChild(fxModule(patch, change));
  grid.appendChild(arpModule(arp, opts.onArpChange));
}

function fxModule(patch: Patch, change: () => void): HTMLElement {
  return moduleBox(
    'FX SEND',
    createKnob({ label: 'Drive', min: 0, max: 1, value: patch.fx.drive, format: pctFmt, onChange: (v) => { patch.fx.drive = v; change(); } }),
    createKnob({ label: 'Chorus', min: 0, max: 1, value: patch.fx.chorus, format: pctFmt, onChange: (v) => { patch.fx.chorus = v; change(); } }),
    createKnob({ label: 'Delay', min: 0, max: 1, value: patch.fx.delay, format: pctFmt, onChange: (v) => { patch.fx.delay = v; change(); } }),
    createKnob({ label: 'Reverb', min: 0, max: 1, value: patch.fx.reverb, format: pctFmt, onChange: (v) => { patch.fx.reverb = v; change(); } })
  );
}

function arpModule(arp: ArpParams, onArpChange: () => void): HTMLElement {
  return moduleBox(
    'ARPEGGIATOR',
    createToggle('ARP ON', arp.enabled, (v) => { arp.enabled = v; onArpChange(); }),
    createToggle('Latch', arp.latch, (v) => { arp.latch = v; onArpChange(); }),
    createSelect('モード', ARP_MODE_OPTIONS, arp.mode, (v) => { arp.mode = v as ArpMode; onArpChange(); }),
    createKnob({ label: 'Octaves', min: 1, max: 4, step: 1, value: arp.octaves, format: (v) => v.toFixed(0), onChange: (v) => { arp.octaves = v; onArpChange(); } }),
    createKnob({ label: 'Rate', min: 1, max: 8, step: 1, value: arp.rate, format: (v) => `${v.toFixed(0)}/拍`, onChange: (v) => { arp.rate = v; onArpChange(); } }),
    createKnob({ label: 'Gate', min: 0.05, max: 1, value: arp.gate, format: pctFmt, onChange: (v) => { arp.gate = v; onArpChange(); } }),
    createKnob({ label: 'Swing', min: 0, max: 1, value: arp.swing, format: pctFmt, onChange: (v) => { arp.swing = v; onArpChange(); } })
  );
}

function buildDrumPanel(grid: HTMLElement, opts: SynthPanelOptions) {
  const { patch } = opts;
  const change = () => opts.onChange();
  const d = patch.drum;

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'btn btn-accent drum-preview';
  preview.textContent = '▶ 試聴';
  preview.addEventListener('click', () => opts.onPreviewDrum());

  grid.appendChild(
    moduleBox(
      'DRUM VOICE',
      createSelect('音色', DRUM_OPTIONS, d.type, (v) => { d.type = v; change(); opts.onPreviewDrum(); }),
      createKnob({ label: 'Tune', min: -24, max: 24, step: 1, bipolar: true, value: d.tune, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`, onChange: (v) => { d.tune = v; change(); } }),
      createKnob({ label: 'Decay', min: 0.05, max: 4, curve: 'log', value: d.decay, format: (v) => `${v.toFixed(2)}x`, onChange: (v) => { d.decay = v; change(); } }),
      createKnob({ label: 'Tone', min: 0, max: 1, value: d.tone, format: pctFmt, onChange: (v) => { d.tone = v; change(); } }),
      createKnob({ label: 'Snap', min: 0, max: 1, value: d.snap, format: pctFmt, onChange: (v) => { d.snap = v; change(); } }),
      createKnob({ label: 'Drive', min: 0, max: 1, value: d.drive, format: pctFmt, onChange: (v) => { d.drive = v; change(); } }),
      createKnob({ label: 'Volume', min: 0, max: 1, value: patch.volume, format: pctFmt, onChange: (v) => { patch.volume = v; change(); } }),
      createKnob({ label: 'Pan', min: -1, max: 1, bipolar: true, value: patch.pan, format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`), onChange: (v) => { patch.pan = v; change(); } }),
      preview
    )
  );
  grid.appendChild(fxModule(patch, change));
  grid.appendChild(arpModule(opts.arp, opts.onArpChange));
}
