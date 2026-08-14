import { DrumEngine, projectSeconds, renderProject, type StepInfo } from '../audio/DrumEngine';
import {
  createZip,
  downloadBlob,
  encodeMidi,
  encodeWav,
  safeName,
  timestampName,
  type ZipEntry,
} from '../audio/export';
import { KITS, applyKit, findKit } from '../audio/kits';
import {
  PATTERN_NAMES,
  clamp,
  clonePattern,
  createProject,
  decodeProject,
  encodeProject,
  isPatternEmpty,
} from '../audio/project';
import { ROOMS } from '../audio/reverb';
import {
  PATTERN_COUNT,
  STEP_MAX,
  emptyPattern,
  type DelayDivision,
  type Pattern,
  type Project,
  type ReverbType,
  type Step,
  type TrackConfig,
} from '../audio/types';
import { DEMO_SONGS, loadDemo } from '../data/songs';
import { DrumPads, PAD_KEYS } from './Pads';
import { StepGrid } from './StepGrid';
import { button, el, grid, section, segmented, slider, stepper, switchRow } from './controls';

const STORAGE_KEY = 'hibiki-drums-v1';

type TabId = 'edit' | 'pads' | 'voice' | 'mix' | 'fx' | 'song' | 'demo' | 'export';

interface UiState {
  inputVelocity: number;
  tab: TabId;
  selected: string;
  follow: boolean;
  exportLoops: number;
}

const DEFAULT_UI: UiState = {
  inputVelocity: 0.7,
  tab: 'edit',
  selected: 'kick',
  follow: true,
  exportLoops: 1,
};

export class DrumApp {
  private root: HTMLElement;
  private engine = new DrumEngine();
  private project: Project = createProject();
  private ui: UiState = { ...DEFAULT_UI };

  private grid!: StepGrid;
  private pads!: DrumPads;
  private panelBody!: HTMLElement;
  private tabButtons: HTMLButtonElement[] = [];
  private statusEl!: HTMLElement;
  private meterFill!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private recButton!: HTMLButtonElement;
  private patternButtons: HTMLButtonElement[] = [];
  private songModeButton!: HTMLButtonElement;
  private bpmInput!: HTMLInputElement;
  private inspector: HTMLElement | null = null;
  private exportStatus: HTMLElement | null = null;

  private audioReady = false;
  private initPromise: Promise<void> | null = null;
  private recording = false;
  private exporting = false;
  private lastStep: StepInfo | null = null;
  private tapTimes: number[] = [];
  private undoStack: { index: number; pattern: Pattern }[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.load();
    this.build();
    this.bindKeys();
    this.startLoop();
  }

