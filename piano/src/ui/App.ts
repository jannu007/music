import { PianoEngine, renderPerformance } from '../audio/PianoEngine';
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
import { ROOMS } from '../audio/reverb';
import { DEFAULT_SETTINGS, type PerformanceEvent, type PianoSettings, type ReverbType } from '../audio/types';
import { DEMOS } from '../data/demos';
import { Metronome } from './Metronome';
import { PianoKeyboard, type LabelMode } from './Keyboard';
import { StringView } from './StringView';
import { button, el, segmented, slider, switchRow } from './controls';
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

const STORAGE_KEY = 'aozora-piano-v1';

interface UiState {
  presetId: string;
  labelMode: LabelMode;
  keyWidth: number;
  autoKeyWidth: boolean;
  rangeLow: number;
  rangeHigh: number;
  fixedVelocity: number | null;
  bpm: number;
  useDemoPreset: boolean;
}

const DEFAULT_UI: UiState = {
  presetId: 'concert',
  labelMode: 'c',
  keyWidth: 34,
  autoKeyWidth: true,
  rangeLow: 21,
  rangeHigh: 108,
  fixedVelocity: null,
  bpm: 90,
  useDemoPreset: true,
};

export class PianoApp {
  private root: HTMLElement;
  private engine = new PianoEngine();
  private keyboard!: PianoKeyboard;
  private view!: StringView;
  private recorder = new Recorder();
  private player!: Player;
  private metronome = new Metronome();
  private midi: MidiInput | null = null;

  private settings: PianoSettings = { ...DEFAULT_SETTINGS };
  private ui: UiState = { ...DEFAULT_UI };

  private sustainHeld = false;
  private sustainLatched = false;
  private softOn = false;
  private sostenutoOn = false;
  private computerOctave = 4;
  private heldComputerKeys = new Map<string, number>();

  private lastSequence: { events: PerformanceEvent[]; name: string } | null = null;
  /** デモ再生前の音色（再生後に戻すため） */
  private demoRestore: { settings: PianoSettings; presetId: string; snapshot: string } | null = null;
  private exporting = false;

