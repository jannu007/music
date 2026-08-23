/*
 * 画面ぜんたい。
 *
 * 下に鍵盤を置きっぱなしにして、上のタブだけを差し替える。
 * どのタブを開いていても手を止めずに弾けるようにするため。
 *
 *   音源     … 付属音源と、自分で取り込んだ素材
 *   割り当て … どの鍵盤でどの素材を鳴らすか。波形とループ点もここ
 *   音づくり … エンベロープ・フィルター・ゆれ・弾き方
 *   エフェクト … 6アプリ共通の10種類
 *   録音     … 弾いたものを記録する
 *   書き出し … WAV / MIDI / 楽器の保存と読み込み
 */

import './strings';
import { onLocaleChange, t, toggleLocale } from './i18n';
import { button, el, grid, section, segmented, slider, stepper, switchRow } from './controls';
import { Keyboard } from './Keyboard';
import { Waveform, type WaveformValues } from './Waveform';
import { SamplerEngine, type EngineSample } from '../audio/SamplerEngine';
import { buildFactory, FACTORY_IDS } from '../audio/factory';
import { DEMO_SONGS, buildDemo, type DemoSong } from '../data/demos';
import {
  ImportError,
  fromRecording,
  importAudioFile,
  trimSilence,
  type ImportedSample,
} from '../audio/import';
import {
  MAX_FILE_BYTES,
  MAX_SAMPLE_SECONDS,
  MAX_STORE_BYTES,
  clearSamples,
  deleteSample,
  getSample,
  listSamples,
  putSample,
  usedBytes,
} from '../audio/store';
import {
  PROJECT_APP,
  PROJECT_VERSION,
  decodeInstrument,
  decodeProjectFile,
  encodeInstrument,
  safeName,
} from '../audio/project';
import {
  Recorder,
  downloadBlob,
  encodeMidi,
  encodeWav,
  renderPerformance,
  timestampName,
} from '../audio/recorder';
import type {
  DistortionType,
  FilterMode,
  Instrument,
  ModMode,
  ReverbType,
  SampleMeta,
  Zone,
} from '../audio/types';
import { noteName } from '../audio/types';

type Tab = 'map' | 'sound' | 'fx' | 'rec' | 'export';

const STORAGE_KEY = 'yamabiko-sampler-state';
const SAMPLE_RATE = 48000;

