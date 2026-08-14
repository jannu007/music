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

const STORAGE_KEY = 'kurogane-bass-v1';

const TECHNIQUE_LABELS: { value: Technique; label: string; hint: string }[] = [
  { value: 'finger', label: '指', hint: '2フィンガー。基本の弾き方' },
  { value: 'pick', label: 'ピック', hint: '硬いアタック' },
  { value: 'slap', label: 'スラップ', hint: '親指で叩く' },
  { value: 'pop', label: 'プル', hint: '指で引っ張る' },
  { value: 'mute', label: 'ミュート', hint: 'ブリッジミュート' },
  { value: 'ghost', label: 'ゴースト', hint: '音程のない打音' },
  { value: 'harmonic', label: 'ハーモニクス', hint: '5・7・12フレットで倍音' },
];

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

  constructor(root: HTMLElement) {
    this.root = root;
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
          this.setStatus(`オーディオを開始できません: ${err}`);
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
        <small>物理モデリング・エレキベース</small>
      </span>`;

    const presetSelect = el('select', 'preset-select');
    presetSelect.setAttribute('aria-label', '音色プリセット');
    for (const preset of PRESETS) {
      const option = el('option', undefined, preset.name);
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
      + '</svg><span class="btn-text">全停止</span>';
    panicButton.title = 'すべての音を止める（Esc）';
    panicButton.setAttribute('aria-label', 'すべての音を止める');

    const headerActions = el('div', 'header-actions');
    headerActions.append(panicButton, button('?', 'ghost round', () => this.toggleHelp()));
    header.append(brand, presetSelect, this.statusEl, headerActions);

    // ---------- 指板 ----------
    const stage = el('section', 'stage');
    const canvas = el('canvas', 'fret-canvas');
    canvas.setAttribute('aria-label', 'ベースの指板');
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
    for (const tech of TECHNIQUE_LABELS) {
      const btn = button(tech.label, 'tech-btn', () => this.setTechnique(tech.value));
      btn.dataset.tech = tech.value;
      btn.title = tech.hint;
      if (tech.value === this.ui.technique) btn.classList.add('active');
      this.techButtons.push(btn);
      techWrap.append(btn);
    }

    const posWrap = el('div', 'position-row');
    this.positionLabel = el('span', 'position-label');
    posWrap.append(
      button('◀', 'ghost small', () => this.shiftPosition(-1)),
      this.positionLabel,
      button('▶', 'ghost small', () => this.shiftPosition(1)),
      button('全ミュート', 'ghost small', () => this.muteAll())
    );
    playBar.append(techWrap, posWrap);

    // ---------- パネル ----------
    const panel = el('section', 'panel');
    const tabs = el('nav', 'tabs');
    const tabDefs = [
      { id: 'tone', label: '音色' },
      { id: 'amp', label: 'アンプ' },
      { id: 'play', label: '演奏' },
      { id: 'rec', label: '録音' },
      { id: 'demo', label: 'フレーズ' },
    ];
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
    window.addEventListener('keydown', kick, { once: true });
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
    parts.push(this.audioReady ? '準備完了' : '指板をタップすると開始');
    const tuning = findTuning(this.settings.tuningId);
    parts.push(tuning.name);
    if (this.midi && this.midi.devices.length > 0) parts.push(`MIDI: ${this.midi.devices.join(', ')}`);
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
    this.positionLabel.textContent = `${first}〜${start === 0 ? count : start + count - 1}フレット`;
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
      card.append(el('strong', undefined, preset.name), el('span', undefined, preset.description));
      card.addEventListener('click', () => {
        this.selectPreset(preset.id);
        this.showTab('tone');
      });
      grid.append(card);
    }
    body.append(el('h2', 'panel-title', '音色プリセット'), grid);

    const strings = el('div', 'ctl-grid');
    strings.append(
      slider({
        label: '弦の明るさ',
        min: 0, max: 1, step: 0.01, value: this.settings.brightness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '使い込んだ弦 ← → 張りたての弦',
        onInput: (v) => { this.settings.brightness = v; this.commit(); },
      }),
      slider({
        label: 'サステイン（余韻）',
        min: 0.4, max: 1.7, step: 0.01, value: this.settings.sustain,
        format: (v) => `${v.toFixed(2)}×`,
        onInput: (v) => { this.settings.sustain = v; this.commit(); },
      }),
      slider({
        label: '弦の硬さ（ゴリッと感）',
        min: 0, max: 1, step: 0.01, value: this.settings.stiffness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '倍音が少しずれて生まれる、太い弦特有の唸り',
        onInput: (v) => { this.settings.stiffness = v; this.commit(); },
      }),
      slider({
        label: 'フレットのビビり',
        min: 0, max: 1, step: 0.01, value: this.settings.buzz,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '弦高を下げるほど、強く弾いたときに「バチッ」と鳴ります',
        onInput: (v) => { this.settings.buzz = v; this.commit(); },
      }),
      slider({
        label: '弾く位置',
        min: -1, max: 1, step: 0.01, value: this.settings.pluckPos,
        format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
        hint: 'ブリッジ寄り（硬い） ← → ネック寄り（丸い）',
        onInput: (v) => { this.settings.pluckPos = v; this.commit(); },
      }),
      slider({
        label: '撥弦ノイズ',
        min: 0, max: 1, step: 0.01, value: this.settings.noise,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '指やピックが弦に当たる音',
        onInput: (v) => { this.settings.noise = v; this.commit(); },
      }),
      slider({
        label: 'うなり',
        min: 0, max: 1, step: 0.01, value: this.settings.beat,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '縦振動と横振動のズレ。太さと生々しさが出ます',
        onInput: (v) => { this.settings.beat = v; this.commit(); },
      }),
      slider({
        label: '他弦の共鳴',
        min: 0, max: 1, step: 0.01, value: this.settings.sympathetic,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '押さえていない弦がブリッジ越しに一緒に鳴ります',
        onInput: (v) => { this.settings.sympathetic = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', '弦'), strings);

    const pickups = el('div', 'ctl-grid');
    pickups.append(
      slider({
        label: 'ピックアップ・バランス',
        min: 0, max: 1, step: 0.01, value: this.settings.pickupBlend,
        format: (v) => (v < 0.05 ? 'フロント' : v > 0.95 ? 'リア' : `F ${Math.round((1 - v) * 100)} : R ${Math.round(v * 100)}`),
        hint: 'フロントは太く、リアは細くて硬い音になります',
        onInput: (v) => { this.settings.pickupBlend = v; this.commit(); },
      }),
      slider({
        label: 'ピックアップの効き',
        min: 0, max: 1, step: 0.01, value: this.settings.pickupTone,
        format: (v) => `${Math.round(v * 100)}`,
        hint: 'コイルの共振。上げるほど抜けが良く、下げるとこもります',
        onInput: (v) => { this.settings.pickupTone = v; this.commit(); },
      }),
      slider({
        label: 'フロントPUの位置',
        min: 0.18, max: 0.42, step: 0.005, value: this.settings.pickupNeck,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: 'ブリッジからの距離。倍音の欠け方が変わります',
        onInput: (v) => { this.settings.pickupNeck = v; this.commit(); },
      }),
      slider({
        label: 'リアPUの位置',
        min: 0.05, max: 0.22, step: 0.005, value: this.settings.pickupBridge,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { this.settings.pickupBridge = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', 'ピックアップ'), pickups);
  }

  private buildAmpTab() {
    const body = this.panelBody;
    const amp = el('div', 'ctl-grid');

    amp.append(
      slider({
        label: 'ドライブ（歪み）',
        min: 0, max: 1, step: 0.01, value: this.settings.drive,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '低音はクリーンのまま、中高域だけを歪ませます',
        onInput: (v) => { this.settings.drive = v; this.commit(); },
      }),
      slider({
        label: 'コンプレッサー',
        min: 0, max: 1, step: 0.01, value: this.settings.comp,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '粒を揃えます。指弾きやスラップで特に有効',
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
        label: 'MIDDLE の周波数',
        min: 200, max: 2000, step: 10, value: this.settings.ampMidFreq,
        format: (v) => `${Math.round(v)} Hz`,
        hint: '250Hz付近は太さ、800Hz付近は輪郭に効きます',
        onInput: (v) => { this.settings.ampMidFreq = v; this.commit(); },
      }),
      slider({
        label: 'TREBLE',
        min: -1, max: 1, step: 0.01, value: this.settings.ampTreble,
        format: (v) => `${v > 0 ? '+' : ''}${(v * 12).toFixed(1)} dB`,
        onInput: (v) => { this.settings.ampTreble = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', 'アンプ'), amp);

    const cabOptions = (Object.keys(CABS) as CabType[]).map((key) => ({
      value: key,
      label: CABS[key].label,
    }));
    const cabBox = el('div', 'ctl-grid');
    cabBox.append(
      segmented<CabType>('キャビネット', cabOptions, this.settings.cab, (v) => {
        this.settings.cab = v;
        this.commit();
        this.showTab('amp');
      })
    );
    const cabNote = el('p', 'panel-note', CABS[this.settings.cab].hint);
    body.append(el('h2', 'panel-title', 'キャビネット'), cabBox, cabNote);

    const fx = el('div', 'ctl-grid');
    fx.append(
      slider({
        label: 'オートワウ',
        min: 0, max: 1, step: 0.01, value: this.settings.wah,
        format: (v) => (v < 0.005 ? 'オフ' : `${Math.round(v * 100)}`),
        hint: '弾く強さでフィルターが開くエンベロープフィルター',
        onInput: (v) => { this.settings.wah = v; this.commit(); },
      }),
      slider({
        label: 'ワウの戻りの速さ',
        min: 0, max: 1, step: 0.01, value: this.settings.wahSens,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.wahSens = v; this.commit(); },
      }),
      slider({
        label: 'コーラス',
        min: 0, max: 1, step: 0.01, value: this.settings.chorus,
        format: (v) => (v < 0.005 ? 'オフ' : `${Math.round(v * 100)}`),
        hint: 'フレットレスやバラードで広がりが出ます',
        onInput: (v) => { this.settings.chorus = v; this.commit(); },
      }),
      segmented<ReverbType>(
        '残響',
        [
          { value: 'off', label: 'オフ' },
          ...(Object.keys(ROOMS) as (keyof typeof ROOMS)[]).map((key) => ({
            value: key as ReverbType,
            label: ROOMS[key].label,
          })),
        ],
        this.settings.reverbType,
        (v) => { this.settings.reverbType = v; this.commit(); }
      ),
      slider({
        label: '残響の量',
        min: 0, max: 0.6, step: 0.01, value: this.settings.reverbMix,
        format: (v) => `${Math.round(v * 166)}`,
        onInput: (v) => { this.settings.reverbMix = v; this.commit(); },
      }),
      slider({
        label: 'マスター音量',
        min: 0, max: 1, step: 0.01, value: this.settings.volume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.volume = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', 'エフェクト'), fx);

    body.append(
      el(
        'p',
        'panel-note',
        'キャビネットも残響も、その場で計算して作っています。音声ファイルのダウンロードは一切ありません。'
      )
    );
  }

  private buildPlayTab() {
    const body = this.panelBody;

    const instrument = el('div', 'ctl-grid');
    instrument.append(
      select(
        'チューニング',
        TUNINGS.map((t) => ({ value: t.id, label: t.name })),
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
    const tuningNote = el('p', 'panel-note', findTuning(this.settings.tuningId).hint);

    const options = el('div', 'ctl-grid');
    options.append(
      switchRow(
        'フレットレス',
        this.settings.fretless,
        (v) => {
          this.settings.fretless = v;
          this.fretboard.setFretless(v);
          this.commit();
        },
        'フレットの無い指板。スライドが滑らかになります'
      ),
      switchRow(
        '指を離しても鳴らし続ける',
        this.ui.letRing,
        (v) => { this.ui.letRing = v; this.save(); },
        'オフにすると、指を離した瞬間に音が止まります'
      ),
      segmented<LabelMode>(
        '指板の音名表示',
        [
          { value: 'off', label: 'なし' },
          { value: 'root', label: 'ルートのみ' },
          { value: 'all', label: 'すべて' },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.fretboard.setLabels(v);
          this.save();
        }
      ),
      select(
        'キー（ルート音を光らせる）',
        [
          { value: '-1', label: '指定しない' },
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
        label: '表示するフレット数',
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
        label: 'タッチの強さ',
        min: 0.2, max: 1, step: 0.01, value: this.ui.baseVelocity,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '筆圧に対応した端末では、押す強さでも変化します',
        onInput: (v) => { this.ui.baseVelocity = v; this.save(); },
      })
    );
    body.append(el('h2', 'panel-title', '楽器'), instrument, tuningNote, options);

    const feel = el('div', 'ctl-grid');
    feel.append(
      slider({
        label: '基準ピッチ A4',
        min: 415, max: 448, step: 0.5, value: this.settings.a4,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { this.settings.a4 = v; this.commit(); },
      }),
      slider({
        label: 'ベロシティカーブ',
        min: 0.5, max: 2.2, step: 0.01, value: this.settings.velCurve,
        format: (v) => v.toFixed(2),
        hint: '大きいほど強く弾かないと音量が出ません',
        onInput: (v) => { this.settings.velCurve = v; this.commit(); },
      }),
      slider({
        label: 'ダイナミクス',
        min: 0.4, max: 1.4, step: 0.01, value: this.settings.dynamics,
        format: (v) => v.toFixed(2),
        onInput: (v) => { this.settings.dynamics = v; this.commit(); },
      }),
      slider({
        label: 'ミュートの速さ',
        min: 0, max: 1, step: 0.01, value: this.settings.release,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '指を置いてから音が止まるまでの速さ',
        onInput: (v) => { this.settings.release = v; this.commit(); },
      }),
      slider({
        label: 'スライドの速さ',
        min: 0.01, max: 0.25, step: 0.005, value: this.settings.glide,
        format: (v) => `${Math.round(v * 1000)} ms`,
        onInput: (v) => { this.settings.glide = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', 'タッチ'), feel);

    // リズム
    const rhythmBox = el('div', 'ctl-grid');
    rhythmBox.append(
      segmented(
        'リズム',
        PATTERNS.map((p) => ({ value: p.id, label: p.name })),
        this.ui.rhythmId,
        (v) => {
          this.ui.rhythmId = v;
          this.rhythm.setPattern(v);
          this.save();
        }
      ),
      slider({
        label: 'テンポ',
        min: 40, max: 220, step: 1, value: this.ui.bpm,
        format: (v) => `${v} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.rhythm.setBpm(v);
          this.save();
        },
      }),
      slider({
        label: 'リズムの音量',
        min: 0, max: 1, step: 0.01, value: this.ui.rhythmVolume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => {
          this.ui.rhythmVolume = v;
          this.rhythm.setVolume(v);
          this.save();
        },
      }),
      switchRow('リズムを鳴らす', this.rhythm.running, (on) => {
        void this.ensureAudio().then(() => {
          if (on) this.rhythm.start(this.ui.bpm);
          else this.rhythm.stop();
        });
      }, 'スペースキーでも切り替えられます')
    );
    body.append(el('h2', 'panel-title', '練習ツール'), rhythmBox);

    // MIDI
    const midiBox = el('div', 'midi-box');
    if (MidiInput.supported) {
      midiBox.append(
        button(this.midi ? 'MIDI 再検出' : 'MIDIキーボードを接続', 'primary', () => void this.connectMidi())
      );
      const list = el('span', 'panel-note');
      list.textContent = this.midi?.devices.length
        ? `接続中: ${this.midi.devices.join(', ')}`
        : 'MIDIキーボードの音は、自動でいちばん自然な弦とフレットに割り当てられます。';
      midiBox.append(list);
    } else {
      midiBox.append(
        el('span', 'panel-note', 'このブラウザは Web MIDI に対応していません（Chrome / Edge 推奨）。')
      );
    }
    body.append(el('h2', 'panel-title', 'MIDI'), midiBox);
  }

  private buildRecordTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', '録音と書き出し'));

    const row = el('div', 'button-row');
    this.recordButton = button(
      this.recorder.recording ? '■ 録音停止' : '● 録音開始',
      this.recorder.recording ? 'danger' : 'primary',
      () => this.toggleRecording()
    );
    const playBtn = button('▶ 再生', 'ghost', () => this.playRecording());
    const clearBtn = button('クリア', 'ghost', () => {
      this.recorder.clear();
      this.lastSequence = null;
      this.showTab('rec');
    });
    row.append(this.recordButton, playBtn, clearBtn);
    body.append(row);

    const info = el('p', 'panel-note');
    const count = this.recorder.events.filter((e) => e.type === 'pluck').length;
    info.textContent = this.recorder.isEmpty
      ? '録音すると、演奏がイベントとして記録されます。あとから音色を変えて書き出せます。'
      : `録音済み: ${count} 音 / ${this.formatTime(this.recorder.duration(0))}`;
    body.append(info);

    const exportRow = el('div', 'button-row');
    const wavBtn = button('WAV で書き出し', 'primary', () => void this.exportWav());
    const midiBtn = button('MIDI で書き出し', 'ghost', () => this.exportMidi());
    if (this.exporting) {
      wavBtn.disabled = true;
      wavBtn.textContent = '書き出し中…';
    }
    exportRow.append(wavBtn, midiBtn);
    body.append(el('h2', 'panel-title', 'ファイル'), exportRow);

    body.append(
      el(
        'p',
        'panel-note',
        'WAV は 48kHz / 24bit・ステレオで、現在の音色のまま再合成して書き出します。'
        + '作成した音源の利用に制限はありません（商用利用も自由です）。'
      )
    );
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', 'デモ・フレーズ'));

    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const card = el('div', 'demo-card');
      const texts = el('div', 'demo-texts');
      texts.append(
        el('strong', undefined, demo.title),
        el('span', undefined, `${demo.style} ・ ${demo.bpm} BPM ・ ${demo.note}`)
      );
      card.append(texts, button('▶ 再生', 'primary', () => this.playDemo(demo.id)));
      list.append(card);
    }
    body.append(list);

    const row = el('div', 'button-row');
    row.append(button('■ 停止', 'ghost', () => this.stopPlayback()));
    body.append(row);

    body.append(
      switchRow('推奨音色とリズムに切り替えて再生する', this.ui.useDemoPreset, (v) => {
        this.ui.useDemoPreset = v;
        this.save();
      })
    );

    body.append(
      el(
        'p',
        'panel-note',
        'デモはすべて本アプリのオリジナル・フレーズです（権利処理は不要）。'
        + '再生中の演奏もそのまま WAV / MIDI に書き出せます。'
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
      this.flashNowPlaying(`音色: ${preset.name}`);
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
    this.flashNowPlaying('すべての音を停止しました');
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
    this.setStatus(ok ? undefined : 'MIDIデバイスに接続できませんでした');
    if (this.activeTab === 'play') this.showTab('play');
  }

  private toggleRecording() {
    void this.ensureAudio().then(() => {
      if (this.recorder.recording) {
        this.recorder.stop(this.engine.now);
        this.lastSequence = { events: this.recorder.events, name: 'recording' };
        this.resetTransport();
        this.flashNowPlaying('録音を停止しました');
      } else {
        this.player.stop();
        this.recorder.start(this.engine.now);
        this.flashNowPlaying('● 録音中');
      }
      if (this.activeTab === 'rec') this.showTab('rec');
    });
  }

  private playRecording() {
    if (this.recorder.isEmpty) return;
    void this.ensureAudio().then(() => {
      this.recorder.stop(this.engine.now);
      this.startPlayback(this.recorder.events, '録音した演奏');
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
      this.startPlayback(events, `${demo.title}（${demo.style}）`);
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
      this.flashNowPlaying('再生が終了しました');
    };
    this.player.play(events);
    this.flashNowPlaying(`▶ ${label}`);
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
      this.flashNowPlaying('書き出す演奏がありません');
      return;
    }
    this.exporting = true;
    if (this.activeTab === 'rec') this.showTab('rec');
    this.flashNowPlaying('WAV を書き出しています…');
    try {
      const last = source.events.reduce((max, ev) => Math.max(max, ev.time), 0);
      const buffer = await renderPerformance(source.events, this.settings, last + 4);
      downloadBlob(encodeWav(buffer), timestampName('kurogane-bass', 'wav'));
      this.flashNowPlaying('WAV を保存しました');
    } catch (err) {
      this.flashNowPlaying(`書き出しに失敗しました: ${err}`);
    } finally {
      this.exporting = false;
      if (this.activeTab === 'rec') this.showTab('rec');
    }
  }

  private exportMidi() {
    const source = this.exportEvents();
    if (!source || source.events.length === 0) {
      this.flashNowPlaying('書き出す演奏がありません');
      return;
    }
    downloadBlob(encodeMidi(source.events, this.ui.bpm), timestampName('kurogane-bass', 'mid'));
    this.flashNowPlaying('MIDI を保存しました');
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
      <h2>使い方</h2>
      <ul>
        <li><strong>弾く</strong> … 指板をタップ／クリック（マルチタッチ対応）。下の段ほど低い弦です。</li>
        <li><strong>スライド</strong> … 押さえたまま左右にドラッグすると、弾き直さずに音程が移動します。</li>
        <li><strong>チョーキング</strong> … 押さえたまま上へドラッグすると音程が上がります。</li>
        <li><strong>奏法</strong> … 指板の下のボタンで、指弾き／ピック／スラップ／プル／ミュート／ゴースト／ハーモニクスを切り替えます。</li>
        <li><strong>PCキーボード</strong> … 手前の段から順に低い弦。<br>
          Z X C V B N M , . / ＝ 1弦目 ／ A S D F G H J K L ; ＝ 2弦目 ／
          Q W E R T Y U I O P ＝ 3弦目 ／ 1 2 3 4 5 6 7 8 9 0 ＝ 4弦目。
          左右キーでポジション移動、Shift で強く弾きます。</li>
        <li><strong>リズム</strong> … スペースキーでドラム／メトロノームの開始・停止。</li>
        <li><strong>録音</strong> … 「録音」タブで演奏を記録し、WAV（48kHz/24bit）や MIDI として保存できます。</li>
      </ul>
      <h2>この音について</h2>
      <p>
        録音されたベースの音（サンプル）は一切使っていません。弦の振動・弾く位置・
        ピックアップの位置・フレットとの衝突までを計算して、その場で音を合成しています。
        だからアプリ本体は数百KBで、追加ダウンロードも通信も不要です。
      </p>
      <p class="help-free">完全無料・広告なし・アカウント登録なし。オフラインでも動作します。</p>
      <p class="help-small">
        書き出した音源はご自由にお使いいただけます（商用利用可・クレジット表記不要）。
        <a href="./privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>
      </p>
    `;
    card.append(button('閉じる', 'primary', () => modal.remove()));
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
