/**
 * Akatsuki Synth — シンセ・パラメーターパネル
 */
import { createKnob, createSelect, createToggle, moduleBox } from './widgets';
import { createEnvelopeView, createFilterView } from './Visualizers';
import { t } from './i18n';
import type {
  ArpParams, ArpMode, DrumType, Envelope, FilterModel, FilterType, LfoParams, LfoTarget, LfoWave,
  ModWheelTarget, OscParams, OscWave, Patch, SubWave, VoiceMode,
} from '../audio/types';

function waveOptions(): { value: OscWave; text: string }[] {
  return [
  { value: 'sawtooth', text: t('wave.saw') },
  { value: 'square', text: t('wave.square') },
  { value: 'pulse', text: t('wave.pulse') },
  { value: 'triangle', text: t('wave.triangle') },
  { value: 'sine', text: t('wave.sine') },
  { value: 'superSaw', text: t('wave.superSaw') },
  { value: 'noise', text: t('wave.noise') },
  ];
}

function subWaveOptions(): { value: SubWave; text: string }[] {
  return [
  { value: 'sine', text: t('wave.sine') },
  { value: 'triangle', text: t('wave.triangle') },
  { value: 'square', text: t('wave.square') },
  ];
}

function filterTypeOptions(): { value: FilterType; text: string }[] {
  return [
  { value: 'lowpass', text: t('filterType.lowpass') },
  { value: 'highpass', text: t('filterType.highpass') },
  { value: 'bandpass', text: t('filterType.bandpass') },
  { value: 'notch', text: t('filterType.notch') },
  ];
}

function filterModelOptions(): { value: FilterModel; text: string }[] {
  return [
    { value: 'ladder', text: t('filterModel.ladder') },
    { value: 'svf', text: 'Clean SVF' },
  ];
}

function lfoWaveOptions(): { value: LfoWave; text: string }[] {
  return [
  { value: 'triangle', text: t('wave.triangle') },
  { value: 'sine', text: t('wave.sine') },
  { value: 'sawtooth', text: t('wave.saw') },
  { value: 'square', text: t('wave.square') },
  { value: 'sampleHold', text: t('wave.sampleHold') },
  ];
}

function lfoTargetOptions(): { value: LfoTarget; text: string }[] {
  return [
  { value: 'none', text: t('lfoTarget.off') },
  { value: 'pitch', text: t('lfoTarget.pitch') },
  { value: 'osc2Pitch', text: t('lfoTarget.osc2Pitch') },
  { value: 'pulseWidth', text: t('lfoTarget.pulseWidth') },
  { value: 'filter', text: t('lfoTarget.cutoff') },
  { value: 'amp', text: t('lfoTarget.amp') },
  { value: 'pan', text: t('lfoTarget.pan') },
  { value: 'fm', text: t('lfoTarget.fmAmount') },
  ];
}

function divisionOptions() {
  return [
    { value: '4', text: t('lfoDiv.bar1') },
    { value: '2', text: t('lfoDiv.beat2') },
    { value: '1', text: t('lfoDiv.beat1') },
    { value: '0.5', text: t('lfoDiv.beat0_5') },
    { value: '0.25', text: t('lfoDiv.beat0_25') },
    { value: '0.1667', text: t('lfoDiv.triplet') },
  ];
}

function voiceModeOptions(): { value: VoiceMode; text: string }[] {
  return [
  { value: 'poly', text: t('voiceMode.poly') },
  { value: 'mono', text: t('voiceMode.mono') },
  { value: 'legato', text: t('voiceMode.legato') },
  ];
}

function modTargetOptions(): { value: ModWheelTarget; text: string }[] {
  return [
  { value: 'none', text: t('lfoTarget.off') },
  { value: 'lfo1', text: t('modTarget.lfo1Depth') },
  { value: 'lfo2', text: t('modTarget.lfo2Depth') },
  { value: 'filter', text: t('lfoTarget.cutoff') },
  ];
}

