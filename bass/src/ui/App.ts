import { BassEngine, renderPerformance } from '../audio/BassEngine';
import {
  MAX_FRET,
  TUNINGS,
  findPosition,
  findTuning,
  harmonicRatio,
  pitchClass,
  positionFrequency,
  positionNote,
} from '../audio/fretboard';
import { COMPUTER_KEY_MAP, MidiInput } from '../audio/midi';
import { PRESETS, applyPreset } from '../audio/presets';
import {
  Player,
  Recorder,
  downloadBlob,
  encodeMidi,
  encodeWav,
  timestampName,
} from '../audio/recorder';
import { CABS, ROOMS } from '../audio/reverb';
import {
  DEFAULT_SETTINGS,
  type BassSettings,
  type CabType,
  type PerformanceEvent,
  type ReverbType,
  type Technique,
} from '../audio/types';
import { DEMOS } from '../data/demos';
import { Fretboard, type LabelMode } from './Fretboard';
import { PATTERNS, Rhythm } from './Rhythm';
import { button, el, segmented, select, slider, switchRow } from './controls';
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

const STORAGE_KEY = 'kurogane-bass-v1';

const TECHNIQUE_VALUES: Technique[] = ['finger', 'pick', 'slap', 'pop', 'mute', 'ghost', 'harmonic'];

interface UiState {
  presetId: string;
  technique: Technique;
  labelMode: LabelMode;
  startFret: number;
  fretCount: number;
  letRing: boolean;
  baseVelocity: number;
  rootPitch: number;
  bpm: number;
  rhythmId: string;
  rhythmVolume: number;
  useDemoPreset: boolean;
}

const DEFAULT_UI: UiState = {
  presetId: 'modern',
  technique: 'finger',
  labelMode: 'all',
  startFret: 0,
  fretCount: 12,
  letRing: true,
  baseVelocity: 0.78,
  rootPitch: -1,
  bpm: 96,
  rhythmId: 'click',
  rhythmVolume: 0.7,
  useDemoPreset: true,
};

export class BassApp {
  private root: HTMLElement;
  private engine = new BassEngine();
  private fretboard!: Fretboard;
  private recorder = new Recorder();
  private player!: Player;
  private rhythm = new Rhythm();
  private midi: MidiInput | null = null;

  private settings: BassSettings = { ...DEFAULT_SETTINGS };
  private ui: UiState = { ...DEFAULT_UI };

  /** 弦ごとに、いま押さえているフレット */
  private held: number[] = [];
  /** PCキーで押している弦とフレット */
  private heldKeys = new Map<string, { str: number; fret: number }>();
  /** MIDIノート → 弦 */
  private midiNotes = new Map<number, number>();
  private accent = false;

  private lastSequence: { events: PerformanceEvent[]; name: string } | null = null;
  private demoRestore: { settings: BassSettings; presetId: string; technique: Technique; snapshot: string } | null = null;
  private exporting = false;

  private statusEl!: HTMLElement;
  private transportEl!: HTMLElement;
  private nowPlayingEl!: HTMLElement;
  private meterFill!: HTMLElement;
  private panelBody!: HTMLElement;
  private positionLabel!: HTMLElement;
  private techButtons: HTMLButtonElement[] = [];
  private tabButtons: HTMLButtonElement[] = [];
  private activeTab = 'tone';
  private recordButton!: HTMLButtonElement;
  private audioReady = false;
  private initPromise: Promise<void> | null = null;
  private globalListenersBound = false;

  constructor(root: HTMLElement) {
    this.root = root;
    document.documentElement.lang = getLocale();
    onLocaleChange(() => this.build());
    this.load();
    this.player = new Player(this.engine);
    this.build();
    this.bindGlobalKeys();
    this.startMeterLoop();
  }

  // ------------------------------------------------------------ persistence