  private statusEl!: HTMLElement;
  /** 音が止まっていないかを見に行くための待ち。二重に張らない */
  private silenceTimer: number | null = null;
  private transportEl!: HTMLElement;
  private nowPlayingEl!: HTMLElement;
  private meterFill!: HTMLElement;
  private panelBody!: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  private activeTab = 'tone';
  private sustainButton!: HTMLButtonElement;
  private softButton!: HTMLButtonElement;
  private sostenutoButton!: HTMLButtonElement;
  private recordButton!: HTMLButtonElement;
  private audioReady = false;
  private initPromise: Promise<void> | null = null;
  private globalListenersBound = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.load();
    this.player = new Player(this.engine);
    document.documentElement.lang = getLocale();
    this.build();
    this.bindGlobalKeys();
    this.startMeterLoop();
    onLocaleChange(() => this.build());
  }

  // ------------------------------------------------------------ persistence

  private load() {
    // 初回起動時は画面幅に合った鍵盤範囲を選ぶ（スマホで88鍵は細くなりすぎるため）
    const width = window.innerWidth;
    if (width < 620) {
      this.ui.rangeLow = 48;
      this.ui.rangeHigh = 72;
    } else if (width < 1100) {
      this.ui.rangeLow = 36;
      this.ui.rangeHigh = 84;
    }

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
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ settings: this.settings, ui: this.ui })
      );
    } catch {
      /* プライベートモードなどで保存できない場合は無視 */
    }
  }

  private commit() {
    this.engine.updateSettings(this.settings);
    this.save();
  }

  // ------------------------------------------------------------------ audio

  private async ensureAudio(): Promise<void> {
    if (this.audioReady) {
      // 画面ロックや、ほかのアプリへ切り替えたときに、ブラウザ側が AudioContext を
      // 止めていることがある。止まったままだと、以降どこを押しても音が出ない
      // （画面は動くので、壊れていることに気づきにくい）。
      // 演奏のたびに再開を試みる。すでに動いていれば resume() はすぐ返る
      if (this.engine.ctx?.state === 'suspended') void this.engine.ctx.resume();
      // 長く背面に置かれるなどして AudioContext ごと閉じられていた場合は、
      // resume() では戻らないので、作り直しからやり直す
      if (this.engine.ctx?.state === 'closed') {
        this.audioReady = false;
        this.initPromise = null;
      } else {
        return;
      }
    }
    if (!this.initPromise) {
      this.initPromise = this.engine
        .init()
        .then(() => {
          this.audioReady = true;
          this.engine.updateSettings(this.settings);
          this.metronome.attach(this.engine);
          this.setStatus();
        })
        .catch((err) => {
          this.initPromise = null;
          this.setStatus(t('status.audioError', { err }));
          throw err;
        });
    }
    return this.initPromise;
  }

  private noteOn(note: number, velocity: number, fromKeybed: boolean) {
    void this.ensureAudio().then(() => {
      this.engine.noteOn(note, velocity);
      this.recorder.capture({ type: 'note', note, vel: velocity }, this.engine.now);
      this.watchForSilence();
    });
    this.view.noteOn(note, velocity);
    if (!fromKeybed) this.keyboard.highlight(note, true, velocity);
  }

  private noteOff(note: number, fromKeybed: boolean) {
    if (this.audioReady) {
      this.engine.noteOff(note);
      this.recorder.capture({ type: 'off', note }, this.engine.now);
    }
    this.view.noteOff(note);
    if (!fromKeybed) this.keyboard.highlight(note, false);
  }

  private setSustain(on: boolean) {
    const value = on ? 1 : 0;
    void this.ensureAudio().then(() => {
      this.engine.sustain(value);
      this.recorder.capture({ type: 'sustain', value }, this.engine.now);
    });
    this.view.setPedal(on);
    this.sustainButton?.classList.toggle('active', on);
  }

  private setSoft(on: boolean) {
    this.softOn = on;
    void this.ensureAudio().then(() => {
      this.engine.soft(on ? 1 : 0);
      this.recorder.capture({ type: 'soft', value: on ? 1 : 0 }, this.engine.now);
    });
    this.softButton?.classList.toggle('active', on);
  }

  private setSostenuto(on: boolean) {
    this.sostenutoOn = on;
    void this.ensureAudio().then(() => {
      this.engine.sostenuto(on ? 1 : 0);
      this.recorder.capture({ type: 'sostenuto', value: on ? 1 : 0 }, this.engine.now);
    });
    this.sostenutoButton?.classList.toggle('active', on);
  }

  private updateSustainFromInputs() {
    this.setSustain(this.sustainHeld || this.sustainLatched);
  }

  // ------------------------------------------------------------------- view

  private build() {
    this.root.innerHTML = '';
    const app = el('div', 'piano-app');

    // ---------- ヘッダー ----------
    const header = el('header', 'topbar');
    const brand = el('div', 'brand');
    brand.innerHTML = `
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-text">
        <strong>Aozora Grand Piano</strong>
        <small>${t('brand.subtitle')}</small>
      </span>`;

    const presetWrap = el('div', 'preset-wrap');
    const presetSelect = el('select', 'preset-select');
    presetSelect.setAttribute('aria-label', t('preset.ariaLabel'));
    for (const preset of PRESETS) {
      const option = el('option', undefined, t(`preset.${preset.id}.name`));
      option.value = preset.id;
      presetSelect.append(option);
    }
    presetSelect.value = this.ui.presetId;
    presetSelect.addEventListener('change', () => this.selectPreset(presetSelect.value));
    presetWrap.append(presetSelect);

    this.statusEl = el('div', 'status');

    // 全停止（鳴っている音・ペダル・再生をまとめて止める）
    const panicButton = button('', 'ghost panic-btn', () => this.panic());
    panicButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.7" />'
      + '<rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" />'
      + `</svg><span class="btn-text">${t('panic.label')}</span>`;
    panicButton.title = t('panic.title');
    panicButton.setAttribute('aria-label', t('panic.ariaLabel'));

    const langButton = button(t('lang.toggle'), 'ghost round lang-btn', () => toggleLocale());
    langButton.title = 'Switch language / 言語を切り替え';

    const headerActions = el('div', 'header-actions');
    headerActions.append(langButton, panicButton, button(t('help.button'), 'ghost round', () => this.toggleHelp()));

    header.append(brand, presetWrap, this.statusEl, headerActions);

    // ---------- ステージ ----------
    const stage = el('section', 'stage');
    const canvas = el('canvas', 'string-canvas');
    stage.append(canvas);

    const overlay = el('div', 'stage-overlay');
    this.nowPlayingEl = el('div', 'now-playing');
    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);
    this.transportEl = el('div', 'transport-readout', '00:00');
    overlay.append(this.nowPlayingEl, this.transportEl, meter);
    stage.append(overlay);

    // ---------- パネル ----------
    const panel = el('section', 'panel');
    const tabs = el('nav', 'tabs');
    const tabDefs: { id: string; label: string }[] = [
      { id: 'tone', label: t('tab.tone') },
      { id: 'space', label: t('tab.space') },
      { id: 'play', label: t('tab.play') },
      { id: 'rec', label: t('tab.rec') },
      { id: 'demo', label: t('tab.demo') },
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
    main.append(stage, panel);

    // ---------- 鍵盤 ----------
    const keyboardArea = el('footer', 'keyboard-area');
    const pedalBar = el('div', 'pedal-bar');

    this.softButton = button(t('pedal.soft'), 'pedal', () => this.setSoft(!this.softOn));
    this.sostenutoButton = button(t('pedal.sostenuto'), 'pedal', () =>
      this.setSostenuto(!this.sostenutoOn)
    );
    this.sustainButton = button(t('pedal.sustain'), 'pedal wide', () => {
      this.sustainLatched = !this.sustainLatched;
      this.updateSustainFromInputs();
    });

    const octaveDown = button(t('octave.down'), 'ghost small octave-btn', () => this.shiftOctave(-1));
    const octaveUp = button(t('octave.up'), 'ghost small octave-btn', () => this.shiftOctave(1));
    const octaveLabel = el('span', 'octave-label');
    this.updateOctaveLabel = () => {
      octaveLabel.textContent = t('octave.label', { n: this.computerOctave });
    };
    this.updateOctaveLabel();

    pedalBar.append(
      this.softButton,
      this.sostenutoButton,
      this.sustainButton,
      el('span', 'spacer'),
      octaveDown,
      octaveLabel,
      octaveUp
    );

    const keybedScroll = el('div', 'keybed-scroll');
    keyboardArea.append(pedalBar, keybedScroll);

    app.append(header, main, keyboardArea);
    this.root.append(app);

    this.view = new StringView(canvas);
    this.view.start();

    this.keyboard = new PianoKeyboard(keybedScroll, {
      onNoteOn: (note, vel) => this.noteOn(note, vel, true),
      onNoteOff: (note) => this.noteOff(note, true),
    });
    this.keyboard.setLabels(this.ui.labelMode);
    this.keyboard.setFixedVelocity(this.ui.fixedVelocity);
    this.keyboard.setRange(this.ui.rangeLow, this.ui.rangeHigh);
    this.applyKeyWidth();
    this.fitKeyboard();

    this.showTab(this.activeTab);
    this.setStatus();

    if (!this.globalListenersBound) {
      this.globalListenersBound = true;
      window.addEventListener('resize', () => this.fitKeyboard());
      // 最初の操作でオーディオを起動する（ブラウザの自動再生制限対策）
      const kick = () => void this.ensureAudio().catch(() => {});
      window.addEventListener('pointerdown', kick, { once: true });
      window.addEventListener('keydown', kick, { once: true });
    }
  }

  private updateOctaveLabel: () => void = () => {};

  private applyKeyWidth() {
    this.root.style.setProperty('--pkey-w', `${this.ui.keyWidth}px`);
  }

  /** 表示範囲が画面に収まるよう鍵盤の幅を決め、中央（C4付近）にスクロールする */
  private fitKeyboard() {
    const scroll = this.root.querySelector('.keybed-scroll') as HTMLElement | null;
    if (!scroll) return;

    if (this.ui.autoKeyWidth) {
      const [low, high] = this.keyboard.getRange();
      let whites = 0;
      for (let n = low; n <= high; n++) if (![1, 3, 6, 8, 10].includes(n % 12)) whites++;
      const available = scroll.clientWidth - 18;
      this.ui.keyWidth = Math.max(22, Math.min(60, Math.floor(available / whites)));
      this.applyKeyWidth();
    }

    requestAnimationFrame(() => {
      const max = scroll.scrollWidth - scroll.clientWidth;
      if (max <= 0) return;
      const middleC = scroll.querySelector('.pkey[data-note="60"]') as HTMLElement | null;
      const target = middleC
        ? middleC.offsetLeft - scroll.clientWidth / 2
        : max / 2;
      scroll.scrollLeft = Math.max(0, Math.min(max, target));
    });
  }

  /**
   * 音が止まったままになっていないかを見て、そのときだけ知らせる。
   *
   * 止まっているとき、画面からは何も分からない。鍵盤は沈むし、エラーも出ない。
   * 音だけが出ないので、壊れていると思われてしまう。
   *
   * ensureAudio() が resume() を頼んだ直後は、まだ suspended のことがある。
   * すこし待ってから見て、それでも動いていないときだけ出す。
   */
  private watchForSilence() {
    if (this.silenceTimer !== null) return;
    this.silenceTimer = window.setTimeout(() => {
      this.silenceTimer = null;
      const state = this.engine.ctx?.state;
      if (state && state !== 'running') this.setStatus(t('status.audioBlocked'));
      else if (this.statusEl.textContent === t('status.audioBlocked')) this.setStatus();
    }, 500);
  }

  private setStatus(message?: string) {
    if (message) {
      this.statusEl.textContent = message;
      return;
    }
    const parts: string[] = [];
    parts.push(this.audioReady ? t('status.ready') : t('status.pressKey'));
    if (this.midi && this.midi.devices.length > 0) {
      parts.push(t('status.midi', { devices: this.midi.devices.join(', ') }));
    }
    this.statusEl.textContent = parts.join(' ・ ');
  }

  private showTab(id: string) {
    this.activeTab = id;
    for (const btn of this.tabButtons) btn.classList.toggle('active', btn.dataset.tab === id);
    this.panelBody.innerHTML = '';
    switch (id) {
      case 'tone': this.buildToneTab(); break;
      case 'space': this.buildSpaceTab(); break;
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
      card.append(
        el('strong', undefined, t(`preset.${preset.id}.name`)),
        el('span', undefined, t(`preset.${preset.id}.description`))
      );
      card.addEventListener('click', () => {
        this.selectPreset(preset.id);
        this.showTab('tone');
      });
      grid.append(card);
    }
    body.append(el('h2', 'panel-title', t('tone.presetsTitle')), grid);

    const controls = el('div', 'ctl-grid');
    controls.append(
      slider({
        label: t('tone.brightness'),
        min: 0, max: 1, step: 0.01, value: this.settings.brightness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('tone.brightness.hint'),
        onInput: (v) => { this.settings.brightness = v; this.commit(); },
      }),
      slider({
        label: t('tone.strikePos'),
        min: 0, max: 1, step: 0.01, value: this.settings.strikePos,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('tone.strikePos.hint'),
        onInput: (v) => { this.settings.strikePos = v; this.commit(); },
      }),
      slider({
        label: t('tone.decay'),
        min: 0.4, max: 1.8, step: 0.01, value: this.settings.decay,
        format: (v) => `${v.toFixed(2)}×`,
        onInput: (v) => { this.settings.decay = v; this.commit(); },
      }),
      slider({
        label: t('tone.stringRes'),
        min: 0, max: 1, step: 0.01, value: this.settings.stringRes,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('tone.stringRes.hint'),
        onInput: (v) => { this.settings.stringRes = v; this.commit(); },
      }),
      slider({
        label: t('tone.unison'),
        min: 0, max: 1, step: 0.01, value: this.settings.unison,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('tone.unison.hint'),
        onInput: (v) => { this.settings.unison = v; this.commit(); },
      }),
      slider({
        label: t('tone.hammerNoise'),
        min: 0, max: 1, step: 0.01, value: this.settings.hammerNoise,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.hammerNoise = v; this.commit(); },
      }),
      slider({
        label: t('tone.releaseNoise'),
        min: 0, max: 1, step: 0.01, value: this.settings.releaseNoise,
        format: (v) => `${Math.round(v * 100)}`,
        hint: t('tone.releaseNoise.hint'),
        onInput: (v) => { this.settings.releaseNoise = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('tone.soundTitle')), controls);
  }

  private buildSpaceTab() {
    const body = this.panelBody;
    const controls = el('div', 'ctl-grid');

    const reverbOptions: { value: ReverbType; label: string }[] = [
      { value: 'off', label: t('space.reverbOff') },
      ...(Object.keys(ROOMS) as (keyof typeof ROOMS)[]).map((key) => ({
        value: key as ReverbType,
        label: t(`reverb.${key}`),
      })),
    ];

    controls.append(
      slider({
        label: t('space.lid'),
        min: 0, max: 1, step: 0.01, value: this.settings.lid,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: t('space.lid.hint'),
        onInput: (v) => { this.settings.lid = v; this.commit(); },
      }),
      slider({
        label: t('space.tone'),
        min: -1, max: 1, step: 0.01, value: this.settings.tone,
        format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
        onInput: (v) => { this.settings.tone = v; this.commit(); },
      }),
      segmented(t('space.reverbType'), reverbOptions, this.settings.reverbType, (v) => {
        this.settings.reverbType = v;
        this.commit();
      }),
      slider({
        label: t('space.reverbMix'),
        min: 0, max: 0.8, step: 0.01, value: this.settings.reverbMix,
        format: (v) => `${Math.round(v * 125)}`,
        onInput: (v) => { this.settings.reverbMix = v; this.commit(); },
      }),
      slider({
        label: t('space.volume'),
        min: 0, max: 1, step: 0.01, value: this.settings.volume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.volume = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', t('space.title')), controls);

    const note = el('p', 'panel-note');
    note.textContent = t('space.note');
    body.append(note);
  }

  private buildPlayTab() {
    const body = this.panelBody;
    const controls = el('div', 'ctl-grid');

    controls.append(
      slider({
        label: t('play.velCurve'),
        min: 0.6, max: 2, step: 0.01, value: this.settings.velCurve,
        format: (v) => v.toFixed(2),
        hint: t('play.velCurve.hint'),
        onInput: (v) => { this.settings.velCurve = v; this.commit(); },
      }),
      slider({
        label: t('play.dynamics'),
        min: 0.4, max: 1.4, step: 0.01, value: this.settings.dynamics,
        format: (v) => v.toFixed(2),
        hint: t('play.dynamics.hint'),
        onInput: (v) => { this.settings.dynamics = v; this.commit(); },
      }),
      slider({
        label: t('play.a4'),
        min: 415, max: 448, step: 0.5, value: this.settings.a4,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { this.settings.a4 = v; this.commit(); },
      }),
      slider({
        label: t('play.stretch'),
        min: 0, max: 1.5, step: 0.01, value: this.settings.stretch,
        format: (v) => `${v.toFixed(2)}×`,
        hint: t('play.stretch.hint'),
        onInput: (v) => { this.settings.stretch = v; this.commit(); },
      }),
      slider({
        label: t('play.maxVoices'),
        min: 12, max: 48, step: 1, value: this.settings.maxVoices,
        format: (v) => `${v}`,
        hint: t('play.maxVoices.hint'),
        onInput: (v) => { this.settings.maxVoices = v; this.commit(); },
      }),
      slider({
        label: t('play.keyWidth'),
        min: 20, max: 62, step: 1, value: this.ui.keyWidth,
        format: (v) => `${v}px`,
        onInput: (v) => {
          this.ui.autoKeyWidth = false;
          this.ui.keyWidth = v;
          this.applyKeyWidth();
          this.save();
        },
      })
    );
    body.append(el('h2', 'panel-title', t('play.touchTuningTitle')), controls);

    const options = el('div', 'ctl-grid');
    options.append(
      segmented<LabelMode>(
        t('play.labelMode'),
        [
          { value: 'off', label: t('play.labelMode.off') },
          { value: 'c', label: t('play.labelMode.c') },
          { value: 'all', label: t('play.labelMode.all') },
          { value: 'ja', label: t('play.labelMode.ja') },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.keyboard.setLabels(v);
          this.save();
        }
      ),
      segmented(
        t('play.range'),
        [
          { value: 'full', label: t('play.range.full') },
          { value: 'wide', label: t('play.range.wide') },
          { value: 'mid', label: t('play.range.mid') },
          { value: 'small', label: t('play.range.small') },
        ],
        this.rangeKind(),
        (v) => this.setRangeKind(v)
      ),
      segmented(
        t('play.velocityMode'),
        [
          { value: 'touch', label: t('play.velocityMode.touch') },
          { value: 'soft', label: t('play.velocityMode.soft') },
          { value: 'mid', label: t('play.velocityMode.mid') },
          { value: 'loud', label: t('play.velocityMode.loud') },
        ],
        this.velocityKind(),
        (v) => {
          const map: Record<string, number | null> = { touch: null, soft: 0.35, mid: 0.62, loud: 0.9 };
          this.ui.fixedVelocity = map[v] ?? null;
          this.keyboard.setFixedVelocity(this.ui.fixedVelocity);
          this.save();
        }
      )
    );
    body.append(options);

    // メトロノーム
    const metroBox = el('div', 'ctl-grid');
    metroBox.append(
      slider({
        label: t('play.metroTempo'),
        min: 40, max: 208, step: 1, value: this.ui.bpm,
        format: (v) => `${v} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.metronome.setBpm(v);
          this.save();
        },
      }),
      switchRow(t('play.metroToggle'), this.metronome.running, (on) => {
        void this.ensureAudio().then(() => {
          if (on) this.metronome.start(this.ui.bpm);
          else this.metronome.stop();
        });
      })
    );
    body.append(el('h2', 'panel-title', t('play.practiceTitle')), metroBox);

    // MIDI
    const midiBox = el('div', 'midi-box');
    if (MidiInput.supported) {
      const connect = button(
        this.midi ? t('play.midiRescan') : t('play.midiConnect'),
        'primary',
        () => void this.connectMidi()
      );
      midiBox.append(connect);
      const list = el('span', 'panel-note');
      list.textContent = this.midi?.devices.length
        ? t('play.midiConnected', { devices: this.midi.devices.join(', ') })
        : t('play.midiHint');
      midiBox.append(list);
    } else {
      midiBox.append(
        el('span', 'panel-note', t('play.midiUnsupported'))
      );
    }
    body.append(el('h2', 'panel-title', t('play.midiTitle')), midiBox);
  }

  private buildRecordTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', t('rec.title')));

    const row = el('div', 'button-row');
    this.recordButton = button(
      this.recorder.recording ? t('rec.stop') : t('rec.start'),
      this.recorder.recording ? 'danger' : 'primary',
      () => this.toggleRecording()
    );
    const playBtn = button(t('rec.play'), 'ghost', () => this.playRecording());
    const clearBtn = button(t('rec.clear'), 'ghost', () => {
      this.recorder.clear();
      this.lastSequence = null;
      this.showTab('rec');
    });
    row.append(this.recordButton, playBtn, clearBtn);
    body.append(row);

    const info = el('p', 'panel-note');
    const count = this.recorder.events.filter((e) => e.type === 'note').length;
    info.textContent = this.recorder.isEmpty
      ? t('rec.empty')
      : t('rec.count', { count, time: this.formatTime(this.recorder.duration(0)) });
    body.append(info);

    const exportRow = el('div', 'button-row');
    const wavBtn = button(t('rec.exportWav'), 'primary', () => void this.exportWav());
    const midiBtn = button(t('rec.exportMidi'), 'ghost', () => this.exportMidi());
    if (this.exporting) {
      wavBtn.disabled = true;
      wavBtn.textContent = t('rec.exporting');
    }
    exportRow.append(wavBtn, midiBtn);
    body.append(el('h2', 'panel-title', t('rec.filesTitle')), exportRow);

    const note = el('p', 'panel-note');
    note.textContent = t('rec.note');
    body.append(note);
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', t('demo.title')));

    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const card = el('div', 'demo-card');
      const texts = el('div', 'demo-texts');
      const noteKey = demo.note === '本アプリ書き下ろし' ? 'demo.note.original' : 'demo.note.publicDomain';
      texts.append(
        el('strong', undefined, t(`demo.${demo.id}.title`)),
        el('span', undefined, `${t(`demo.${demo.id}.composer`)} ・ ${t(noteKey)}`)
      );
      const play = button(t('demo.play'), 'primary', () => this.playDemo(demo.id));
      card.append(texts, play);
      list.append(card);
    }
    body.append(list);

    const row = el('div', 'button-row');
    row.append(button(t('demo.stop'), 'ghost', () => this.stopPlayback()));
    body.append(row);

    body.append(
      switchRow(
        t('demo.useDemoPreset'),
        this.ui.useDemoPreset,
        (v) => {
          this.ui.useDemoPreset = v;
          this.save();
        }
      )
    );

    const note = el('p', 'panel-note');
    note.textContent = t('demo.note');
    body.append(note);
  }

  // -------------------------------------------------------------- behaviours

  private rangeKind(): string {
    const span = this.ui.rangeHigh - this.ui.rangeLow;
    if (span >= 80) return 'full';
    if (span >= 55) return 'wide';
    if (span >= 40) return 'mid';
    return 'small';
  }

  private setRangeKind(kind: string) {
    const ranges: Record<string, [number, number]> = {
      full: [21, 108],
      wide: [36, 96],
      mid: [36, 84],
      small: [48, 72],
    };
    const [low, high] = ranges[kind] ?? ranges.full;
    this.ui.rangeLow = low;
    this.ui.rangeHigh = high;
    this.keyboard.setRange(low, high);
    this.fitKeyboard();
    this.save();
  }

  private velocityKind(): string {
    const v = this.ui.fixedVelocity;
    if (v === null) return 'touch';
    if (v < 0.45) return 'soft';
    if (v < 0.75) return 'mid';
    return 'loud';
  }

  private selectPreset(id: string) {
    this.ui.presetId = id;
    this.settings = applyPreset(this.settings, id);
    this.commit();
    const select = this.root.querySelector('.preset-select') as HTMLSelectElement | null;
    if (select) select.value = id;
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) this.flashNowPlaying(t('flash.presetChanged', { name: t(`preset.${preset.id}.name`) }));
    if (this.activeTab === 'tone' || this.activeTab === 'space') this.showTab(this.activeTab);
  }

  private shiftOctave(delta: number) {
    this.computerOctave = Math.max(0, Math.min(7, this.computerOctave + delta));
    this.updateOctaveLabel();
  }

  private panic() {
    this.player.stop();
    this.engine.panic();
    this.keyboard.clearAll();
    this.view.allOff();
    this.heldComputerKeys.clear();
    this.sustainLatched = false;
    this.sustainHeld = false;
    this.updateSustainFromInputs();
    this.resetTransport();
    this.restoreDemoPreset();
    this.flashNowPlaying(t('flash.allStopped'));
  }

  /** 再生位置の表示を初期状態に戻す */
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
    this.commit();
    const select = this.root.querySelector('.preset-select') as HTMLSelectElement | null;
    if (select) select.value = saved.presetId;
    if (this.activeTab === 'tone' || this.activeTab === 'space') this.showTab(this.activeTab);
  }

  private async connectMidi() {
    if (!this.midi) {
      this.midi = new MidiInput({
        noteOn: (note, vel) => {
          this.noteOn(note, vel, false);
        },
        noteOff: (note) => this.noteOff(note, false),
        sustain: (v) => {
          this.sustainHeld = v > 0.45;
          this.updateSustainFromInputs();
        },
        sostenuto: (v) => this.setSostenuto(v > 0.45),
        soft: (v) => this.setSoft(v > 0.45),
        allNotesOff: () => this.panic(),
      });
      this.midi.onDevicesChanged = () => {
        this.setStatus();
        if (this.activeTab === 'play') this.showTab('play');
      };
    }
    await this.ensureAudio();
    const ok = await this.midi.init();
    this.setStatus(ok ? undefined : t('flash.midiConnectFailed'));
    if (this.activeTab === 'play') this.showTab('play');
  }

  private toggleRecording() {
    void this.ensureAudio().then(() => {
      if (this.recorder.recording) {
        this.recorder.stop(this.engine.now);
        this.lastSequence = { events: this.recorder.events, name: 'recording' };
        this.resetTransport();
        this.flashNowPlaying(t('flash.recStopped'));
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
      // 再生後に戻すため、切り替える前の音色を覚えておく
      // （デモを続けて再生したときは最初の音色を保持する）
      const previous = this.demoRestore
        ? { settings: this.demoRestore.settings, presetId: this.demoRestore.presetId }
        : { settings: { ...this.settings }, presetId: this.ui.presetId };
      this.selectPreset(demo.presetId);
      this.demoRestore = { ...previous, snapshot: JSON.stringify(this.settings) };
    }
    void this.ensureAudio().then(() => {
      const events = demo.build();
      this.startPlayback(events, `${t(`demo.${demo.id}.title`)} / ${t(`demo.${demo.id}.composer`)}`);
    });
  }

  private startPlayback(events: PerformanceEvent[], label: string) {
    this.player.stop();
    this.keyboard.clearAll();
    this.lastSequence = { events, name: label };
    this.player.onNote = (note, on, vel) => {
      if (on && !this.player.playing) return; // 停止後に遅れて届いた点灯は無視
      this.keyboard.highlight(note, on, vel);
      if (on) this.view.noteOn(note, vel);
      else this.view.noteOff(note);
    };
    this.player.onProgress = (elapsed, total) => {
      this.transportEl.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
    };
    this.player.onEnd = () => {
      this.keyboard.clearAll();
      this.view.allOff();
      this.resetTransport();
      this.restoreDemoPreset();
      this.flashNowPlaying(t('flash.playbackEnded'));
    };
    this.player.play(events);
    this.flashNowPlaying(`▶ ${label}`);
  }

  private stopPlayback() {
    this.player.stop();
    this.keyboard.clearAll();
    this.view.allOff();
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
      this.flashNowPlaying(t('flash.nothingToExport'));
      return;
    }
    this.exporting = true;
    if (this.activeTab === 'rec') this.showTab('rec');
    this.flashNowPlaying(t('flash.exportingWav'));
    try {
      const last = source.events.reduce((max, ev) => Math.max(max, ev.time), 0);
      const buffer = await renderPerformance(source.events, this.settings, last + 6);
      await this.saveFile(encodeWav(buffer), timestampName('aozora-piano', 'wav'), t('flash.wavSaved'));
    } catch (err) {
      this.flashNowPlaying(t('flash.exportFailed', { err: String(err) }));
    } finally {
      this.exporting = false;
      if (this.activeTab === 'rec') this.showTab('rec');
    }
  }

  private async exportMidi() {
    const source = this.exportEvents();
    if (!source || source.events.length === 0) {
      this.flashNowPlaying(t('flash.nothingToExport'));
      return;
    }
    try {
      await this.saveFile(
        encodeMidi(source.events),
        timestampName('aozora-piano', 'mid'),
        t('flash.midiSaved')
      );
    } catch (err) {
      this.flashNowPlaying(t('flash.exportFailed', { err: String(err) }));
    }
  }

  /**
   * 保存して、済んだことを伝える。
   * 同梱アプリでは端末のどこに置いたかまで出す（web ではブラウザ任せなので出さない）
   */
  private async saveFile(blob: Blob, filename: string, done: string) {
    const outcome = await downloadBlob(blob, filename);
    this.flashNowPlaying(outcome.kind === 'file' ? `${done} → ${outcome.path}` : done);
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
        <li><strong>${t('help.pcKeys.term')}</strong> … ${t('help.pcKeys.desc')}</li>
        <li><strong>${t('help.pedals.term')}</strong> … ${t('help.pedals.desc')}</li>
        <li><strong>${t('help.midi.term')}</strong> … ${t('help.midi.desc')}</li>
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
    const close = button(t('help.close'), 'primary', () => modal.remove());
    card.append(close);
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
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.sustainHeld = true;
        this.updateSustainFromInputs();
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.setSoft(true);
        return;
      }
      if (e.code === 'ArrowLeft') { this.shiftOctave(-1); return; }
      if (e.code === 'ArrowRight') { this.shiftOctave(1); return; }
      if (e.code === 'Escape') { this.panic(); return; }

      const offset = COMPUTER_KEY_MAP[e.code];
      if (offset === undefined) return;
      e.preventDefault();
      const note = 12 * (this.computerOctave + 1) + offset;
      if (note < 21 || note > 108 || this.heldComputerKeys.has(e.code)) return;
      this.heldComputerKeys.set(e.code, note);
      this.noteOn(note, 0.72, false);
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.sustainHeld = false;
        this.updateSustainFromInputs();
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.setSoft(false);
        return;
      }
      const note = this.heldComputerKeys.get(e.code);
      if (note === undefined) return;
      this.heldComputerKeys.delete(e.code);
      this.noteOff(note, false);
    });

    window.addEventListener('blur', () => {
      for (const [code, note] of this.heldComputerKeys) {
        this.noteOff(note, false);
        this.heldComputerKeys.delete(code);
      }
    });
  }

  private startMeterLoop() {
    const loop = () => {
      const level = this.audioReady ? this.engine.level() : 0;
      this.view.setLevel(level);
      this.meterFill.style.transform = `scaleX(${Math.min(1, level * 1.15)})`;
      if (this.recorder.recording) {
        this.transportEl.textContent = `● ${this.formatTime(this.recorder.elapsed(this.engine.now))}`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
