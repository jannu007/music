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
    if (this.audioReady) return;
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
          this.setStatus(`オーディオを開始できません: ${err}`);
          throw err;
        });
    }
    return this.initPromise;
  }

  private noteOn(note: number, velocity: number, fromKeybed: boolean) {
    void this.ensureAudio().then(() => {
      this.engine.noteOn(note, velocity);
      this.recorder.capture({ type: 'note', note, vel: velocity }, this.engine.now);
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
        <small>物理モデリング・グランドピアノ</small>
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

    // 全停止（鳴っている音・ペダル・再生をまとめて止める）
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
      { id: 'tone', label: '音色' },
      { id: 'space', label: '響き' },
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

    // ---------- 鍵盤 ----------
    const keyboardArea = el('footer', 'keyboard-area');
    const pedalBar = el('div', 'pedal-bar');

    this.softButton = button('ソフト', 'pedal', () => this.setSoft(!this.softOn));
    this.sostenutoButton = button('ソステヌート', 'pedal', () =>
      this.setSostenuto(!this.sostenutoOn)
    );
    this.sustainButton = button('サステイン', 'pedal wide', () => {
      this.sustainLatched = !this.sustainLatched;
      this.updateSustainFromInputs();
    });

    const octaveDown = button('◀ オクターブ', 'ghost small octave-btn', () => this.shiftOctave(-1));
    const octaveUp = button('オクターブ ▶', 'ghost small octave-btn', () => this.shiftOctave(1));
    const octaveLabel = el('span', 'octave-label');
    this.updateOctaveLabel = () => {
      octaveLabel.textContent = `PCキー: C${this.computerOctave}`;
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
    window.addEventListener('resize', () => this.fitKeyboard());

    this.showTab(this.activeTab);
    this.setStatus();

    // 最初の操作でオーディオを起動する（ブラウザの自動再生制限対策）
    const kick = () => void this.ensureAudio().catch(() => {});
    app.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
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

  private setStatus(message?: string) {
    if (message) {
      this.statusEl.textContent = message;
      return;
    }
    const parts: string[] = [];
    parts.push(this.audioReady ? '準備完了' : '鍵盤を押すと開始');
    if (this.midi && this.midi.devices.length > 0) {
      parts.push(`MIDI: ${this.midi.devices.join(', ')}`);
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
      card.append(el('strong', undefined, preset.name), el('span', undefined, preset.description));
      card.addEventListener('click', () => {
        this.selectPreset(preset.id);
        this.showTab('tone');
      });
      grid.append(card);
    }
    body.append(el('h2', 'panel-title', '音色プリセット'), grid);

    const controls = el('div', 'ctl-grid');
    controls.append(
      slider({
        label: 'ハンマーの硬さ（明るさ）',
        min: 0, max: 1, step: 0.01, value: this.settings.brightness,
        format: (v) => `${Math.round(v * 100)}`,
        hint: 'フェルト ← → ブライト',
        onInput: (v) => { this.settings.brightness = v; this.commit(); },
      }),
      slider({
        label: '打弦位置',
        min: 0, max: 1, step: 0.01, value: this.settings.strikePos,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '端寄り（硬い） ← → 中央寄り（丸い）',
        onInput: (v) => { this.settings.strikePos = v; this.commit(); },
      }),
      slider({
        label: '減衰（余韻の長さ）',
        min: 0.4, max: 1.8, step: 0.01, value: this.settings.decay,
        format: (v) => `${v.toFixed(2)}×`,
        onInput: (v) => { this.settings.decay = v; this.commit(); },
      }),
      slider({
        label: '弦の共鳴',
        min: 0, max: 1, step: 0.01, value: this.settings.stringRes,
        format: (v) => `${Math.round(v * 100)}`,
        hint: 'ペダルを踏んだときに他の弦が共鳴する量',
        onInput: (v) => { this.settings.stringRes = v; this.commit(); },
      }),
      slider({
        label: 'ユニゾンのうなり',
        min: 0, max: 1, step: 0.01, value: this.settings.unison,
        format: (v) => `${Math.round(v * 100)}`,
        hint: '1つの音に張られた複数弦のズレ',
        onInput: (v) => { this.settings.unison = v; this.commit(); },
      }),
      slider({
        label: '打弦ノイズ',
        min: 0, max: 1, step: 0.01, value: this.settings.hammerNoise,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.hammerNoise = v; this.commit(); },
      }),
      slider({
        label: '離鍵ノイズ',
        min: 0, max: 1, step: 0.01, value: this.settings.releaseNoise,
        format: (v) => `${Math.round(v * 100)}`,
        hint: 'ダンパーが弦に触れる音',
        onInput: (v) => { this.settings.releaseNoise = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', '音づくり'), controls);
  }

  private buildSpaceTab() {
    const body = this.panelBody;
    const controls = el('div', 'ctl-grid');

    const reverbOptions: { value: ReverbType; label: string }[] = [
      { value: 'off', label: 'オフ' },
      ...(Object.keys(ROOMS) as (keyof typeof ROOMS)[]).map((key) => ({
        value: key as ReverbType,
        label: ROOMS[key].label,
      })),
    ];

    controls.append(
      slider({
        label: '大屋根の開き',
        min: 0, max: 1, step: 0.01, value: this.settings.lid,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: '閉じるほど丸く、開くほど華やかに',
        onInput: (v) => { this.settings.lid = v; this.commit(); },
      }),
      slider({
        label: 'トーン',
        min: -1, max: 1, step: 0.01, value: this.settings.tone,
        format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
        onInput: (v) => { this.settings.tone = v; this.commit(); },
      }),
      segmented('残響空間', reverbOptions, this.settings.reverbType, (v) => {
        this.settings.reverbType = v;
        this.commit();
      }),
      slider({
        label: '残響の量',
        min: 0, max: 0.8, step: 0.01, value: this.settings.reverbMix,
        format: (v) => `${Math.round(v * 125)}`,
        onInput: (v) => { this.settings.reverbMix = v; this.commit(); },
      }),
      slider({
        label: 'マスター音量',
        min: 0, max: 1, step: 0.01, value: this.settings.volume,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => { this.settings.volume = v; this.commit(); },
      })
    );
    body.append(el('h2', 'panel-title', '空間と響き'), controls);

    const note = el('p', 'panel-note');
    note.textContent =
      '残響はインパルス応答をその場で生成しています。音声ファイルのダウンロードは一切ありません。';
    body.append(note);
  }

  private buildPlayTab() {
    const body = this.panelBody;
    const controls = el('div', 'ctl-grid');

    controls.append(
      slider({
        label: 'ベロシティカーブ',
        min: 0.6, max: 2, step: 0.01, value: this.settings.velCurve,
        format: (v) => v.toFixed(2),
        hint: '大きいほど強く弾かないと音量が出ません',
        onInput: (v) => { this.settings.velCurve = v; this.commit(); },
      }),
      slider({
        label: 'ダイナミクス',
        min: 0.4, max: 1.4, step: 0.01, value: this.settings.dynamics,
        format: (v) => v.toFixed(2),
        hint: '小さいほど強弱の差が圧縮されます',
        onInput: (v) => { this.settings.dynamics = v; this.commit(); },
      }),
      slider({
        label: '基準ピッチ A4',
        min: 415, max: 448, step: 0.5, value: this.settings.a4,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { this.settings.a4 = v; this.commit(); },
      }),
      slider({
        label: 'ストレッチ調律',
        min: 0, max: 1.5, step: 0.01, value: this.settings.stretch,
        format: (v) => `${v.toFixed(2)}×`,
        hint: '低音を低く・高音を高く。実際の調律に近づきます',
        onInput: (v) => { this.settings.stretch = v; this.commit(); },
      }),
      slider({
        label: '最大同時発音数',
        min: 12, max: 48, step: 1, value: this.settings.maxVoices,
        format: (v) => `${v}`,
        hint: '動作が重いときは減らしてください',
        onInput: (v) => { this.settings.maxVoices = v; this.commit(); },
      }),
      slider({
        label: '鍵盤の大きさ',
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
    body.append(el('h2', 'panel-title', 'タッチと調律'), controls);

    const options = el('div', 'ctl-grid');
    options.append(
      segmented<LabelMode>(
        '鍵盤の音名表示',
        [
          { value: 'off', label: 'なし' },
          { value: 'c', label: 'Cのみ' },
          { value: 'all', label: '英語' },
          { value: 'ja', label: 'ドレミ' },
        ],
        this.ui.labelMode,
        (v) => {
          this.ui.labelMode = v;
          this.keyboard.setLabels(v);
          this.save();
        }
      ),
      segmented(
        '表示する鍵盤の範囲',
        [
          { value: 'full', label: '88鍵' },
          { value: 'wide', label: '61鍵' },
          { value: 'mid', label: '49鍵' },
          { value: 'small', label: '25鍵' },
        ],
        this.rangeKind(),
        (v) => this.setRangeKind(v)
      ),
      segmented(
        '鍵盤のベロシティ',
        [
          { value: 'touch', label: '打鍵位置で変化' },
          { value: 'soft', label: '固定 (弱)' },
          { value: 'mid', label: '固定 (中)' },
          { value: 'loud', label: '固定 (強)' },
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
        label: 'メトロノーム テンポ',
        min: 40, max: 208, step: 1, value: this.ui.bpm,
        format: (v) => `${v} BPM`,
        onInput: (v) => {
          this.ui.bpm = v;
          this.metronome.setBpm(v);
          this.save();
        },
      }),
      switchRow('メトロノームを鳴らす', this.metronome.running, (on) => {
        void this.ensureAudio().then(() => {
          if (on) this.metronome.start(this.ui.bpm);
          else this.metronome.stop();
        });
      })
    );
    body.append(el('h2', 'panel-title', '練習ツール'), metroBox);

    // MIDI
    const midiBox = el('div', 'midi-box');
    if (MidiInput.supported) {
      const connect = button(
        this.midi ? 'MIDI 再検出' : 'MIDIキーボードを接続',
        'primary',
        () => void this.connectMidi()
      );
      midiBox.append(connect);
      const list = el('span', 'panel-note');
      list.textContent = this.midi?.devices.length
        ? `接続中: ${this.midi.devices.join(', ')}`
        : '外部MIDIキーボードを接続すると、そのまま演奏できます。';
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
    const count = this.recorder.events.filter((e) => e.type === 'note').length;
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

    const note = el('p', 'panel-note');
    note.textContent =
      'WAV は 48kHz / 24bit・ステレオで、現在の音色設定のまま再合成して書き出します。'
      + '作成した音源の利用に制限はありません（商用利用も自由です）。';
    body.append(note);
  }

  private buildDemoTab() {
    const body = this.panelBody;
    body.append(el('h2', 'panel-title', 'デモ演奏'));

    const list = el('div', 'demo-list');
    for (const demo of DEMOS) {
      const card = el('div', 'demo-card');
      const texts = el('div', 'demo-texts');
      texts.append(
        el('strong', undefined, demo.title),
        el('span', undefined, `${demo.composer} ・ ${demo.note}`)
      );
      const play = button('▶ 再生', 'primary', () => this.playDemo(demo.id));
      card.append(texts, play);
      list.append(card);
    }
    body.append(list);

    const row = el('div', 'button-row');
    row.append(button('■ 停止', 'ghost', () => this.stopPlayback()));
    body.append(row);

    body.append(
      switchRow(
        '推奨音色に切り替えて再生する',
        this.ui.useDemoPreset,
        (v) => {
          this.ui.useDemoPreset = v;
          this.save();
        }
      )
    );

    const note = el('p', 'panel-note');
    note.textContent =
      'デモはすべて権利処理が不要な楽曲です（パブリックドメイン作品と本アプリのオリジナル曲）。'
      + '再生中の演奏もそのまま WAV / MIDI に書き出せます。';
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
    if (preset) this.flashNowPlaying(`音色: ${preset.name}`);
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
    this.flashNowPlaying('すべての音を停止しました');
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
      this.startPlayback(events, `${demo.title} / ${demo.composer}`);
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
      this.flashNowPlaying('再生が終了しました');
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
      this.flashNowPlaying('書き出す演奏がありません');
      return;
    }
    this.exporting = true;
    if (this.activeTab === 'rec') this.showTab('rec');
    this.flashNowPlaying('WAV を書き出しています…');
    try {
      const last = source.events.reduce((max, ev) => Math.max(max, ev.time), 0);
      const buffer = await renderPerformance(source.events, this.settings, last + 6);
      downloadBlob(encodeWav(buffer), timestampName('aozora-piano', 'wav'));
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
    downloadBlob(encodeMidi(source.events), timestampName('aozora-piano', 'mid'));
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
        <li><strong>演奏</strong> … 画面の鍵盤をクリック／タッチ（マルチタッチ対応）。鍵盤の手前を押すほど強い音になります。</li>
        <li><strong>PCキーボード</strong> … Z S X D C V G B H N J M , L . ; / と Q 2 W 3 E R 5 T 6 Y 7 U で2オクターブ。←→ でオクターブ移動。</li>
        <li><strong>ペダル</strong> … スペースキーでサステイン。Shift でソフト（弱音）ペダル。</li>
        <li><strong>MIDI</strong> … 「演奏」タブから MIDI キーボードを接続できます（CC64/66/67 のペダルにも対応）。</li>
        <li><strong>録音</strong> … 「録音」タブで演奏を記録し、WAV（48kHz/24bit）や MIDI として保存できます。</li>
      </ul>
      <h2>この音について</h2>
      <p>
        録音済みのピアノ音源（サンプル）は使っていません。88鍵それぞれの弦の部分音・不協和度・
        打弦位置・ダンパー・共鳴を計算して、その場で音を合成しています。
        そのためアプリ本体は数百KBで、追加ダウンロードも通信も不要です。
      </p>
      <p class="help-free">完全無料・広告なし・アカウント登録なし。オフラインでも動作します。</p>
      <p class="help-small">
        書き出した音源はご自由にお使いいただけます（商用利用可・クレジット表記不要）。
        <a href="./privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>
      </p>
    `;
    const close = button('閉じる', 'primary', () => modal.remove());
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