  // ------------------------------------------------------------ 保存と復元

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const project = decodeProject(data.project);
      if (project) this.project = project;
      if (data.ui) this.ui = { ...DEFAULT_UI, ...data.ui };
    } catch {
      /* 壊れた保存データは無視して初期状態で起動する */
    }
  }

  private save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ project: encodeProject(this.project), ui: this.ui })
      );
    } catch {
      /* プライベートモードなどで保存できない場合は無視 */
    }
  }

  private get pattern(): Pattern {
    return this.project.patterns[this.project.current];
  }

  private get selectedTrack(): TrackConfig {
    return this.project.tracks.find((t) => t.id === this.ui.selected) ?? this.project.tracks[0];
  }

  // ------------------------------------------------------------------ 音声

  private async ensureAudio(): Promise<void> {
    if (this.audioReady) return;
    if (!this.initPromise) {
      this.initPromise = this.engine
        .init(this.project)
        .then(() => {
          this.audioReady = true;
          this.engine.onStep = (info) => this.onStep(info);
          this.engine.onMeters = (peaks) => this.grid.setMeters(peaks);
          this.engine.syncAll(this.project);
          this.setStatus('準備完了');
        })
        .catch((err) => {
          console.error(err);
          this.setStatus('音声を初期化できませんでした');
        });
    }
    await this.initPromise;
  }

  private onStep(info: StepInfo) {
    this.lastStep = info;
    if (info.step < 0) {
      this.grid.setPlayhead(-1, 0);
      return;
    }
    if (info.pattern !== this.project.current && this.project.songMode) {
      this.project.current = info.pattern;
      this.grid.render(this.pattern);
      this.paintPatternButtons();
    }
    this.grid.setPlayhead(info.step, info.abs);
    if (this.ui.follow) this.grid.followPlayhead(info.step);
  }

  // ------------------------------------------------------------------ 画面

  private build() {
    this.root.innerHTML = '';
    const app = el('div', 'dm-app');

    app.append(this.buildTopbar(), this.buildTransport());

    const stage = el('div', 'stage');
    this.grid = new StepGrid(this.project.tracks, {
      onEdit: (trackId, index, step) => this.editStep(trackId, index, step),
      onSelectTrack: (trackId) => this.selectTrack(trackId),
      onPreview: (trackId) => this.preview(trackId),
      onInspect: (trackId, index, anchor) => this.openInspector(trackId, index, anchor),
      onMute: (trackId) => this.toggleMute(trackId),
      onSolo: (trackId) => this.toggleSolo(trackId),
      inputVelocity: () => this.ui.inputVelocity,
    });
    stage.append(this.grid.root);
    app.append(stage);

    app.append(this.buildPanel());
    this.root.append(app);

    this.grid.setTracks(this.project.tracks);
    this.grid.render(this.pattern);
    this.grid.setSelected(this.ui.selected);
    this.paintPatternButtons();
    this.renderPanel();
  }

  private buildTopbar(): HTMLElement {
    const bar = el('header', 'topbar');

    const brand = el('div', 'brand');
    brand.append(el('div', 'brand-mark'));
    const texts = el('div', 'brand-text');
    texts.append(el('strong', '', 'Hibiki Drum Machine'), el('small', '', '完全合成ドラムマシン'));
    brand.append(texts);

    const kitSelect = el('select', 'kit-select');
    for (const kit of KITS) {
      const opt = el('option', '', kit.name);
      opt.value = kit.id;
      if (kit.id === this.project.kitId) opt.selected = true;
      kitSelect.append(opt);
    }
    kitSelect.title = 'キット（音色セット）';
    kitSelect.addEventListener('change', () => this.setKit(kitSelect.value));

    this.statusEl = el('div', 'status', '画面をタップすると音が出ます');

    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);

    const panic = el('button', 'icon-btn danger');
    panic.type = 'button';
    panic.title = '全停止（Esc）';
    panic.append(el('span', 'stop-icon'), el('span', 'icon-label', '全停止'));
    panic.addEventListener('click', () => this.panic());

    bar.append(brand, kitSelect, this.statusEl, meter, panic);
    return bar;
  }

  private buildTransport(): HTMLElement {
    const bar = el('div', 'transport');

    this.playButton = el('button', 'play-btn');
    this.playButton.type = 'button';
    this.playButton.title = '再生 / 停止（Space）';
    this.playButton.append(el('span', 'play-icon'));
    this.playButton.addEventListener('click', () => this.togglePlay());

    this.recButton = el('button', 'rec-btn');
    this.recButton.type = 'button';
    this.recButton.title = 'パッドの演奏をパターンに書き込む（R）';
    this.recButton.append(el('span', 'rec-dot'), el('span', '', 'REC'));
    this.recButton.addEventListener('click', () => this.toggleRecord());

    const tempo = el('div', 'tempo');
    const minus = el('button', 'stepper-btn', '−');
    minus.type = 'button';
    const plus = el('button', 'stepper-btn', '＋');
    plus.type = 'button';
    this.bpmInput = el('input', 'bpm-input');
    this.bpmInput.type = 'number';
    this.bpmInput.min = '40';
    this.bpmInput.max = '240';
    this.bpmInput.value = String(this.project.bpm);
    this.bpmInput.inputMode = 'numeric';
    const applyBpm = (v: number) => this.setBpm(v);
    minus.addEventListener('click', () => applyBpm(this.project.bpm - 1));
    plus.addEventListener('click', () => applyBpm(this.project.bpm + 1));
    this.bpmInput.addEventListener('change', () => applyBpm(Number(this.bpmInput.value)));
    const tap = el('button', 'tap-btn', 'TAP');
    tap.type = 'button';
    tap.title = 'テンポをタップで入力';
    tap.addEventListener('click', () => this.tapTempo());
    tempo.append(el('span', 'tempo-label', 'BPM'), minus, this.bpmInput, plus, tap);

    const patterns = el('div', 'pattern-bank');
    this.patternButtons = [];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const btn = el('button', 'pattern-btn', PATTERN_NAMES[i]);
      btn.type = 'button';
      btn.title = `パターン ${PATTERN_NAMES[i]}`;
      btn.addEventListener('click', () => this.selectPattern(i));
      this.patternButtons.push(btn);
      patterns.append(btn);
    }

    this.songModeButton = el('button', 'mode-btn', 'SONG');
    this.songModeButton.type = 'button';
    this.songModeButton.title = 'ソングモード（パターンを並べて通しで再生）';
    this.songModeButton.addEventListener('click', () => this.setSongMode(!this.project.songMode));

    bar.append(this.playButton, this.recButton, tempo, patterns, this.songModeButton);
    return bar;
  }

  private buildPanel(): HTMLElement {
    const panel = el('section', 'panel');
    const tabs = el('div', 'panel-tabs');
    const defs: { id: TabId; label: string }[] = [
      { id: 'edit', label: '打ち込み' },
      { id: 'pads', label: 'パッド' },
      { id: 'voice', label: '音づくり' },
      { id: 'mix', label: 'ミキサー' },
      { id: 'fx', label: 'エフェクト' },
      { id: 'song', label: 'ソング' },
      { id: 'demo', label: 'デモ' },
      { id: 'export', label: '書き出し' },
    ];
    this.tabButtons = [];
    for (const def of defs) {
      const btn = el('button', 'tab-btn', def.label);
      btn.type = 'button';
      btn.dataset.tab = def.id;
      if (def.id === this.ui.tab) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.ui.tab = def.id;
        for (const b of this.tabButtons) b.classList.toggle('active', b.dataset.tab === def.id);
        this.renderPanel();
        this.save();
      });
      this.tabButtons.push(btn);
      tabs.append(btn);
    }
    this.panelBody = el('div', 'panel-body');
    panel.append(tabs, this.panelBody);
    return panel;
  }

  // ------------------------------------------------------------- 各パネル

  private renderPanel() {
    this.panelBody.innerHTML = '';
    this.exportStatus = null;
    switch (this.ui.tab) {
      case 'edit': this.renderEditPanel(); break;
      case 'pads': this.renderPadsPanel(); break;
      case 'voice': this.renderVoicePanel(); break;
      case 'mix': this.renderMixPanel(); break;
      case 'fx': this.renderFxPanel(); break;
      case 'song': this.renderSongPanel(); break;
      case 'demo': this.renderDemoPanel(); break;
      case 'export': this.renderExportPanel(); break;
    }
  }

  private renderEditPanel() {
    const sec = section('打ち込み', 'マス目をタップ / 長押しでステップの詳細');
    const g = grid();

    g.append(
      segmented<number>(
        '入力の強さ',
        [
          { value: 0.34, label: 'ゴースト' },
          { value: 0.7, label: 'ノーマル' },
          { value: 1, label: 'アクセント' },
        ],
        this.ui.inputVelocity,
        (v) => {
          this.ui.inputVelocity = v;
          this.save();
        }
      )
    );

    g.append(
      stepper('ステップ数', this.pattern.length, 1, STEP_MAX, 1, (v) => {
        this.pattern.length = clamp(v, 1, STEP_MAX);
        this.grid.render(this.pattern);
        this.syncPattern();
      }, '1〜64。16 = 1小節（16分音符）')
    );

    g.append(
      slider({
        label: 'スウィング',
        min: 50,
        max: 75,
        step: 1,
        value: this.project.swing,
        format: (v) => `${v}%`,
        hint: '50% で均等、62% 前後で三連のハネ',
        onInput: (v) => {
          this.project.swing = v;
          this.engine.syncTransport(this.project);
          this.save();
        },
      })
    );

    g.append(
      slider({
        label: 'ヒューマナイズ',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.project.humanize,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: 'タイミングと強さをわずかに揺らす',
        onInput: (v) => {
          this.project.humanize = v;
          this.engine.syncTransport(this.project);
          this.save();
        },
      })
    );

    g.append(
      segmented<number>(
        '細かさ',
        [
          { value: 4, label: '16分' },
          { value: 3, label: '8分3連' },
          { value: 6, label: '16分3連' },
        ],
        this.project.stepsPerBeat,
        (v) => {
          this.project.stepsPerBeat = v;
          this.engine.syncTransport(this.project);
          this.save();
        }
      )
    );

    g.append(
      switchRow('再生位置を追う', this.ui.follow, (v) => {
        this.ui.follow = v;
        this.save();
      }, '長いパターンで自動的に横スクロール')
    );

    sec.append(g);

    const tools = el('div', 'btn-row');
    tools.append(
      button('◀ ずらす', '', () => this.shiftPattern(-1)),
      button('ずらす ▶', '', () => this.shiftPattern(1)),
      button('倍に伸ばす', '', () => this.doublePattern()),
      button('パターンを複製', '', () => this.duplicatePattern()),
      button('選択トラックを消去', '', () => this.clearTrack()),
      button('パターンを消去', 'danger', () => this.clearPattern()),
      button('元に戻す', '', () => this.undo())
    );
    sec.append(tools);
    this.panelBody.append(sec);
  }

  private renderPadsPanel() {
    const sec = section('パッド', 'キーボードの A S D F G H J / Z X C V B N M でも叩けます');
    this.pads = new DrumPads(this.project.tracks, {
      onHit: (trackId, vel) => this.hit(trackId, vel),
      onSelect: (trackId) => this.selectTrack(trackId),
    });
    sec.append(this.pads.root);
    const note = el('div', 'panel-note',
      'REC を点灯させて再生すると、叩いた音がそのままステップに書き込まれます（自動でマス目に合わせます）。');
    sec.append(note);
    this.panelBody.append(sec);
  }

  private renderVoicePanel() {
    const track = this.selectedTrack;
    const sec = section(`音づくり — ${track.name}`, '左のトラック名を押すと切り替わります');

    const picker = el('div', 'track-picker');
    for (const t of this.project.tracks) {
      const btn = el('button', 'chip', t.short);
      btn.type = 'button';
      btn.title = t.name;
      if (t.id === track.id) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.selectTrack(t.id);
        this.preview(t.id);
        this.renderPanel();
      });
      picker.append(btn);
    }
    sec.append(picker);

    const p = track.params;
    const g = grid();
    const bind = (key: keyof typeof p, label: string, min: number, max: number, step: number,
      format: (v: number) => string, hint?: string) => {
      g.append(
        slider({
          label, min, max, step, value: p[key], format, hint,
          onInput: (v) => {
            p[key] = v;
            this.engine.syncTracks(this.project);
            this.save();
          },
        })
      );
    };

    bind('tune', '音程', -24, 24, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, '半音単位');
    bind('decay', '減衰', 0.1, 3, 0.01, (v) => `${v.toFixed(2)}×`, '大きいほど長く伸びる');
    bind('tone', 'トーン', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, this.toneHint(track));
    bind('snap', 'アタック', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, this.snapHint(track));
    bind('drive', 'ドライブ', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, 'サチュレーションで太くする');
    bind('level', '音量', 0, 1.6, 0.01, (v) => v.toFixed(2));
    bind('pan', '定位', -1, 1, 0.01, (v) => (v === 0 ? '中央' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
    bind('reverb', 'リバーブ送り', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`);
    bind('delay', 'ディレイ送り', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`);

    const tp = this.pattern.tracks[track.id];
    g.append(
      stepper('このトラックの長さ', tp.length, 0, STEP_MAX, 1, (v) => {
        tp.length = clamp(v, 0, STEP_MAX);
        this.grid.render(this.pattern);
        this.syncPattern();
      }, '0 でパターン全体と同じ。別の数にするとポリメーターになります')
    );

    sec.append(g);
    const row = el('div', 'btn-row');
    row.append(
      button('試聴', 'primary', () => this.preview(track.id)),
      button('このトラックを初期値に', '', () => this.resetTrack(track.id))
    );
    sec.append(row);
    this.panelBody.append(sec);
  }

  private toneHint(track: TrackConfig): string {
    switch (track.type) {
      case 'kick': return 'アタックの高さ（クリック感）';
      case 'snare': return 'ノイズの明るさ';
      case 'clap': return '手のあたる高さ';
      case 'hat':
      case 'cymbal': return '金物の明るさ（高域の量）';
      case 'tom': return '打面の張り';
      case 'shaker': return '粒の細かさ';
      default: return '音色の明るさ';
    }
  }

  private snapHint(track: TrackConfig): string {
    switch (track.type) {
      case 'kick': return 'ビーターのクリック音';
      case 'snare': return 'スナッピー（響き線）の量';
      case 'clap': return '手の重なり具合';
      case 'tom': return '打面のノイズ';
      case 'shaker': return '立ち上がりの速さ';
      default: return 'アタックのノイズ量';
    }
  }

  private renderMixPanel() {
    const sec = section('ミキサー', '音量・定位・センドをまとめて調整します');
    const table = el('div', 'mixer');
    for (const track of this.project.tracks) {
      const strip = el('div', 'strip');
      if (track.id === this.ui.selected) strip.classList.add('active');
      const head = el('div', 'strip-head');
      const name = el('button', 'strip-name', track.name);
      name.type = 'button';
      name.addEventListener('click', () => {
        this.selectTrack(track.id);
        this.preview(track.id);
        this.renderPanel();
      });
      const mute = el('button', 'mini-btn mute', 'M');
      mute.type = 'button';
      if (track.mute) mute.classList.add('active');
      mute.addEventListener('click', () => {
        this.toggleMute(track.id);
        mute.classList.toggle('active', track.mute);
      });
      const solo = el('button', 'mini-btn solo', 'S');
      solo.type = 'button';
      if (track.solo) solo.classList.add('active');
      solo.addEventListener('click', () => {
        this.toggleSolo(track.id);
        this.renderPanel();
      });
      head.append(name, mute, solo);

      const knobs = el('div', 'strip-knobs');
      const mini = (label: string, key: 'level' | 'pan' | 'reverb' | 'delay', min: number, max: number,
        format: (v: number) => string) => {
        knobs.append(
          slider({
            label, min, max, step: 0.01, value: track.params[key], format,
            onInput: (v) => {
              track.params[key] = v;
              this.engine.syncTracks(this.project);
              this.save();
            },
          })
        );
      };
      mini('音量', 'level', 0, 1.6, (v) => v.toFixed(2));
      mini('定位', 'pan', -1, 1, (v) => (v === 0 ? '中央' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
      mini('REV', 'reverb', 0, 1, (v) => `${Math.round(v * 100)}`);
      mini('DLY', 'delay', 0, 1, (v) => `${Math.round(v * 100)}`);

      strip.append(head, knobs);
      table.append(strip);
    }
    sec.append(table);
    this.panelBody.append(sec);
  }

  private renderFxPanel() {
    const m = this.project.master;
    const sec = section('エフェクト', 'マスターの音作りと空間系');
    const g = grid();

    const bind = (label: string, key: 'volume' | 'drive' | 'glue' | 'reverbMix' | 'delayFeedback' | 'delayMix',
      min: number, max: number, format: (v: number) => string, hint?: string) => {
      g.append(
        slider({
          label, min, max, step: 0.01, value: m[key], format, hint,
          onInput: (v) => {
            m[key] = v;
            this.engine.syncMaster(this.project);
            this.save();
          },
        })
      );
    };

    bind('マスター音量', 'volume', 0, 1, (v) => `${Math.round(v * 100)}`);
    bind('ドライブ', 'drive', 0, 1, (v) => `${Math.round(v * 100)}`, 'バス全体を軽く歪ませて密度を出す');
    bind('グルー（バスコンプ）', 'glue', 0, 1, (v) => `${Math.round(v * 100)}`, '全体をまとめて前に出す');

    g.append(
      slider({
        label: '低域', min: -12, max: 12, step: 0.5, value: m.low,
        format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
        onInput: (v) => { m.low = v; this.engine.syncMaster(this.project); this.save(); },
      })
    );
    g.append(
      slider({
        label: '高域', min: -12, max: 12, step: 0.5, value: m.high,
        format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
        onInput: (v) => { m.high = v; this.engine.syncMaster(this.project); this.save(); },
      })
    );

    g.append(
      segmented<ReverbType>(
        'リバーブ',
        [
          { value: 'off', label: 'なし' },
          { value: 'room', label: ROOMS.room.label },
          { value: 'plate', label: ROOMS.plate.label },
          { value: 'hall', label: ROOMS.hall.label },
          { value: 'cavern', label: ROOMS.cavern.label },
        ],
        m.reverbType,
        (v) => { m.reverbType = v; this.engine.syncMaster(this.project); this.save(); }
      )
    );
    bind('リバーブ量', 'reverbMix', 0, 1, (v) => `${Math.round(v * 100)}`);

    g.append(
      segmented<DelayDivision>(
        'ディレイ（テンポ同期）',
        [
          { value: 'off', label: 'なし' },
          { value: '1/16', label: '1/16' },
          { value: '1/8T', label: '3連' },
          { value: '1/8', label: '1/8' },
          { value: '1/8.', label: '付点' },
          { value: '1/4', label: '1/4' },
        ],
        m.delayDivision,
        (v) => { m.delayDivision = v; this.engine.syncMaster(this.project); this.save(); }
      )
    );
    bind('ディレイ量', 'delayMix', 0, 1, (v) => `${Math.round(v * 100)}`);
    bind('フィードバック', 'delayFeedback', 0, 0.85, (v) => `${Math.round(v * 100)}`);
    g.append(
      switchRow('ピンポン', m.delayPingPong, (v) => {
        m.delayPingPong = v;
        this.engine.syncMaster(this.project);
        this.save();
      }, '左右交互に返す')
    );

    sec.append(g);
    this.panelBody.append(sec);
  }

  private renderSongPanel() {
    const sec = section('ソング', 'パターンを並べて曲にします');
    const g = grid();
    g.append(
      switchRow('ソングモードで再生', this.project.songMode, (v) => this.setSongMode(v), 'この並び順で通して再生します')
    );
    sec.append(g);

    const list = el('div', 'song-list');
    this.project.song.forEach((slot, index) => {
      const rowEl = el('div', 'song-slot');
      rowEl.append(el('span', 'song-index', String(index + 1)));

      const select = el('select', 'song-select');
      for (let i = 0; i < PATTERN_COUNT; i++) {
        const opt = el('option', '', `${PATTERN_NAMES[i]}：${this.project.patterns[i].name}`);
        opt.value = String(i);
        if (i === slot.pattern) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        slot.pattern = Number(select.value);
        this.engine.syncTransport(this.project);
        this.save();
      });

      const repeats = el('input', 'song-repeats');
      repeats.type = 'number';
      repeats.min = '1';
      repeats.max = '16';
      repeats.value = String(slot.repeats);
      repeats.addEventListener('change', () => {
        slot.repeats = clamp(Number(repeats.value), 1, 16);
        repeats.value = String(slot.repeats);
        this.engine.syncTransport(this.project);
        this.save();
      });

      const up = button('↑', 'mini', () => this.moveSlot(index, -1));
      const down = button('↓', 'mini', () => this.moveSlot(index, 1));
      const remove = button('✕', 'mini danger', () => {
        if (this.project.song.length <= 1) return;
        this.project.song.splice(index, 1);
        this.engine.syncTransport(this.project);
        this.save();
        this.renderPanel();
      });

      rowEl.append(select, el('span', 'song-x', '×'), repeats, up, down, remove);
      list.append(rowEl);
    });
    sec.append(list);

    const tools = el('div', 'btn-row');
    tools.append(
      button('ブロックを追加', 'primary', () => {
        this.project.song.push({ pattern: this.project.current, repeats: 2 });
        this.engine.syncTransport(this.project);
        this.save();
        this.renderPanel();
      }),
      button('現在のパターンを末尾に', '', () => {
        this.project.song.push({ pattern: this.project.current, repeats: 1 });
        this.engine.syncTransport(this.project);
        this.save();
        this.renderPanel();
      })
    );
    sec.append(tools);

    const total = this.project.song.reduce(
      (n, slot) => n + this.project.patterns[slot.pattern].length * slot.repeats, 0);
    const seconds = (total * 60) / this.project.bpm / this.project.stepsPerBeat;
    sec.append(el('div', 'panel-note',
      `全体で ${total} ステップ・約 ${seconds.toFixed(1)} 秒（${this.project.bpm} BPM）`));

    this.panelBody.append(sec);
  }

  private renderDemoPanel() {
    const sec = section('デモ', '読み込むと現在の内容は置き換わります（保存したい場合は先に書き出してください）');
    const list = el('div', 'demo-list');
    for (const demo of DEMO_SONGS) {
      const card = el('div', 'demo-card');
      const head = el('div', 'demo-head');
      head.append(el('strong', '', demo.name), el('span', 'demo-meta', `${demo.bpm} BPM / ${findKit(demo.kitId).name}`));
      card.append(head, el('p', 'demo-desc', demo.desc));
      const row = el('div', 'btn-row');
      row.append(button('読み込む', 'primary', () => this.loadDemoSong(demo.id)));
      card.append(row);
      list.append(card);
    }
    sec.append(list);
    this.panelBody.append(sec);
  }

  private renderExportPanel() {
    const sec = section('書き出し', 'すべて端末内で処理します。アップロードは行いません');
    const g = grid();
    g.append(
      stepper('繰り返し回数', this.ui.exportLoops, 1, 32, 1, (v) => {
        this.ui.exportLoops = clamp(v, 1, 32);
        this.save();
        this.updateExportStatus();
      }, 'パターン（またはソング全体）を何回続けて書き出すか')
    );
    sec.append(g);

    const row = el('div', 'btn-row');
    row.append(
      button('WAV を書き出す', 'primary', () => this.exportWav()),
      button('トラック別 WAV（ZIP）', '', () => this.exportStems()),
      button('MIDI を書き出す', '', () => this.exportMidi())
    );
    sec.append(row);

    const row2 = el('div', 'btn-row');
    row2.append(
      button('プロジェクトを保存', '', () => this.exportProject()),
      button('プロジェクトを読み込む', '', () => this.importProject())
    );
    sec.append(row2);

    this.exportStatus = el('div', 'panel-note');
    sec.append(this.exportStatus);
    this.updateExportStatus();

    sec.append(
      el('div', 'panel-note',
        'WAV は 48kHz / 24bit ステレオ。書き出した音源は自由に使えます（商用利用可・クレジット不要）。')
    );
    this.panelBody.append(sec);
  }

  private updateExportStatus(text?: string) {
    if (!this.exportStatus) return;
    if (text) {
      this.exportStatus.textContent = text;
      return;
    }
    const seconds = projectSeconds(this.project, this.ui.exportLoops);
    const mode = this.project.songMode ? 'ソング全体' : `パターン ${PATTERN_NAMES[this.project.current]}`;
    this.exportStatus.textContent = `対象：${mode} ／ 長さ 約 ${seconds.toFixed(1)} 秒`;
  }

  // ------------------------------------------------------------- 編集の操作

  private pushUndo() {
    this.undoStack.push({ index: this.project.current, pattern: clonePattern(this.pattern) });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  private undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.setStatus('元に戻せる操作はありません');
      return;
    }
    this.project.patterns[entry.index] = entry.pattern;
    this.project.current = entry.index;
    this.grid.render(this.pattern);
    this.paintPatternButtons();
    this.syncPattern();
    this.refreshPanelIfNeeded();
    this.setStatus('元に戻しました');
  }

  private editStep(trackId: string, index: number, step: Step | null) {
    const tp = this.pattern.tracks[trackId];
    if (!tp) return;
    const before = tp.steps[index];
    if (!before && !step) return;
    this.pushUndo();
    tp.steps[index] = step;
    this.grid.render(this.pattern);
    this.syncPattern();
    if (step && !this.engine.playing) this.preview(trackId, step.v);
  }

  private syncPattern() {
    this.engine.syncPattern(this.project.current, this.pattern);
    this.save();
  }

  /** ステップ数などを表示しているパネルを作り直す */
  private refreshPanelIfNeeded() {
    if (this.ui.tab === 'edit' || this.ui.tab === 'voice' || this.ui.tab === 'song') this.renderPanel();
  }

  private shiftPattern(direction: number) {
    this.pushUndo();
    const length = this.pattern.length;
    for (const tp of Object.values(this.pattern.tracks)) {
      const len = tp.length > 0 ? tp.length : length;
      const slice = tp.steps.slice(0, len);
      const rotated = slice.map((_, i) => slice[(i - direction + len * 2) % len]);
      for (let i = 0; i < len; i++) tp.steps[i] = rotated[i];
    }
    this.grid.render(this.pattern);
    this.syncPattern();
  }

  private doublePattern() {
    const length = this.pattern.length;
    if (length * 2 > STEP_MAX) {
      this.setStatus('これ以上は伸ばせません（最大64ステップ）');
      return;
    }
    this.pushUndo();
    for (const tp of Object.values(this.pattern.tracks)) {
      for (let i = 0; i < length; i++) {
        const src = tp.steps[i];
        tp.steps[length + i] = src ? { ...src } : null;
      }
    }
    this.pattern.length = length * 2;
    this.grid.render(this.pattern);
    this.syncPattern();
    this.refreshPanelIfNeeded();
  }

  private duplicatePattern() {
    const target = this.project.patterns.findIndex((p, i) => i !== this.project.current && isPatternEmpty(p));
    if (target < 0) {
      this.setStatus('空きパターンがありません');
      return;
    }
    const copy = clonePattern(this.pattern);
    copy.name = PATTERN_NAMES[target];
    this.project.patterns[target] = copy;
    this.engine.syncPattern(target, copy);
    this.selectPattern(target);
    this.setStatus(`パターン ${PATTERN_NAMES[target]} に複製しました`);
  }

  private clearTrack() {
    this.pushUndo();
    const tp = this.pattern.tracks[this.ui.selected];
    if (tp) tp.steps = new Array(STEP_MAX).fill(null);
    this.grid.render(this.pattern);
    this.syncPattern();
  }

  private clearPattern() {
    this.pushUndo();
    const length = this.pattern.length;
    this.project.patterns[this.project.current] = emptyPattern(
      this.pattern.name,
      this.project.tracks.map((t) => t.id),
      length
    );
    this.grid.render(this.pattern);
    this.paintPatternButtons();
    this.syncPattern();
    this.refreshPanelIfNeeded();
  }

  // -------------------------------------------------------- ステップの詳細

  private openInspector(trackId: string, index: number, anchor: HTMLElement) {
    this.closeInspector();
    const tp = this.pattern.tracks[trackId];
    if (!tp) return;
    const step = tp.steps[index] ?? { v: this.ui.inputVelocity, p: 1, r: 1, s: 0 };
    const track = this.project.tracks.find((t) => t.id === trackId);

    const pop = el('div', 'inspector');
    pop.append(el('div', 'inspector-title', `${track?.name ?? trackId} ／ ${index + 1} ステップ目`));

    const apply = (next: Step | null) => {
      tp.steps[index] = next;
      this.grid.render(this.pattern);
      this.syncPattern();
    };

    pop.append(
      slider({
        label: '強さ', min: 0.05, max: 1, step: 0.01, value: step.v,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => apply({ ...step, v }),
      }),
      slider({
        label: '確率', min: 0.05, max: 1, step: 0.05, value: step.p,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => apply({ ...step, p: v }),
      }),
      segmented<number>('連打', [
        { value: 1, label: '1' }, { value: 2, label: '2' },
        { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 6, label: '6' },
      ], step.r, (v) => apply({ ...step, r: v })),
      slider({
        label: 'ずらし', min: -0.5, max: 0.5, step: 0.01, value: step.s,
        format: (v) => (v === 0 ? 'ジャスト' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
        hint: '1ステップ幅に対する割合',
        onInput: (v) => apply({ ...step, s: v }),
      })
    );

    const row = el('div', 'btn-row');
    row.append(
      button('消す', 'danger', () => {
        apply(null);
        this.closeInspector();
      }),
      button('閉じる', '', () => this.closeInspector())
    );
    pop.append(row);

    document.body.append(pop);
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    pop.style.width = `${width}px`;
    const left = Math.min(Math.max(12, rect.left - width / 2 + rect.width / 2), window.innerWidth - width - 12);
    pop.style.left = `${left}px`;
    const height = pop.getBoundingClientRect().height;
    const top = rect.bottom + 8 + height > window.innerHeight ? Math.max(12, rect.top - height - 8) : rect.bottom + 8;
    pop.style.top = `${top}px`;
    this.inspector = pop;

    // 外側をタップしたら閉じる
    setTimeout(() => {
      const onDown = (e: PointerEvent) => {
        if (this.inspector && !this.inspector.contains(e.target as Node)) {
          this.closeInspector();
          window.removeEventListener('pointerdown', onDown);
        }
      };
      window.addEventListener('pointerdown', onDown);
    }, 0);
  }

  private closeInspector() {
    this.inspector?.remove();
    this.inspector = null;
  }

  // ---------------------------------------------------------------- 再生系

  private async togglePlay() {
    await this.ensureAudio();
    if (this.engine.playing) {
      this.engine.stop();
      this.playButton.classList.remove('playing');
      this.setStatus('停止');
    } else {
      this.engine.syncAll(this.project);
      this.engine.play(0);
      this.playButton.classList.add('playing');
      this.setStatus(this.project.songMode ? 'ソングを再生中' : `パターン ${PATTERN_NAMES[this.project.current]} を再生中`);
    }
  }

  private async toggleRecord() {
    await this.ensureAudio();
    this.recording = !this.recording;
    this.recButton.classList.toggle('active', this.recording);
    if (this.recording && !this.engine.playing) await this.togglePlay();
    this.setStatus(this.recording ? '録音中：パッドを叩くと書き込まれます' : '録音を終了しました');
  }

  private panic() {
    this.engine.panic();
    this.recording = false;
    this.recButton.classList.remove('active');
    this.playButton.classList.remove('playing');
    this.grid.setPlayhead(-1, 0);
    this.setStatus('全停止しました');
  }

  private async hit(trackId: string, velocity: number) {
    await this.ensureAudio();
    this.engine.hit(trackId, velocity);
    if (this.recording && this.engine.playing) this.recordHit(trackId, velocity);
  }

  private preview(trackId: string, velocity = 0.85) {
    void this.ensureAudio().then(() => this.engine.hit(trackId, velocity));
  }

  /** 叩いた時刻をいちばん近いステップに合わせて書き込む */
  private recordHit(trackId: string, velocity: number) {
    const info = this.lastStep;
    if (!info || info.step < 0) return;
    const stepSec = 60 / this.project.bpm / this.project.stepsPerBeat;
    const elapsed = this.engine.now - info.at;
    const pattern = this.project.patterns[info.pattern];
    if (!pattern) return;
    let index = info.step + (elapsed > stepSec * 0.5 ? 1 : 0);
    const tp = pattern.tracks[trackId];
    if (!tp) return;
    const length = tp.length > 0 ? tp.length : pattern.length;
    index = ((index % length) + length) % length;
    this.pushUndo();
    tp.steps[index] = { v: velocity, p: 1, r: 1, s: 0 };
    if (info.pattern === this.project.current) this.grid.render(this.pattern);
    this.engine.syncPattern(info.pattern, pattern);
    this.save();
  }

  private tapTempo() {
    const now = performance.now();
    this.tapTimes = this.tapTimes.filter((t) => now - t < 2500);
    this.tapTimes.push(now);
    if (this.tapTimes.length < 2) {
      this.setStatus('もう数回タップしてください');
      return;
    }
    const spans: number[] = [];
    for (let i = 1; i < this.tapTimes.length; i++) spans.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    this.setBpm(Math.round(60000 / avg));
  }

  private setBpm(value: number) {
    this.project.bpm = clamp(Math.round(value), 40, 240);
    this.bpmInput.value = String(this.project.bpm);
    this.engine.syncTransport(this.project);
    this.save();
    this.setStatus(`テンポ ${this.project.bpm} BPM`);
    if (this.ui.tab === 'export') this.updateExportStatus();
  }

  private setSongMode(on: boolean) {
    this.project.songMode = on;
    this.songModeButton.classList.toggle('active', on);
    this.engine.syncTransport(this.project);
    this.save();
    if (this.ui.tab === 'song' || this.ui.tab === 'export') this.renderPanel();
    this.setStatus(on ? 'ソングモード' : 'パターンモード');
  }

  private selectPattern(index: number) {
    this.project.current = clamp(index, 0, PATTERN_COUNT - 1);
    this.grid.render(this.pattern);
    this.paintPatternButtons();
    this.engine.syncTransport(this.project);
    this.save();
    if (this.ui.tab === 'export') this.updateExportStatus();
    else this.refreshPanelIfNeeded();
  }

  private paintPatternButtons() {
    this.patternButtons.forEach((btn, i) => {
      btn.classList.toggle('active', i === this.project.current);
      btn.classList.toggle('filled', !isPatternEmpty(this.project.patterns[i]));
    });
    this.songModeButton.classList.toggle('active', this.project.songMode);
  }

  private selectTrack(trackId: string) {
    this.ui.selected = trackId;
    this.grid.setSelected(trackId);
    this.save();
  }

  private toggleMute(trackId: string) {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.mute = !track.mute;
    this.grid.setTracks(this.project.tracks);
    this.engine.syncTracks(this.project);
    this.save();
  }

  private toggleSolo(trackId: string) {
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.solo = !track.solo;
    this.grid.setTracks(this.project.tracks);
    this.engine.syncTracks(this.project);
    this.save();
  }

  private setKit(kitId: string) {
    this.project.kitId = kitId;
    this.project.tracks = applyKit(this.project.tracks, kitId);
    const kit = findKit(kitId);
    if (kit.master) this.project.master = { ...this.project.master, ...kit.master };
    this.engine.syncAll(this.project);
    this.save();
    this.renderPanel();
    this.setStatus(`キット：${kit.name}`);
  }

  private resetTrack(trackId: string) {
    const fresh = applyKit(this.project.tracks, this.project.kitId).find((t) => t.id === trackId);
    const track = this.project.tracks.find((t) => t.id === trackId);
    if (!fresh || !track) return;
    track.params = { ...fresh.params };
    this.engine.syncTracks(this.project);
    this.save();
    this.renderPanel();
  }

  private moveSlot(index: number, direction: number) {
    const next = index + direction;
    if (next < 0 || next >= this.project.song.length) return;
    const [slot] = this.project.song.splice(index, 1);
    this.project.song.splice(next, 0, slot);
    this.engine.syncTransport(this.project);
    this.save();
    this.renderPanel();
  }

  private loadDemoSong(id: string) {
    const demo = DEMO_SONGS.find((d) => d.id === id);
    if (!demo) return;
    this.project = loadDemo(demo);
    this.undoStack = [];
    this.engine.syncAll(this.project);
    this.save();
    this.build();
    this.setStatus(`デモ「${demo.name}」を読み込みました`);
  }

  // ---------------------------------------------------------------- 書き出し

  private async exportWav() {
    if (this.exporting) return;
    this.exporting = true;
    this.updateExportStatus('書き出し中…');
    try {
      await this.ensureAudio();
      const buffer = await renderProject(this.project, { loops: this.ui.exportLoops });
      const wav = encodeWav(buffer);
      downloadBlob(new Blob([wav], { type: 'audio/wav' }), timestampName('hibiki-drums', 'wav'));
      this.updateExportStatus(`WAV を書き出しました（${(wav.length / 1024 / 1024).toFixed(1)} MB）`);
    } catch (err) {
      console.error(err);
      this.updateExportStatus('書き出しに失敗しました');
    } finally {
      this.exporting = false;
    }
  }

  private async exportStems() {
    if (this.exporting) return;
    this.exporting = true;
    try {
      await this.ensureAudio();
      const targets = this.project.tracks.filter((t) => !t.mute);
      const entries: ZipEntry[] = [];
      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];
        this.updateExportStatus(`トラック別に書き出し中… (${i + 1}/${targets.length}) ${track.name}`);
        // 描画を進めるために1フレーム譲る
        await new Promise((resolve) => setTimeout(resolve, 0));
        const buffer = await renderProject(this.project, {
          loops: this.ui.exportLoops,
          soloTrack: track.id,
        });
        entries.push({
          name: `${String(i + 1).padStart(2, '0')}_${safeName(track.name)}.wav`,
          data: encodeWav(buffer),
        });
      }
      const zip = createZip(entries);
      downloadBlob(zip, timestampName('hibiki-stems', 'zip'));
      this.updateExportStatus(`${entries.length} 本のトラックを ZIP にまとめました`);
    } catch (err) {
      console.error(err);
      this.updateExportStatus('書き出しに失敗しました');
    } finally {
      this.exporting = false;
    }
  }

  private exportMidi() {
    const midi = encodeMidi(this.project, this.ui.exportLoops);
    downloadBlob(new Blob([midi], { type: 'audio/midi' }), timestampName('hibiki-drums', 'mid'));
    this.updateExportStatus('MIDI を書き出しました（GM ドラムマップ・チャンネル10）');
  }

  private exportProject() {
    const data = {
      app: 'hibiki-drum-machine',
      version: 1,
      project: encodeProject(this.project),
    };
    downloadBlob(
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      `${safeName(this.project.name)}.hibiki.json`
    );
    this.updateExportStatus('プロジェクトを保存しました');
  }

  private importProject() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const project = decodeProject(data.project ?? data);
        if (!project) throw new Error('形式が違います');
        this.project = project;
        this.undoStack = [];
        this.engine.syncAll(this.project);
        this.save();
        this.build();
        this.setStatus('プロジェクトを読み込みました');
      } catch (err) {
        console.error(err);
        this.setStatus('ファイルを読み込めませんでした');
      }
    });
    input.click();
  }

  // ------------------------------------------------------------------ 補助

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void this.togglePlay();
        return;
      }
      if (e.code === 'Escape') {
        this.closeInspector();
        this.panic();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this.undo();
        return;
      }
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        void this.toggleRecord();
        return;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= PATTERN_COUNT) {
          this.selectPattern(n - 1);
          return;
        }
      }
      if (e.repeat) return;
      const index = PAD_KEYS.indexOf(e.code);
      if (index >= 0 && index < this.project.tracks.length) {
        const track = this.project.tracks[index];
        this.selectTrack(track.id);
        void this.hit(track.id, e.shiftKey ? 1 : 0.8);
        this.pads?.flash(track.id);
      }
    });
  }

  private startLoop() {
    const tick = () => {
      if (this.audioReady) {
        const level = this.engine.level();
        this.meterFill.style.transform = `scaleX(${Math.min(1, level * 1.25).toFixed(3)})`;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
