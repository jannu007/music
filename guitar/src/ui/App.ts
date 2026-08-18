import { AMPS, GuitarEngine, renderPerformance } from '../audio/GuitarEngine';
import { COMPUTER_KEY_MAP, MidiInput } from '../audio/midi';
import { PRESETS, applyPreset, findPreset } from '../audio/presets';
import {
  Player,
  Recorder,
  downloadBlob,
  encodeMidi,
  encodeWav,
  timestampName,
} from '../audio/recorder';
import { CABS, ROOMS } from '../audio/cabinet';
import {
  DEFAULT_SETTINGS,
  type AmpType,
  type BodyType,
  type CabType,
  type DriveType,
  type GuitarSettings,
  type ModType,
  type PerformanceEvent,
  type PerformanceEventInput,
  type ReverbType,
} from '../audio/types';
import { chordName, findQuality, parseChord, cachedVoicing, type Chord } from '../music/chords';
import { arrange, arrangeDuration, barTimes, type ArrangeBar } from '../music/arranger';
import { findFretting } from '../music/fretting';
import { PATTERNS, findPattern } from '../music/strum';
import { TUNINGS, findTuning, midiToFreq, noteName } from '../music/tunings';
import { DEMOS } from '../data/demos';
import { ChordPads } from './ChordPads';
import { FRET_CHORD, Fretboard, type LabelMode } from './Fretboard';
import { Metronome, ReferenceTone } from './Metronome';
import { StringView } from './StringView';
import { button, el, section, segmented, select, slider, switchRow } from './controls';
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

const STORAGE_KEY = 'takibi-guitar-v1';

interface StoredChord {
  root: number;
  quality: string;
}

interface UiState {
  presetId: string;
  labelMode: LabelMode;
  fretCount: number;
  bpm: number;
  patternId: string;
  progression: StoredChord[];
  keyRoot: number;
  keyMinor: boolean;
  strumSpread: number;
  humanize: number;
  loopBacking: boolean;
}

const DEFAULT_UI: UiState = {
  presetId: 'steel',
  labelMode: 'note',
  fretCount: 15,
  bpm: 100,
  patternId: 'folk',
  progression: [
    { root: 0, quality: 'maj' },
    { root: 7, quality: 'maj' },
    { root: 9, quality: 'min' },
    { root: 5, quality: 'maj' },
  ],
  keyRoot: 0,
  keyMinor: false,
  strumSpread: 0.014,
  humanize: 0.3,
  loopBacking: true,
};

export class GuitarApp {
  private root: HTMLElement;
  private engine = new GuitarEngine();
  private fretboard!: Fretboard;
  private chordPads: ChordPads | null = null;
  private view!: StringView;
  private recorder = new Recorder();
  private player!: Player;
  private metronome = new Metronome();
  private reference = new ReferenceTone();
  private midi: MidiInput | null = null;

  private settings: GuitarSettings = { ...DEFAULT_SETTINGS };
  private ui: UiState = { ...DEFAULT_UI };

  /** いま指板に表示しているコードフォーム（弦ごとのフレット、-1=弾かない） */
  private currentShape: number[] | null = null;
  private currentChord: Chord | null = null;
  private palmOn = false;
  private heldComputerKeys = new Map<string, { string: number; note: number }>();
  private computerOctave = 3;
  /** MIDI入力で鳴っているノート → 弦 */
  private midiNotes = new Map<number, number>();

  private lastSequence: { events: PerformanceEvent[]; name: string; duration: number } | null = null;
  private backingPlaying = false;
  private exporting = false;

  private statusEl!: HTMLElement;
  private transportEl!: HTMLElement;
  private chordReadout!: HTMLElement;
  private meterFill!: HTMLElement;
  private panelBody!: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  private activeTab = 'chord';
  private palmButton!: HTMLButtonElement;
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

  // ------------------------------------------------------------ 保存と復元

  private load() {
    // スマホでは指板を短く表示する（フレットが細くなりすぎるため）
    if (window.innerWidth < 620) this.ui.fretCount = 7;
    else if (window.innerWidth < 1000) this.ui.fretCount = 12;

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
    this.engine.updateSettings(this.settings, this.tuning().notes);
    this.save();
  }

  private tuning() {
    return findTuning(this.settings.tuningId);
  }

  // ------------------------------------------------------------------ 音声

