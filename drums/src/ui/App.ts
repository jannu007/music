import { DrumEngine, projectSeconds, renderProject, type StepInfo } from '../audio/DrumEngine';
import {
  createZip,
  downloadBlob,
  encodeMidi,
  encodeWav,
  hasAudibleSteps,
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
  type DistortionType,
  type FilterMode,
  type MasterSettings,
  type ModMode,
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
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

const STORAGE_KEY = 'hibiki-drums-v1';

/** MasterSettings のうち数値の項目だけ／真偽値の項目だけを取り出す */
type MasterNumberKey = {
  [K in keyof MasterSettings]: MasterSettings[K] extends number ? K : never;
}[keyof MasterSettings];
type MasterBoolKey = {
  [K in keyof MasterSettings]: MasterSettings[K] extends boolean ? K : never;
}[keyof MasterSettings];

const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

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
  private globalListenersBound = false;

  constructor(root: HTMLElement) {
    this.root = root;
    document.documentElement.lang = getLocale();
    onLocaleChange(() => this.build());
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
        .init(this.project)
        .then(() => {
          this.audioReady = true;
          this.engine.onStep = (info) => this.onStep(info);
          this.engine.onMeters = (peaks) => this.grid.setMeters(peaks);
          this.engine.syncAll(this.project);
          this.setStatus(t('status.ready'));
        })
        .catch((err) => {
          console.error(err);
          this.setStatus(t('status.audioInitFailed'));
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

    // 画面が横長で低いとき（スマホの横向きなど）に、グリッドとパネルを
    // 左右に並べ替えられるよう、この2つはひとつの箱にまとめておく
    const work = el('div', 'work');
    work.append(stage, this.buildPanel());
    app.append(work);
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
    texts.append(el('strong', '', 'Hibiki Drum Machine'), el('small', '', t('brand.subtitle')));
    brand.append(texts);

    const kitSelect = el('select', 'kit-select');
    for (const kit of KITS) {
      const opt = el('option', '', t(`kit.${kit.id}.name`));
      opt.value = kit.id;
      if (kit.id === this.project.kitId) opt.selected = true;
      kitSelect.append(opt);
    }
    kitSelect.title = t('kit.selectTitle');
    kitSelect.addEventListener('change', () => this.setKit(kitSelect.value));

    this.statusEl = el('div', 'status', t('status.tapToStart'));

    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);

    const langButton = el('button', 'icon-btn lang-btn', t('lang.toggle'));
    langButton.type = 'button';
    langButton.addEventListener('click', () => toggleLocale());

    const panic = el('button', 'icon-btn danger');
    panic.type = 'button';
    panic.title = t('panic.title');
    panic.append(el('span', 'stop-icon'), el('span', 'icon-label', t('panic.label')));
    panic.addEventListener('click', () => this.panic());

    bar.append(brand, kitSelect, this.statusEl, meter, langButton, panic);
    return bar;
  }

  private buildTransport(): HTMLElement {
    const bar = el('div', 'transport');

    this.playButton = el('button', 'play-btn');
    this.playButton.type = 'button';
    this.playButton.title = t('play.title');
    this.playButton.append(el('span', 'play-icon'));
    this.playButton.addEventListener('click', () => this.togglePlay());

    this.recButton = el('button', 'rec-btn');
    this.recButton.type = 'button';
    this.recButton.title = t('rec.title');
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
    tap.title = t('tap.title');
    tap.addEventListener('click', () => this.tapTempo());
    tempo.append(el('span', 'tempo-label', 'BPM'), minus, this.bpmInput, plus, tap);

    const patterns = el('div', 'pattern-bank');
    this.patternButtons = [];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const btn = el('button', 'pattern-btn', PATTERN_NAMES[i]);
      btn.type = 'button';
      btn.title = t('pattern.title', { name: PATTERN_NAMES[i] });
      btn.addEventListener('click', () => this.selectPattern(i));
      this.patternButtons.push(btn);
      patterns.append(btn);
    }

    this.songModeButton = el('button', 'mode-btn', 'SONG');
    this.songModeButton.type = 'button';
    this.songModeButton.title = t('song.title');
    this.songModeButton.addEventListener('click', () => this.setSongMode(!this.project.songMode));

    bar.append(this.playButton, this.recButton, tempo, patterns, this.songModeButton);
    return bar;
  }

  private buildPanel(): HTMLElement {
    const panel = el('section', 'panel');
    const tabs = el('div', 'panel-tabs');
    const defs: { id: TabId; label: string }[] = [
      { id: 'edit', label: t('tab.edit') },
      { id: 'pads', label: t('tab.pads') },
      { id: 'voice', label: t('tab.voice') },
      { id: 'mix', label: t('tab.mix') },
      { id: 'fx', label: t('tab.fx') },
      { id: 'song', label: t('tab.song') },
      { id: 'demo', label: t('tab.demo') },
      { id: 'export', label: t('tab.export') },
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
    const sec = section(t('panel.edit.title'), t('panel.edit.hint'));
    const g = grid();

    g.append(
      segmented<number>(
        t('ctl.inputVelocity.label'),
        [
          { value: 0.34, label: t('vel.ghost') },
          { value: 0.7, label: t('vel.normal') },
          { value: 1, label: t('vel.accent') },
        ],
        this.ui.inputVelocity,
        (v) => {
          this.ui.inputVelocity = v;
          this.save();
        }
      )
    );

    g.append(
      stepper(t('ctl.stepCount.label'), this.pattern.length, 1, STEP_MAX, 1, (v) => {
        this.pattern.length = clamp(v, 1, STEP_MAX);
        this.grid.render(this.pattern);
        this.syncPattern();
      }, t('ctl.stepCount.hint'))
    );

    g.append(
      slider({
        label: t('ctl.swing.label'),
        min: 50,
        max: 75,
        step: 1,
        value: this.project.swing,
        format: (v) => `${v}%`,
        hint: t('ctl.swing.hint'),
        onInput: (v) => {
          this.project.swing = v;
          this.engine.syncTransport(this.project);
          this.save();
        },
      })
    );

    g.append(
      slider({
        label: t('ctl.humanize.label'),
        min: 0,
        max: 1,
        step: 0.01,
        value: this.project.humanize,
        format: (v) => `${Math.round(v * 100)}%`,
        hint: t('ctl.humanize.hint'),
        onInput: (v) => {
          this.project.humanize = v;
          this.engine.syncTransport(this.project);
          this.save();
        },
      })
    );

    g.append(
      segmented<number>(
        t('ctl.subdivision.label'),
        [
          { value: 4, label: t('sub.16') },
          { value: 3, label: t('sub.8t') },
          { value: 6, label: t('sub.16t') },
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
      switchRow(t('ctl.follow.label'), this.ui.follow, (v) => {
        this.ui.follow = v;
        this.save();
      }, t('ctl.follow.hint'))
    );

    sec.append(g);

    const tools = el('div', 'btn-row');
    tools.append(
      button(t('tool.shiftLeft'), '', () => this.shiftPattern(-1)),
      button(t('tool.shiftRight'), '', () => this.shiftPattern(1)),
      button(t('tool.double'), '', () => this.doublePattern()),
      button(t('tool.duplicate'), '', () => this.duplicatePattern()),
      button(t('tool.clearTrack'), '', () => this.clearTrack()),
      button(t('tool.clearPattern'), 'danger', () => this.clearPattern()),
      button(t('tool.undo'), '', () => this.undo())
    );
    sec.append(tools);
    this.panelBody.append(sec);
  }

  private renderPadsPanel() {
    const sec = section(t('panel.pads.title'), t('panel.pads.hint'));
    this.pads = new DrumPads(this.project.tracks, {
      onHit: (trackId, vel) => this.hit(trackId, vel),
      onSelect: (trackId) => this.selectTrack(trackId),
    });
    sec.append(this.pads.root);
    const note = el('div', 'panel-note', t('pads.note'));
    sec.append(note);
    this.panelBody.append(sec);
  }

  private renderVoicePanel() {
    const track = this.selectedTrack;
    const sec = section(t('panel.voice.title', { track: t(`track.${track.id}.name`) }), t('panel.voice.hint'));

    const picker = el('div', 'track-picker');
    for (const tr of this.project.tracks) {
      const btn = el('button', 'chip', tr.short);
      btn.type = 'button';
      btn.title = t(`track.${tr.id}.name`);
      if (tr.id === track.id) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.selectTrack(tr.id);
        this.preview(tr.id);
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

    bind('tune', t('ctl.tune.label'), -24, 24, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, t('ctl.tune.hint'));
    bind('decay', t('ctl.decay.label'), 0.1, 3, 0.01, (v) => `${v.toFixed(2)}×`, t('ctl.decay.hint'));
    bind('tone', t('ctl.tone.label'), 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, this.toneHint(track));
    bind('snap', t('ctl.snap.label'), 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, this.snapHint(track));
    bind('drive', t('ctl.voiceDrive.label'), 0, 1, 0.01, (v) => `${Math.round(v * 100)}`, t('ctl.voiceDrive.hint'));
    bind('level', t('ctl.level.label'), 0, 1.6, 0.01, (v) => v.toFixed(2));
    bind('pan', t('ctl.pan.label'), -1, 1, 0.01, (v) => (v === 0 ? t('pan.center') : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
    bind('reverb', t('ctl.reverbSend.label'), 0, 1, 0.01, (v) => `${Math.round(v * 100)}`);
    bind('delay', t('ctl.delaySend.label'), 0, 1, 0.01, (v) => `${Math.round(v * 100)}`);

    const tp = this.pattern.tracks[track.id];
    g.append(
      stepper(t('ctl.trackLength.label'), tp.length, 0, STEP_MAX, 1, (v) => {
        tp.length = clamp(v, 0, STEP_MAX);
        this.grid.render(this.pattern);
        this.syncPattern();
      }, t('ctl.trackLength.hint'))
    );

    sec.append(g);
    const row = el('div', 'btn-row');
    row.append(
      button(t('action.preview'), 'primary', () => this.preview(track.id)),
      button(t('action.resetTrack'), '', () => this.resetTrack(track.id))
    );
    sec.append(row);
    this.panelBody.append(sec);
  }

  private toneHint(track: TrackConfig): string {
    switch (track.type) {
      case 'kick': return t('tonehint.kick');
      case 'snare': return t('tonehint.snare');
      case 'clap': return t('tonehint.clap');
      case 'hat':
      case 'cymbal': return t('tonehint.metal');
      case 'tom': return t('tonehint.tom');
      case 'shaker': return t('tonehint.shaker');
      default: return t('tonehint.default');
    }
  }

  private snapHint(track: TrackConfig): string {
    switch (track.type) {
      case 'kick': return t('snaphint.kick');
      case 'snare': return t('snaphint.snare');
      case 'clap': return t('snaphint.clap');
      case 'tom': return t('snaphint.tom');
      case 'shaker': return t('snaphint.shaker');
      default: return t('snaphint.default');
    }
  }

  private renderMixPanel() {
    const sec = section(t('panel.mix.title'), t('panel.mix.hint'));
    const table = el('div', 'mixer');
    for (const track of this.project.tracks) {
      const strip = el('div', 'strip');
      if (track.id === this.ui.selected) strip.classList.add('active');
      const head = el('div', 'strip-head');
      const name = el('button', 'strip-name', t(`track.${track.id}.name`));
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
      mini(t('mini.level'), 'level', 0, 1.6, (v) => v.toFixed(2));
      mini(t('mini.pan'), 'pan', -1, 1, (v) => (v === 0 ? t('pan.center') : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
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

    const apply = () => {
      this.engine.syncMaster(this.project);
      this.save();
    };

    /** 数値の項目をスライダーにする */
    const num = (
      g: HTMLElement,
      label: string,
      key: MasterNumberKey,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string,
      hint?: string
    ) => {
      g.append(
        slider({
          label, min, max, step, value: m[key], format, hint,
          onInput: (v) => { m[key] = v; apply(); },
        })
      );
    };

    const pct = (v: number) => `${Math.round(v * 100)}`;
    const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

    /** 効果ごとの入／切スイッチ */
    const onOff = (g: HTMLElement, label: string, key: MasterBoolKey, hint?: string) => {
      g.append(switchRow(label, m[key], (v) => { m[key] = v; apply(); }, hint));
    };

    // --- マスター --------------------------------------------------------
    const master = section(t('panel.fx.title'), t('panel.fx.hint'));
    const mg = grid();
    num(mg, t('ctl.masterVolume.label'), 'volume', 0, 1, 0.01, pct);
    num(mg, t('ctl.masterDrive.label'), 'drive', 0, 1, 0.01, pct, t('ctl.masterDrive.hint'));
    num(mg, t('ctl.glue.label'), 'glue', 0, 1, 0.01, pct, t('ctl.glue.hint'));
    num(mg, t('ctl.low.label'), 'low', -12, 12, 0.5, db);
    num(mg, t('ctl.high.label'), 'high', -12, 12, 0.5, db);
    num(mg, t('ctl.width.label'), 'width', 0, 2, 0.01,
      (v) => (v < 0.02 ? t('width.mono') : `${Math.round(v * 100)}%`), t('ctl.width.hint'));
    master.append(mg);
    this.panelBody.append(master);

    // --- 歪み ------------------------------------------------------------
    const dist = section(t('panel.dist.title'), t('panel.dist.hint'));
    const dg = grid();
    dg.append(
      segmented<DistortionType>(
        t('ctl.distType.label'),
        [
          { value: 'off', label: t('common.off') },
          { value: 'soft', label: t('dist.soft') },
          { value: 'hard', label: t('dist.hard') },
          { value: 'fuzz', label: t('dist.fuzz') },
        ],
        m.distType,
        (v) => { m.distType = v; apply(); }
      )
    );
    num(dg, t('ctl.distAmount.label'), 'distAmount', 0, 1, 0.01, pct);
    num(dg, t('ctl.distTone.label'), 'distTone', 0, 1, 0.01, pct, t('ctl.distTone.hint'));
    num(dg, t('ctl.distMix.label'), 'distMix', 0, 1, 0.01, pct);
    num(dg, t('ctl.crushBits.label'), 'crushBits', 2, 16, 1,
      (v) => (v >= 16 ? t('common.off') : `${Math.round(v)} bit`), t('ctl.crushBits.hint'));
    num(dg, t('ctl.crushMix.label'), 'crushMix', 0, 1, 0.01, pct);
    dist.append(dg);
    this.panelBody.append(dist);

    // --- フィルター ------------------------------------------------------
    const filter = section(t('panel.filter.title'), t('panel.filter.hint'));
    const fg = grid();
    fg.append(
      segmented<FilterMode>(
        t('ctl.filterMode.label'),
        [
          { value: 'off', label: t('common.off') },
          { value: 'lowpass', label: t('filter.lowpass') },
          { value: 'highpass', label: t('filter.highpass') },
          { value: 'bandpass', label: t('filter.bandpass') },
        ],
        m.filterMode,
        (v) => { m.filterMode = v; apply(); }
      )
    );
    num(fg, t('ctl.filterFreq.label'), 'filterFreq', 60, 16000, 10, hz);
    num(fg, t('ctl.filterQ.label'), 'filterQ', 0.3, 20, 0.1, (v) => v.toFixed(1), t('ctl.filterQ.hint'));
    num(fg, t('ctl.filterLfoRate.label'), 'filterLfoRate', 0.02, 8, 0.01, (v) => `${v.toFixed(2)} Hz`);
    num(fg, t('ctl.filterLfoDepth.label'), 'filterLfoDepth', 0, 1, 0.01, pct, t('ctl.filterLfoDepth.hint'));
    filter.append(fg);
    this.panelBody.append(filter);

    // --- 揺らし系 --------------------------------------------------------
    const mod = section(t('panel.mod.title'), t('panel.mod.hint'));
    const cg = grid();
    onOff(cg, t('ctl.chorus.label'), 'chorusOn', t('ctl.chorus.hint'));
    num(cg, t('ctl.chorusRate.label'), 'chorusRate', 0.05, 6, 0.01, (v) => `${v.toFixed(2)} Hz`);
    num(cg, t('ctl.chorusDepth.label'), 'chorusDepth', 0, 1, 0.01, pct);
    num(cg, t('ctl.chorusMix.label'), 'chorusMix', 0, 1, 0.01, pct);
    onOff(cg, t('ctl.flanger.label'), 'flangerOn', t('ctl.flanger.hint'));
    num(cg, t('ctl.flangerRate.label'), 'flangerRate', 0.05, 6, 0.01, (v) => `${v.toFixed(2)} Hz`);
    num(cg, t('ctl.flangerDepth.label'), 'flangerDepth', 0, 1, 0.01, pct);
    num(cg, t('ctl.flangerFeedback.label'), 'flangerFeedback', 0, 0.85, 0.01, pct);
    num(cg, t('ctl.flangerMix.label'), 'flangerMix', 0, 1, 0.01, pct);
    onOff(cg, t('ctl.phaser.label'), 'phaserOn', t('ctl.phaser.hint'));
    num(cg, t('ctl.phaserRate.label'), 'phaserRate', 0.05, 6, 0.01, (v) => `${v.toFixed(2)} Hz`);
    num(cg, t('ctl.phaserDepth.label'), 'phaserDepth', 0, 1, 0.01, pct);
    num(cg, t('ctl.phaserFeedback.label'), 'phaserFeedback', 0, 0.7, 0.01, pct);
    num(cg, t('ctl.phaserMix.label'), 'phaserMix', 0, 1, 0.01, pct);
    mod.append(cg);
    this.panelBody.append(mod);

    // --- トレモロ／リングモジュレーター ----------------------------------
    const extra = section(t('panel.extra.title'), t('panel.extra.hint'));
    const eg = grid();
    eg.append(
      segmented<ModMode>(
        t('ctl.modMode.label'),
        [
          { value: 'off', label: t('common.off') },
          { value: 'tremolo', label: t('mod.tremolo') },
          { value: 'autopan', label: t('mod.autopan') },
        ],
        m.modMode,
        (v) => { m.modMode = v; apply(); }
      )
    );
    num(eg, t('ctl.modRate.label'), 'modRate', 0.05, 16, 0.05, (v) => `${v.toFixed(2)} Hz`);
    num(eg, t('ctl.modDepth.label'), 'modDepth', 0, 1, 0.01, pct);
    onOff(eg, t('ctl.ring.label'), 'ringOn', t('ctl.ring.hint'));
    num(eg, t('ctl.ringFreq.label'), 'ringFreq', 10, 2000, 1, hz);
    num(eg, t('ctl.ringMix.label'), 'ringMix', 0, 1, 0.01, pct);
    extra.append(eg);
    this.panelBody.append(extra);

    // --- 空間系 ----------------------------------------------------------
    const space = section(t('panel.space.title'), t('panel.space.hint'));
    const sg = grid();
    sg.append(
      segmented<ReverbType>(
        t('ctl.reverbType.label'),
        [
          { value: 'off', label: t('reverbType.none') },
          { value: 'room', label: t('room.room.label') },
          { value: 'plate', label: t('room.plate.label') },
          { value: 'hall', label: t('room.hall.label') },
          { value: 'cavern', label: t('room.cavern.label') },
        ],
        m.reverbType,
        (v) => { m.reverbType = v; apply(); }
      )
    );
    num(sg, t('ctl.reverbAmount.label'), 'reverbMix', 0, 1, 0.01, pct);
    sg.append(
      segmented<DelayDivision>(
        t('ctl.delayDivision.label'),
        [
          { value: 'off', label: t('delayDivision.none') },
          { value: '1/16', label: '1/16' },
          { value: '1/8T', label: t('delay.triplet') },
          { value: '1/8', label: '1/8' },
          { value: '1/8.', label: t('delay.dotted') },
          { value: '1/4', label: '1/4' },
        ],
        m.delayDivision,
        (v) => { m.delayDivision = v; apply(); }
      )
    );
    num(sg, t('ctl.delayAmount.label'), 'delayMix', 0, 1, 0.01, pct);
    num(sg, t('ctl.feedback.label'), 'delayFeedback', 0, 0.85, 0.01, pct);
    sg.append(
      switchRow(t('ctl.pingpong.label'), m.delayPingPong, (v) => {
        m.delayPingPong = v;
        apply();
      }, t('ctl.pingpong.hint'))
    );
    space.append(sg);
    this.panelBody.append(space);
  }

  private renderSongPanel() {
    const sec = section(t('panel.song.title'), t('panel.song.hint'));
    const g = grid();
    g.append(
      switchRow(t('ctl.songMode.label'), this.project.songMode, (v) => this.setSongMode(v), t('ctl.songMode.hint'))
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
      button(t('tool.addBlock'), 'primary', () => {
        this.project.song.push({ pattern: this.project.current, repeats: 2 });
        this.engine.syncTransport(this.project);
        this.save();
        this.renderPanel();
      }),
      button(t('tool.appendCurrent'), '', () => {
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
      t('song.summary', { total, seconds: seconds.toFixed(1), bpm: this.project.bpm })));

    this.panelBody.append(sec);
  }

  private renderDemoPanel() {
    const sec = section(t('panel.demo.title'), t('panel.demo.hint'));
    const list = el('div', 'demo-list');
    for (const demo of DEMO_SONGS) {
      const card = el('div', 'demo-card');
      const head = el('div', 'demo-head');
      head.append(
        el('strong', '', t(`demo.${demo.id}.name`)),
        el('span', 'demo-meta', t('demo.meta', { bpm: demo.bpm, kit: t(`kit.${demo.kitId}.name`) }))
      );
      card.append(head, el('p', 'demo-desc', t(`demo.${demo.id}.desc`)));
      const row = el('div', 'btn-row');
      row.append(button(t('action.load'), 'primary', () => this.loadDemoSong(demo.id)));
      card.append(row);
      list.append(card);
    }
    sec.append(list);
    this.panelBody.append(sec);
  }

  private renderExportPanel() {
    const sec = section(t('panel.export.title'), t('panel.export.hint'));
    const g = grid();
    g.append(
      stepper(t('ctl.exportLoops.label'), this.ui.exportLoops, 1, 32, 1, (v) => {
        this.ui.exportLoops = clamp(v, 1, 32);
        this.save();
        this.updateExportStatus();
      }, t('ctl.exportLoops.hint'))
    );
    sec.append(g);

    const row = el('div', 'btn-row');
    row.append(
      button(t('action.exportWav'), 'primary', () => this.exportWav()),
      button(t('action.exportStems'), '', () => this.exportStems()),
      button(t('action.exportMidi'), '', () => this.exportMidi())
    );
    sec.append(row);

    const row2 = el('div', 'btn-row');
    row2.append(
      button(t('action.saveProject'), '', () => this.exportProject()),
      button(t('action.loadProject'), '', () => this.importProject())
    );
    sec.append(row2);

    this.exportStatus = el('div', 'panel-note');
    sec.append(this.exportStatus);
    this.updateExportStatus();

    sec.append(
      el('div', 'panel-note', t('export.note'))
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
    const mode = this.project.songMode
      ? t('export.mode.song')
      : t('export.mode.pattern', { name: PATTERN_NAMES[this.project.current] });
    this.exportStatus.textContent = t('export.status', { mode, seconds: seconds.toFixed(1) });
  }

  // ------------------------------------------------------------- 編集の操作

  private pushUndo() {
    this.undoStack.push({ index: this.project.current, pattern: clonePattern(this.pattern) });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  private undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.setStatus(t('status.noUndo'));
      return;
    }
    this.project.patterns[entry.index] = entry.pattern;
    this.project.current = entry.index;
    this.grid.render(this.pattern);
    this.paintPatternButtons();
    this.syncPattern();
    this.refreshPanelIfNeeded();
    this.setStatus(t('status.undone'));
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
      this.setStatus(t('status.maxLength'));
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
      this.setStatus(t('status.noEmptyPattern'));
      return;
    }
    const copy = clonePattern(this.pattern);
    copy.name = PATTERN_NAMES[target];
    this.project.patterns[target] = copy;
    this.engine.syncPattern(target, copy);
    this.selectPattern(target);
    this.setStatus(t('status.duplicated', { name: PATTERN_NAMES[target] }));
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
    const track = this.project.tracks.find((tr) => tr.id === trackId);

    const pop = el('div', 'inspector');
    pop.append(el('div', 'inspector-title', t('inspector.title', { track: track ? t(`track.${track.id}.name`) : trackId, index: index + 1 })));

    const apply = (next: Step | null) => {
      tp.steps[index] = next;
      this.grid.render(this.pattern);
      this.syncPattern();
    };

    pop.append(
      slider({
        label: t('ctl.velocity.label'), min: 0.05, max: 1, step: 0.01, value: step.v,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => apply({ ...step, v }),
      }),
      slider({
        label: t('ctl.probability.label'), min: 0.05, max: 1, step: 0.05, value: step.p,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => apply({ ...step, p: v }),
      }),
      segmented<number>(t('ctl.roll.label'), [
        { value: 1, label: '1' }, { value: 2, label: '2' },
        { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 6, label: '6' },
      ], step.r, (v) => apply({ ...step, r: v })),
      slider({
        label: t('ctl.offset.label'), min: -0.5, max: 0.5, step: 0.01, value: step.s,
        format: (v) => (v === 0 ? t('offset.just') : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
        hint: t('ctl.offset.hint'),
        onInput: (v) => apply({ ...step, s: v }),
      })
    );

    const row = el('div', 'btn-row');
    row.append(
      button(t('action.delete'), 'danger', () => {
        apply(null);
        this.closeInspector();
      }),
      button(t('action.close'), '', () => this.closeInspector())
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
      this.setStatus(t('status.stopped'));
    } else {
      this.engine.syncAll(this.project);
      this.engine.play(0);
      this.playButton.classList.add('playing');
      this.setStatus(this.project.songMode ? t('status.playingSong') : t('status.playingPattern', { name: PATTERN_NAMES[this.project.current] }));
    }
  }

  private async toggleRecord() {
    await this.ensureAudio();
    this.recording = !this.recording;
    this.recButton.classList.toggle('active', this.recording);
    if (this.recording && !this.engine.playing) await this.togglePlay();
    this.setStatus(this.recording ? t('status.recording') : t('status.recordingEnded'));
  }

  private panic() {
    this.engine.panic();
    this.recording = false;
    this.recButton.classList.remove('active');
    this.playButton.classList.remove('playing');
    this.grid.setPlayhead(-1, 0);
    this.setStatus(t('status.allStopped'));
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
      this.setStatus(t('status.tapMore'));
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
    this.setStatus(t('status.tempo', { bpm: this.project.bpm }));
    if (this.ui.tab === 'export') this.updateExportStatus();
  }

  private setSongMode(on: boolean) {
    this.project.songMode = on;
    this.songModeButton.classList.toggle('active', on);
    this.engine.syncTransport(this.project);
    this.save();
    if (this.ui.tab === 'song' || this.ui.tab === 'export') this.renderPanel();
    this.setStatus(on ? t('status.songMode') : t('status.patternMode'));
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
    const track = this.project.tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    track.mute = !track.mute;
    this.grid.setTracks(this.project.tracks);
    this.engine.syncTracks(this.project);
    this.save();
  }

  private toggleSolo(trackId: string) {
    const track = this.project.tracks.find((tr) => tr.id === trackId);
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
    this.setStatus(t('status.kit', { name: t(`kit.${kit.id}.name`) }));
  }

  private resetTrack(trackId: string) {
    const fresh = applyKit(this.project.tracks, this.project.kitId).find((tr) => tr.id === trackId);
    const track = this.project.tracks.find((tr) => tr.id === trackId);
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
    this.setStatus(t('status.demoLoaded', { name: t(`demo.${demo.id}.name`) }));
  }

  // ---------------------------------------------------------------- 書き出し

  private async exportWav() {
    if (this.exporting) return;
    if (!this.checkNotEmpty()) return;
    this.exporting = true;
    this.updateExportStatus(t('export.exporting'));
    try {
      await this.ensureAudio();
      const buffer = await renderProject(this.project, { loops: this.ui.exportLoops });
      const wav = encodeWav(buffer);
      await this.saveFile(
        new Blob([wav], { type: 'audio/wav' }),
        timestampName('hibiki-drums', 'wav'),
        t('export.wavDone', { size: (wav.length / 1024 / 1024).toFixed(1) })
      );
    } catch (err) {
      console.error(err);
      this.updateExportStatus(t('export.failed'));
    } finally {
      this.exporting = false;
    }
  }

  private async exportStems() {
    if (this.exporting) return;
    if (!this.checkNotEmpty()) return;
    this.exporting = true;
    try {
      await this.ensureAudio();
      const targets = this.project.tracks.filter((tr) => !tr.mute);
      const entries: ZipEntry[] = [];
      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];
        const trackName = t(`track.${track.id}.name`);
        this.updateExportStatus(t('export.stemsProgress', { i: i + 1, total: targets.length, track: trackName }));
        // 描画を進めるために1フレーム譲る
        await new Promise((resolve) => setTimeout(resolve, 0));
        const buffer = await renderProject(this.project, {
          loops: this.ui.exportLoops,
          soloTrack: track.id,
        });
        entries.push({
          name: `${String(i + 1).padStart(2, '0')}_${safeName(trackName)}.wav`,
          data: encodeWav(buffer),
        });
      }
      const zip = createZip(entries);
      await this.saveFile(zip, timestampName('hibiki-stems', 'zip'), t('export.stemsDone', { count: entries.length }));
    } catch (err) {
      console.error(err);
      this.updateExportStatus(t('export.failed'));
    } finally {
      this.exporting = false;
    }
  }

  private async exportMidi() {
    if (!this.checkNotEmpty()) return;
    const midi = encodeMidi(this.project, this.ui.exportLoops);
    try {
      await this.saveFile(
        new Blob([midi], { type: 'audio/midi' }),
        timestampName('hibiki-drums', 'mid'),
        t('export.midiDone')
      );
    } catch (err) {
      console.error(err);
      this.updateExportStatus(t('export.failed'));
    }
  }

  /**
   * 打ち込みが空のまま書き出そうとしていないか。
   *
   * このアプリは空のパターンから始まる。そのまま書き出すと、
   * 無音のファイルが「書き出しました（1.2 MB）」と一緒に出来上がる。
   * 保存して再生してはじめて気づくことになるので、押した時点で止める。
   */
  private checkNotEmpty(): boolean {
    if (hasAudibleSteps(this.project, this.ui.exportLoops)) return true;
    this.updateExportStatus(t('export.empty'));
    return false;
  }

  private async exportProject() {
    const data = {
      app: 'hibiki-drum-machine',
      version: 1,
      project: encodeProject(this.project),
    };
    try {
      await this.saveFile(
        new Blob([JSON.stringify(data)], { type: 'application/json' }),
        `${safeName(this.project.name)}.hibiki.json`,
        t('export.projectSaved')
      );
    } catch (err) {
      console.error(err);
      this.updateExportStatus(t('export.failed'));
    }
  }

  /**
   * 保存して、済んだことを伝える。
   * 同梱アプリでは端末のどこに置いたかまで出す（web ではブラウザ任せなので出さない）
   */
  private async saveFile(blob: Blob, filename: string, done: string) {
    const outcome = await downloadBlob(blob, filename);
    this.updateExportStatus(outcome.kind === 'file' ? `${done} → ${outcome.path}` : done);
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
        this.setStatus(t('export.projectLoaded'));
      } catch (err) {
        console.error(err);
        this.setStatus(t('export.projectLoadFailed'));
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