  private load() {
    // 画面が狭いときは表示するフレット数を減らす（指板が細かすぎると押せないため）
    const width = window.innerWidth;
    if (width < 620) this.ui.fretCount = 6;
    else if (width < 1000) this.ui.fretCount = 9;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.settings) this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (data.ui) this.ui = { ...DEFAULT_UI, ...data.ui };
    } catch {
      /* 壊れた保存データは無視して初期値で起動する */
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: this.settings, ui: this.ui }));
    } catch {
      /* プライベートモードなどで保存できない場合は無視 */
    }
  }

  private commit() {
    this.engine.updateSettings(this.settings);
    this.save();
  }

  private get tuning(): number[] {
    return findTuning(this.settings.tuningId).notes;
  }

  // ------------------------------------------------------------------ audio

  private async ensureAudio(): Promise<void> {
    if (this.audioReady) return;
    if (!this.initPromise) {
      this.initPromise = this.engine
        .init()
        .then(() => {
          this.audioReady = true;
          this.engine.updateSettings(this.settings);
          this.rhythm.attach(this.engine);
          this.rhythm.setBpm(this.ui.bpm);
          this.rhythm.setPattern(this.ui.rhythmId);
          this.rhythm.setVolume(this.ui.rhythmVolume);
          this.setStatus();
        })
        .catch((err) => {
          this.initPromise = null;
          this.setStatus(t('status.audioError', { err: String(err) }));
          throw err;
        });
    }
    return this.initPromise;
  }

  // --------------------------------------------------------------- playing

  private pluck(str: number, fret: number, velocity: number, technique?: Technique) {
    const tech = technique ?? this.ui.technique;
    const tuning = this.tuning;
    if (str < 0 || str >= tuning.length) return;
    const clampedFret = Math.max(0, Math.min(MAX_FRET, fret));

    // ハーモニクスは指定フレットで倍音が出る位置のみ有効
    const isHarmonic = tech === 'harmonic' && harmonicRatio(clampedFret) !== null;
    const freq = positionFrequency(tuning, str, clampedFret, this.settings.a4, isHarmonic);
    const note = positionNote(tuning, str, clampedFret, isHarmonic);
    let vel = velocity * this.ui.baseVelocity;
    if (this.accent) vel = Math.min(1, vel * 1.3);
    vel = Math.max(0.05, Math.min(1, vel));

    this.held[str] = clampedFret;
    this.fretboard.showPluck(str, clampedFret, vel);

    void this.ensureAudio().then(() => {
      this.engine.pluck(str, freq, vel, tech, clampedFret);
      this.recorder.capture(
        { type: 'pluck', str, fret: clampedFret, note, freq, vel, tech },
        this.engine.now
      );
    });
  }

  private slide(str: number, fret: number) {
    const tuning = this.tuning;
    if (str < 0 || str >= tuning.length) return;
    const clampedFret = Math.max(0, Math.min(MAX_FRET, fret));
    const freq = positionFrequency(tuning, str, clampedFret, this.settings.a4);
    const note = positionNote(tuning, str, clampedFret);
    this.held[str] = clampedFret;
    this.fretboard.showSlide(str, clampedFret);

    void this.ensureAudio().then(() => {
      this.engine.slide(str, freq, clampedFret);
      this.recorder.capture(
        { type: 'slide', str, fret: clampedFret, note, freq, glide: this.settings.glide },
        this.engine.now
      );
    });
  }

  private bend(str: number, cents: number) {
    const tuning = this.tuning;
    if (str < 0 || str >= tuning.length) return;
    const fret = this.held[str] ?? 0;
    const base = positionFrequency(tuning, str, fret, this.settings.a4);
    const freq = base * Math.pow(2, cents / 1200);
    const note = positionNote(tuning, str, fret);
    if (!this.audioReady) return;
    this.engine.bend(str, freq);
    this.recorder.capture({ type: 'bend', str, note, freq, cents }, this.engine.now);
  }

  private mute(str: number) {
    this.fretboard.showMute(str);
    if (!this.audioReady) return;
    this.engine.mute(str, 1);
    this.recorder.capture({ type: 'mute', str, amount: 1 }, this.engine.now);
  }

  private muteAll() {
    for (let i = 0; i < this.tuning.length; i++) this.fretboard.showMute(i);
    if (!this.audioReady) return;
    this.engine.muteAll();
    this.recorder.capture({ type: 'muteAll' }, this.engine.now);
  }

  // ------------------------------------------------------------------- view

  private build() {
    this.root.innerHTML = '';
    const app = el('div', 'bass-app');

    // ---------- ヘッダー ----------
    const header = el('header', 'topbar');
    const brand = el('div', 'brand');
    brand.innerHTML = `
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-text">
        <strong>Kurogane Bass</strong>
        <small>${t('brand.subtitle')}</small>
      </span>`;

    const presetSelect = el('select', 'preset-select');
    presetSelect.setAttribute('aria-label', t('preset.ariaLabel'));
    for (const preset of PRESETS) {
      const option = el('option', undefined, t(`preset.${preset.id}.name`));
      option.value = preset.id;
      presetSelect.append(option);
    }
    presetSelect.value = this.ui.presetId;
    presetSelect.addEventListener('change', () => this.selectPreset(presetSelect.value));

    this.statusEl = el('div', 'status');

    const panicButton = button('', 'ghost panic-btn', () => this.panic());
    panicButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.7" />'
      + '<rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" />'
      + `</svg><span class="btn-text">${t('panic.label')}</span>`;
    panicButton.title = t('panic.title');
    panicButton.setAttribute('aria-label', t('panic.ariaLabel'));

    const langButton = button(t('lang.toggle'), 'ghost round lang-btn', () => toggleLocale());

    const headerActions = el('div', 'header-actions');
    headerActions.append(langButton, panicButton, button(t('help.button'), 'ghost round', () => this.toggleHelp()));
    header.append(brand, presetSelect, this.statusEl, headerActions);

    // ---------- 指板 ----------
    const stage = el('section', 'stage');
    const canvas = el('canvas', 'fret-canvas');
    canvas.setAttribute('aria-label', t('fretboard.ariaLabel'));
    stage.append(canvas);

    const overlay = el('div', 'stage-overlay');
    this.nowPlayingEl = el('div', 'now-playing');
    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);
    this.transportEl = el('div', 'transport-readout', '00:00');
    overlay.append(this.nowPlayingEl, this.transportEl, meter);
    stage.append(overlay);

    // ---------- 奏法バー ----------
    const playBar = el('div', 'play-bar');
    const techWrap = el('div', 'tech-row');
    this.techButtons = [];
    for (const value of TECHNIQUE_VALUES) {
      const btn = button(t(`technique.${value}.label`), 'tech-btn', () => this.setTechnique(value));
      btn.dataset.tech = value;
      btn.title = t(`technique.${value}.hint`);
      if (value === this.ui.technique) btn.classList.add('active');
      this.techButtons.push(btn);
      techWrap.append(btn);
    }

    const posWrap = el('div', 'position-row');
    this.positionLabel = el('span', 'position-label');
    posWrap.append(
      button('◀', 'ghost small', () => this.shiftPosition(-1)),
      this.positionLabel,
      button('▶', 'ghost small', () => this.shiftPosition(1)),
      button(t('position.muteAll'), 'ghost small', () => this.muteAll())
    );
    playBar.append(techWrap, posWrap);

    // ---------- パネル ----------
    const panel = el('section', 'panel');
    const tabs = el('nav', 'tabs');
    const tabDefs = [
      { id: 'tone', label: t('tab.tone') },
      { id: 'amp', label: t('tab.amp') },
      { id: 'play', label: t('tab.play') },
      { id: 'rec', label: t('tab.rec') },
      { id: 'demo', label: t('tab.demo') },
    ];
    this.tabButtons = [];
    for (const def of tabDefs) {
      const btn = el('button', 'tab', def.label);
      btn.type = 'button';
      btn.dataset.tab = def.id;
      if (def.id === this.activeTab) btn.classList.add('active');
      btn.addEventListener('click', () => this.showTab(def.id));
      this.tabButtons.push(btn);
      tabs.append(btn);
    }
    this.panelBody = el('div', 'panel-body');
    panel.append(tabs, this.panelBody);

    const main = el('main', 'main-area');
    const left = el('div', 'stage-column');
    left.append(stage, playBar);
    main.append(left, panel);

    app.append(header, main);
    this.root.append(app);

    // ---------- 指板の生成 ----------
    this.fretboard = new Fretboard(canvas, {
      onPluck: (str, fret, velocity) => this.pluck(str, fret, velocity),
      onSlide: (str, fret) => this.slide(str, fret),
      onBend: (str, cents) => this.bend(str, cents),
      onRelease: (str) => {
        if (!this.ui.letRing) this.mute(str);
      },
    });
    this.applyInstrument();
    this.fretboard.start();

    this.showTab(this.activeTab);
    this.updatePositionLabel();
    this.setStatus();

    // 最初の操作でオーディオを起動する（ブラウザの自動再生制限対策）
    const kick = () => void this.ensureAudio().catch(() => {});
    app.addEventListener('pointerdown', kick, { once: true });
    if (!this.globalListenersBound) {
      this.globalListenersBound = true;
      window.addEventListener('keydown', kick, { once: true });
    }
  }

  /** チューニングや表示範囲を指板へ反映する */
  private applyInstrument() {
    const tuning = this.tuning;
    this.held = new Array(tuning.length).fill(0);
    this.fretboard.setTuning(tuning);
    this.fretboard.setRange(this.ui.startFret, this.ui.fretCount);
    this.fretboard.setLabels(this.ui.labelMode);
    this.fretboard.setRoot(this.ui.rootPitch);
    this.fretboard.setFretless(this.settings.fretless);
    this.fretboard.resize();
    this.settings.stringCount = tuning.length;
  }

  private setStatus(message?: string) {
    if (message) {
      this.statusEl.textContent = message;
      return;
    }
    const parts: string[] = [];
    parts.push(this.audioReady ? t('status.ready') : t('status.tapToStart'));
    const tuning = findTuning(this.settings.tuningId);
    parts.push(t(`tuning.${tuning.id}.name`));
    if (this.midi && this.midi.devices.length > 0) parts.push(t('status.midi', { devices: this.midi.devices.join(', ') }));
    this.statusEl.textContent = parts.join(' ・ ');
  }

  private setTechnique(tech: Technique) {
    this.ui.technique = tech;
    for (const btn of this.techButtons) btn.classList.toggle('active', btn.dataset.tech === tech);
    this.save();
  }

  private shiftPosition(delta: number) {
    const next = Math.max(0, Math.min(MAX_FRET - this.ui.fretCount, this.ui.startFret + delta * 3));
    this.ui.startFret = next;
    this.fretboard.setRange(next, this.ui.fretCount);
    this.updatePositionLabel();
    this.save();
  }

  private updatePositionLabel() {
    const [start, count] = this.fretboard.getRange();
    const first = start === 0 ? 0 : start;
    const last = start === 0 ? count : start + count - 1;
    this.positionLabel.textContent = t('position.range', { first, last });
  }

  private showTab(id: string) {
    this.activeTab = id;
    for (const btn of this.tabButtons) btn.classList.toggle('active', btn.dataset.tab === id);
    this.panelBody.innerHTML = '';
    switch (id) {
      case 'tone': this.buildToneTab(); break;
      case 'amp': this.buildAmpTab(); break;
      case 'play': this.buildPlayTab(); break;
      case 'rec': this.buildRecordTab(); break;
      case 'demo': this.buildDemoTab(); break;
    }
  }

  // ------------------------------------------------------------------- tabs

  private buildToneTab() {
    const body = this.panelBody;

    const grid = el('div', 'preset-grid');
    for (const preset of PRESETS) {
      const card = el('button', 'preset-card');
      card.type = 'button';
      if (preset.id === this.ui.presetId) card.classList.add('active');
      card.append(el('strong', undefined, t(`preset.${preset.id}.name`)), el('span', undefined, t(`preset.${preset.id}.description`)));
      card.addEventListener('click', () => {
        this.selectPreset(preset.id);
        this.showTab('tone');
      });
      grid.append(card);
    }
    body.append(el('h2', 'panel-title', t('panel.tonePresets')), grid);

    const strings = el('div', 'ctl-grid');
    strings.append(
      slider({
        label: t('ctl.brightness.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.brightness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.brightness.hint'),
        onInput: (v) => { this.settings.brightness = v; this.commit(); },
      }),
      slider({
        label: t('ctl.sustain.label'),
        min: 0.4, max: 1.7, step: 0.01, value: this.settings.sustain,
        format: (v) => `${v.toFixed(2)}×`,
        onInput: (v) => { this.settings.sustain = v; this.commit(); },
      }),
      slider({
        label: t('ctl.stiffness.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.stiffness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.stiffness.hint'),
        onInput: (v) => { this.settings.stiffness = v; this.commit(); },
      }),
      slider({
        label: t('ctl.buzz.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.buzz,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.buzz.hint'),
        onInput: (v) => { this.settings.buzz = v; this.commit(); },
      }),
      slider({
        label: t('ctl.pluckPos.label'),
        min: -1, max: 1, step: 0.01, value: this.settings.pluckPos,
        format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
        hint: t('ctl.pluckPos.hint'),
        onInput: (v) => { this.settings.pluckPos = v; this.commit(); },
      }),
      slider({
        label: t('ctl.noise.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.noise,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.noise.hint'),
        onInput: (v) => { this.settings.noise = v; this.commit(); },
      }),
      slider({
        label: t('ctl.beat.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.beat,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.beat.hint'),
        onInput: (v) => { this.settings.beat = v; this.commit(); },
      }),
      slider({
        label: t('ctl.sympathetic.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.sympathetic,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.sympathetic.hint'),
        onInput: (v) => { this.settings.sympathetic = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.strings')), strings);

    const pickups = el('div', 'ctl-grid');
    pickups.append(
      slider({
        label: t('ctl.pickupBlend.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.pickupBlend,
        format: (v) => (v < 0.05 ? t('pickup.front') : v > 0.95 ? t('pickup.rear') : `F ${Math.round((1 - v) * 100)} : R ${Math.round(v * 100)}`),
        hint: t('ctl.pickupBlend.hint'),
        onInput: (v) => { this.settings.pickupBlend = v; this.commit(); },
      }),
      slider({
        label: t('ctl.pickupTone.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.pickupTone,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.pickupTone.hint'),
        onInput: (v) => { this.settings.pickupTone = v; this.commit(); },
      }),
      slider({
        label: t('ctl.pickupNeck.label'),
        min: 0.18, max: 0.42, step: 0.005, value: this.settings.pickupNeck,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: t('ctl.pickupNeck.hint'),
        onInput: (v) => { this.settings.pickupNeck = v; this.commit(); },
      }),
      slider({
        label: t('ctl.pickupBridge.label'),
        min: 0.05, max: 0.22, step: 0.005, value: this.settings.pickupBridge,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { this.settings.pickupBridge = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.pickups')), pickups);
  }

  private buildAmpTab() {
    const body = this.panelBody;
    const amp = el('div', 'ctl-grid');

    amp.append(
      slider({
        label: t('ctl.drive.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.drive,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.drive.hint'),
        onInput: (v) => { this.settings.drive = v; this.commit(); },
      }),
      slider({
        label: t('ctl.comp.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.comp,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.comp.hint'),
        onInput: (v) => { this.settings.comp = v; this.commit(); },
      }),
      slider({
        label: 'BASS',
        min: -1, max: 1, step: 0.01, value: this.settings.ampBass,
        format: (v) => `${v > 0 ? '+' : ''}${(v * 12).toFixed(1)} dB`,
        onInput: (v) => { this.settings.ampBass = v; this.commit(); },
      }),
      slider({
        label: 'MIDDLE',
        min: -1, max: 1, step: 0.01, value: this.settings.ampMid,
        format: (v) => `${v > 0 ? '+' : ''}${(v * 12).toFixed(1)} dB`,
        onInput: (v) => { this.settings.ampMid = v; this.commit(); },
      }),
      slider({
        label: t('ctl.ampMidFreq.label'),
        min: 200, max: 2000, step: 10, value: this.settings.ampMidFreq,
        format: (v) => `${Math.round(v)} Hz`,
        hint: t('ctl.ampMidFreq.hint'),
        onInput: (v) => { this.settings.ampMidFreq = v; this.commit(); },
      }),
      slider({
        label: 'TREBLE',
        min: -1, max: 1, step: 0.01, value: this.settings.ampTreble,
        format: (v) => `${v > 0 ? '+' : ''}${(v * 12).toFixed(1)} dB`,
        onInput: (v) => { this.settings.ampTreble = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.amp')), amp);

    const cabOptions = (Object.keys(CABS) as CabType[]).map((key) => ({
      value: key,
      label: t(`cab.${key}.label`),
    }));
    const cabBox = el('div', 'ctl-grid');
    cabBox.append(
      segmented<CabType>(t('panel.cabinet'), cabOptions, this.settings.cab, (v) => {
        this.settings.cab = v;
        this.commit();
        this.showTab('amp');
      })
    );
    const cabNote = el('p', 'panel-note', t(`cab.${this.settings.cab}.hint`));
    body.append(el('h2', 'panel-title', t('panel.cabinet')), cabBox, cabNote);

    const fx = el('div', 'ctl-grid');
    fx.append(
      slider({
        label: t('ctl.wah.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.wah,
        format: (v) => (v < 0.005 ? t('fx.off') : `${Math.round(v * 100)}`),
        hint: t('ctl.wah.hint'),
        onInput: (v) => { this.settings.wah = v; this.commit(); },
      }),
      slider({
        label: t('ctl.wahSens.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.wahSens,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.wahSens = v; this.commit(); },
      }),
      slider({
        label: t('ctl.chorus.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.chorus,
        format: (v) => (v < 0.005 ? t('fx.off') : `${Math.round(v * 100)}`),
        hint: t('ctl.chorus.hint'),
        onInput: (v) => { this.settings.chorus = v; this.commit(); },
      }),
      segmented<ReverbType>(
        t('reverb.label'),
        [
          { value: 'off', label: t('fx.off') },
          ...(Object.keys(ROOMS) as (keyof typeof ROOMS)[]).map((key) => ({
            value: key as ReverbType,
            label: t(`reverb.${key}.label`),
          })),
        ],
        this.settings.reverbType,
        (v) => { this.settings.reverbType = v; this.commit(); }
      ),
      slider({
        label: t('ctl.reverbMix.label'),
        min: 0, max: 0.6, step: 0.01, value: this.settings.reverbMix,
        format: (v) => `${Math.round(v * 166)}`,
        onInput: (v) => { this.settings.reverbMix = v; this.commit(); },
      }),
      slider({
        label: t('ctl.volume.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.volume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.volume = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.fx')), fx);

    body.append(
      el(
        'p',
        'panel-note',
        t('amp.note')
      )
    );
  }

  private buildPlayTab() {
    const body = this.panelBody;

    const instrument = el('div', 'ctl-grid');
    instrument.append(
      select(
        t('ctl.tuning.label'),
        TUNINGS.map((tuning) => ({ value: tuning.id, label: t(`tuning.${tuning.id}.name`) })),
        this.settings.tuningId,
        (v) => {
          this.settings.tuningId = v;
          this.applyInstrument();
          this.commit();
          this.setStatus();
          this.showTab('play');
        }
      )
    );
    const tuningNote = el('p', 'panel-note', t(`tuning.${findTuning(this.settings.tuningId).id}.hint`));

    const options = el('div', 'ctl-grid');
    options.append(
      switchRow(
        t('ctl.fretless.label'),
        this.settings.fretless,
        (v) => {
          this.settings.fretless = v;
          this.fretboard.setFretless(v);
          this.commit();
        },
        t('ctl.fretless.hint')
      ),
      switchRow(
        t('ctl.letRing.label'),
        this.ui.letRing,
        (v) => { this.ui.letRing = v; this.save(); },
        t('ctl.letRing.hint')
      ),
      segmented<LabelMode>(
        t('ctl.labelMode.label'),
        [
          { value: 'off', label: t('labelMode.off') },
          { value: 'root', label: t('labelMode.root') },
          { value: 'all', label: t('labelMode.all') },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.fretboard.setLabels(v);
          this.save();
        }
      ),
      select(
        t('ctl.rootPitch.label'),
        [
          { value: '-1', label: t('rootPitch.none') },
          ...Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: pitchClass(i) })),
        ],
        String(this.ui.rootPitch),
        (v) => {
          this.ui.rootPitch = Number(v);
          this.fretboard.setRoot(this.ui.rootPitch);
          this.save();
        }
      ),
      slider({
        label: t('ctl.fretCount.label'),
        min: 4, max: 20, step: 1, value: this.ui.fretCount,
        format: (v) => `${v}`,
        onInput: (v) => {
          this.ui.fretCount = v;
          this.ui.startFret = Math.min(this.ui.startFret, MAX_FRET - v);
          this.fretboard.setRange(this.ui.startFret, v);
          this.updatePositionLabel();
          this.save();
        },
      }),
      slider({
        label: t('ctl.touch.label'),
        min: 0.2, max: 1, step: 0.01, value: this.ui.baseVelocity,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.touch.hint'),
        onInput: (v) => { this.ui.baseVelocity = v; this.save(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.instrument')), instrument, tuningNote, options);

    const feel = el('div', 'ctl-grid');
    feel.append(
      slider({
        label: t('ctl.a4.label'),
        min: 415, max: 448, step: 0.5, value: this.settings.a4,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { this.settings.a4 = v; this.commit(); },
      }),
      slider({
        label: t('ctl.velCurve.label'),
        min: 0.5, max: 2.2, step: 0.01, value: this.settings.velCurve,
        format: (v) => v.toFixed(2),
        hint: t('ctl.velCurve.hint'),
        onInput: (v) => { this.settings.velCurve = v; this.commit(); },
      }),
      slider({
        label: t('ctl.dynamics.label'),
        min: 0.4, max: 1.4, step: 0.01, value: this.settings.dynamics,
        format: (v) => v.toFixed(2),
        onInput: (v) => { this.settings.dynamics = v; this.commit(); },
      }),
      slider({
        label: t('ctl.release.label'),
        min: 0, max: 1, step: 0.01, value: this.settings.release,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('ctl.release.hint'),
        onInput: (v) => { this.settings.release = v; this.commit(); },
      }),
      slider({
        label: t('ctl.glide.label'),
        min: 0.01, max: 0.25, step: 0.005, value: this.settings.glide,
        format: (v) => `${Math.round(v * 1000)} ms`,
        onInput: (v) => { this.settings.glide = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('panel.touch')), feel);

    // リズム
    const rhythmBox = el('div', 'ctl-grid');
    rhythmBox.append(
      segmented(
        t('ctl.rhythm.label'),
        PATTERNS.map((p) => ({ value: p.id, label: t(`rhythm.${p.id}.name`) })),
        this.ui.rhythmId,
        (v) => {
          this.ui.rhythmId = v;
          this.rhythm.setPattern(v);
          this.save();
        }
      ),
      slider({
        label: t('ctl.tempo.label'),
        min: 40, max: 220, step: 1, value: this.ui.bpm,
        format: (v) => `${v} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.rhythm.setBpm(v);
          this.save();
        },
      }),
      slider({
        label: t('ctl.rhythmVolume.label'),
        min: 0, max: 1, step: 0.01, value: this.ui.rhythmVolume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => {
          this.ui.rhythmVolume = v;
          this.rhythm.setVolume(v);
          this.save();
        },
      }),
      switchRow(t('ctl.rhythmToggle.label'), this.rhythm.running, (on) => {
        void this.ensureAudio().then(() => {
          if (on) this.rhythm.start(this.ui.bpm);
          else this.rhythm.stop();
        });
      }, t('ctl.rhythmToggle.hint'))
    );
    body.append(el('h2', 'panel-title', t('panel.practiceTools')), rhythmBox);

    // MIDI
    const midiBox = el('div', 'midi-box');
    if (MidiInput.supported) {
      midiBox.append(
        button(this.midi ? t('midi.reconnect') : t('midi.connect'), 'primary', () => void this.connectMidi())
      );
      const list = el('span', 'panel-note');
      list.textContent = this.midi?.devices.length
        ? t('midi.connected', { devices: this.midi.devices.join(', ') })
        : t('midi.hint');
      midiBox.append(list);
    } else {
      midiBox.append(
        el('span', 'panel-note', t('midi.unsupported'))
      );
    }
    body.append(el('h2', 'panel-title', t('panel.midi')), midiBox);
  }

  private buildRecordTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', t('panel.record')));

    const row = el('div', 'button-row');
    this.recordButton = button(
      this.recorder.recording ? t('record.stop') : t('record.start'),
      this.recorder.recording ? 'danger' : 'primary',
      () => this.toggleRecording()
    );
    const playBtn = button(t('record.play'), 'ghost', () => this.playRecording());
    const clearBtn = button(t('record.clear'), 'ghost', () => {
      this.recorder.clear();
      this.lastSequence = null;
      this.showTab('rec');
    });
    row.append(this.recordButton, playBtn, clearBtn);
    body.append(row);

    const info = el('p', 'panel-note');
    const count = this.recorder.events.filter((e) => e.type === 'pluck').length;
    info.textContent = this.recorder.isEmpty
      ? t('record.empty')
      : t('record.count', { count, time: this.formatTime(this.recorder.duration(0)) });
    body.append(info);

    const exportRow = el('div', 'button-row');
    const wavBtn = button(t('export.wav'), 'primary', () => void this.exportWav());
    const midiBtn = button(t('export.midi'), 'ghost', () => this.exportMidi());
    if (this.exporting) {
      wavBtn.disabled = true;
      wavBtn.textContent = t('export.exporting');
    }
    exportRow.append(wavBtn, midiBtn);
    body.append(el('h2', 'panel-title', t('panel.file')), exportRow);

    body.append(
      el(
        'p',
        'panel-note',
        t('export.note')
      )
    );
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', t('panel.demo')));

    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const card = el('div', 'demo-card');
      const texts = el('div', 'demo-texts');
      texts.append(
        el('strong', undefined, t(`demo.${demo.id}.title`)),
        el('span', undefined, `${t(`demo.${demo.id}.style`)} ・ ${demo.bpm} BPM ・ ${t(`demo.${demo.id}.note`)}`)
      );
      card.append(texts, button(t('demo.play'), 'primary', () => this.playDemo(demo.id)));
      list.append(card);
    }
    body.append(list);

    const row = el('div', 'button-row');
    row.append(button(t('demo.stop'), 'ghost', () => this.stopPlayback()));
    body.append(row);

    body.append(
      switchRow(t('demo.useDemoPreset'), this.ui.useDemoPreset, (v) => {
        this.ui.useDemoPreset = v;
        this.save();
      })
    );

    body.append(
      el(
        'p',
        'panel-note',
        t('demo.note')
      )
    );
  }

  // -------------------------------------------------------------- behaviours

  private selectPreset(id: string) {
    this.ui.presetId = id;
    this.settings = applyPreset(this.settings, id);
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      this.setTechnique(preset.technique);
      this.flashNowPlaying(t('flash.presetChanged', { name: t(`preset.${preset.id}.name`) }));
    }
    this.fretboard.setFretless(this.settings.fretless);
    this.commit();
    const node = this.root.querySelector('.preset-select') as HTMLSelectElement | null;
    if (node) node.value = id;
    if (this.activeTab === 'tone' || this.activeTab === 'amp') this.showTab(this.activeTab);
  }

  private panic() {
    this.player.stop();
    this.rhythm.stop();
    this.engine.panic();
    this.fretboard.allOff();
    this.heldKeys.clear();
    this.midiNotes.clear();
    this.resetTransport();
    this.restoreDemoPreset();
    this.flashNowPlaying(t('flash.allStopped'));
    if (this.activeTab === 'play') this.showTab('play');
  }

  private resetTransport() {
    this.transportEl.textContent = '00:00';
  }

  /**
   * デモ再生のために切り替えた音色を元に戻す。
   * 再生中に自分でパラメータを触っていた場合は、その状態を尊重して戻さない。
   */
  private restoreDemoPreset() {
    const saved = this.demoRestore;
    this.demoRestore = null;
    if (!saved || JSON.stringify(this.settings) !== saved.snapshot) return;

    this.settings = saved.settings;
    this.ui.presetId = saved.presetId;
    this.setTechnique(saved.technique);
    this.fretboard.setFretless(this.settings.fretless);
    this.commit();
    const node = this.root.querySelector('.preset-select') as HTMLSelectElement | null;
    if (node) node.value = saved.presetId;
    if (this.activeTab === 'tone' || this.activeTab === 'amp') this.showTab(this.activeTab);
  }

  private async connectMidi() {
    if (!this.midi) {
      this.midi = new MidiInput({
        noteOn: (note, vel) => {
          const pos = findPosition(note, this.tuning, this.ui.startFret + 3);
          if (!pos) return;
          this.midiNotes.set(note, pos.str);
          this.pluck(pos.str, pos.fret, Math.max(0.15, vel) / Math.max(0.2, this.ui.baseVelocity));
        },
        noteOff: (note) => {
          const str = this.midiNotes.get(note);
          if (str === undefined) return;
          this.midiNotes.delete(note);
          this.mute(str);
        },
        pitchBend: (semitones) => {
          for (const str of new Set(this.midiNotes.values())) this.bend(str, semitones * 100);
        },
        allNotesOff: () => this.panic(),
      });
      this.midi.onDevicesChanged = () => {
        this.setStatus();
        if (this.activeTab === 'play') this.showTab('play');
      };
    }
    await this.ensureAudio();
    const ok = await this.midi.init();
    this.setStatus(ok ? undefined : t('status.midiFailed'));
    if (this.activeTab === 'play') this.showTab('play');
  }

  private toggleRecording() {
    void this.ensureAudio().then(() => {
      if (this.recorder.recording) {
        this.recorder.stop(this.engine.now);
        this.lastSequence = { events: this.recorder.events, name: 'recording' };
        this.resetTransport();
        this.flashNowPlaying(t('flash.recordStopped'));
      } else {
        this.player.stop();
        this.recorder.start(this.engine.now);
        this.flashNowPlaying(t('flash.recording'));
      }
      if (this.activeTab === 'rec') this.showTab('rec');
    });
  }

  private playRecording() {
    if (this.recorder.isEmpty) return;
    void this.ensureAudio().then(() => {
      this.recorder.stop(this.engine.now);
      this.startPlayback(this.recorder.events, t('flash.recordedPerformance'));
    });
  }

  private playDemo(id: string) {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;

    if (this.ui.useDemoPreset && demo.presetId !== this.ui.presetId) {
      const previous = this.demoRestore
        ? {
            settings: this.demoRestore.settings,
            presetId: this.demoRestore.presetId,
            technique: this.demoRestore.technique,
          }
        : { settings: { ...this.settings }, presetId: this.ui.presetId, technique: this.ui.technique };
      this.selectPreset(demo.presetId);
      this.demoRestore = { ...previous, snapshot: JSON.stringify(this.settings) };
    }

    void this.ensureAudio().then(() => {
      const events = demo.build(this.tuning, this.settings.a4);
      if (this.ui.useDemoPreset) {
        this.ui.bpm = demo.bpm;
        this.rhythm.setBpm(demo.bpm);
      }
      this.startPlayback(events, t('flash.demoLabel', { title: t(`demo.${demo.id}.title`), style: t(`demo.${demo.id}.style`) }));
    });
  }

  private startPlayback(events: PerformanceEvent[], label: string) {
    this.player.stop();
    this.fretboard.allOff();
    this.lastSequence = { events, name: label };

    this.player.onEvent = (ev) => {
      switch (ev.type) {
        case 'pluck':
          this.fretboard.showPluck(ev.str, ev.fret, ev.vel);
          break;
        case 'slide':
          this.fretboard.showSlide(ev.str, ev.fret);
          break;
        case 'mute':
          this.fretboard.showMute(ev.str);
          break;
        case 'muteAll':
          this.fretboard.allOff();
          break;
      }
    };
    this.player.onProgress = (elapsed, total) => {
      this.transportEl.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
    };
    this.player.onEnd = () => {
      this.fretboard.allOff();
      this.resetTransport();
      this.restoreDemoPreset();
      this.flashNowPlaying(t('flash.playbackEnded'));
    };
    this.player.play(events);
    this.flashNowPlaying(t('flash.playing', { label }));
  }

  private stopPlayback() {
    this.player.stop();
    this.fretboard.allOff();
    this.resetTransport();
    this.restoreDemoPreset();
  }

  private exportEvents(): { events: PerformanceEvent[]; name: string } | null {
    if (!this.recorder.isEmpty) return { events: this.recorder.events, name: 'performance' };
    return this.lastSequence;
  }

  private async exportWav() {
    const source = this.exportEvents();
    if (!source || source.events.length === 0) {
      this.flashNowPlaying(t('flash.noExportable'));
      return;
    }
    this.exporting = true;
    if (this.activeTab === 'rec') this.showTab('rec');
    this.flashNowPlaying(t('flash.exportingWav'));
    try {
      const last = source.events.reduce((max, ev) => Math.max(max, ev.time), 0);
      const buffer = await renderPerformance(source.events, this.settings, last + 4);
      downloadBlob(encodeWav(buffer), timestampName('kurogane-bass', 'wav'));
      this.flashNowPlaying(t('flash.wavSaved'));
    } catch (err) {
      this.flashNowPlaying(t('flash.exportFailed', { err: String(err) }));
    } finally {
      this.exporting = false;
      if (this.activeTab === 'rec') this.showTab('rec');
    }
  }

  private exportMidi() {
    const source = this.exportEvents();
    if (!source || source.events.length === 0) {
      this.flashNowPlaying(t('flash.noExportable'));
      return;
    }
    downloadBlob(encodeMidi(source.events, this.ui.bpm), timestampName('kurogane-bass', 'mid'));
    this.flashNowPlaying(t('flash.midiSaved'));
  }

  private toggleHelp() {
    const existing = this.root.querySelector('.help-modal');
    if (existing) {
      existing.remove();
      return;
    }
    const modal = el('div', 'help-modal');
    const card = el('div', 'help-card');
    card.innerHTML = `
      <h2>${t('help.title')}</h2>
      <ul>
        <li><strong>${t('help.play.term')}</strong> … ${t('help.play.desc')}</li>
        <li><strong>${t('help.slide.term')}</strong> … ${t('help.slide.desc')}</li>
        <li><strong>${t('help.bend.term')}</strong> … ${t('help.bend.desc')}</li>
        <li><strong>${t('help.technique.term')}</strong> … ${t('help.technique.desc')}</li>
        <li><strong>${t('help.pcKeys.term')}</strong> … ${t('help.pcKeys.desc')}</li>
        <li><strong>${t('help.rhythm.term')}</strong> … ${t('help.rhythm.desc')}</li>
        <li><strong>${t('help.rec.term')}</strong> … ${t('help.rec.desc')}</li>
      </ul>
      <h2>${t('help.aboutSoundTitle')}</h2>
      <p>${t('help.aboutSound')}</p>
      <p class="help-free">${t('help.free')}</p>
      <p class="help-small">
        ${t('help.usage')}
        <a href="./privacy.html" target="_blank" rel="noopener">${t('help.privacy')}</a>
      </p>
    `;
    card.append(button(t('help.close'), 'primary', () => modal.remove()));
    modal.append(card);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    this.root.append(modal);
  }

  private flashNowPlaying(text: string) {
    this.nowPlayingEl.textContent = text;
    this.nowPlayingEl.classList.remove('flash');
    void this.nowPlayingEl.offsetWidth;
    this.nowPlayingEl.classList.add('flash');
  }

  private formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------- global keys

  private bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.accent = true;
        return;
      }
      if (e.repeat) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void this.ensureAudio().then(() => {
          this.rhythm.toggle(this.ui.bpm);
          if (this.activeTab === 'play') this.showTab('play');
        });
        return;
      }
      if (e.code === 'Escape') { this.panic(); return; }
      if (e.code === 'ArrowLeft') { this.shiftPosition(-1); return; }
      if (e.code === 'ArrowRight') { this.shiftPosition(1); return; }

      const pos = COMPUTER_KEY_MAP[e.code];
      if (!pos) return;
      e.preventDefault();
      const str = pos.row;
      if (str >= this.tuning.length || this.heldKeys.has(e.code)) return;
      const fret = this.ui.startFret + pos.fret;
      this.heldKeys.set(e.code, { str, fret });
      this.pluck(str, fret, 1);
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.accent = false;
        return;
      }
      const held = this.heldKeys.get(e.code);
      if (!held) return;
      this.heldKeys.delete(e.code);
      if (!this.ui.letRing) this.mute(held.str);
    });

    window.addEventListener('blur', () => {
      this.heldKeys.clear();
      this.accent = false;
    });
  }

  private startMeterLoop() {
    const loop = () => {
      const level = this.audioReady ? this.engine.level() : 0;
      this.fretboard.setLevel(level);
      this.meterFill.style.transform = `scaleX(${Math.min(1, level * 1.15)})`;
      if (this.recorder.recording) {
        this.transportEl.textContent = `● ${this.formatTime(this.recorder.elapsed(this.engine.now))}`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