  private async ensureAudio(): Promise<void> {
    if (this.audioReady) {
      // 画面ロックやタブの背面化でブラウザ側が AudioContext を止めていることがあるため、
      // 演奏操作のたびに念のため再開を試みる（すでに動作中なら resume() は即座に解決する）
      if (this.engine.ctx?.state === 'suspended') void this.engine.ctx.resume();
      // 長時間バックグラウンドに置かれるなどして AudioContext 自体が閉じられていた場合、
      // resume() では復帰できないため、初期化からやり直す
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
          this.engine.updateSettings(this.settings, this.tuning().notes);
          this.metronome.attach(this.engine);
          this.reference.attach(this.engine);
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

  /** 単発の演奏イベントを即座に鳴らす（録音にも記録する） */
  private fire(ev: PerformanceEventInput) {
    void this.ensureAudio().then(() => {
      switch (ev.type) {
        case 'pluck':
          this.engine.pluck(ev.string, ev.fret, ev.vel, ev.mute);
          break;
        case 'fret':
          this.engine.setFret(ev.string, ev.fret, ev.slide, ev.vel);
          break;
        case 'bend':
          this.engine.bend(ev.string, ev.amount);
          break;
        case 'vibrato':
          this.engine.vibrato(ev.string, ev.depth, ev.rate);
          break;
        case 'damp':
          this.engine.damp(ev.string, ev.amount ?? 1);
          break;
        case 'dampAll':
          this.engine.dampAll();
          break;
        case 'palm':
          this.engine.palm(ev.value);
          break;
      }
      this.recorder.capture(ev, this.engine.now);
    });
  }

  /** 未来の時刻にスケジュールする（ストロークのずらし用） */
  private fireAt(ev: PerformanceEventInput, at: number) {
    void this.ensureAudio().then(() => {
      this.engine.schedule({ ...ev, time: 0 } as PerformanceEvent, at);
      this.recorder.capture(ev, at);
    });
  }

  private pluck(string: number, fret: number, vel: number) {
    const count = this.tuning().notes.length;
    if (string < 0 || string >= count) return;
    let actual = fret;
    if (fret === FRET_CHORD) {
      // コードフォームに従う。押さえていない弦は鳴らさない
      if (!this.currentShape) actual = 0;
      else {
        actual = this.currentShape[string];
        if (actual === undefined || actual < 0) return;
      }
    }
    this.fire({ type: 'pluck', string, fret: actual, vel, mute: this.palmOn ? 0.85 : 0 });
    this.view.hit(string, vel);
    this.fretboard.flash(string, actual);
  }

  /** コードをストロークする */
  private strum(chord: Chord, dir: 'down' | 'up', vel = 0.85) {
    const tuning = this.tuning();
    const voicing = cachedVoicing(tuning, chord, 0);
    this.setChord(chord, voicing.frets);

    const order: number[] = [];
    for (let s = 0; s < voicing.frets.length; s++) {
      if (voicing.frets[s] < 0) continue;
      order.push(s);
    }
    if (dir === 'up') order.reverse();

    const spread = this.ui.strumSpread * (dir === 'up' ? 0.75 : 1);
    void this.ensureAudio().then(() => {
      const base = this.engine.now + 0.02;
      order.forEach((s, i) => {
        const at = base + i * spread;
        const level = Math.max(0.08, vel * (dir === 'down' ? 1 - i * 0.02 : 0.9 - i * 0.015));
        this.fireAt(
          { type: 'pluck', string: s, fret: voicing.frets[s], vel: level, mute: this.palmOn ? 0.85 : 0 },
          at
        );
        window.setTimeout(() => {
          this.view.hit(s, level);
          this.fretboard.flash(s, voicing.frets[s]);
        }, Math.max(0, (at - this.engine.now) * 1000));
      });
    });
  }

  private setChord(chord: Chord | null, frets: number[] | null) {
    this.currentChord = chord;
    this.currentShape = frets;
    this.fretboard.showShape(frets, chord ? chord.root : null);
    this.chordReadout.textContent = chord ? chordName(chord) : '';
    this.chordReadout.classList.toggle('visible', !!chord);
  }

  private setPalm(on: boolean) {
    this.palmOn = on;
    this.palmButton?.classList.toggle('active', on);
    this.fire({ type: 'palm', value: on ? 0.85 : 0 });
  }

  // ------------------------------------------------------------------ 画面

  private build() {
    this.root.innerHTML = '';
    const app = el('div', 'guitar-app');

    // ---------- ヘッダー ----------
    const header = el('header', 'topbar');
    const brand = el('div', 'brand');
    brand.innerHTML = `
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-text">
        <strong>Takibi Guitar</strong>
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

    const langButton = button(t('lang.toggle'), 'ghost round lang-btn', () => toggleLocale());

    const panicButton = button('', 'ghost panic-btn', () => this.panic());
    panicButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.7" />'
      + '<rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" />'
      + `</svg><span class="btn-text">${t('panic.label')}</span>`;
    panicButton.title = t('panic.title');
    panicButton.setAttribute('aria-label', t('panic.ariaLabel'));

    const headerActions = el('div', 'header-actions');
    headerActions.append(langButton, panicButton, button(t('help.button'), 'ghost round', () => this.toggleHelp()));
    header.append(brand, presetWrap, this.statusEl, headerActions);

    // ---------- ステージ ----------
    const stage = el('section', 'stage');
    const canvas = el('canvas', 'string-canvas');
    stage.append(canvas);

    const overlay = el('div', 'stage-overlay');
    this.chordReadout = el('div', 'chord-readout');
    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);
    this.transportEl = el('div', 'transport-readout', '00:00');
    overlay.append(this.chordReadout, this.transportEl, meter);
    stage.append(overlay);

    // ---------- パネル ----------
    const panel = el('section', 'panel');
    const tabs = el('nav', 'tabs');
    const tabDefs: { id: string; label: string }[] = [
      { id: 'chord', label: t('tab.chord') },
      { id: 'backing', label: t('tab.backing') },
      { id: 'string', label: t('tab.string') },
      { id: 'amp', label: t('tab.amp') },
      { id: 'space', label: t('tab.space') },
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
    main.append(stage, panel);

    // ---------- 指板 ----------
    const boardArea = el('footer', 'board-area');
    const playBar = el('div', 'play-bar');

    this.palmButton = button(t('palm.label'), 'pedal', () => this.setPalm(!this.palmOn));
    this.palmButton.title = t('palm.title');
    const downButton = button(t('strum.down'), 'pedal wide', () => this.strumCurrent('down'));
    const upButton = button(t('strum.up'), 'pedal', () => this.strumCurrent('up'));
    const dampButton = button(t('mute.label'), 'ghost small', () => this.fire({ type: 'dampAll' }));

    playBar.append(this.palmButton, downButton, upButton, el('span', 'spacer'), dampButton);

    const boardScroll = el('div', 'board-scroll');
    boardArea.append(playBar, boardScroll);

    app.append(header, main, boardArea);
    this.root.append(app);

    this.view = new StringView(canvas);
    this.view.setCount(this.tuning().notes.length);
    this.view.start();

    this.fretboard = new Fretboard(boardScroll, this.tuning(), {
      onPluck: (string, fret, vel) => this.pluck(string, fret, vel),
      onSlide: (string, fret, time) => {
        this.fire({ type: 'fret', string, fret, slide: time });
      },
      onBend: (string, semitones) => this.fire({ type: 'bend', string, amount: semitones }),
    });
    this.fretboard.setLabelMode(this.ui.labelMode);
    this.fretboard.setFrets(this.ui.fretCount);
    this.fretboard.setCapo(this.settings.capo);

    this.showTab(this.activeTab);
    this.setStatus();

    // 最初の操作でオーディオを起動する（ブラウザの自動再生制限対策）
    const kick = () => void this.ensureAudio().catch(() => {});
    app.addEventListener('pointerdown', kick, { once: true });
    if (!this.globalListenersBound) {
      this.globalListenersBound = true;
      window.addEventListener('keydown', kick, { once: true });
    }
  }

  private strumCurrent(dir: 'down' | 'up') {
    const chord = this.currentChord ?? this.chordPads?.getSelected() ?? null;
    if (chord) {
      this.strum(chord, dir);
      return;
    }
    // コードが選ばれていなければ開放弦をそのまま鳴らす
    const count = this.tuning().notes.length;
    const order = dir === 'down' ? range(count) : range(count).reverse();
    void this.ensureAudio().then(() => {
      const base = this.engine.now + 0.02;
      order.forEach((s, i) => {
        const at = base + i * this.ui.strumSpread;
        this.fireAt({ type: 'pluck', string: s, fret: 0, vel: 0.8 }, at);
      });
    });
  }

  private setStatus(message?: string) {
    if (message) {
      this.statusEl.textContent = message;
      return;
    }
    const parts: string[] = [];
    parts.push(this.audioReady ? t('status.ready') : t('status.tapToStart'));
    const tuning = this.tuning();
    parts.push(t(`tuning.${tuning.id}.name`).replace(/\s*\(.*\)$/, ''));
    if (this.settings.capo > 0) parts.push(t('status.capo', { n: this.settings.capo }));
    if (this.midi && this.midi.devices.length > 0) parts.push(t('status.midi', { devices: this.midi.devices.join(', ') }));
    this.statusEl.textContent = parts.join(' ・ ');
  }

  private showTab(id: string) {
    this.activeTab = id;
    for (const btn of this.tabButtons) btn.classList.toggle('active', btn.dataset.tab === id);
    this.panelBody.innerHTML = '';
    this.chordPads = null;
    switch (id) {
      case 'chord': this.buildChordTab(); break;
      case 'backing': this.buildBackingTab(); break;
      case 'string': this.buildStringTab(); break;
      case 'amp': this.buildAmpTab(); break;
      case 'space': this.buildSpaceTab(); break;
      case 'play': this.buildPlayTab(); break;
      case 'rec': this.buildRecordTab(); break;
      case 'demo': this.buildDemoTab(); break;
    }
  }

  // ------------------------------------------------------------------ タブ

  private buildChordTab() {
    const body = this.panelBody;
    const holder = el('div', 'chord-pads');
    body.append(holder);
    this.chordPads = new ChordPads(holder, {
      onStrum: (chord, dir) => this.strum(chord, dir),
      onSelect: (chord) => {
        const voicing = cachedVoicing(this.tuning(), chord, 0);
        this.setChord(chord, voicing.frets);
      },
    });
    this.chordPads.setKey(this.ui.keyRoot, this.ui.keyMinor);

    const info = el('p', 'section-hint', t('chord.hint'));
    body.append(info);

    body.append(
      slider({
        label: t('ctl.strumSpeed.label'),
        min: 4, max: 45, step: 1, value: this.ui.strumSpread * 1000,
        format: (v) => `${v.toFixed(0)} ${t('unit.msPerString')}`,
        hint: t('ctl.strumSpeed.hint'),
        onInput: (v) => {
          this.ui.strumSpread = v / 1000;
          this.save();
        },
      })
    );
  }

  private buildBackingTab() {
    const body = this.panelBody;

    const patternSection = section(t('panel.rhythmPattern.title'));
    patternSection.append(
      select(
        t('ctl.pattern.label'),
        PATTERNS.map((p) => ({ value: p.id, label: t(`pattern.${p.id}.name`) })),
        this.ui.patternId,
        (v) => {
          this.ui.patternId = v;
          this.save();
          this.showTab('backing');
        },
        t(`pattern.${findPattern(this.ui.patternId).id}.hint`)
      ),
      slider({
        label: t('ctl.tempo.label'),
        min: 40, max: 220, step: 1, value: this.ui.bpm,
        format: (v) => `${v.toFixed(0)} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.metronome.setBpm(v);
          this.save();
        },
      }),
      slider({
        label: t('ctl.humanize.label'),
        min: 0, max: 1, step: 0.01, value: this.ui.humanize,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.humanize.hint'),
        onInput: (v) => {
          this.ui.humanize = v;
          this.save();
        },
      })
    );
    body.append(patternSection);

    // ---- コード進行 ----
    const progSection = section(t('panel.progression.title'), t('panel.progression.hint'));
    const slots = el('div', 'prog-grid');
    const repaint = () => {
      slots.innerHTML = '';
      if (this.ui.progression.length === 0) {
        slots.append(el('p', 'section-hint', t('progression.empty')));
      }
      this.ui.progression.forEach((entry, index) => {
        const chord: Chord = { root: entry.root, quality: findQuality(entry.quality) };
        const slot = el('button', 'prog-slot', chordName(chord));
        slot.type = 'button';
        slot.title = t('slot.title');
        slot.addEventListener('click', () => {
          this.ui.progression.splice(index, 1);
          this.save();
          repaint();
        });
        slots.append(slot);
      });
    };
    repaint();

    const addRow = el('div', 'button-row');
    addRow.append(
      button(t('action.addSelected'), 'primary small', () => {
        const chord = this.currentChord ?? this.chordPads?.getSelected();
        if (!chord) {
          this.setStatus(t('status.selectChordFirst'));
          return;
        }
        if (this.ui.progression.length >= 16) return;
        this.ui.progression.push({ root: chord.root, quality: chord.quality.id });
        this.save();
        repaint();
      }),
      button(t('action.clearAll'), 'ghost small', () => {
        this.ui.progression = [];
        this.save();
        repaint();
      })
    );
    progSection.append(slots, addRow);
    body.append(progSection);

    // ---- 再生 ----
    const playSection = section(t('panel.backingPlayback.title'));
    const playRow = el('div', 'button-row');
    const playButton = button(
      this.backingPlaying ? t('backing.stop') : t('backing.play'),
      this.backingPlaying ? 'danger' : 'primary',
      () => {
        if (this.backingPlaying) this.stopPlayback();
        else this.playBacking();
        this.showTab('backing');
      }
    );
    playRow.append(
      playButton,
      button(t('action.exportBackingWav'), 'ghost small', () => void this.exportBacking())
    );
    playSection.append(
      playRow,
      switchRow(t('ctl.loopBacking.label'), this.ui.loopBacking, (v) => {
        this.ui.loopBacking = v;
        this.save();
      })
    );
    body.append(playSection);
  }

  private buildStringTab() {
    const body = this.panelBody;
    const s = this.settings;
    const set = <K extends keyof GuitarSettings>(key: K, value: GuitarSettings[K]) => {
      this.settings[key] = value;
      this.commit();
    };

    body.append(
      slider({
        label: t('ctl.pickPos.label'),
        min: 0.03, max: 0.5, step: 0.005, value: s.pickPos,
        format: (v) => (v < 0.12 ? t('pickPos.bridge') : v > 0.3 ? t('pickPos.neck') : t('pickPos.standard')),
        hint: t('ctl.pickPos.hint'),
        onInput: (v) => set('pickPos', v),
      }),
      slider({
        label: t('ctl.pickHard.label'),
        min: 0, max: 1, step: 0.01, value: s.pickHard,
        format: (v) => (v < 0.25 ? t('pickHard.finger') : v > 0.7 ? t('pickHard.hard') : t('pickHard.normal')),
        onInput: (v) => set('pickHard', v),
      }),
      slider({
        label: t('ctl.brightness.label'),
        min: 0, max: 1, step: 0.01, value: s.brightness,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.brightness.hint'),
        onInput: (v) => set('brightness', v),
      }),
      slider({
        label: t('ctl.sustain.label'),
        min: 0.3, max: 2.2, step: 0.01, value: s.sustain,
        format: (v) => `${v.toFixed(2)}x`,
        onInput: (v) => set('sustain', v),
      }),
      slider({
        label: t('ctl.stiffness.label'),
        min: 0, max: 1, step: 0.01, value: s.stiffness,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.stiffness.hint'),
        onInput: (v) => set('stiffness', v),
      }),
      slider({
        label: t('ctl.coupling.label'),
        min: 0, max: 1, step: 0.01, value: s.coupling,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.coupling.hint'),
        onInput: (v) => set('coupling', v),
      }),
      slider({
        label: t('ctl.pickNoise.label'),
        min: 0, max: 1, step: 0.01, value: s.pickNoise,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('pickNoise', v),
      }),
      slider({
        label: t('ctl.fretNoise.label'),
        min: 0, max: 1, step: 0.01, value: s.fretNoise,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.fretNoise.hint'),
        onInput: (v) => set('fretNoise', v),
      }),
      slider({
        label: t('ctl.buzz.label'),
        min: 0, max: 1, step: 0.01, value: s.buzz,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.buzz.hint'),
        onInput: (v) => set('buzz', v),
      }),
      slider({
        label: t('ctl.spread.label'),
        min: 0, max: 1, step: 0.01, value: s.spread,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('spread', v),
      })
    );

    const bodySection = section(t('panel.body.title'), t('panel.body.hint'));
    bodySection.append(
      select<BodyType>(
        t('ctl.bodyType.label'),
        (['none', 'dread', 'parlor', 'nylon', 'archtop', 'resonator'] as BodyType[]).map((bt) => ({
          value: bt,
          label: t(`body.${bt}.label`),
        })),
        s.bodyType,
        (v) => {
          set('bodyType', v);
          this.showTab('string');
        }
      )
    );
    if (s.bodyType !== 'none') {
      bodySection.append(
        slider({
          label: t('ctl.bodyMix.label'),
          min: 0, max: 1, step: 0.01, value: s.bodyMix,
          format: (v) => `${(v * 100).toFixed(0)}%`,
          onInput: (v) => set('bodyMix', v),
        })
      );
    }
    body.append(bodySection);
  }

  private buildAmpTab() {
    const body = this.panelBody;
    const s = this.settings;
    const set = <K extends keyof GuitarSettings>(key: K, value: GuitarSettings[K]) => {
      this.settings[key] = value;
      this.commit();
    };

    body.append(
      select<AmpType>(
        t('ctl.amp.label'),
        (['off', 'clean', 'tweed', 'british', 'modern', 'bassamp'] as AmpType[]).map((at) => ({
          value: at,
          label: t(`amp.${at}.label`),
        })),
        s.ampType,
        (v) => {
          set('ampType', v);
          this.showTab('amp');
        },
        t('ctl.amp.hint')
      ),
      select<DriveType>(
        t('ctl.driveType.label'),
        [
          { value: 'off' as DriveType, label: t('drive.off') },
          { value: 'boost' as DriveType, label: t('drive.boost') },
          { value: 'overdrive' as DriveType, label: t('drive.overdrive') },
          { value: 'distortion' as DriveType, label: t('drive.distortion') },
          { value: 'fuzz' as DriveType, label: t('drive.fuzz') },
        ],
        s.driveType,
        (v) => {
          set('driveType', v);
          this.showTab('amp');
        }
      )
    );

    if (s.driveType !== 'off') {
      body.append(
        slider({
          label: t('ctl.driveAmount.label'),
          min: 0, max: 1, step: 0.01, value: s.drive,
          format: (v) => `${(v * 100).toFixed(0)}%`,
          onInput: (v) => set('drive', v),
        })
      );
    }

    body.append(
      slider({
        label: t('ctl.compress.label'),
        min: 0, max: 1, step: 0.01, value: s.compress,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: t('ctl.compress.hint'),
        onInput: (v) => set('compress', v),
      })
    );

    const eq = section(t('panel.eq.title'));
    for (const key of ['bass', 'mid', 'treble', 'presence'] as const) {
      eq.append(
        slider({
          label: t(`eq.${key}`),
          min: -1, max: 1, step: 0.01, value: s[key],
          format: (v) => `${(v * 11).toFixed(1)} dB`,
          onInput: (v) => set(key, v),
        })
      );
    }
    body.append(eq);

    body.append(
      select<CabType>(
        t('ctl.cabinet.label'),
        [
          { value: 'off' as CabType, label: t('cab.off.label') },
          ...(Object.keys(CABS) as Exclude<CabType, 'off'>[]).map((k) => ({
            value: k as CabType,
            label: t(`cab.${k}.label`),
          })),
        ],
        s.cabType,
        (v) => set('cabType', v),
        t('ctl.cabinet.hint')
      )
    );
  }

  private buildSpaceTab() {
    const body = this.panelBody;
    const s = this.settings;
    const set = <K extends keyof GuitarSettings>(key: K, value: GuitarSettings[K]) => {
      this.settings[key] = value;
      this.commit();
    };

    const mod = section(t('panel.mod.title'));
    mod.append(
      select<ModType>(
        t('ctl.modType.label'),
        [
          { value: 'off' as ModType, label: t('mod.off') },
          { value: 'chorus' as ModType, label: t('mod.chorus') },
          { value: 'vibrato' as ModType, label: t('mod.vibrato') },
          { value: 'phaser' as ModType, label: t('mod.phaser') },
          { value: 'tremolo' as ModType, label: t('mod.tremolo') },
          { value: 'wah' as ModType, label: t('mod.wah') },
        ],
        s.modType,
        (v) => {
          set('modType', v);
          this.showTab('space');
        }
      )
    );
    if (s.modType !== 'off') {
      mod.append(
        slider({
          label: t('ctl.modRate.label'),
          min: 0.1, max: 9, step: 0.05, value: s.modRate,
          format: (v) => `${v.toFixed(2)} Hz`,
          onInput: (v) => set('modRate', v),
        }),
        slider({
          label: t('ctl.modDepth.label'),
          min: 0, max: 1, step: 0.01, value: s.modDepth,
          format: (v) => `${(v * 100).toFixed(0)}%`,
          onInput: (v) => set('modDepth', v),
        })
      );
    }
    body.append(mod);

    const delay = section(t('panel.delay.title'));
    delay.append(
      slider({
        label: t('ctl.delayMix.label'),
        min: 0, max: 1, step: 0.01, value: s.delayMix,
        format: (v) => (v === 0 ? t('delay.off') : `${(v * 100).toFixed(0)}%`),
        onInput: (v) => set('delayMix', v),
      }),
      slider({
        label: t('ctl.delayTime.label'),
        min: 0.04, max: 1.2, step: 0.005, value: s.delayTime,
        format: (v) => `${(v * 1000).toFixed(0)} ms`,
        onInput: (v) => set('delayTime', v),
      }),
      slider({
        label: t('ctl.delayFeedback.label'),
        min: 0, max: 0.85, step: 0.01, value: s.delayFeedback,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('delayFeedback', v),
      })
    );
    const syncRow = el('div', 'button-row');
    for (const [labelKey, div] of [['delay.quarter', 1], ['delay.dottedEighth', 0.75], ['delay.eighth', 0.5], ['delay.sixteenth', 0.25]] as const) {
      syncRow.append(
        button(t(labelKey), 'ghost small', () => {
          set('delayTime', Math.min(1.2, (60 / this.ui.bpm) * div));
          this.showTab('space');
        })
      );
    }
    delay.append(el('div', 'ctl-hint', t('delay.syncHint', { bpm: this.ui.bpm })), syncRow);
    body.append(delay);

    const reverb = section(t('panel.reverb.title'));
    reverb.append(
      select<ReverbType>(
        t('ctl.reverbType.label'),
        [
          { value: 'off' as ReverbType, label: t('reverb.off') },
          ...(Object.keys(ROOMS) as Exclude<ReverbType, 'off'>[]).map((k) => ({
            value: k as ReverbType,
            label: t(`room.${k}.label`),
          })),
        ],
        s.reverbType,
        (v) => set('reverbType', v)
      ),
      slider({
        label: t('ctl.reverbAmount.label'),
        min: 0, max: 1, step: 0.01, value: s.reverbMix,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('reverbMix', v),
      })
    );
    body.append(reverb);

    body.append(
      slider({
        label: t('ctl.masterVolume.label'),
        min: 0, max: 1, step: 0.01, value: s.volume,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('volume', v),
      }),
      slider({
        label: t('ctl.outputTrim.label'),
        min: 0.2, max: 3, step: 0.01, value: s.outputTrim,
        format: (v) => `${(20 * Math.log10(v)).toFixed(1)} dB`,
        hint: t('ctl.outputTrim.hint'),
        onInput: (v) => set('outputTrim', v),
      })
    );
  }

  private buildPlayTab() {
    const body = this.panelBody;
    const s = this.settings;

    // ---- チューニング ----
    const tuneSection = section(t('panel.tuning.title'));
    tuneSection.append(
      select(
        t('ctl.tuningSelect.label'),
        TUNINGS.map((tn) => ({ value: tn.id, label: t(`tuning.${tn.id}.name`) })),
        s.tuningId,
        (v) => {
          this.settings.tuningId = v;
          const tuning = findTuning(v);
          this.fretboard.setTuning(tuning);
          this.view.setCount(tuning.notes.length);
          this.setChord(null, null);
          this.commit();
          this.setStatus();
          this.showTab('play');
        },
        t(`tuning.${findTuning(s.tuningId).id}.hint`)
      ),
      slider({
        label: t('ctl.capo.label'),
        min: 0, max: 9, step: 1, value: s.capo,
        format: (v) => (v === 0 ? t('capo.none') : t('capo.fret', { v })),
        onInput: (v) => {
          this.settings.capo = v;
          this.fretboard.setCapo(v);
          this.commit();
          this.setStatus();
        },
      }),
      slider({
        label: t('ctl.a4.label'),
        min: 415, max: 466, step: 0.5, value: s.a4,
        format: (v) => `A = ${v.toFixed(1)} Hz`,
        onInput: (v) => {
          this.settings.a4 = v;
          this.commit();
        },
      })
    );

    // 各弦の基準音
    const tuner = el('div', 'tuner-row');
    const tuning = this.tuning();
    for (let i = tuning.notes.length - 1; i >= 0; i--) {
      const note = tuning.notes[i] + s.capo;
      const btn = button(t('tuner.stringLabel', { n: i + 1, note: noteName(note) }), 'ghost small', () => {
        void this.ensureAudio().then(() => this.reference.play(midiToFreq(note, s.a4)));
      });
      tuner.append(btn);
    }
    tuneSection.append(
      el('div', 'ctl-hint', t('tuner.hint')),
      tuner
    );
    body.append(tuneSection);

    // ---- 指板 ----
    const boardSection = section(t('panel.boardDisplay.title'));
    boardSection.append(
      slider({
        label: t('ctl.fretCount.label'),
        min: 5, max: 22, step: 1, value: this.ui.fretCount,
        format: (v) => t('fretCount.value', { v: v.toFixed(0) }),
        onInput: (v) => {
          this.ui.fretCount = v;
          this.fretboard.setFrets(v);
          this.save();
        },
      }),
      segmented<LabelMode>(
        t('ctl.labelMode.label'),
        [
          { value: 'off', label: t('labelMode.off') },
          { value: 'note', label: t('labelMode.note') },
          { value: 'degree', label: t('labelMode.degree') },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.fretboard.setLabelMode(v);
          this.save();
        },
        t('ctl.labelMode.hint')
      )
    );
    body.append(boardSection);

    // ---- メトロノーム ----
    const metro = section(t('panel.metronome.title'));
    const metroRow = el('div', 'button-row');
    metroRow.append(
      button(this.metronome.running ? t('metro.stop') : t('metro.start'), this.metronome.running ? 'danger' : '', () => {
        void this.ensureAudio().then(() => {
          if (this.metronome.running) {
            this.metronome.stop();
          } else {
            this.metronome.beatsPerBar = findPattern(this.ui.patternId).beats;
            this.metronome.start(this.ui.bpm);
          }
          this.showTab('play');
        });
      })
    );
    metro.append(
      slider({
        label: t('ctl.tempo.label'),
        min: 40, max: 220, step: 1, value: this.ui.bpm,
        format: (v) => `${v.toFixed(0)} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.metronome.setBpm(v);
          this.save();
        },
      }),
      metroRow
    );
    body.append(metro);

    // ---- 入力 ----
    const input = section(t('panel.input.title'));
    input.append(
      slider({
        label: t('ctl.velCurve.label'),
        min: 0.5, max: 2, step: 0.01, value: s.velCurve,
        format: (v) => (v < 0.9 ? t('velCurve.light') : v > 1.3 ? t('velCurve.heavy') : t('velCurve.standard')),
        onInput: (v) => {
          this.settings.velCurve = v;
          this.commit();
        },
      })
    );
    if (MidiInput.supported) {
      const midiRow = el('div', 'button-row');
      midiRow.append(
        button(this.midi ? t('midi.reconnect') : t('midi.connect'), 'ghost small', () => {
          void this.enableMidi();
        })
      );
      input.append(midiRow);
      input.append(
        el('div', 'ctl-hint', t('midi.hint'))
      );
    } else {
      input.append(el('div', 'ctl-hint', t('midi.unsupported')));
    }
    input.append(
      el('div', 'ctl-hint', t('keyboard.hint'))
    );
    body.append(input);
  }

  private buildRecordTab() {
    const body = this.panelBody;

    this.recordButton = button(
      this.recorder.recording ? t('record.stop') : t('record.start'),
      this.recorder.recording ? 'danger' : 'primary',
      () => this.toggleRecording()
    );

    const row = el('div', 'button-row');
    row.append(
      this.recordButton,
      button(t('record.play'), 'ghost', () => this.playRecording()),
      button(t('record.clear'), 'ghost small', () => {
        this.recorder.clear();
        this.lastSequence = null;
        this.showTab('rec');
      })
    );
    body.append(row);

    const count = this.recorder.events.length;
    body.append(
      el('p', 'section-hint',
        count === 0
          ? t('record.empty')
          : t('record.count', { count, time: this.formatTime(this.recorder.duration(0)) }))
    );

    const exportRow = el('div', 'button-row');
    exportRow.append(
      button(t('export.wav'), 'primary small', () => void this.exportWav()),
      button(t('export.midi'), 'ghost small', () => this.exportMidi())
    );
    body.append(section(t('panel.export.title')), exportRow);
    body.append(
      el('div', 'ctl-hint', t('export.hint'))
    );
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(
      el('p', 'section-hint', t('demo.hint'))
    );
    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const item = el('button', 'demo-item');
      item.type = 'button';
      item.append(
        el('span', 'demo-title', t(`demo.${demo.id}.title`)),
        el('span', 'demo-desc', t(`demo.${demo.id}.description`)),
        el('span', 'demo-meta', `${demo.chords.join(' - ')} ／ ${demo.bpm} BPM`)
      );
      item.addEventListener('click', () => this.playDemo(demo.id));
      list.append(item);
    }
    body.append(list);
    const stopRow = el('div', 'button-row');
    stopRow.append(button(t('demo.stop'), 'ghost small', () => this.stopPlayback()));
    body.append(stopRow);
  }

  // ------------------------------------------------------------------ 動作

  private selectPreset(id: string) {
    this.ui.presetId = id;
    const preset = findPreset(id);
    this.settings = applyPreset(this.settings, id);

    // ベースやウクレレはチューニングも一緒に変わる
    const tuning = this.tuning();
    this.fretboard.setTuning(tuning);
    this.fretboard.setLabelMode(this.ui.labelMode);
    this.fretboard.setFrets(this.ui.fretCount);
    this.fretboard.setCapo(this.settings.capo);
    this.view.setCount(tuning.notes.length);
    this.setChord(null, null);

    if (preset.pattern) this.ui.patternId = preset.pattern;
    this.commit();
    this.setStatus();
    this.showTab(this.activeTab);
  }

  private async enableMidi() {
    if (!this.midi) {
      this.midi = new MidiInput({
        noteOn: (note, velocity) => this.midiNoteOn(note, velocity),
        noteOff: (note) => this.midiNoteOff(note),
        hold: () => {},
        palm: (value) => {
          this.palmOn = value > 0.5;
          this.palmButton?.classList.toggle('active', this.palmOn);
          this.fire({ type: 'palm', value });
        },
        pitchBend: (semitones) => {
          for (const string of this.midiNotes.values()) {
            this.fire({ type: 'bend', string, amount: semitones });
          }
        },
        allNotesOff: () => {
          this.midiNotes.clear();
          this.fire({ type: 'dampAll' });
        },
      });
      this.midi.onDevicesChanged = () => this.setStatus();
    }
    await this.ensureAudio();
    const ok = await this.midi.init();
    this.setStatus(ok ? undefined : t('status.midiUnavailable'));
  }

  private midiNoteOn(note: number, velocity: number) {
    const tuning = this.tuning();
    const busy = new Array<boolean>(tuning.notes.length).fill(false);
    for (const s of this.midiNotes.values()) busy[s] = true;
    const hit = findFretting(tuning, note, this.settings.capo, busy, this.ui.fretCount);
    if (!hit) return;
    this.midiNotes.set(note, hit.string);
    this.pluck(hit.string, hit.fret, velocity);
  }

  private midiNoteOff(note: number) {
    const string = this.midiNotes.get(note);
    if (string === undefined) return;
    this.midiNotes.delete(note);
    this.fire({ type: 'damp', string, amount: 0.85 });
  }

  private panic() {
    this.stopPlayback();
    this.metronome.stop();
    this.reference.stop();
    if (this.audioReady) this.engine.panic();
    this.palmOn = false;
    this.palmButton?.classList.remove('active');
    this.midiNotes.clear();
    this.heldComputerKeys.clear();
    if (this.recorder.recording) {
      this.recorder.stop(this.engine.now);
      this.recordButton?.classList.remove('danger');
    }
    this.transportEl.textContent = '00:00';
    this.setStatus(t('status.allStopped'));
    window.setTimeout(() => this.setStatus(), 1200);
  }

  private toggleRecording() {
    void this.ensureAudio().then(() => {
      if (this.recorder.recording) {
        this.recorder.stop(this.engine.now);
      } else {
        this.recorder.start(this.engine.now);
      }
      this.showTab('rec');
    });
  }

  private playRecording() {
    if (this.recorder.isEmpty) {
      this.setStatus(t('status.noRecording'));
      return;
    }
    void this.ensureAudio().then(() => {
      this.startPlayback(this.recorder.events, t('flash.recordingPlayback'), this.recorder.duration());
    });
  }

  /** デモやコード進行を「演奏イベント」に展開する */
  private buildBars(chordNames: string[]): ArrangeBar[] {
    const bars: ArrangeBar[] = [];
    for (const name of chordNames) {
      const chord = parseChord(name);
      if (chord) bars.push({ chord });
    }
    return bars;
  }

  private progressionBars(): ArrangeBar[] {
    return this.ui.progression.map((entry) => ({
      chord: { root: entry.root, quality: findQuality(entry.quality) },
    }));
  }

  private playBacking() {
    const bars = this.progressionBars();
    if (bars.length === 0) {
      this.setStatus(t('status.emptyProgression'));
      return;
    }
    void this.ensureAudio().then(() => {
      const pattern = findPattern(this.ui.patternId);
      const repeats = this.ui.loopBacking ? 8 : 2;
      const all: ArrangeBar[] = [];
      for (let i = 0; i < repeats; i++) all.push(...bars);
      const events = arrange(this.tuning(), all, pattern, {
        bpm: this.ui.bpm,
        strumSpread: this.ui.strumSpread,
        humanize: this.ui.humanize,
      });
      const times = barTimes(all, pattern, this.ui.bpm);
      const timeline = all.map((bar, i) => ({ time: times[i], chord: bar.chord }));
      this.backingPlaying = true;
      this.startPlayback(events, t('flash.backing'), arrangeDuration(all, pattern, this.ui.bpm) + 2, timeline);
    });
  }

  private playDemo(id: string) {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    void this.ensureAudio().then(() => {
      this.selectPreset(demo.presetId);
      this.ui.bpm = demo.bpm;
      this.ui.patternId = demo.patternId;

      const pattern = findPattern(demo.patternId);
      const one = this.buildBars(demo.chords);
      const all: ArrangeBar[] = [];
      for (let i = 0; i < demo.repeat; i++) all.push(...one);
      const events = arrange(this.tuning(), all, pattern, {
        bpm: demo.bpm,
        strumSpread: this.ui.strumSpread,
        humanize: this.ui.humanize,
        palm: demo.palm,
        minFret: demo.minFret,
      });
      const times = barTimes(all, pattern, demo.bpm);
      const timeline = all.map((bar, i) => ({ time: times[i], chord: bar.chord }));
      this.startPlayback(events, t(`demo.${demo.id}.title`), arrangeDuration(all, pattern, demo.bpm) + 3, timeline);
    });
  }

  private startPlayback(
    events: PerformanceEvent[],
    label: string,
    duration: number,
    timeline?: { time: number; chord: Chord }[]
  ) {
    this.player.stop();
    this.lastSequence = { events, name: label, duration };
    let timelineIndex = -1;
    this.player.onEvent = (ev) => {
      if (ev.type !== 'pluck') return;
      this.view.hit(ev.string, ev.vel);
      this.fretboard.flash(ev.string, ev.fret);
    };
    this.player.onProgress = (elapsed, total) => {
      this.transportEl.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
      if (!timeline || timeline.length === 0) return;
      // いま鳴っている小節のコードを画面に出す
      let index = 0;
      for (let i = 0; i < timeline.length; i++) {
        if (timeline[i].time <= elapsed) index = i;
        else break;
      }
      if (index !== timelineIndex) {
        timelineIndex = index;
        const chord = timeline[index].chord;
        const voicing = cachedVoicing(this.tuning(), chord, 0);
        this.setChord(chord, voicing.frets);
      }
    };
    this.player.onEnd = () => {
      this.transportEl.textContent = '00:00';
      if (this.backingPlaying && this.ui.loopBacking) {
        this.playBacking();
        return;
      }
      this.backingPlaying = false;
      // デモがブリッジミュートを使っていた場合に備えて、演奏者の設定へ戻す
      this.engine.palm(this.palmOn ? 0.85 : 0);
      this.setStatus();
    };
    this.player.play(events, 2.5);
    this.setStatus(t('status.playing', { label }));
  }

  private stopPlayback() {
    this.backingPlaying = false;
    this.player.stop();
    this.transportEl.textContent = '00:00';
    this.setStatus();
  }

  private async exportBacking() {
    const bars = this.progressionBars();
    if (bars.length === 0) {
      this.setStatus(t('status.emptyProgression'));
      return;
    }
    const pattern = findPattern(this.ui.patternId);
    const all: ArrangeBar[] = [];
    for (let i = 0; i < 4; i++) all.push(...bars);
    const events = arrange(this.tuning(), all, pattern, {
      bpm: this.ui.bpm,
      strumSpread: this.ui.strumSpread,
      humanize: this.ui.humanize,
    });
    await this.renderAndDownload(events, arrangeDuration(all, pattern, this.ui.bpm) + 3, 'takibi-backing');
  }

  private async exportWav() {
    const events = this.recorder.isEmpty ? this.lastSequence?.events : this.recorder.events;
    const duration = this.recorder.isEmpty
      ? this.lastSequence?.duration ?? 0
      : this.recorder.duration();
    if (!events || events.length === 0) {
      this.setStatus(t('status.nothingToExportLong'));
      return;
    }
    await this.renderAndDownload(events, duration, 'takibi-guitar');
  }

  private async renderAndDownload(events: PerformanceEvent[], duration: number, prefix: string) {
    if (this.exporting) return;
    this.exporting = true;
    this.setStatus(t('status.exporting'));
    try {
      await this.ensureAudio();
      const buffer = await renderPerformance(
        events,
        this.settings,
        this.tuning().notes,
        Math.max(1, duration)
      );
      downloadBlob(encodeWav(buffer), timestampName(prefix, 'wav'));
      this.setStatus(t('status.wavExported'));
    } catch (err) {
      this.setStatus(t('status.exportFailed', { err: String(err) }));
    } finally {
      this.exporting = false;
      window.setTimeout(() => this.setStatus(), 2000);
    }
  }

  private exportMidi() {
    const events = this.recorder.isEmpty ? this.lastSequence?.events : this.recorder.events;
    if (!events || events.length === 0) {
      this.setStatus(t('status.nothingToExport'));
      return;
    }
    // 25 = Acoustic Guitar (steel) / 27 = Electric Guitar (clean) / 33 = ベース
    const preset = this.settings;
    const program = preset.tuningId === 'bass' ? 33 : preset.ampType === 'off' ? 25 : 27;
    const blob = encodeMidi(events, this.tuning().notes, this.settings.capo, this.ui.bpm, program);
    downloadBlob(blob, timestampName('takibi-guitar', 'mid'));
    this.setStatus(t('status.midiExported'));
    window.setTimeout(() => this.setStatus(), 2000);
  }

  private toggleHelp() {
    const existing = this.root.querySelector('.help-overlay');
    if (existing) {
      existing.remove();
      return;
    }
    const overlay = el('div', 'help-overlay');
    const card = el('div', 'help-card');
    card.innerHTML = `
      <h2>${t('help.title')}</h2>
      <h3>${t('help.play.heading')}</h3>
      <ul>
        <li>${t('help.play.tap')}</li>
        <li>${t('help.play.bendSlide')}</li>
        <li>${t('help.play.vibrato')}</li>
        <li>${t('help.play.strumBar')}</li>
        <li>${t('help.play.chordPad')}</li>
      </ul>
      <h3>${t('help.keyboard.heading')}</h3>
      <ul>
        <li>${t('help.keyboard.space')}</li>
        <li>${t('help.keyboard.digits')}</li>
        <li>${t('help.keyboard.notes')}</li>
        <li>${t('help.keyboard.misc')}</li>
      </ul>
      <h3>${t('help.tone.heading')}</h3>
      <ul>
        <li>${t('help.tone.synthesis')}</li>
        <li>${t('help.tone.tabs')}</li>
      </ul>
      <h3>${t('help.create.heading')}</h3>
      <ul>
        <li>${t('help.create.backing')}</li>
        <li>${t('help.create.record')}</li>
      </ul>
      <p class="help-note">${t('help.note')}</p>
    `;
    const close = button(t('help.close'), 'primary', () => overlay.remove());
    card.append(close);
    overlay.append(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    this.root.append(overlay);
  }

  private formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------ キーボード

  private bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === 'Escape') {
        this.panic();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        this.strumCurrent(e.shiftKey ? 'up' : 'down');
        return;
      }
      if (e.code === 'KeyM' && !this.heldComputerKeys.has('KeyM')) {
        // 音階キーとしても使うので、単独押しのときだけミュート切替にする
        if (!e.shiftKey) {
          this.setPalm(!this.palmOn);
          return;
        }
      }
      if (e.code === 'ArrowUp') {
        this.computerOctave = Math.min(6, this.computerOctave + 1);
        this.setStatus(t('status.pcOctave', { n: this.computerOctave }));
        window.setTimeout(() => this.setStatus(), 900);
        return;
      }
      if (e.code === 'ArrowDown') {
        this.computerOctave = Math.max(1, this.computerOctave - 1);
        this.setStatus(t('status.pcOctave', { n: this.computerOctave }));
        window.setTimeout(() => this.setStatus(), 900);
        return;
      }

      // 数字キー = 弦を単独で弾く
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        const count = this.tuning().notes.length;
        // 1弦＝高音側なので並びを反転する
        const string = count - 1 - index;
        if (string >= 0) {
          e.preventDefault();
          this.pluck(string, this.currentShape ? this.currentShape[string] ?? 0 : 0, 0.82);
        }
        return;
      }

      const semis = COMPUTER_KEY_MAP[e.code];
      if (semis === undefined || e.repeat || this.heldComputerKeys.has(e.code)) return;
      const note = (this.computerOctave + 1) * 12 + semis;
      const tuning = this.tuning();
      const busy = new Array(tuning.notes.length).fill(false);
      for (const held of this.heldComputerKeys.values()) busy[held.string] = true;
      const hit = findFretting(tuning, note, this.settings.capo, busy, this.ui.fretCount);
      if (!hit) return;
      e.preventDefault();
      this.heldComputerKeys.set(e.code, { string: hit.string, note });
      this.pluck(hit.string, hit.fret, 0.82);
    });

    window.addEventListener('keyup', (e) => {
      const held = this.heldComputerKeys.get(e.code);
      if (!held) return;
      this.heldComputerKeys.delete(e.code);
      this.fire({ type: 'damp', string: held.string, amount: 0.8 });
    });

    window.addEventListener('blur', () => {
      this.heldComputerKeys.clear();
    });
  }

  private startMeterLoop() {
    const tick = () => {
      if (this.audioReady) {
        const level = this.engine.level();
        this.meterFill.style.width = `${Math.min(100, level * 118).toFixed(1)}%`;
        this.meterFill.classList.toggle('hot', level > 0.92);
        this.view.update(this.engine.status);
        if (this.recorder.recording) {
          this.transportEl.textContent = `● ${this.formatTime(this.recorder.elapsed(this.engine.now))}`;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
