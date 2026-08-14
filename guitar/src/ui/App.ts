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
import { CABS, ROOMS, bodyLabel } from '../audio/cabinet';
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

  constructor(root: HTMLElement) {
    this.root = root;
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
    if (this.audioReady) return;
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
          this.setStatus(`オーディオを開始できません: ${err}`);
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
        <small>物理モデリング・ギター</small>
      </span>`;

    const presetWrap = el('div', 'preset-wrap');
    const presetSelect = el('select', 'preset-select');
    presetSelect.setAttribute('aria-label', '音色プリセット');
    for (const preset of PRESETS) {
      const option = el('option', undefined, preset.name);
      option.value = preset.id;
      presetSelect.append(option);
    }
    presetSelect.value = this.ui.presetId;
    presetSelect.addEventListener('change', () => this.selectPreset(presetSelect.value));
    presetWrap.append(presetSelect);

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
      { id: 'chord', label: 'コード' },
      { id: 'backing', label: '伴奏' },
      { id: 'string', label: '弦' },
      { id: 'amp', label: 'アンプ' },
      { id: 'space', label: '空間' },
      { id: 'play', label: '演奏' },
      { id: 'rec', label: '録音' },
      { id: 'demo', label: 'デモ' },
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

    // ---------- 指板 ----------
    const boardArea = el('footer', 'board-area');
    const playBar = el('div', 'play-bar');

    this.palmButton = button('ブリッジミュート', 'pedal', () => this.setPalm(!this.palmOn));
    this.palmButton.title = 'M キーでも切り替えられます';
    const downButton = button('▼ ダウン', 'pedal wide', () => this.strumCurrent('down'));
    const upButton = button('▲ アップ', 'pedal', () => this.strumCurrent('up'));
    const dampButton = button('ミュート', 'ghost small', () => this.fire({ type: 'dampAll' }));

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
    window.addEventListener('keydown', kick, { once: true });
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
    parts.push(this.audioReady ? '準備完了' : '指板に触れると開始');
    const tuning = this.tuning();
    parts.push(tuning.name.replace(/\s*\(.*\)$/, ''));
    if (this.settings.capo > 0) parts.push(`カポ ${this.settings.capo}`);
    if (this.midi && this.midi.devices.length > 0) parts.push(`MIDI: ${this.midi.devices.join(', ')}`);
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

    const info = el('p', 'section-hint',
      'パッドをタップでダウンストローク、上へスワイプでアップストローク。'
      + '選んだコードの押さえ方は指板に表示されます。');
    body.append(info);

    body.append(
      slider({
        label: 'ストロークの速さ',
        min: 4, max: 45, step: 1, value: this.ui.strumSpread * 1000,
        format: (v) => `${v.toFixed(0)} ms/弦`,
        hint: '隣り合う弦を弾く間隔。大きいほどゆっくり「ジャラーン」と鳴ります。',
        onInput: (v) => {
          this.ui.strumSpread = v / 1000;
          this.save();
        },
      })
    );
  }

  private buildBackingTab() {
    const body = this.panelBody;

    const patternSection = section('リズムパターン');
    patternSection.append(
      select(
        'パターン',
        PATTERNS.map((p) => ({ value: p.id, label: p.name })),
        this.ui.patternId,
        (v) => {
          this.ui.patternId = v;
          this.save();
          this.showTab('backing');
        },
        findPattern(this.ui.patternId).hint
      ),
      slider({
        label: 'テンポ',
        min: 40, max: 220, step: 1, value: this.ui.bpm,
        format: (v) => `${v.toFixed(0)} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.metronome.setBpm(v);
          this.save();
        },
      }),
      slider({
        label: '人間らしさ',
        min: 0, max: 1, step: 0.01, value: this.ui.humanize,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: 'タイミングと強さを少しだけ揺らします。',
        onInput: (v) => {
          this.ui.humanize = v;
          this.save();
        },
      })
    );
    body.append(patternSection);

    // ---- コード進行 ----
    const progSection = section('コード進行', '1マス＝1小節。タップで削除できます。');
    const slots = el('div', 'prog-grid');
    const repaint = () => {
      slots.innerHTML = '';
      if (this.ui.progression.length === 0) {
        slots.append(el('p', 'section-hint', 'コードがありません。下のボタンで追加してください。'));
      }
      this.ui.progression.forEach((entry, index) => {
        const chord: Chord = { root: entry.root, quality: findQuality(entry.quality) };
        const slot = el('button', 'prog-slot', chordName(chord));
        slot.type = 'button';
        slot.title = 'タップで削除';
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
      button('選択中のコードを追加', 'primary small', () => {
        const chord = this.currentChord ?? this.chordPads?.getSelected();
        if (!chord) {
          this.setStatus('先に「コード」タブでコードを選んでください');
          return;
        }
        if (this.ui.progression.length >= 16) return;
        this.ui.progression.push({ root: chord.root, quality: chord.quality.id });
        this.save();
        repaint();
      }),
      button('すべて消す', 'ghost small', () => {
        this.ui.progression = [];
        this.save();
        repaint();
      })
    );
    progSection.append(slots, addRow);
    body.append(progSection);

    // ---- 再生 ----
    const playSection = section('伴奏の再生');
    const playRow = el('div', 'button-row');
    const playButton = button(
      this.backingPlaying ? '■ 停止' : '▶ 伴奏を再生',
      this.backingPlaying ? 'danger' : 'primary',
      () => {
        if (this.backingPlaying) this.stopPlayback();
        else this.playBacking();
        this.showTab('backing');
      }
    );
    playRow.append(
      playButton,
      button('WAVで書き出す', 'ghost small', () => void this.exportBacking())
    );
    playSection.append(
      playRow,
      switchRow('繰り返し再生', this.ui.loopBacking, (v) => {
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
        label: 'ピッキング位置',
        min: 0.03, max: 0.5, step: 0.005, value: s.pickPos,
        format: (v) => (v < 0.12 ? 'ブリッジ寄り' : v > 0.3 ? 'ネック寄り' : '標準'),
        hint: 'ブリッジ寄りほど硬く、ネック寄りほど丸い音になります。',
        onInput: (v) => set('pickPos', v),
      }),
      slider({
        label: 'ピックの硬さ',
        min: 0, max: 1, step: 0.01, value: s.pickHard,
        format: (v) => (v < 0.25 ? '指' : v > 0.7 ? '硬いピック' : '普通のピック'),
        onInput: (v) => set('pickHard', v),
      }),
      slider({
        label: '弦の明るさ',
        min: 0, max: 1, step: 0.01, value: s.brightness,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: '高域の伸び。新品の弦ほど明るく鳴ります。',
        onInput: (v) => set('brightness', v),
      }),
      slider({
        label: 'サステイン',
        min: 0.3, max: 2.2, step: 0.01, value: s.sustain,
        format: (v) => `${v.toFixed(2)}x`,
        onInput: (v) => set('sustain', v),
      }),
      slider({
        label: '弦の張り（倍音のずれ）',
        min: 0, max: 1, step: 0.01, value: s.stiffness,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: '太い弦ほど倍音が少し高めにずれます。金属的な質感の元。',
        onInput: (v) => set('stiffness', v),
      }),
      slider({
        label: '弦どうしの共鳴',
        min: 0, max: 1, step: 0.01, value: s.coupling,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: 'ブリッジを介して他の弦が共鳴します。',
        onInput: (v) => set('coupling', v),
      }),
      slider({
        label: 'ピックのアタック音',
        min: 0, max: 1, step: 0.01, value: s.pickNoise,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('pickNoise', v),
      }),
      slider({
        label: '指のこすれ音',
        min: 0, max: 1, step: 0.01, value: s.fretNoise,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: 'スライドしたときのキュッという音。',
        onInput: (v) => set('fretNoise', v),
      }),
      slider({
        label: 'ビビり',
        min: 0, max: 1, step: 0.01, value: s.buzz,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: '強く弾いたときだけ出るバズ音。',
        onInput: (v) => set('buzz', v),
      }),
      slider({
        label: '左右の広がり',
        min: 0, max: 1, step: 0.01, value: s.spread,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('spread', v),
      })
    );

    const bodySection = section('ボディ（胴鳴り）', 'アコースティックの箱の響き。エレキでは「なし」に。');
    bodySection.append(
      select<BodyType>(
        '種類',
        (['none', 'dread', 'parlor', 'nylon', 'archtop', 'resonator'] as BodyType[]).map((t) => ({
          value: t,
          label: bodyLabel(t),
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
          label: '胴鳴りの量',
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
        'アンプ',
        (['off', 'clean', 'tweed', 'british', 'modern', 'bassamp'] as AmpType[]).map((t) => ({
          value: t,
          label: AMPS[t].label,
        })),
        s.ampType,
        (v) => {
          set('ampType', v);
          this.showTab('amp');
        },
        'アコースティックは「アンプなし」。'
      ),
      select<DriveType>(
        '歪み',
        [
          { value: 'off' as DriveType, label: 'なし' },
          { value: 'boost' as DriveType, label: 'ブースター' },
          { value: 'overdrive' as DriveType, label: 'オーバードライブ' },
          { value: 'distortion' as DriveType, label: 'ディストーション' },
          { value: 'fuzz' as DriveType, label: 'ファズ' },
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
          label: 'ドライブ量',
          min: 0, max: 1, step: 0.01, value: s.drive,
          format: (v) => `${(v * 100).toFixed(0)}%`,
          onInput: (v) => set('drive', v),
        })
      );
    }

    body.append(
      slider({
        label: 'コンプレッサー',
        min: 0, max: 1, step: 0.01, value: s.compress,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        hint: '粒を揃えてサステインを伸ばします。カッティングに有効。',
        onInput: (v) => set('compress', v),
      })
    );

    const eq = section('イコライザー');
    for (const [key, label] of [
      ['bass', 'ロー'],
      ['mid', 'ミドル'],
      ['treble', 'ハイ'],
      ['presence', 'プレゼンス'],
    ] as const) {
      eq.append(
        slider({
          label,
          min: -1, max: 1, step: 0.01, value: s[key],
          format: (v) => `${(v * 11).toFixed(1)} dB`,
          onInput: (v) => set(key, v),
        })
      );
    }
    body.append(eq);

    body.append(
      select<CabType>(
        'キャビネット',
        [
          { value: 'off' as CabType, label: 'なし（ラインアウト）' },
          ...(Object.keys(CABS) as Exclude<CabType, 'off'>[]).map((k) => ({
            value: k as CabType,
            label: CABS[k].label,
          })),
        ],
        s.cabType,
        (v) => set('cabType', v),
        'スピーカーの箱の特性。歪ませるときは必ず通すと自然になります。'
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

    const mod = section('モジュレーション');
    mod.append(
      select<ModType>(
        '種類',
        [
          { value: 'off' as ModType, label: 'なし' },
          { value: 'chorus' as ModType, label: 'コーラス' },
          { value: 'vibrato' as ModType, label: 'ビブラート' },
          { value: 'phaser' as ModType, label: 'フェイザー' },
          { value: 'tremolo' as ModType, label: 'トレモロ' },
          { value: 'wah' as ModType, label: 'オートワウ' },
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
          label: '速さ',
          min: 0.1, max: 9, step: 0.05, value: s.modRate,
          format: (v) => `${v.toFixed(2)} Hz`,
          onInput: (v) => set('modRate', v),
        }),
        slider({
          label: '深さ',
          min: 0, max: 1, step: 0.01, value: s.modDepth,
          format: (v) => `${(v * 100).toFixed(0)}%`,
          onInput: (v) => set('modDepth', v),
        })
      );
    }
    body.append(mod);

    const delay = section('ディレイ');
    delay.append(
      slider({
        label: 'ディレイ量',
        min: 0, max: 1, step: 0.01, value: s.delayMix,
        format: (v) => (v === 0 ? 'オフ' : `${(v * 100).toFixed(0)}%`),
        onInput: (v) => set('delayMix', v),
      }),
      slider({
        label: 'ディレイタイム',
        min: 0.04, max: 1.2, step: 0.005, value: s.delayTime,
        format: (v) => `${(v * 1000).toFixed(0)} ms`,
        onInput: (v) => set('delayTime', v),
      }),
      slider({
        label: 'フィードバック',
        min: 0, max: 0.85, step: 0.01, value: s.delayFeedback,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('delayFeedback', v),
      })
    );
    const syncRow = el('div', 'button-row');
    for (const [label, div] of [['4分', 1], ['付点8分', 0.75], ['8分', 0.5], ['16分', 0.25]] as const) {
      syncRow.append(
        button(label, 'ghost small', () => {
          set('delayTime', Math.min(1.2, (60 / this.ui.bpm) * div));
          this.showTab('space');
        })
      );
    }
    delay.append(el('div', 'ctl-hint', `テンポ（${this.ui.bpm} BPM）に合わせる:`), syncRow);
    body.append(delay);

    const reverb = section('リバーブ');
    reverb.append(
      select<ReverbType>(
        '種類',
        [
          { value: 'off' as ReverbType, label: 'なし' },
          ...(Object.keys(ROOMS) as Exclude<ReverbType, 'off'>[]).map((k) => ({
            value: k as ReverbType,
            label: ROOMS[k].label,
          })),
        ],
        s.reverbType,
        (v) => set('reverbType', v)
      ),
      slider({
        label: 'リバーブ量',
        min: 0, max: 1, step: 0.01, value: s.reverbMix,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('reverbMix', v),
      })
    );
    body.append(reverb);

    body.append(
      slider({
        label: 'マスター音量',
        min: 0, max: 1, step: 0.01, value: s.volume,
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onInput: (v) => set('volume', v),
      }),
      slider({
        label: '出力トリム',
        min: 0.2, max: 3, step: 0.01, value: s.outputTrim,
        format: (v) => `${(20 * Math.log10(v)).toFixed(1)} dB`,
        hint: '音色ごとの音量差をならすための補正。プリセットを選ぶと自動で設定されます。',
        onInput: (v) => set('outputTrim', v),
      })
    );
  }

  private buildPlayTab() {
    const body = this.panelBody;
    const s = this.settings;

    // ---- チューニング ----
    const tuneSection = section('チューニング');
    tuneSection.append(
      select(
        '調弦',
        TUNINGS.map((t) => ({ value: t.id, label: t.name })),
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
        findTuning(s.tuningId).hint
      ),
      slider({
        label: 'カポ',
        min: 0, max: 9, step: 1, value: s.capo,
        format: (v) => (v === 0 ? 'なし' : `${v} フレット`),
        onInput: (v) => {
          this.settings.capo = v;
          this.fretboard.setCapo(v);
          this.commit();
          this.setStatus();
        },
      }),
      slider({
        label: '基準ピッチ',
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
      const btn = button(`${i + 1}弦 ${noteName(note)}`, 'ghost small', () => {
        void this.ensureAudio().then(() => this.reference.play(midiToFreq(note, s.a4)));
      });
      tuner.append(btn);
    }
    tuneSection.append(
      el('div', 'ctl-hint', 'タップすると基準音が鳴ります（耳で合わせるチューナー）:'),
      tuner
    );
    body.append(tuneSection);

    // ---- 指板 ----
    const boardSection = section('指板の表示');
    boardSection.append(
      slider({
        label: '表示するフレット数',
        min: 5, max: 22, step: 1, value: this.ui.fretCount,
        format: (v) => `${v.toFixed(0)} フレット`,
        onInput: (v) => {
          this.ui.fretCount = v;
          this.fretboard.setFrets(v);
          this.save();
        },
      }),
      segmented<LabelMode>(
        '音名の表示',
        [
          { value: 'off', label: 'なし' },
          { value: 'note', label: '音名' },
          { value: 'degree', label: '度数' },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.fretboard.setLabelMode(v);
          this.save();
        },
        '「度数」は選んだコードのルートから見た音の役割を表示します。'
      )
    );
    body.append(boardSection);

    // ---- メトロノーム ----
    const metro = section('メトロノーム');
    const metroRow = el('div', 'button-row');
    metroRow.append(
      button(this.metronome.running ? '■ 停止' : '▶ 開始', this.metronome.running ? 'danger' : '', () => {
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
        label: 'テンポ',
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
    const input = section('入力');
    input.append(
      slider({
        label: 'ベロシティカーブ',
        min: 0.5, max: 2, step: 0.01, value: s.velCurve,
        format: (v) => (v < 0.9 ? '軽い' : v > 1.3 ? '重い' : '標準'),
        onInput: (v) => {
          this.settings.velCurve = v;
          this.commit();
        },
      })
    );
    if (MidiInput.supported) {
      const midiRow = el('div', 'button-row');
      midiRow.append(
        button(this.midi ? 'MIDI 再検出' : 'MIDIキーボードを使う', 'ghost small', () => {
          void this.enableMidi();
        })
      );
      input.append(midiRow);
      input.append(
        el('div', 'ctl-hint', 'MIDIノートは自動で弦とフレットに割り当てられます。')
      );
    } else {
      input.append(el('div', 'ctl-hint', 'このブラウザは Web MIDI に対応していません。'));
    }
    input.append(
      el('div', 'ctl-hint',
        'PCキーボード: Space=ダウンストローク / Shift+Space=アップ / 1〜6=各弦 / '
        + 'Z〜M・Q〜P=音階 / M=ブリッジミュート / Esc=全停止')
    );
    body.append(input);
  }

  private buildRecordTab() {
    const body = this.panelBody;

    this.recordButton = button(
      this.recorder.recording ? '■ 録音停止' : '● 録音開始',
      this.recorder.recording ? 'danger' : 'primary',
      () => this.toggleRecording()
    );

    const row = el('div', 'button-row');
    row.append(
      this.recordButton,
      button('▶ 再生', 'ghost', () => this.playRecording()),
      button('消去', 'ghost small', () => {
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
          ? '録音すると、演奏そのもの（弾いた弦・フレット・強さ）が記録されます。'
            + '後から音色を変えて書き出すこともできます。'
          : `${count} 個のイベント / ${this.formatTime(this.recorder.duration(0))}`)
    );

    const exportRow = el('div', 'button-row');
    exportRow.append(
      button('WAVで書き出す', 'primary small', () => void this.exportWav()),
      button('MIDIで書き出す', 'ghost small', () => this.exportMidi())
    );
    body.append(section('書き出し'), exportRow);
    body.append(
      el('div', 'ctl-hint',
        'WAV は今の音色設定でオフライン合成します（実時間より速く書き出せます）。'
        + 'MIDI は弦とフレットを実音に直して保存します。')
    );
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(
      el('p', 'section-hint',
        'コード進行とリズムから自動で演奏します。再生すると音色プリセットも切り替わります。')
    );
    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const item = el('button', 'demo-item');
      item.type = 'button';
      item.append(
        el('span', 'demo-title', demo.title),
        el('span', 'demo-desc', demo.description),
        el('span', 'demo-meta', `${demo.chords.join(' - ')} ／ ${demo.bpm} BPM`)
      );
      item.addEventListener('click', () => this.playDemo(demo.id));
      list.append(item);
    }
    body.append(list);
    const stopRow = el('div', 'button-row');
    stopRow.append(button('■ 再生を止める', 'ghost small', () => this.stopPlayback()));
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
    this.setStatus(ok ? undefined : 'MIDIデバイスを利用できませんでした');
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
    this.setStatus('すべて停止しました');
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
      this.setStatus('録音がありません');
      return;
    }
    void this.ensureAudio().then(() => {
      this.startPlayback(this.recorder.events, '録音の再生', this.recorder.duration());
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
      this.setStatus('コード進行が空です');
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
      this.startPlayback(events, '伴奏', arrangeDuration(all, pattern, this.ui.bpm) + 2, timeline);
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
      this.startPlayback(events, demo.title, arrangeDuration(all, pattern, demo.bpm) + 3, timeline);
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
    this.setStatus(`再生中: ${label}`);
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
      this.setStatus('コード進行が空です');
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
      this.setStatus('書き出すものがありません（先に録音するかデモを再生してください）');
      return;
    }
    await this.renderAndDownload(events, duration, 'takibi-guitar');
  }

  private async renderAndDownload(events: PerformanceEvent[], duration: number, prefix: string) {
    if (this.exporting) return;
    this.exporting = true;
    this.setStatus('書き出し中…');
    try {
      await this.ensureAudio();
      const buffer = await renderPerformance(
        events,
        this.settings,
        this.tuning().notes,
        Math.max(1, duration)
      );
      downloadBlob(encodeWav(buffer), timestampName(prefix, 'wav'));
      this.setStatus('WAVを書き出しました');
    } catch (err) {
      this.setStatus(`書き出しに失敗しました: ${err}`);
    } finally {
      this.exporting = false;
      window.setTimeout(() => this.setStatus(), 2000);
    }
  }

  private exportMidi() {
    const events = this.recorder.isEmpty ? this.lastSequence?.events : this.recorder.events;
    if (!events || events.length === 0) {
      this.setStatus('書き出すものがありません');
      return;
    }
    // 25 = Acoustic Guitar (steel) / 27 = Electric Guitar (clean) / 33 = ベース
    const preset = this.settings;
    const program = preset.tuningId === 'bass' ? 33 : preset.ampType === 'off' ? 25 : 27;
    const blob = encodeMidi(events, this.tuning().notes, this.settings.capo, this.ui.bpm, program);
    downloadBlob(blob, timestampName('takibi-guitar', 'mid'));
    this.setStatus('MIDIを書き出しました');
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
      <h2>Takibi Guitar の使い方</h2>
      <h3>弾く</h3>
      <ul>
        <li><b>指板をタップ</b> … その弦・フレットを弾きます。</li>
        <li><b>押したまま上下</b> … チョーキング。<b>左右</b> … スライド。</li>
        <li><b>指板の下の帯を左右になぞる</b> … ストローク。</li>
        <li><b>コードタブのパッド</b> … タップでダウン、上へスワイプでアップストローク。</li>
      </ul>
      <h3>キーボード</h3>
      <ul>
        <li><b>Space</b> … ダウンストローク（<b>Shift+Space</b> でアップ）</li>
        <li><b>1〜6</b> … その弦を単独で弾く</li>
        <li><b>Z〜M / Q〜P</b> … 音階（自動で弦とフレットに割り当て）</li>
        <li><b>↑↓</b> … オクターブ切替、<b>M</b> … ブリッジミュート、<b>Esc</b> … 全停止</li>
      </ul>
      <h3>音づくり</h3>
      <ul>
        <li>サンプル音源は一切使わず、弦の振動をその場で計算しています。</li>
        <li>「弦」タブでピッキング位置や弦の明るさ、「アンプ」タブで歪みとEQ、
            「空間」タブで揺れ・ディレイ・残響を調整できます。</li>
      </ul>
      <h3>作る</h3>
      <ul>
        <li>「伴奏」タブでコード進行とリズムを決めると、自動で伴奏を演奏します。</li>
        <li>「録音」タブで演奏を記録し、WAV / MIDI に書き出せます。</li>
      </ul>
      <p class="help-note">すべてブラウザ内で動作します。音源のダウンロードも、通信も、課金もありません。</p>
    `;
    const close = button('閉じる', 'primary', () => overlay.remove());
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
        this.setStatus(`PCキー: C${this.computerOctave}`);
        window.setTimeout(() => this.setStatus(), 900);
        return;
      }
      if (e.code === 'ArrowDown') {
        this.computerOctave = Math.max(1, this.computerOctave - 1);
        this.setStatus(`PCキー: C${this.computerOctave}`);
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