/** 数を効く単位で見せる */
const fmtSeconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtMb = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`;

export class SamplerApp {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly voiceMeter: HTMLElement;
  private readonly instrumentLabel: HTMLElement;
  private readonly keyboard: Keyboard;
  private readonly waveform: Waveform;
  private readonly waveStrip: HTMLElement;
  private readonly waveLabel: HTMLElement;

  private ctx: AudioContext | null = null;
  private engine: SamplerEngine | null = null;
  private masterGain: GainNode | null = null;

  private instrument: Instrument = decodeInstrument({});
  /** いま楽器が使っている素材の波形 */
  private sampleData = new Map<string, Float32Array[]>();
  private sampleMeta = new Map<string, SampleMeta>();
  /** 保管庫にある自分の素材 */
  private mySamples: SampleMeta[] = [];

  private tab: Tab = 'map';
  /**
   * いま載っている付属音源の id。自分の素材から作った楽器のときは null。
   *
   * 表示名は言語で変わるので、名前そのものではなく id を覚えておき、
   * 画面を組むたびに引き直す。名前を持ったままだと、言語を切り替えても
   * 見出しだけ前の言語のまま残ってしまう。
   */
  private factoryId: string | null = null;
  /** いま読み込んでいる収録デモ。一覧で印を付けるのに使う */
  private loadedDemo: string | null = null;
  private selectedZone = 0;
  private masterVolume = 0.85;
  private exporting = false;
  private busy = false;
  private includeSamples = true;

  private readonly recorder = new Recorder();
  private playbackTimer: number | null = null;
  private micRecorder: {
    stop: () => void;
    stream: MediaStream;
  } | null = null;
  private meterTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('sampler-app');

    const header = el('header', 'app-header');
    const title = el('div', 'app-title');
    title.append(el('h1', '', t('app.name')));
    this.instrumentLabel = el('div', 'app-instrument');
    title.append(this.instrumentLabel);

    this.voiceMeter = el('div', 'voice-meter');
    const lang = button(t('lang.toggle'), 'ghost', () => toggleLocale());
    lang.classList.add('lang-btn');
    lang.title = t('lang.toggle.hint');
    header.append(title, this.voiceMeter, lang);

    const tabs = el('nav', 'tab-bar');
    const tabIds: Tab[] = ['map', 'sound', 'fx', 'rec', 'export'];
    for (const id of tabIds) {
      const btn = button(t(`tab.${id}`), 'tab-btn', () => this.showTab(id));
      btn.dataset.tab = id;
      tabs.append(btn);
    }

    this.panel = el('main', 'panel');
    this.statusLine = el('div', 'status-line');

    // 波形はタブを切り替えても消さない。どの画面にいても、いま触っている音が
    // どんな形をしているかが見えているようにする
    this.waveform = new Waveform((values) => this.updateZone(values));
    this.waveStrip = el('div', 'wave-strip');
    this.waveLabel = el('div', 'wave-strip-label');
    this.waveStrip.append(this.waveLabel, this.waveform.root);

    this.keyboard = new Keyboard(
      {
        noteOn: (note, velocity) => this.playNote(note, velocity),
        noteOff: (note) => this.stopNote(note),
        hasZone: (note) => this.engine?.hasZoneFor(note) ?? false,
        highlight: () => {
          const zone = this.instrument.zones[this.selectedZone];
          return zone ? { lo: zone.loKey, hi: zone.hiKey } : null;
        },
      },
      () => this.keyboard.paint()
    );

    this.root.append(header, tabs, this.panel, this.waveStrip, this.statusLine, this.keyboard.root);

    this.restore();
    onLocaleChange(() => this.rebuild());
    this.startMeter();
    void this.loadInitial();
  }

  // ---------------------------------------------------------------- 起動

  /** はじめに開いたときは、付属音源のひとつを載せておく */
  private async loadInitial() {
    await this.refreshMySamples();
    if (this.instrument.zones.length === 0) {
      await this.loadFactory(FACTORY_IDS[0]);
    } else {
      await this.reloadSamplesForInstrument();
    }
    this.rebuild();
  }

  private restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      // 保存データも外から書き換えられうるので、必ず検証を通す
      if (saved?.instrument) this.instrument = decodeInstrument(saved.instrument);
      if (typeof saved?.masterVolume === 'number') {
        this.masterVolume = Math.max(0, Math.min(1, saved.masterVolume));
      }
      // 保存データも書き換えられうるので、知っている id のときだけ受け取る
      if (typeof saved?.factoryId === 'string' && FACTORY_IDS.includes(saved.factoryId)) {
        this.factoryId = saved.factoryId;
      }
    } catch {
      /* 壊れていれば初期状態で始める */
    }
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          instrument: encodeInstrument(this.instrument),
          masterVolume: this.masterVolume,
          factoryId: this.factoryId,
        })
      );
    } catch {
      /* 保存できなくても操作は続けられる */
    }
  }

  // ---------------------------------------------------------------- 音

  private async ensureAudio(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    this.masterGain = master;

    const engine = new SamplerEngine(ctx, this.instrument);
    engine.output.connect(master);
    this.engine = engine;
    this.pushBuffers();
    return ctx;
  }

  /** いま持っている波形をエンジンへ渡す */
  private pushBuffers() {
    const ctx = this.ctx;
    const engine = this.engine;
    if (!ctx || !engine) return;
    const buffers = new Map<string, EngineSample>();
    for (const [id, channels] of this.sampleData) {
      if (channels.length === 0 || channels[0].length === 0) continue;
      const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
      for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c);
      buffers.set(id, { buffer });
    }
    engine.setBuffers(buffers);
  }

  private applyInstrument() {
    this.engine?.apply(this.instrument);
    this.persist();
    this.keyboard.paint();
  }

  private async playNote(note: number, velocity: number) {
    await this.ensureAudio();
    this.engine?.noteOn(note, velocity);
    if (this.recorder.recording && this.ctx) this.recorder.noteOn(note, velocity, this.ctx.currentTime);
  }

  private stopNote(note: number) {
    this.engine?.noteOff(note);
    if (this.recorder.recording && this.ctx) this.recorder.noteOff(note, this.ctx.currentTime);
  }

  private startMeter() {
    const tick = () => {
      const voices = this.engine?.activeVoices ?? 0;
      this.voiceMeter.textContent = `${t('header.voices')} ${voices}`;
      this.voiceMeter.classList.toggle('busy', voices > this.instrument.polyphony * 0.75);
      if (this.recorder.recording && this.ctx) {
        this.setStatus(t('rec.recording', { seconds: this.recorder.elapsed(this.ctx.currentTime).toFixed(1) }));
      }
    };
    this.meterTimer = window.setInterval(tick, 250);
    tick();
  }

  // ---------------------------------------------------------------- 素材

  private async refreshMySamples() {
    try {
      this.mySamples = await listSamples();
    } catch {
      this.mySamples = [];
    }
  }

  /** 付属音源を合成して読み込む */
  private async loadFactory(id: string) {
    this.busy = true;
    this.setStatus(t('browse.loading'));
    this.rebuild();
    // 合成の前に一度描かせる。数百ミリ秒とはいえ、無反応に見せない
    await new Promise((resolve) => setTimeout(resolve, 16));
    try {
      const [built] = buildFactory(SAMPLE_RATE, id);
      if (!built) return;
      this.instrument = built.instrument;
      this.factoryId = id;
      this.loadedDemo = null;
      this.instrument.name = t(`inst.${id}`);
      this.sampleData = new Map();
      this.sampleMeta = new Map();
      for (const s of built.samples) {
        this.sampleData.set(s.meta.id, s.channels);
        this.sampleMeta.set(s.meta.id, s.meta);
      }
      this.selectedZone = 0;
      await this.ensureAudio();
      this.pushBuffers();
      this.applyInstrument();
      this.setStatus('');
    } finally {
      this.busy = false;
      this.rebuild();
    }
  }

  /**
   * 収録デモを読み込む。
   *
   * 音源を載せ、その曲のための音づくりを重ね、演奏を録音済みの状態に入れる。
   * そのまま「再生」で聞けて、そのまま WAV へ書き出せる——という置き方にして
   * あるので、気に入った曲をそのまま素材として持ち出せる。
   */
  private async loadDemo(demo: DemoSong) {
    this.busy = true;
    this.setStatus(t('browse.loading'));
    this.rebuild();
    await new Promise((resolve) => setTimeout(resolve, 16));
    try {
      const [built] = buildFactory(SAMPLE_RATE, demo.instrument);
      if (!built) return;

      // 付属音源の設定に、その曲ぶんを重ねる。値の妥当性は decode に任せる
      const merged = {
        ...built.instrument,
        ...(demo.tweak ?? {}),
        fx: { ...built.instrument.fx, ...(demo.tweak?.fx ?? {}) },
      };
      const instrument = decodeInstrument(merged);
      // ゾーンは合成した本物を使う（decode は素材の id しか見ていない）
      instrument.zones = built.instrument.zones;
      instrument.name = t(`demo.${demo.id}.name`);

      this.instrument = instrument;
      this.factoryId = null;
      this.loadedDemo = demo.id;
      this.sampleData = new Map();
      this.sampleMeta = new Map();
      for (const sample of built.samples) {
        this.sampleData.set(sample.meta.id, sample.channels);
        this.sampleMeta.set(sample.meta.id, sample.meta);
      }
      this.selectedZone = 0;

      await this.ensureAudio();
      this.pushBuffers();
      this.applyInstrument();

      // 演奏を録音済みとして入れておく
      this.recorder.load(buildDemo(demo));
      this.setStatus(t('demo.loaded', { name: t(`demo.${demo.id}.name`) }));
    } finally {
      this.busy = false;
      this.rebuild();
      void this.playRecording();
    }
  }

  /** 楽器が参照している素材を、保管庫から読み直す */
  private async reloadSamplesForInstrument() {
    const wanted = new Set(this.instrument.zones.map((z) => z.sampleId));
    const missing: string[] = [];
    for (const id of wanted) {
      if (this.sampleData.has(id)) continue;
      const stored = await getSample(id).catch(() => null);
      if (stored) {
        this.sampleData.set(id, stored.channels);
        this.sampleMeta.set(id, stored.meta);
      } else {
        missing.push(id);
      }
    }
    // 付属音源のぶんは合成し直す（保存していないため）
    const factoryIds = new Set(missing.map((id) => id.split('-')[0]));
    for (const id of factoryIds) {
      const spec = FACTORY_IDS.find((f) => f === id || id === 'drum');
      if (!spec) continue;
      const [built] = buildFactory(SAMPLE_RATE, spec);
      if (!built) continue;
      for (const s of built.samples) {
        if (!this.sampleData.has(s.meta.id)) {
          this.sampleData.set(s.meta.id, s.channels);
          this.sampleMeta.set(s.meta.id, s.meta);
        }
      }
    }
    // それでも見つからない素材を指すゾーンは、鳴らないので外す
    this.instrument.zones = this.instrument.zones.filter((z) => this.sampleData.has(z.sampleId));
    await this.ensureAudio();
    this.pushBuffers();
    this.applyInstrument();
  }

  private async addSample(imported: ImportedSample) {
    this.sampleData.set(imported.meta.id, imported.channels);
    this.sampleMeta.set(imported.meta.id, imported.meta);
    try {
      await putSample(imported.meta, imported.channels);
    } catch {
      this.setStatus(t('import.failed.store'));
    }
    await this.refreshMySamples();
    this.pushBuffers();
  }

  private importFile() {
    const input = el('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const ctx = await this.ensureAudio();
        const imported = await importAudioFile(file, ctx);
        imported.channels = trimSilence(imported.channels);
        imported.meta.frames = imported.channels[0]?.length ?? 0;
        await this.addSample(imported);
        this.setStatus(t('import.done', { name: imported.meta.name }));
        this.rebuild();
      } catch (err) {
        this.setStatus(this.describeImportError(err));
      }
    });
    input.click();
  }

  private describeImportError(err: unknown): string {
    if (err instanceof ImportError) {
      return t(`import.failed.${err.reason}`, {
        max: err.reason === 'tooLarge' ? MAX_FILE_BYTES / 1048576 : MAX_SAMPLE_SECONDS,
      });
    }
    return t('import.failed.notAudio');
  }

  /**
   * マイクで録る。
   *
   * 許可を求めるのは押されたときだけ。録り終わったら必ずトラックを止める
   * （止めないと、端末によっては録音中の表示が残り続ける）。
   */
  private async toggleMicRecording() {
    if (this.micRecorder) {
      this.micRecorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      this.setStatus(t('record.denied'));
      return;
    }

    const ctx = await this.ensureAudio();
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor は古い仕組みだが、録音のためだけならこれで足りるうえ
    // どの端末でも確実に動く（AudioWorklet を足すと同梱物が増える）
    const size = 4096;
    const node = ctx.createScriptProcessor(size, 1, 1);
    const chunks: Float32Array[] = [];
    let frames = 0;
    const limit = SAMPLE_RATE * MAX_SAMPLE_SECONDS;

    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      frames += input.length;
      if (frames >= limit) stop();
    };
    // 出力へつながないと動かない実装があるので、無音のまま繋いでおく
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    const stop = () => {
      if (!this.micRecorder) return;
      this.micRecorder = null;
      node.onaudioprocess = null;
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      for (const track of stream.getTracks()) track.stop();

      const merged = new Float32Array(frames);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const trimmed = trimSilence([merged]);
      const seconds = (trimmed[0]?.length ?? 0) / SAMPLE_RATE;
      if (seconds < 0.05) {
        this.setStatus(t('record.tooShort'));
        this.rebuild();
        return;
      }
      const imported = fromRecording(trimmed, SAMPLE_RATE, `rec-${new Date().toISOString().slice(11, 19)}`);
      void this.addSample(imported).then(() => {
        this.setStatus(t('record.done', { seconds: seconds.toFixed(1) }));
        this.rebuild();
      });
    };

    this.micRecorder = { stop, stream };
    this.setStatus(t('browse.recording'));
    this.rebuild();
  }

  /** 選んだ素材だけの楽器をつくり、鍵盤いっぱいに並べる */
  private async makeInstrumentFrom(meta: SampleMeta) {
    const stored = this.sampleData.get(meta.id) ?? (await getSample(meta.id))?.channels;
    if (!stored) return;
    this.sampleData.set(meta.id, stored);
    this.sampleMeta.set(meta.id, meta);

    const base = decodeInstrument({});
    base.name = meta.name;
    base.zones = [
      {
        id: 'z1',
        sampleId: meta.id,
        loKey: 0,
        hiKey: 127,
        loVel: 1,
        hiVel: 127,
        rootKey: 60,
        tuneSemis: 0,
        tuneCents: 0,
        gainDb: 0,
        pan: 0,
        start: 0,
        end: 1,
        loop: false,
        loopStart: 0.35,
        loopEnd: 0.95,
        group: 0,
        reverse: false,
      },
    ];
    this.instrument = base;
    this.factoryId = null;
    this.loadedDemo = null;
    this.selectedZone = 0;
    await this.ensureAudio();
    this.pushBuffers();
    this.applyInstrument();
    this.showTab('map');
  }

  private async removeSample(meta: SampleMeta) {
    await deleteSample(meta.id).catch(() => {});
    this.sampleData.delete(meta.id);
    this.sampleMeta.delete(meta.id);
    this.instrument.zones = this.instrument.zones.filter((z) => z.sampleId !== meta.id);
    await this.refreshMySamples();
    this.applyInstrument();
    this.rebuild();
  }

  // ---------------------------------------------------------------- 画面

  private showTab(tab: Tab) {
    this.tab = tab;
    this.rebuild();
  }

  private setStatus(text: string) {
    this.statusLine.textContent = text;
    this.statusLine.classList.toggle('empty', text === '');
  }

  private rebuild() {
    // 付属音源は言語で名前が変わる。切り替えたときに見出しも追従させる
    if (this.factoryId) this.instrument.name = t(`inst.${this.factoryId}`);
    this.instrumentLabel.textContent = this.instrument.name;
    for (const btn of this.root.querySelectorAll('.tab-btn')) {
      btn.classList.toggle('active', btn instanceof HTMLElement && btn.dataset.tab === this.tab);
      if (btn instanceof HTMLElement && btn.dataset.tab) {
        btn.textContent = t(`tab.${btn.dataset.tab}`);
      }
    }
    const lang = this.root.querySelector('.lang-btn');
    if (lang instanceof HTMLElement) {
      lang.textContent = t('lang.toggle');
      lang.title = t('lang.toggle.hint');
    }

    this.refreshWaveStrip();

    this.panel.textContent = '';
    switch (this.tab) {
      case 'map':
        this.buildMapTab();
        break;
      case 'sound':
        this.buildSoundTab();
        break;
      case 'fx':
        this.buildFxTab();
        break;
      case 'rec':
        this.buildRecTab();
        break;
      case 'export':
        this.buildExportTab();
        break;
    }
    this.keyboard.paint();
  }

  // ------------------------------------------------------------- 音源タブ

  /** このアプリについて。タブのいちばん下に置く */
  private buildAboutSection(): HTMLElement {
    const about = section(t('privacy.title'));
    about.append(el('p', 'about-note', t('privacy.offline')));
    about.append(el('p', 'about-note', t('privacy.original')));
    about.append(
      button(t('privacy.clear'), 'ghost small', () => {
        void clearSamples().then(async () => {
          this.sampleData.clear();
          await this.refreshMySamples();
          this.setStatus(t('privacy.cleared'));
          this.rebuild();
        });
      })
    );
    return about;
  }

  /** 音源・収録デモ・自分の素材。割り当てタブの中に置く */
  private buildSoundSections() {
    const factory = section(t('browse.factory'), t('browse.factory.hint'));
    const list = el('div', 'sound-list');
    for (const id of FACTORY_IDS) {
      const row = el('button', 'sound-row');
      row.type = 'button';
      const texts = el('div', 'sound-texts');
      texts.append(el('span', 'sound-name', t(`inst.${id}`)));
      texts.append(el('span', 'sound-desc', t(`inst.${id}.desc`)));
      row.append(texts);
      if (this.factoryId === id) row.classList.add('active');
      row.disabled = this.busy;
      row.addEventListener('click', () => void this.loadFactory(id));
      list.append(row);
    }
    factory.append(list);

    const mine = section(t('browse.mine'), t('browse.mine.hint'));
    const actions = el('div', 'row-actions');
    actions.append(button(t('browse.import'), 'primary', () => this.importFile()));
    actions.append(
      button(this.micRecorder ? t('rec.stop') : t('browse.record'), this.micRecorder ? 'danger' : '', () =>
        void this.toggleMicRecording()
      )
    );
    mine.append(actions);

    if (this.mySamples.length === 0) {
      mine.append(el('p', 'empty-note', t('browse.empty')));
    } else {
      const myList = el('div', 'sound-list');
      for (const meta of this.mySamples) {
        const row = el('div', 'sound-row static');
        const texts = el('div', 'sound-texts');
        texts.append(el('span', 'sound-name', meta.name));
        texts.append(
          el(
            'span',
            'sound-desc',
            `${(meta.frames / meta.sampleRate).toFixed(2)} s · ${meta.channels === 2 ? 'stereo' : 'mono'}`
          )
        );
        row.append(texts);
        const rowActions = el('div', 'row-actions tight');
        rowActions.append(button(t('browse.makeInstrument'), 'small', () => void this.makeInstrumentFrom(meta)));
        rowActions.append(button(t('browse.delete'), 'small ghost', () => void this.removeSample(meta)));
        row.append(rowActions);
        myList.append(row);
      }
      mine.append(myList);
      void usedBytes().then((used) => {
        mine.append(
          el(
            'p',
            'panel-hint',
            t('browse.storage', { used: fmtMb(used), max: fmtMb(MAX_STORE_BYTES) })
          )
        );
      });
    }

    // 収録デモ
    const demos = section(t('demo.title'), t('demo.hint'));
    const demoList = el('div', 'sound-list');
    for (const demo of DEMO_SONGS) {
      const row = el('button', 'sound-row');
      row.type = 'button';
      const texts = el('div', 'sound-texts');
      texts.append(el('span', 'sound-name', t(`demo.${demo.id}.name`)));
      texts.append(
        el('span', 'sound-desc', `${t(`demo.${demo.id}.desc`)} · ${t(`inst.${demo.instrument}`)}`)
      );
      row.append(texts);
      if (this.loadedDemo === demo.id) row.classList.add('active');
      row.disabled = this.busy;
      row.addEventListener('click', () => void this.loadDemo(demo));
      demoList.append(row);
    }
    demos.append(demoList);

    this.panel.append(factory, demos, mine);
  }

  // ----------------------------------------------------------- 割り当てタブ

  /**
   * 素材の表示名。
   * 付属の打楽器だけは内部の id を名前にしているので、訳せるなら訳す
   * （t は訳が無いとキーをそのまま返すので、それで判別できる）
   */
  private sampleLabel(id: string): string {
    const meta = this.sampleMeta.get(id);
    if (!meta) return id;
    const key = `sample.${meta.name}`;
    const translated = t(key);
    return translated === key ? meta.name : translated;
  }

  private get zone(): Zone | null {
    return this.instrument.zones[this.selectedZone] ?? null;
  }

  private buildMapTab() {
    // 音源選びと割り当ては続けて行う作業なので、1つのタブにまとめている
    this.buildSoundSections();

    const head = section(t('map.title'), t('map.hint'));

    if (this.instrument.zones.length === 0) {
      head.append(el('p', 'empty-note', t('map.noZones')));
      this.panel.append(head, this.buildAboutSection());
      return;
    }

    // ゾーンの一覧。鍵盤の範囲が横棒で見えるようにする
    const strip = el('div', 'zone-strip');
    this.instrument.zones.forEach((zone, index) => {
      const item = el('button', 'zone-chip');
      item.type = 'button';
      if (index === this.selectedZone) item.classList.add('active');
      item.append(el('span', 'zone-chip-name', this.sampleLabel(zone.sampleId)));
      item.append(el('span', 'zone-chip-range', `${noteName(zone.loKey)}–${noteName(zone.hiKey)}`));
      item.addEventListener('click', () => {
        this.selectedZone = index;
        this.rebuild();
      });
      strip.append(item);
    });
    head.append(strip);

    const zoneActions = el('div', 'row-actions');
    zoneActions.append(button(t('map.addZone'), 'small', () => this.addZone()));
    zoneActions.append(button(t('map.removeZone'), 'small ghost', () => this.removeZone()));
    head.append(zoneActions);
    this.panel.append(head);

    const zone = this.zone;
    if (!zone) {
      this.panel.append(this.buildAboutSection());
      return;
    }

    // 鳴らし方（波形そのものは常設の帯にある）
    const playSection = section(t('wave.title'), t('wave.hint'));
    playSection.append(
      switchRow(t('map.loop'), zone.loop, (v) => {
        this.editZone((z) => (z.loop = v));
        this.rebuild();
      })
    );
    playSection.append(
      switchRow(t('map.reverse'), zone.reverse, (v) => {
        this.editZone((z) => (z.reverse = v));
        // 逆再生ぶんは作り直しになるので、波形を渡し直す
        this.pushBuffers();
      })
    );
    this.panel.append(playSection);

    // 素材の選択
    const sampleSection = section(t('map.sample'));
    const options = [...this.sampleMeta.values()].map((meta) => ({
      value: meta.id,
      label: this.sampleLabel(meta.id),
    }));
    if (options.length > 0) {
      sampleSection.append(
        segmented(null, options, zone.sampleId, (v) => {
          this.editZone((z) => (z.sampleId = v));
          this.rebuild();
        })
      );
    }
    this.panel.append(sampleSection);

    // 範囲
    const rangeSection = section(t('map.keyRange'));
    const rangeGrid = grid();
    rangeGrid.append(
      slider({
        label: `${t('map.keyRange')} ↓`,
        min: 0,
        max: 127,
        step: 1,
        value: zone.loKey,
        format: noteName,
        onInput: (v) =>
          this.editZone((z) => {
            z.loKey = Math.min(v, z.hiKey);
          }),
      }),
      slider({
        label: `${t('map.keyRange')} ↑`,
        min: 0,
        max: 127,
        step: 1,
        value: zone.hiKey,
        format: noteName,
        onInput: (v) =>
          this.editZone((z) => {
            z.hiKey = Math.max(v, z.loKey);
          }),
      }),
      slider({
        label: t('map.rootKey'),
        min: 0,
        max: 127,
        step: 1,
        value: zone.rootKey,
        format: noteName,
        hint: t('map.rootKey.hint'),
        onInput: (v) => this.editZone((z) => (z.rootKey = v)),
      }),
      slider({
        label: `${t('map.velRange')} ↓`,
        min: 1,
        max: 127,
        step: 1,
        value: zone.loVel,
        format: (v) => String(Math.round(v)),
        onInput: (v) =>
          this.editZone((z) => {
            z.loVel = Math.min(v, z.hiVel);
          }),
      }),
      slider({
        label: `${t('map.velRange')} ↑`,
        min: 1,
        max: 127,
        step: 1,
        value: zone.hiVel,
        format: (v) => String(Math.round(v)),
        onInput: (v) =>
          this.editZone((z) => {
            z.hiVel = Math.max(v, z.loVel);
          }),
      })
    );
    rangeSection.append(rangeGrid);
    this.panel.append(rangeSection);

    // 音程・音量・定位
    const tuneSection = section(t('map.tune'));
    const tuneGrid = grid();
    tuneGrid.append(
      slider({
        label: `${t('map.tune')} (semi)`,
        min: -24,
        max: 24,
        step: 1,
        value: zone.tuneSemis,
        format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
        onInput: (v) => this.editZone((z) => (z.tuneSemis = v)),
      }),
      slider({
        label: `${t('map.tune')} (cent)`,
        min: -100,
        max: 100,
        step: 1,
        value: zone.tuneCents,
        format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
        onInput: (v) => this.editZone((z) => (z.tuneCents = v)),
      }),
      slider({
        label: t('map.gain'),
        min: -36,
        max: 12,
        step: 0.5,
        value: zone.gainDb,
        format: fmtDb,
        onInput: (v) => this.editZone((z) => (z.gainDb = v)),
      }),
      slider({
        label: t('map.pan'),
        min: -1,
        max: 1,
        step: 0.05,
        value: zone.pan,
        format: (v) => (Math.abs(v) < 0.03 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
        onInput: (v) => this.editZone((z) => (z.pan = v)),
      }),
      stepper(
        t('map.group'),
        zone.group,
        0,
        7,
        1,
        (v) => this.editZone((z) => (z.group = v)),
        t('map.group.hint')
      )
    );
    tuneSection.append(tuneGrid);
    this.panel.append(tuneSection, this.buildAboutSection());
  }

  /** 常設の波形帯を、いま選んでいるゾーンの中身にそろえる */
  private refreshWaveStrip() {
    const zone = this.zone;
    const channels = zone ? this.sampleData.get(zone.sampleId) : undefined;
    if (!zone || !channels) {
      this.waveStrip.classList.add('empty');
      this.waveLabel.textContent = '';
      return;
    }
    this.waveStrip.classList.remove('empty');
    const seconds = (channels[0]?.length ?? 0) / SAMPLE_RATE;
    this.waveLabel.textContent =
      `${this.sampleLabel(zone.sampleId)} · ` +
      `${noteName(zone.loKey)}–${noteName(zone.hiKey)} · ` +
      `${(zone.start * seconds).toFixed(2)}–${(zone.end * seconds).toFixed(2)}s`;
    this.waveform.setSample(channels, this.waveValues(zone));
  }

  private waveValues(zone: Zone): WaveformValues {
    return {
      start: zone.start,
      end: zone.end,
      loop: zone.loop,
      loopStart: zone.loopStart,
      loopEnd: zone.loopEnd,
    };
  }

  private updateZone(values: WaveformValues) {
    this.editZone((z) => {
      z.start = values.start;
      z.end = values.end;
      z.loopStart = values.loopStart;
      z.loopEnd = values.loopEnd;
    });
    // 掴んで動かしている最中。波形は描き直さず、数字だけ追いかける
    const zone = this.zone;
    const channels = zone ? this.sampleData.get(zone.sampleId) : undefined;
    if (!zone || !channels) return;
    const seconds = (channels[0]?.length ?? 0) / SAMPLE_RATE;
    this.waveLabel.textContent =
      `${this.sampleLabel(zone.sampleId)} · ` +
      `${noteName(zone.loKey)}–${noteName(zone.hiKey)} · ` +
      `${(zone.start * seconds).toFixed(2)}–${(zone.end * seconds).toFixed(2)}s`;
  }

  private editZone(fn: (zone: Zone) => void) {
    const zone = this.zone;
    if (!zone) return;
    fn(zone);
    this.applyInstrument();
  }

  private addZone() {
    const source = this.zone;
    const sampleId = source?.sampleId ?? [...this.sampleData.keys()][0];
    if (!sampleId) return;
    const zone: Zone = source
      ? { ...source, id: `z${Date.now().toString(36)}` }
      : {
          id: `z${Date.now().toString(36)}`,
          sampleId,
          loKey: 0,
          hiKey: 127,
          loVel: 1,
          hiVel: 127,
          rootKey: 60,
          tuneSemis: 0,
          tuneCents: 0,
          gainDb: 0,
          pan: 0,
          start: 0,
          end: 1,
          loop: false,
          loopStart: 0.35,
          loopEnd: 0.95,
          group: 0,
          reverse: false,
        };
    this.instrument.zones.push(zone);
    this.selectedZone = this.instrument.zones.length - 1;
    this.applyInstrument();
    this.rebuild();
  }

  private removeZone() {
    if (this.instrument.zones.length === 0) return;
    this.instrument.zones.splice(this.selectedZone, 1);
    this.selectedZone = Math.max(0, Math.min(this.selectedZone, this.instrument.zones.length - 1));
    this.applyInstrument();
    this.rebuild();
  }

  // ----------------------------------------------------------- 音づくりタブ

  private buildSoundTab() {
    const inst = this.instrument;

    const amp = section(t('sound.amp'), t('sound.amp.hint'));
    const ampGrid = grid();
    ampGrid.append(
      slider({
        label: t('sound.attack'),
        min: 0,
        max: 3,
        step: 0.001,
        value: inst.amp.attack,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.amp.attack = v)),
      }),
      slider({
        label: t('sound.decay'),
        min: 0.005,
        max: 6,
        step: 0.005,
        value: inst.amp.decay,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.amp.decay = v)),
      }),
      slider({
        label: t('sound.sustain'),
        min: 0,
        max: 1,
        step: 0.01,
        value: inst.amp.sustain,
        format: fmtPct,
        onInput: (v) => this.edit((i) => (i.amp.sustain = v)),
      }),
      slider({
        label: t('sound.release'),
        min: 0.005,
        max: 8,
        step: 0.005,
        value: inst.amp.release,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.amp.release = v)),
      })
    );
    amp.append(ampGrid);

    const filter = section(t('sound.filter'));
    filter.append(
      segmented<FilterMode>(
        t('sound.filter.mode'),
        [
          { value: 'off', label: t('mode.off') },
          { value: 'lowpass', label: t('mode.lowpass') },
          { value: 'highpass', label: t('mode.highpass') },
          { value: 'bandpass', label: t('mode.bandpass') },
        ],
        inst.filter.mode,
        (v) => this.edit((i) => (i.filter.mode = v))
      )
    );
    const filterGrid = grid();
    filterGrid.append(
      slider({
        label: t('sound.filter.freq'),
        min: 40,
        max: 18000,
        step: 10,
        value: inst.filter.freq,
        format: fmtHz,
        onInput: (v) => this.edit((i) => (i.filter.freq = v)),
      }),
      slider({
        label: t('sound.filter.q'),
        min: 0.1,
        max: 16,
        step: 0.1,
        value: inst.filter.q,
        format: (v) => v.toFixed(1),
        onInput: (v) => this.edit((i) => (i.filter.q = v)),
      }),
      slider({
        label: t('sound.filter.keyTrack'),
        min: 0,
        max: 1.5,
        step: 0.05,
        value: inst.filter.keyTrack,
        format: fmtPct,
        hint: t('sound.filter.keyTrack.hint'),
        onInput: (v) => this.edit((i) => (i.filter.keyTrack = v)),
      }),
      slider({
        label: t('sound.filter.envAmount'),
        min: -4,
        max: 4,
        step: 0.1,
        value: inst.filter.envAmount,
        format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`,
        onInput: (v) => this.edit((i) => (i.filter.envAmount = v)),
      }),
      slider({
        label: `${t('sound.filter.env')} · ${t('sound.attack')}`,
        min: 0.001,
        max: 3,
        step: 0.001,
        value: inst.filter.env.attack,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.filter.env.attack = v)),
      }),
      slider({
        label: `${t('sound.filter.env')} · ${t('sound.decay')}`,
        min: 0.005,
        max: 6,
        step: 0.005,
        value: inst.filter.env.decay,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.filter.env.decay = v)),
      })
    );
    filter.append(filterGrid);

    const lfo = section(t('sound.lfo'));
    const lfoGrid = grid();
    lfoGrid.append(
      slider({
        label: t('sound.lfo.rate'),
        min: 0.05,
        max: 20,
        step: 0.05,
        value: inst.lfo.rate,
        format: (v) => `${v.toFixed(2)} Hz`,
        onInput: (v) => this.edit((i) => (i.lfo.rate = v)),
      }),
      slider({
        label: t('sound.lfo.toPitch'),
        min: 0,
        max: 200,
        step: 1,
        value: inst.lfo.toPitch,
        format: (v) => `${Math.round(v)} cent`,
        onInput: (v) => this.edit((i) => (i.lfo.toPitch = v)),
      }),
      slider({
        label: t('sound.lfo.toFilter'),
        min: 0,
        max: 3,
        step: 0.05,
        value: inst.lfo.toFilter,
        format: (v) => `${v.toFixed(2)} oct`,
        onInput: (v) => this.edit((i) => (i.lfo.toFilter = v)),
      }),
      slider({
        label: t('sound.lfo.toAmp'),
        min: 0,
        max: 1,
        step: 0.01,
        value: inst.lfo.toAmp,
        format: fmtPct,
        onInput: (v) => this.edit((i) => (i.lfo.toAmp = v)),
      }),
      slider({
        label: t('sound.lfo.delay'),
        min: 0,
        max: 3,
        step: 0.05,
        value: inst.lfo.delay,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.lfo.delay = v)),
      })
    );
    lfo.append(lfoGrid);

    const play = section(t('sound.play'));
    play.append(
      switchRow(t('sound.mono'), inst.mono, (v) => this.edit((i) => (i.mono = v)), t('sound.mono.hint'))
    );
    const playGrid = grid();
    playGrid.append(
      stepper(t('sound.poly'), inst.polyphony, 1, 64, 1, (v) => this.edit((i) => (i.polyphony = v))),
      slider({
        label: t('sound.glide'),
        min: 0,
        max: 1,
        step: 0.01,
        value: inst.glide,
        format: fmtSeconds,
        onInput: (v) => this.edit((i) => (i.glide = v)),
      }),
      stepper(t('sound.transpose'), inst.transpose, -24, 24, 1, (v) => this.edit((i) => (i.transpose = v))),
      slider({
        label: t('sound.velToVolume'),
        min: 0,
        max: 1,
        step: 0.01,
        value: inst.velToVolume,
        format: fmtPct,
        onInput: (v) => this.edit((i) => (i.velToVolume = v)),
      }),
      slider({
        label: t('sound.velToFilter'),
        min: 0,
        max: 4,
        step: 0.05,
        value: inst.velToFilter,
        format: (v) => `${v.toFixed(2)} oct`,
        onInput: (v) => this.edit((i) => (i.velToFilter = v)),
      }),
      slider({
        label: t('sound.gain'),
        min: -24,
        max: 12,
        step: 0.5,
        value: inst.gainDb,
        format: fmtDb,
        onInput: (v) => this.edit((i) => (i.gainDb = v)),
      }),
      slider({
        label: t('header.volume'),
        min: 0,
        max: 1,
        step: 0.01,
        value: this.masterVolume,
        format: fmtPct,
        onInput: (v) => {
          this.masterVolume = v;
          if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
          }
          this.persist();
        },
      })
    );
    play.append(playGrid);

    this.panel.append(amp, filter, lfo, play);
  }

  private edit(fn: (inst: Instrument) => void) {
    fn(this.instrument);
    this.applyInstrument();
  }

  // ------------------------------------------------------------ エフェクト

  private buildFxTab() {
    const fx = this.instrument.fx;
    const editFx = (fn: (f: Instrument['fx']) => void) => this.edit((i) => fn(i.fx));

    const dist = section(t('fx.dist'));
    dist.append(
      segmented<DistortionType>(
        t('fx.dist.type'),
        [
          { value: 'off', label: t('mode.off') },
          { value: 'soft', label: t('mode.soft') },
          { value: 'hard', label: t('mode.hard') },
          { value: 'fuzz', label: t('mode.fuzz') },
        ],
        fx.distType,
        (v) => editFx((f) => (f.distType = v))
      )
    );
    const distGrid = grid();
    distGrid.append(
      slider({
        label: t('fx.dist.amount'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.distAmount,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.distAmount = v)),
      }),
      slider({
        label: t('fx.dist.tone'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.distTone,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.distTone = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.distMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.distMix = v)),
      })
    );
    dist.append(distGrid);

    const crush = section(t('fx.crush'));
    const crushGrid = grid();
    crushGrid.append(
      slider({
        label: t('fx.crush.bits'),
        min: 1,
        max: 16,
        step: 1,
        value: fx.crushBits,
        format: (v) => `${Math.round(v)} bit`,
        onInput: (v) => editFx((f) => (f.crushBits = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.crushMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.crushMix = v)),
      })
    );
    crush.append(crushGrid);

    const sweep = section(t('fx.filter'));
    sweep.append(
      segmented<FilterMode>(
        t('sound.filter.mode'),
        [
          { value: 'off', label: t('mode.off') },
          { value: 'lowpass', label: t('mode.lowpass') },
          { value: 'highpass', label: t('mode.highpass') },
          { value: 'bandpass', label: t('mode.bandpass') },
        ],
        fx.filterMode,
        (v) => editFx((f) => (f.filterMode = v))
      )
    );
    const sweepGrid = grid();
    sweepGrid.append(
      slider({
        label: t('sound.filter.freq'),
        min: 40,
        max: 12000,
        step: 10,
        value: fx.filterFreq,
        format: fmtHz,
        onInput: (v) => editFx((f) => (f.filterFreq = v)),
      }),
      slider({
        label: t('sound.filter.q'),
        min: 0.2,
        max: 18,
        step: 0.1,
        value: fx.filterQ,
        format: (v) => v.toFixed(1),
        onInput: (v) => editFx((f) => (f.filterQ = v)),
      }),
      slider({
        label: t('fx.filter.rate'),
        min: 0.02,
        max: 12,
        step: 0.02,
        value: fx.filterRate,
        format: (v) => `${v.toFixed(2)} Hz`,
        onInput: (v) => editFx((f) => (f.filterRate = v)),
      }),
      slider({
        label: t('fx.filter.depth'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.filterDepth,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.filterDepth = v)),
      })
    );
    sweep.append(sweepGrid);

    const chorus = section(t('fx.chorus'));
    chorus.append(switchRow(t('fx.on'), fx.chorusOn, (v) => editFx((f) => (f.chorusOn = v))));
    const chorusGrid = grid();
    chorusGrid.append(
      slider({
        label: t('fx.rate'),
        min: 0.05,
        max: 6,
        step: 0.05,
        value: fx.chorusRate,
        format: (v) => `${v.toFixed(2)} Hz`,
        onInput: (v) => editFx((f) => (f.chorusRate = v)),
      }),
      slider({
        label: t('fx.depth'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.chorusDepth,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.chorusDepth = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.chorusMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.chorusMix = v)),
      })
    );
    chorus.append(chorusGrid);

    const flanger = section(t('fx.flanger'));
    flanger.append(switchRow(t('fx.on'), fx.flangerOn, (v) => editFx((f) => (f.flangerOn = v))));
    const flangerGrid = grid();
    flangerGrid.append(
      slider({
        label: t('fx.rate'),
        min: 0.02,
        max: 5,
        step: 0.02,
        value: fx.flangerRate,
        format: (v) => `${v.toFixed(2)} Hz`,
        onInput: (v) => editFx((f) => (f.flangerRate = v)),
      }),
      slider({
        label: t('fx.depth'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.flangerDepth,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.flangerDepth = v)),
      }),
      slider({
        label: t('fx.feedback'),
        min: 0,
        max: 0.9,
        step: 0.01,
        value: fx.flangerFeedback,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.flangerFeedback = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.flangerMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.flangerMix = v)),
      })
    );
    flanger.append(flangerGrid);

    const phaser = section(t('fx.phaser'));
    phaser.append(switchRow(t('fx.on'), fx.phaserOn, (v) => editFx((f) => (f.phaserOn = v))));
    const phaserGrid = grid();
    phaserGrid.append(
      slider({
        label: t('fx.rate'),
        min: 0.02,
        max: 5,
        step: 0.02,
        value: fx.phaserRate,
        format: (v) => `${v.toFixed(2)} Hz`,
        onInput: (v) => editFx((f) => (f.phaserRate = v)),
      }),
      slider({
        label: t('fx.depth'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.phaserDepth,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.phaserDepth = v)),
      }),
      slider({
        label: t('fx.feedback'),
        min: 0,
        max: 0.9,
        step: 0.01,
        value: fx.phaserFeedback,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.phaserFeedback = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.phaserMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.phaserMix = v)),
      })
    );
    phaser.append(phaserGrid);

    const ring = section(t('fx.ring'));
    ring.append(switchRow(t('fx.on'), fx.ringOn, (v) => editFx((f) => (f.ringOn = v))));
    const ringGrid = grid();
    ringGrid.append(
      slider({
        label: t('fx.freq'),
        min: 5,
        max: 3000,
        step: 1,
        value: fx.ringFreq,
        format: fmtHz,
        onInput: (v) => editFx((f) => (f.ringFreq = v)),
      }),
      slider({
        label: t('fx.mix'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.ringMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.ringMix = v)),
      })
    );
    ring.append(ringGrid);

    const mod = section(t('fx.mod'));
    mod.append(
      segmented<ModMode>(
        null,
        [
          { value: 'off', label: t('mode.off') },
          { value: 'tremolo', label: t('mode.tremolo') },
          { value: 'autopan', label: t('mode.autopan') },
        ],
        fx.modMode,
        (v) => editFx((f) => (f.modMode = v))
      )
    );
    const modGrid = grid();
    modGrid.append(
      slider({
        label: t('fx.rate'),
        min: 0.1,
        max: 20,
        step: 0.1,
        value: fx.modRate,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => editFx((f) => (f.modRate = v)),
      }),
      slider({
        label: t('fx.depth'),
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.modDepth,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.modDepth = v)),
      })
    );
    mod.append(modGrid);

    const space = section(t('fx.space'));
    const spaceGrid = grid();
    spaceGrid.append(
      slider({
        label: t('fx.width'),
        min: 0,
        max: 2,
        step: 0.05,
        value: fx.width,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.width = v)),
      }),
      slider({
        label: t('fx.delay.time'),
        min: 0.02,
        max: 1.2,
        step: 0.01,
        value: fx.delayTime,
        format: fmtSeconds,
        onInput: (v) => editFx((f) => (f.delayTime = v)),
      }),
      slider({
        label: t('fx.delay.feedback'),
        min: 0,
        max: 0.85,
        step: 0.01,
        value: fx.delayFeedback,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.delayFeedback = v)),
      }),
      slider({
        label: `${t('fx.delay')} ${t('fx.mix')}`,
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.delayMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.delayMix = v)),
      }),
      slider({
        label: `${t('fx.reverb')} ${t('fx.mix')}`,
        min: 0,
        max: 1,
        step: 0.01,
        value: fx.reverbMix,
        format: fmtPct,
        onInput: (v) => editFx((f) => (f.reverbMix = v)),
      })
    );
    space.append(spaceGrid);
    space.append(switchRow(t('fx.delay.pingPong'), fx.delayPingPong, (v) => editFx((f) => (f.delayPingPong = v))));
    space.append(
      segmented<ReverbType>(
        t('fx.reverb.type'),
        [
          { value: 'off', label: t('mode.off') },
          { value: 'room', label: t('room.room') },
          { value: 'plate', label: t('room.plate') },
          { value: 'hall', label: t('room.hall') },
          { value: 'cavern', label: t('room.cavern') },
        ],
        fx.reverbType,
        (v) => editFx((f) => (f.reverbType = v))
      )
    );

    this.panel.append(dist, crush, sweep, chorus, flanger, phaser, ring, mod, space);
  }

  // ------------------------------------------------------------- 録音タブ

  private buildRecTab() {
    const rec = section(t('tab.rec'), t('rec.hint'));
    const actions = el('div', 'row-actions');
    actions.append(
      button(this.recorder.recording ? t('rec.stop') : t('rec.start'), this.recorder.recording ? 'danger' : 'primary', () =>
        void this.toggleRecording()
      )
    );
    actions.append(button(t('rec.play'), '', () => void this.playRecording()));
    actions.append(
      button(t('rec.clear'), 'ghost', () => {
        this.recorder.clear();
        this.rebuild();
      })
    );
    rec.append(actions);
    rec.append(
      el(
        'p',
        'panel-hint',
        this.recorder.isEmpty ? t('rec.empty') : t('rec.notes', { count: this.recorder.events.length })
      )
    );
    this.panel.append(rec);
  }

  private async toggleRecording() {
    const ctx = await this.ensureAudio();
    if (this.recorder.recording) {
      this.recorder.stop(ctx.currentTime);
      this.setStatus(t('rec.notes', { count: this.recorder.events.length }));
    } else {
      this.recorder.start(ctx.currentTime);
    }
    this.rebuild();
  }

  /** 記録した演奏をそのまま鳴らす。鍵盤も光らせる */
  private async playRecording() {
    if (this.recorder.isEmpty) return;
    const ctx = await this.ensureAudio();
    if (this.playbackTimer !== null) {
      window.clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    const at = ctx.currentTime + 0.1;
    for (const ev of this.recorder.events) {
      this.engine?.noteOn(ev.note, ev.velocity, at + ev.time);
      this.engine?.noteOff(ev.note, at + ev.time + (ev.duration ?? 0.5));
      // 画面のほうは実時間で追いかける
      window.setTimeout(() => this.keyboard.flash(ev.note, true), ev.time * 1000 + 100);
      window.setTimeout(() => this.keyboard.flash(ev.note, false), (ev.time + (ev.duration ?? 0.5)) * 1000 + 100);
    }
    this.playbackTimer = window.setTimeout(
      () => this.keyboard.releaseAll(),
      this.recorder.duration(0.5) * 1000 + 200
    );
  }

  // ----------------------------------------------------------- 書き出しタブ

  private buildExportTab() {
    const out = section(t('tab.export'), t('export.hint'));
    const actions = el('div', 'row-actions');
    actions.append(button(t('export.wav'), 'primary', () => void this.exportWav()));
    actions.append(button(t('export.midi'), '', () => void this.exportMidi()));
    out.append(actions);

    const project = section(t('export.save'));
    project.append(
      switchRow(
        t('export.withSamples'),
        this.includeSamples,
        (v) => (this.includeSamples = v),
        t('export.withSamples.hint')
      )
    );
    const projectActions = el('div', 'row-actions');
    projectActions.append(button(t('export.save'), '', () => void this.saveInstrument()));
    projectActions.append(button(t('export.load'), '', () => this.loadInstrument()));
    project.append(projectActions);

    this.panel.append(out, project);
  }

  private async saveFile(blob: Blob, filename: string, done: string) {
    const outcome = await downloadBlob(blob, filename);
    this.setStatus(outcome.kind === 'file' ? `${done} → ${outcome.path}` : done);
  }

  private async exportWav() {
    if (this.exporting) return;
    if (this.recorder.isEmpty) {
      this.setStatus(t('export.nothing'));
      return;
    }
    this.exporting = true;
    this.setStatus(t('export.rendering'));
    try {
      const buffer = await renderPerformance(
        this.recorder.events,
        this.instrument,
        this.sampleData,
        SAMPLE_RATE,
        this.recorder.duration()
      );
      const wav = encodeWav(buffer);
      await this.saveFile(
        wav,
        timestampName(safeName(this.instrument.name), 'wav'),
        t('export.wavDone', { size: (wav.size / 1048576).toFixed(1) })
      );
    } catch (err) {
      console.error(err);
      this.setStatus(t('export.failed'));
    } finally {
      this.exporting = false;
    }
  }

  private async exportMidi() {
    if (this.recorder.isEmpty) {
      this.setStatus(t('export.nothing'));
      return;
    }
    try {
      await this.saveFile(
        encodeMidi(this.recorder.events),
        timestampName(safeName(this.instrument.name), 'mid'),
        t('export.midiDone')
      );
    } catch (err) {
      console.error(err);
      this.setStatus(t('export.failed'));
    }
  }

  /** 楽器を1つのファイルにまとめる。取り込んだ素材だけを同梱する */
  private async saveInstrument() {
    try {
      const samples: { id: string; name: string; sampleRate: number; channels: number; data: string }[] = [];
      if (this.includeSamples) {
        for (const zone of this.instrument.zones) {
          const meta = this.sampleMeta.get(zone.sampleId);
          // 付属音源は合成し直せるので入れない。ファイルが無駄に太る
          if (!meta || meta.origin === 'factory') continue;
          if (samples.some((s) => s.id === meta.id)) continue;
          const channels = this.sampleData.get(meta.id);
          if (!channels) continue;
          samples.push({
            id: meta.id,
            name: meta.name,
            sampleRate: meta.sampleRate,
            channels: channels.length,
            data: encodeChannels(channels),
          });
        }
      }
      const file = {
        app: PROJECT_APP,
        version: PROJECT_VERSION,
        instrument: encodeInstrument(this.instrument),
        samples,
      };
      await this.saveFile(
        new Blob([JSON.stringify(file)], { type: 'application/json' }),
        `${safeName(this.instrument.name)}.yamabiko.json`,
        t('export.saved')
      );
    } catch (err) {
      console.error(err);
      this.setStatus(t('export.failed'));
    }
  }

  private loadInstrument() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      // 楽器ファイルは小さいはず。大きいものは読まずに断る
      if (file.size > 128 * 1024 * 1024) {
        this.setStatus(t('export.loadFailed'));
        return;
      }
      try {
        const parsed = decodeProjectFile(JSON.parse(await file.text()));
        if (!parsed) {
          this.setStatus(t('export.loadFailed'));
          return;
        }
        for (const s of parsed.samples) {
          const channels = decodeChannels(s.data, s.channels);
          if (!channels) continue;
          this.sampleData.set(s.id, channels);
          const meta: SampleMeta = {
            id: s.id,
            name: s.name,
            sampleRate: s.sampleRate,
            frames: channels[0]?.length ?? 0,
            channels: channels.length,
            origin: 'import',
          };
          this.sampleMeta.set(s.id, meta);
          await putSample(meta, channels).catch(() => {});
        }
        this.instrument = parsed.instrument;
        this.factoryId = null;
        this.loadedDemo = null;
        this.selectedZone = 0;
        await this.refreshMySamples();
        await this.reloadSamplesForInstrument();
        this.setStatus(t('export.loaded'));
        this.showTab('map');
      } catch {
        this.setStatus(t('export.loadFailed'));
      }
    });
    input.click();
  }

  /** 後片付け（テストや、埋め込みで使うとき用） */
  dispose() {
    if (this.meterTimer !== null) window.clearInterval(this.meterTimer);
    if (this.playbackTimer !== null) window.clearTimeout(this.playbackTimer);
    this.micRecorder?.stop();
    this.engine?.allNotesOff();
    void this.ctx?.close();
  }
}

/** 波形を 16bit にして base64 にする。ファイルの大きさが Float32 の半分で済む */
function encodeChannels(channels: Float32Array[]): string {
  const frames = channels[0]?.length ?? 0;
  const out = new Int16Array(frames * channels.length);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < frames; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      out[c * frames + i] = Math.round(v * 32767);
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/** 読み込み側。壊れていたら null を返す（例外にしない） */
function decodeChannels(data: string, channelCount: number): Float32Array[] | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // 16bit なので偶数バイトでなければおかしい
    if (bytes.length % 2 !== 0) return null;
    const samples = new Int16Array(bytes.buffer, 0, bytes.length / 2);
    const count = Math.max(1, Math.min(2, channelCount));
    const frames = Math.floor(samples.length / count);
    if (frames === 0) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < count; c++) {
      const ch = new Float32Array(frames);
      for (let i = 0; i < frames; i++) ch[i] = samples[c * frames + i] / 32767;
      channels.push(ch);
    }
    return channels;
  } catch {
    return null;
  }
}