function arpModeOptions(): { value: ArpMode; text: string }[] {
  return [
  { value: 'up', text: t('arpMode.up') },
  { value: 'down', text: t('arpMode.down') },
  { value: 'updown', text: t('arpMode.updown') },
  { value: 'random', text: t('arpMode.random') },
  { value: 'order', text: t('arpMode.order') },
  { value: 'chord', text: t('arpMode.chord') },
  ];
}

function drumOptions(): { value: DrumType; text: string }[] {
  return [
  { value: 'kick', text: t('drumOpt.kickAnalog') },
  { value: 'kick2', text: t('drumOpt.kick808') },
  { value: 'snare', text: t('drumOpt.snare') },
  { value: 'rim', text: t('drumOpt.rim') },
  { value: 'clap', text: t('drumOpt.clap') },
  { value: 'hatClosed', text: t('drumOpt.hatClosed') },
  { value: 'hatOpen', text: t('drumOpt.hatOpen') },
  { value: 'tomLow', text: t('drumOpt.tomLow') },
  { value: 'tomMid', text: t('drumOpt.tomMid') },
  { value: 'tomHigh', text: t('drumOpt.tomHigh') },
  { value: 'crash', text: t('drumOpt.crash') },
  { value: 'ride', text: t('drumOpt.ride') },
  { value: 'cowbell', text: t('drumOpt.cowbell') },
  { value: 'shaker', text: t('drumOpt.shaker') },
  { value: 'clave', text: t('drumOpt.clave') },
  ];
}

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
      createSelect(t('ctl.waveform'), waveOptions(), o.wave, (v) => {
        o.wave = v;
        change();
      }),
      createKnob({ label: t('knob.octave'), min: -3, max: 3, step: 1, bipolar: true, value: o.octave, format: (v) => (v > 0 ? `+${v}` : `${v}`), onChange: (v) => { o.octave = v; change(); } }),
      createKnob({ label: t('knob.semi'), min: -12, max: 12, step: 1, bipolar: true, value: o.semitone, format: (v) => (v > 0 ? `+${v}` : `${v}`), onChange: (v) => { o.semitone = v; change(); } }),
      createKnob({ label: t('knob.detune'), min: -50, max: 50, bipolar: true, value: o.detune, format: (v) => `${v.toFixed(0)}c`, onChange: (v) => { o.detune = v; change(); } }),
      createKnob({ label: t('knob.level'), min: 0, max: 1, value: o.level, format: pctFmt, onChange: (v) => { o.level = v; change(); } }),
      createKnob({ label: t('knob.pulseWidth'), min: 0.03, max: 0.97, value: o.pulseWidth, format: pctFmt, onChange: (v) => { o.pulseWidth = v; change(); } }),
      showSpread
        ? createKnob({ label: t('knob.spread'), min: 0, max: 1, value: o.spread, format: pctFmt, onChange: (v) => { o.spread = v; change(); } })
        : null
    );

  grid.appendChild(oscModule('OSC 1', patch.osc1, true));
  grid.appendChild(oscModule('OSC 2', patch.osc2, true));

  // ------------------------------------------------------------ MIX
  grid.appendChild(
    moduleBox(
      t('module.mixerMod'),
      createKnob({ label: t('knob.oscMix'), min: 0, max: 1, bipolar: true, value: patch.oscMix, format: (v) => (v < 0.5 ? `OSC1 ${Math.round((1 - v * 2) * 100)}%` : v > 0.5 ? `OSC2 ${Math.round((v - 0.5) * 200)}%` : 'CENTER'), onChange: (v) => { patch.oscMix = v; change(); } }),
      createKnob({ label: t('knob.fm'), min: 0, max: 1, value: patch.fmAmount, format: pctFmt, onChange: (v) => { patch.fmAmount = v; change(); } }),
      createSelect(t('ctl.subWaveform'), subWaveOptions(), patch.sub.wave, (v) => { patch.sub.wave = v; change(); }),
      createKnob({ label: t('knob.subLevel'), min: 0, max: 1, value: patch.sub.level, format: pctFmt, onChange: (v) => { patch.sub.level = v; change(); } }),
      createKnob({ label: t('knob.subOctave'), min: -2, max: -1, step: 1, value: patch.sub.octave, format: (v) => `${v}`, onChange: (v) => { patch.sub.octave = v === -2 ? -2 : -1; change(); } }),
      createSelect(t('ctl.noiseType'), [{ value: 'white', text: t('noiseType.white') }, { value: 'pink', text: t('noiseType.pink') }] as const, patch.noise.type, (v) => { patch.noise.type = v; change(); }),
      createKnob({ label: t('knob.noiseLevel'), min: 0, max: 1, value: patch.noise.level, format: pctFmt, onChange: (v) => { patch.noise.level = v; change(); } }),
      createToggle(t('toggle.ringMod'), patch.ringMod, (v) => { patch.ringMod = v; change(); }),
      createToggle(t('toggle.oscSync'), patch.oscSync, (v) => { patch.oscSync = v; change(); })
    )
  );

  // ------------------------------------------------------------ FILTER
  const filterView = createFilterView(() => patch.filter);
  const filterChange = () => {
    filterView.update();
    change();
  };
  const filterModule = moduleBox(
    t('module.filter'),
    createSelect(t('ctl.filterModel'), filterModelOptions(), patch.filter.model, (v) => { patch.filter.model = v; filterChange(); }),
    createSelect(t('ctl.filterType'), filterTypeOptions(), patch.filter.type, (v) => { patch.filter.type = v; filterChange(); }),
    createSelect(t('ctl.slope'), [{ value: '12', text: '12 dB/oct' }, { value: '24', text: '24 dB/oct' }], String(patch.filter.slope), (v) => { patch.filter.slope = v === '24' ? 24 : 12; filterChange(); }),
    createKnob({ label: t('knob.cutoff'), min: 20, max: 18000, curve: 'log', value: patch.filter.cutoff, format: hzFmt, onChange: (v) => { patch.filter.cutoff = v; filterChange(); } }),
    createKnob({ label: t('knob.reso'), min: 0, max: 1, value: patch.filter.resonance, format: pctFmt, onChange: (v) => { patch.filter.resonance = v; filterChange(); } }),
    createKnob({ label: t('knob.drive'), min: 0, max: 1, value: patch.filter.drive, format: pctFmt, onChange: (v) => { patch.filter.drive = v; change(); } }),
    createKnob({ label: t('knob.egAmount'), min: -1, max: 1, bipolar: true, value: patch.filter.envAmount, format: pctFmt, onChange: (v) => { patch.filter.envAmount = v; change(); } }),
    createKnob({ label: t('knob.keyTrack'), min: 0, max: 1, value: patch.filter.keyTrack, format: pctFmt, onChange: (v) => { patch.filter.keyTrack = v; change(); } }),
    createKnob({ label: t('knob.velToCut'), min: 0, max: 1, value: patch.filter.velAmount, format: pctFmt, onChange: (v) => { patch.filter.velAmount = v; change(); } })
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
      createKnob({ label: t('knob.attack'), min: 0.001, max: 6, curve: 'log', value: e.attack, format: secFmt, onChange: (v) => { e.attack = v; upd(); } }),
      createKnob({ label: t('knob.decay'), min: 0.005, max: 8, curve: 'log', value: e.decay, format: secFmt, onChange: (v) => { e.decay = v; upd(); } }),
      createKnob({ label: t('knob.sustain'), min: 0, max: 1, value: e.sustain, format: pctFmt, onChange: (v) => { e.sustain = v; upd(); } }),
      createKnob({ label: t('knob.release'), min: 0.005, max: 10, curve: 'log', value: e.release, format: secFmt, onChange: (v) => { e.release = v; upd(); } })
    );
    box.querySelector('.module-body')?.appendChild(view.element);
    return box;
  };
  grid.appendChild(envModule(t('module.ampEg'), patch.ampEnv));
  grid.appendChild(envModule(t('module.filterEg'), patch.filterEnv));

  // ------------------------------------------------------------ LFO
  const lfoModule = (title: string, l: LfoParams) => {
    const rateKnob = createKnob({ label: t('knob.rate'), min: 0.02, max: 24, curve: 'log', value: l.rate, format: (v) => `${v.toFixed(2)}Hz`, onChange: (v) => { l.rate = v; change(); } });
    const divSelect = createSelect(t('ctl.sync'), divisionOptions(), String(l.division), (v) => { l.division = Number(v); change(); });
    const refresh = () => {
      rateKnob.style.display = l.sync ? 'none' : '';
      divSelect.style.display = l.sync ? '' : 'none';
    };
    const box = moduleBox(
      title,
      createSelect(t('ctl.waveform'), lfoWaveOptions(), l.wave, (v) => { l.wave = v; change(); }),
      createSelect(t('ctl.modTarget'), lfoTargetOptions(), l.target, (v) => { l.target = v; change(); }),
      createToggle(t('toggle.tempoSync'), l.sync, (v) => { l.sync = v; refresh(); change(); }),
      rateKnob,
      divSelect,
      createKnob({ label: t('knob.amount'), min: 0, max: 1, value: l.amount, format: pctFmt, onChange: (v) => { l.amount = v; change(); } }),
      createKnob({ label: t('knob.fadeIn'), min: 0, max: 5, value: l.fade, format: secFmt, onChange: (v) => { l.fade = v; change(); } }),
      createToggle(t('toggle.keyRetrig'), l.retrigger, (v) => { l.retrigger = v; change(); })
    );
    refresh();
    return box;
  };
  grid.appendChild(lfoModule('LFO 1', patch.lfo1));
  grid.appendChild(lfoModule('LFO 2', patch.lfo2));

  // ------------------------------------------------------------ VOICE
  grid.appendChild(
    moduleBox(
      t('module.voice'),
      createSelect(t('ctl.voiceMode'), voiceModeOptions(), patch.voiceMode, (v) => { patch.voiceMode = v; change(); }),
      createKnob({ label: t('knob.glide'), min: 0, max: 2, value: patch.glide, format: secFmt, onChange: (v) => { patch.glide = v; change(); } }),
      createKnob({ label: t('knob.bend'), min: 0, max: 24, step: 1, value: patch.bendRange, format: (v) => `±${v.toFixed(0)}`, onChange: (v) => { patch.bendRange = v; change(); } }),
      createKnob({ label: t('knob.velToAmp'), min: 0, max: 1, value: patch.velSens, format: pctFmt, onChange: (v) => { patch.velSens = v; change(); } }),
      createSelect(t('ctl.modWheel'), modTargetOptions(), patch.modWheel.target, (v) => { patch.modWheel.target = v; change(); }),
      createKnob({ label: t('knob.modAmount'), min: 0, max: 1, value: patch.modWheel.amount, format: pctFmt, onChange: (v) => { patch.modWheel.amount = v; change(); } }),
      createKnob({ label: t('knob.volume'), min: 0, max: 1, value: patch.volume, format: pctFmt, onChange: (v) => { patch.volume = v; change(); } }),
      createKnob({ label: t('knob.pan'), min: -1, max: 1, bipolar: true, value: patch.pan, format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`), onChange: (v) => { patch.pan = v; change(); } })
    )
  );

  grid.appendChild(fxModule(patch, change));
  grid.appendChild(arpModule(arp, opts.onArpChange));
}

function fxModule(patch: Patch, change: () => void): HTMLElement {
  return moduleBox(
    t('module.fxSend'),
    createKnob({ label: t('knob.drive'), min: 0, max: 1, value: patch.fx.drive, format: pctFmt, onChange: (v) => { patch.fx.drive = v; change(); } }),
    createKnob({ label: t('knob.chorus'), min: 0, max: 1, value: patch.fx.chorus, format: pctFmt, onChange: (v) => { patch.fx.chorus = v; change(); } }),
    createKnob({ label: t('knob.delay'), min: 0, max: 1, value: patch.fx.delay, format: pctFmt, onChange: (v) => { patch.fx.delay = v; change(); } }),
    createKnob({ label: t('knob.reverb'), min: 0, max: 1, value: patch.fx.reverb, format: pctFmt, onChange: (v) => { patch.fx.reverb = v; change(); } })
  );
}

function arpModule(arp: ArpParams, onArpChange: () => void): HTMLElement {
  return moduleBox(
    t('module.arp'),
    createToggle(t('toggle.arpOn'), arp.enabled, (v) => { arp.enabled = v; onArpChange(); }),
    createToggle(t('toggle.latch'), arp.latch, (v) => { arp.latch = v; onArpChange(); }),
    createSelect(t('ctl.arpMode'), arpModeOptions(), arp.mode, (v) => { arp.mode = v as ArpMode; onArpChange(); }),
    createKnob({ label: t('knob.octaves'), min: 1, max: 4, step: 1, value: arp.octaves, format: (v) => v.toFixed(0), onChange: (v) => { arp.octaves = v; onArpChange(); } }),
    createKnob({ label: t('knob.rate'), min: 1, max: 8, step: 1, value: arp.rate, format: (v) => `${v.toFixed(0)}${t('unit.perBeat')}`, onChange: (v) => { arp.rate = v; onArpChange(); } }),
    createKnob({ label: t('knob.gate'), min: 0.05, max: 1, value: arp.gate, format: pctFmt, onChange: (v) => { arp.gate = v; onArpChange(); } }),
    createKnob({ label: t('knob.swing'), min: 0, max: 1, value: arp.swing, format: pctFmt, onChange: (v) => { arp.swing = v; onArpChange(); } })
  );
}

function buildDrumPanel(grid: HTMLElement, opts: SynthPanelOptions) {
  const { patch } = opts;
  const change = () => opts.onChange();
  const d = patch.drum;

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'btn btn-accent drum-preview';
  preview.textContent = t('drum.preview');
  preview.addEventListener('click', () => opts.onPreviewDrum());

  grid.appendChild(
    moduleBox(
      t('module.drumVoiceGroup'),
      createSelect(t('ctl.drumVoice'), drumOptions(), d.type, (v) => { d.type = v; change(); opts.onPreviewDrum(); }),
      createKnob({ label: t('knob.tune'), min: -24, max: 24, step: 1, bipolar: true, value: d.tune, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`, onChange: (v) => { d.tune = v; change(); } }),
      createKnob({ label: t('knob.decay'), min: 0.05, max: 4, curve: 'log', value: d.decay, format: (v) => `${v.toFixed(2)}x`, onChange: (v) => { d.decay = v; change(); } }),
      createKnob({ label: t('knob.tone'), min: 0, max: 1, value: d.tone, format: pctFmt, onChange: (v) => { d.tone = v; change(); } }),
      createKnob({ label: t('knob.snap'), min: 0, max: 1, value: d.snap, format: pctFmt, onChange: (v) => { d.snap = v; change(); } }),
      createKnob({ label: t('knob.drive'), min: 0, max: 1, value: d.drive, format: pctFmt, onChange: (v) => { d.drive = v; change(); } }),
      createKnob({ label: t('knob.volume'), min: 0, max: 1, value: patch.volume, format: pctFmt, onChange: (v) => { patch.volume = v; change(); } }),
      createKnob({ label: t('knob.pan'), min: -1, max: 1, bipolar: true, value: patch.pan, format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`), onChange: (v) => { patch.pan = v; change(); } }),
      preview
    )
  );
  grid.appendChild(fxModule(patch, change));
  grid.appendChild(arpModule(opts.arp, opts.onArpChange));
}
