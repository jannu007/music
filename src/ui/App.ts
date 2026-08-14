/**
 * Akatsuki Synth — アプリケーション本体（画面構成とすべての配線）
 */
import { AudioEngine, defaultMasterSettings, loadWorklets } from '../audio/AudioEngine';
import { Arpeggiator } from '../audio/Arpeggiator';
import { ComputerKeyboard, MidiInput } from '../audio/MidiInput';
import { exportMidi } from '../audio/midifile';
import { PRESETS, clonePatch } from '../audio/presets';
import { renderSong } from '../audio/render';
import { Sequencer, STEPS_PER_BAR, type Track } from '../audio/Sequencer';
import type { ArpParams, Patch } from '../audio/types';
import { audioBufferToWav, encodeWav } from '../audio/wav';
import { buildMasterPanel } from './MasterPanel';
import { buildMixer, type MixerHandle } from './Mixer';
import { buildPatchBrowser } from './PatchBrowser';
import { createPianoRoll, type PianoRollHandle } from './PianoRoll';
import { buildSongView, type SongViewHandle } from './SongView';
import { buildSynthPanel } from './SynthPanel';
import { buildVirtualKeyboard, type KeyboardHandle } from './Keyboard';
import { createAnalyzerBar, type AnalyzerBarHandle } from './Visualizers';
import { createButton, createKnob, openModal, toast, type KnobHandle } from './widgets';
import { demoSong } from './demoSong';

const AUTOSAVE_KEY = 'mss.autosave.v2';

type CenterTab = 'synth' | 'master' | 'song';

export class App {
  private root: HTMLElement;
  private ctx!: AudioContext;
  engine!: AudioEngine;
  sequencer!: Sequencer;
  private selectedTrackId = '';
  private arpParams: ArpParams = { enabled: false, mode: 'up', octaves: 1, rate: 4, gate: 0.7, swing: 0, latch: false };
  private arp!: Arpeggiator;
  private midi!: MidiInput;
  private computerKeys!: ComputerKeyboard;

  private mixer: MixerHandle | null = null;
  private roll: PianoRollHandle | null = null;
  private songView: SongViewHandle | null = null;
  private keyboard: KeyboardHandle | null = null;
  private analyzerBar: AnalyzerBarHandle | null = null;
  private bpmKnob: KnobHandle | null = null;

  private tab: CenterTab = 'synth';
  private tapTimes: number[] = [];
  private autosaveTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.showSplash();
  }

  // ------------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------------
  private showSplash() {
    this.root.innerHTML = '';
    const splash = document.createElement('div');
    splash.className = 'splash';
    splash.innerHTML = `
      <div class="splash-inner">
        <div class="splash-logo">AKATSUKI SYNTH</div>
        <p class="splash-sub">バーチャルアナログ・シンセサイザー / DTM ワークステーション</p>
        <ul class="splash-features">
          <li>アンチエイリアス処理済みオシレーター＆ラダーフィルターによる本格アナログサウンド</li>
          <li>マルチトラック・シーケンサー／ソング構成／WAV・MIDI 書き出し</li>
          <li>スペクトラム＋波形を常時表示するアナライザーとステレオ・ピークメーター</li>
          <li>完全無料・オフライン動作・広告なし</li>
        </ul>
      </div>`;
    const startBtn = createButton('▶ スタジオを起動', () => void this.boot(), 'btn-start');
    (splash.querySelector('.splash-inner') as HTMLElement).appendChild(startBtn);
    const note = document.createElement('p');
    note.className = 'splash-note';
    note.textContent = 'ブラウザの自動再生制限のため、最初に一度クリック（タップ）が必要です。';
    (splash.querySelector('.splash-inner') as HTMLElement).appendChild(note);
    this.root.appendChild(splash);
    startBtn.focus();
  }

  private async boot() {
    const splash = this.root.querySelector('.splash') as HTMLElement | null;
    if (splash) splash.classList.add('loading');

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      await loadWorklets(this.ctx);
    } catch (err) {
      this.root.innerHTML = `<div class="splash"><div class="splash-inner"><p>お使いのブラウザは AudioWorklet に対応していないため起動できません。<br>最新の Chrome / Edge / Firefox / Safari をお使いください。</p><pre>${String(err)}</pre></div></div>`;
      return;
    }
    await this.ctx.resume();

    this.engine = new AudioEngine(this.ctx, defaultMasterSettings());
    this.engine.rebuildReverb();
    this.sequencer = new Sequencer(this.engine);

    const saved = localStorage.getItem(AUTOSAVE_KEY);
    let loaded = false;
    if (saved) {
      try {
        this.sequencer.loadJSON(JSON.parse(saved));
        loaded = this.sequencer.tracks.length > 0;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) this.sequencer.loadJSON(demoSong());

    this.selectedTrackId = this.sequencer.tracks[0]?.id ?? '';
    this.setupInput();

    this.sequencer.onStep = (tick) => {
      this.roll?.setPlayhead(tick);
      this.updatePosition(tick);
    };
    this.sequencer.onSceneChange = (i) => this.songView?.setActiveScene(i);

    this.buildLayout();
    this.startAnimationLoop();
    window.addEventListener('beforeunload', () => this.autosave());
  }

  // ------------------------------------------------------------------
  // 入力
  // ------------------------------------------------------------------
  private setupInput() {
    this.arp = new Arpeggiator(this.arpTarget(), () => this.sequencer.bpm, this.arpParams);

    this.midi = new MidiInput({
      onNoteOn: (n, v) => this.noteOn(n, v),
      onNoteOff: (n) => this.noteOff(n),
      onPitchBend: (v) => this.selectedTrack?.setBend(v),
      onModWheel: (v) => this.selectedTrack?.setMod(v),
      onSustain: (on) => this.selectedTrack?.setSustain(on),
    });
    void this.midi.init();
    this.midi.onDevicesChanged = () => this.updateMidiStatus();

    this.computerKeys = new ComputerKeyboard({
      onNoteOn: (n, v) => this.noteOn(n, v),
      onNoteOff: (n) => this.noteOff(n),
    });
    this.computerKeys.onNoteVisual = (note, on) => this.keyboard?.highlight(note, on);
    this.computerKeys.onOctaveChange = () => this.updateStatus();

    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveSongFile();
      }
    });
  }

  private arpTarget() {
    return {
      now: () => this.ctx.currentTime,
      noteOn: (note: number, vel: number, time: number) => this.selectedTrack?.noteOn(note, vel, time),
      noteOff: (note: number, time: number) => this.selectedTrack?.noteOff(note, time),
      allNotesOff: () => this.selectedTrack?.allNotesOff(),
    };
  }

  private get selectedTrack(): Track | null {
    return this.sequencer.tracks.find((t) => t.id === this.selectedTrackId) ?? this.sequencer.tracks[0] ?? null;
  }

  private noteOn(note: number, velocity: number) {
    this.engine.resume();
    if (this.arpParams.enabled) this.arp.noteOn(note, velocity);
    else this.selectedTrack?.noteOn(note, velocity, this.ctx.currentTime);
  }

  private noteOff(note: number) {
    if (this.arpParams.enabled) this.arp.noteOff(note);
    else this.selectedTrack?.noteOff(note, this.ctx.currentTime);
  }

  // ------------------------------------------------------------------
  // レイアウト
  // ------------------------------------------------------------------
  private buildLayout() {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'shell';

    // マスター出力のアナライザーは画面最上部に常時表示する
    this.analyzerBar?.stop();
    this.analyzerBar = createAnalyzerBar(this.engine);
    shell.appendChild(this.analyzerBar.element);

    shell.appendChild(this.buildHeader());

    const main = document.createElement('div');
    main.className = 'main';

    const left = document.createElement('aside');
    left.className = 'panel panel-mixer';
    left.id = 'mixer';
    main.appendChild(left);

    const center = document.createElement('section');
    center.className = 'panel panel-center';

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const tabDefs: { id: CenterTab; label: string }[] = [
      { id: 'synth', label: 'シンセ' },
      { id: 'master', label: 'マスターFX' },
      { id: 'song', label: 'ソング構成' },
    ];
    for (const t of tabDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (this.tab === t.id ? ' on' : '');
      b.textContent = t.label;
      b.dataset.tab = t.id;
      b.addEventListener('click', () => this.setTab(t.id));
      tabs.appendChild(b);
    }
    center.appendChild(tabs);

    const lcd = document.createElement('div');
    lcd.className = 'lcd';
    lcd.id = 'lcd';
    center.appendChild(lcd);

    const tabBody = document.createElement('div');
    tabBody.className = 'tab-body';
    tabBody.id = 'tab-body';
    center.appendChild(tabBody);

    const browser = document.createElement('div');
    browser.className = 'browser';
    browser.id = 'browser';
    center.appendChild(browser);

    main.appendChild(center);
    shell.appendChild(main);

    const bottom = document.createElement('div');
    bottom.className = 'bottom';
    const rollWrap = document.createElement('div');
    rollWrap.className = 'roll-wrap';
    rollWrap.id = 'roll';
    const kbWrap = document.createElement('div');
    kbWrap.id = 'keyboard';
    bottom.append(rollWrap, kbWrap);
    shell.appendChild(bottom);

    const status = document.createElement('div');
    status.className = 'status';
    status.id = 'status';
    shell.appendChild(status);

    this.root.appendChild(shell);

    this.renderMixer();
    this.renderTab();
    this.renderBrowser();
    this.renderRoll();
    this.renderKeyboard();
    this.updateStatus();
    this.updateLcd();
  }

  private buildHeader(): HTMLElement {
    const bar = document.createElement('header');
    bar.className = 'header';

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = '<span class="brand-mark"></span><span class="brand-name">AKATSUKI<br><small>SYNTH</small></span>';
    bar.appendChild(brand);

    // --- トランスポート ---
    const transport = document.createElement('div');
    transport.className = 'transport';

    const playBtn = createButton('▶', () => this.togglePlay(), 'btn-transport btn-play');
    playBtn.id = 'play-btn';
    playBtn.title = '再生 / 停止（スペースキー）';
    transport.appendChild(playBtn);

    const stopBtn = createButton('■', () => this.stopAll(), 'btn-transport');
    stopBtn.title = '停止＆全音消音';
    transport.appendChild(stopBtn);

    const recBtn = createButton('●', () => this.toggleRecord(), 'btn-transport btn-rec');
    recBtn.id = 'rec-btn';
    recBtn.title = 'リアルタイム録音（WAV）';
    transport.appendChild(recBtn);

    const position = document.createElement('div');
    position.className = 'position';
    position.id = 'position';
    position.textContent = '001 : 1';
    transport.appendChild(position);

    const modeWrap = document.createElement('div');
    modeWrap.className = 'seg';
    for (const [value, label] of [['pattern', 'パターン'], ['song', 'ソング']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (this.sequencer.mode === value ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.sequencer.mode = value;
        modeWrap.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.autosaveSoon();
      });
      modeWrap.appendChild(b);
    }
    transport.appendChild(modeWrap);

    bar.appendChild(transport);

    // --- テンポ関連 ---
    const tempo = document.createElement('div');
    tempo.className = 'tempo';
    this.bpmKnob = createKnob({
      label: 'BPM',
      min: 40,
      max: 240,
      step: 1,
      value: this.sequencer.bpm,
      format: (v) => v.toFixed(0),
      onChange: (v) => {
        this.sequencer.setBpm(Math.round(v));
        this.autosaveSoon();
      },
    });
    tempo.appendChild(this.bpmKnob);
    tempo.appendChild(
      createKnob({
        label: 'Swing',
        min: 0,
        max: 1,
        value: this.sequencer.swing,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => {
          this.sequencer.swing = v;
          this.autosaveSoon();
        },
      })
    );
    const tap = createButton('TAP', () => this.tapTempo(), 'btn-sm');
    tap.title = 'タップテンポ';
    tempo.appendChild(tap);
    const metro = createButton('🔔', () => {
      this.sequencer.metronome = !this.sequencer.metronome;
      metro.classList.toggle('on', this.sequencer.metronome);
    }, 'btn-sm btn-icon');
    metro.title = 'メトロノーム';
    tempo.appendChild(metro);
    bar.appendChild(tempo);

    // --- マスター ---
    const master = document.createElement('div');
    master.className = 'master-strip';
    master.appendChild(
      createKnob({
        label: 'Master',
        min: 0,
        max: 1.2,
        value: this.engine.settings.volume,
        format: (v) => `${Math.round(v * 100)}`,
        onChange: (v) => {
          this.engine.settings.volume = v;
          this.engine.applySettings(this.engine.settings);
        },
      })
    );
    bar.appendChild(master);

    // --- ファイル操作 ---
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(createButton('WAV書出', () => void this.exportWav(), 'btn-sm btn-accent'));
    actions.appendChild(createButton('MIDI書出', () => this.exportMidiFile(), 'btn-sm'));
    actions.appendChild(createButton('保存', () => this.saveSongFile(), 'btn-sm'));

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = 'application/json,.mss.json';
    loadInput.style.display = 'none';
    loadInput.addEventListener('change', () => this.loadSongFile(loadInput));
    actions.appendChild(createButton('読込', () => loadInput.click(), 'btn-sm'));
    actions.appendChild(loadInput);
    actions.appendChild(createButton('？', () => this.showHelp(), 'btn-sm btn-icon'));
    bar.appendChild(actions);

    return bar;
  }

  private setTab(tab: CenterTab) {
    this.tab = tab;
    this.root.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('on', (el as HTMLElement).dataset.tab === tab);
    });
    this.renderTab();
  }

  private renderTab() {
    const body = document.getElementById('tab-body');
    const browser = document.getElementById('browser');
    if (!body) return;
    body.innerHTML = '';
    if (browser) browser.style.display = this.tab === 'synth' ? '' : 'none';

    if (this.tab === 'synth') {
      const track = this.selectedTrack;
      if (!track) return;
      buildSynthPanel(body, {
        patch: track.patch,
        arp: this.arpParams,
        onChange: () => {
          track.applyPatch();
          this.updateLcd();
          this.autosaveSoon();
        },
        onArpChange: () => {
          this.arp.params = this.arpParams;
          this.arp.setEnabled(this.arpParams.enabled);
        },
        onPreviewDrum: () => {
          this.engine.resume();
          track.noteOn(60, 0.95, this.ctx.currentTime + 0.01);
        },
      });
    } else if (this.tab === 'master') {
      buildMasterPanel(body, this.engine, () => this.autosaveSoon());
    } else {
      this.songView = buildSongView(body, this.sequencer, () => this.autosaveSoon());
    }
  }

  private renderMixer() {
    const el = document.getElementById('mixer');
    if (!el) return;
    this.mixer = buildMixer(el, {
      sequencer: this.sequencer,
      getSelectedId: () => this.selectedTrackId,
      onSelect: (id) => this.selectTrack(id),
      onChange: () => {
        this.autosaveSoon();
        if (this.tab === 'song') this.songView?.refresh();
      },
      onAddTrack: () => this.addTrackDialog(),
    });
  }

  private renderBrowser() {
    const el = document.getElementById('browser');
    const track = this.selectedTrack;
    if (!el || !track) return;
    buildPatchBrowser(el, {
      currentPatch: track.patch,
      onSelect: (patch: Patch) => {
        const t = this.selectedTrack;
        if (!t) return;
        const keepPan = t.patch.pan;
        patch.pan = keepPan;
        t.setPatch(patch);
        this.renderTab();
        this.renderBrowser();
        this.mixer?.refresh();
        this.updateLcd();
        this.autosaveSoon();
      },
      onRename: () => {
        this.updateLcd();
      },
    });
  }

  private renderRoll() {
    const el = document.getElementById('roll');
    if (!el) return;
    this.roll?.destroy();
    this.roll = createPianoRoll(el, {
      getTrack: () => this.selectedTrack,
      onPreview: (pitch, vel) => {
        this.engine.resume();
        this.selectedTrack?.noteOn(pitch, vel, this.ctx.currentTime);
      },
      onPreviewEnd: (pitch) => this.selectedTrack?.noteOff(pitch, this.ctx.currentTime),
      onChange: () => {
        this.autosaveSoon();
        if (this.tab === 'song') this.songView?.refresh();
      },
    });
  }

  private renderKeyboard() {
    const el = document.getElementById('keyboard');
    if (!el) return;
    this.keyboard = buildVirtualKeyboard(el, {
      low: 48,
      high: 84,
      onNoteOn: (n, v) => this.noteOn(n, v),
      onNoteOff: (n) => this.noteOff(n),
      onBend: (v) => this.selectedTrack?.setBend(v),
      onMod: (v) => this.selectedTrack?.setMod(v),
      onOctaveShift: (delta) => this.computerKeys.setOctave(this.computerKeys.octaveBase + delta),
    });
  }

  private selectTrack(id: string) {
    if (this.selectedTrackId === id) return;
    this.selectedTrack?.allNotesOff();
    this.selectedTrackId = id;
    this.arp.setTarget(this.arpTarget());
    this.mixer?.refresh();
    this.renderTab();
    this.renderBrowser();
    this.roll?.refresh();
    this.updateLcd();
  }

  private addTrackDialog() {
    const content = document.createElement('div');
    content.className = 'preset-picker';
    const groups = new Map<string, typeof PRESETS>();
    for (const p of PRESETS) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category)!.push(p);
    }
    let close = () => {};
    for (const [cat, items] of groups) {
      const title = document.createElement('div');
      title.className = 'browser-group-title';
      title.textContent = cat;
      content.appendChild(title);
      const wrap = document.createElement('div');
      wrap.className = 'browser-items';
      for (const p of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'patch-btn';
        b.textContent = p.name;
        b.addEventListener('click', () => {
          const track = this.sequencer.addTrack(p.id, p.name);
          this.selectedTrackId = track.id;
          this.arp.setTarget(this.arpTarget());
          this.mixer?.refresh();
          this.renderTab();
          this.renderBrowser();
          this.roll?.refresh();
          this.updateLcd();
          this.autosaveSoon();
          close();
        });
        wrap.appendChild(b);
      }
      content.appendChild(wrap);
    }
    close = openModal('トラックを追加：音色を選択', content);
  }

  // ------------------------------------------------------------------
  // トランスポート
  // ------------------------------------------------------------------
  private togglePlay() {
    this.engine.resume();
    const btn = document.getElementById('play-btn');
    if (this.sequencer.playing) {
      this.sequencer.stop();
      btn?.classList.remove('on');
      if (btn) btn.textContent = '▶';
      this.roll?.setPlayhead(-1);
    } else {
      this.sequencer.play(0);
      btn?.classList.add('on');
      if (btn) btn.textContent = '❚❚';
    }
  }

  private stopAll() {
    this.sequencer.stop();
    for (const t of this.sequencer.tracks) t.allNotesOff();
    this.arp.stop();
    const btn = document.getElementById('play-btn');
    btn?.classList.remove('on');
    if (btn) btn.textContent = '▶';
    this.roll?.setPlayhead(-1);
  }

  private tapTempo() {
    const now = performance.now();
    this.tapTimes = this.tapTimes.filter((t) => now - t < 2500);
    this.tapTimes.push(now);
    if (this.tapTimes.length < 2) return;
    const deltas: number[] = [];
    for (let i = 1; i < this.tapTimes.length; i++) deltas.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const bpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
    this.sequencer.setBpm(bpm);
    this.bpmKnob?.setKnobValue(bpm);
    toast(`テンポ: ${bpm} BPM`);
  }

  private toggleRecord() {
    const btn = document.getElementById('rec-btn');
    if (this.engine.recording) {
      const result = this.engine.stopRecording();
      btn?.classList.remove('on');
      if (result) {
        const blob = encodeWav(result.channels, result.sampleRate, 24);
        this.download(blob, `akatsuki-recording-${stamp()}.wav`);
        toast('録音を WAV で保存しました');
      } else {
        toast('録音データがありません');
      }
    } else {
      if (this.engine.startRecording()) {
        btn?.classList.add('on');
        toast('録音中… もう一度押すと停止して WAV を保存します');
      } else {
        toast('この環境では録音を開始できませんでした');
      }
    }
  }

  // ------------------------------------------------------------------
  // 書き出し・保存
  // ------------------------------------------------------------------
  private async exportWav() {
    const content = document.createElement('div');
    content.className = 'export-dialog';

    const info = document.createElement('p');
    info.textContent =
      'オフラインレンダリングで高品質な WAV（24bit）を書き出します。リアルタイム録音と違い音切れがなく、実時間より短時間で完了します。';
    content.appendChild(info);

    const barsInput = labeledInput('小節数', 'number', String(this.sequencer.mode === 'song' ? this.sequencer.songLengthBars : 4));
    const repeatInput = labeledInput('繰り返し', 'number', '1');
    const rateSelect = document.createElement('select');
    rateSelect.className = 'field-select';
    for (const r of [44100, 48000, 96000]) {
      const o = document.createElement('option');
      o.value = String(r);
      o.textContent = `${r / 1000} kHz`;
      if (r === 48000) o.selected = true;
      rateSelect.appendChild(o);
    }
    const rateWrap = document.createElement('label');
    rateWrap.className = 'field';
    const rateLabel = document.createElement('span');
    rateLabel.className = 'field-label';
    rateLabel.textContent = 'サンプルレート';
    rateWrap.append(rateLabel, rateSelect);

    content.append(barsInput.wrap, repeatInput.wrap, rateWrap);

    const progress = document.createElement('div');
    progress.className = 'progress';
    content.appendChild(progress);

    let close = () => {};
    const go = createButton('書き出す', async () => {
      go.disabled = true;
      progress.textContent = 'レンダリング中…';
      try {
        const data = this.sequencer.toJSON();
        const buffer = await renderSong(data, {
          sampleRate: Number(rateSelect.value),
          bars: Math.max(1, Number(barsInput.input.value) || 4),
          repeats: Math.max(1, Number(repeatInput.input.value) || 1),
          tail: 3.5,
        });
        const blob = audioBufferToWav(buffer, 24);
        this.download(blob, `akatsuki-song-${stamp()}.wav`);
        progress.textContent = '完了しました';
        toast('WAV を書き出しました');
        close();
      } catch (err) {
        progress.textContent = `失敗しました: ${String(err)}`;
        go.disabled = false;
      }
    }, 'btn-accent');

    close = openModal('WAV 書き出し', content, [go]);
  }

  private exportMidiFile() {
    try {
      const blob = exportMidi(this.sequencer);
      this.download(blob, `akatsuki-song-${stamp()}.mid`);
      toast('MIDI ファイルを書き出しました');
    } catch (err) {
      toast(`MIDI 書き出しに失敗しました: ${String(err)}`);
    }
  }

  private saveSongFile() {
    const data = this.sequencer.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.download(blob, `akatsuki-song-${stamp()}.json`);
    this.autosave();
    toast('曲データを保存しました');
  }

  private loadSongFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        this.applySong(data);
        toast('曲データを読み込みました');
      } catch (err) {
        toast(`読み込みに失敗しました: ${String(err)}`);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private applySong(data: unknown) {
    this.stopAll();
    this.sequencer.loadJSON(data);
    this.selectedTrackId = this.sequencer.tracks[0]?.id ?? '';
    this.arp.setTarget(this.arpTarget());
    this.bpmKnob?.setKnobValue(this.sequencer.bpm);
    this.mixer?.refresh();
    this.renderTab();
    this.renderBrowser();
    this.roll?.refresh();
    this.updateLcd();
    this.autosaveSoon();
  }

  private download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  private autosaveSoon() {
    if (this.autosaveTimer) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosave(), 900);
  }

  private autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.sequencer.toJSON()));
    } catch {
      /* 容量超過などは無視 */
    }
  }

  // ------------------------------------------------------------------
  // 表示更新
  // ------------------------------------------------------------------
  private updateLcd() {
    const lcd = document.getElementById('lcd');
    const track = this.selectedTrack;
    if (!lcd || !track) return;
    lcd.innerHTML = `<span class="lcd-track">${escapeHtml(track.name)}</span><span class="lcd-patch">${escapeHtml(track.patch.name)}</span><span class="lcd-meta">${track.patch.kind === 'drum' ? 'DRUM' : track.patch.voiceMode.toUpperCase()}</span>`;
    const patchName = document.querySelector('.track-row.selected .track-patch');
    if (patchName) patchName.textContent = track.patch.name;
  }

  private updatePosition(tick: number) {
    const el = document.getElementById('position');
    if (!el) return;
    if (tick < 0) {
      el.textContent = '001 : 1';
      return;
    }
    const bar = Math.floor(tick / STEPS_PER_BAR) + 1;
    const beat = Math.floor((tick % STEPS_PER_BAR) / 4) + 1;
    el.textContent = `${String(bar).padStart(3, '0')} : ${beat}`;
  }

  private updateMidiStatus() {
    this.updateStatus();
  }

  private updateStatus() {
    const el = document.getElementById('status');
    if (!el) return;
    const midi = this.midi?.connectedNames.length ? `MIDI: ${this.midi.connectedNames.join(', ')}` : 'MIDI: 未接続';
    const oct = `キーボード基準: C${Math.floor(this.computerKeys.octaveBase / 12) - 1}（← →で変更）`;
    el.innerHTML = `<span>${escapeHtml(midi)}</span><span>${escapeHtml(oct)}</span><span>Space: 再生/停止 ・ Ctrl+Z: 元に戻す ・ Alt+クリック: ノート削除</span>`;
  }

  private showHelp() {
    const content = document.createElement('div');
    content.className = 'help';
    content.innerHTML = `
      <h3>基本操作</h3>
      <ul>
        <li><b>演奏</b>：画面下の鍵盤、PCキーボード（Z S X D C… / Q 2 W 3 E…）、MIDIキーボード。</li>
        <li><b>オクターブ</b>：← → キー、または OCT ボタン。</li>
        <li><b>打ち込み</b>：ピアノロールをクリックでノート追加。右端をドラッグで長さ変更、ドラッグで移動、Alt+クリックまたは右クリックで削除。</li>
        <li><b>ベロシティ</b>：ピアノロール下部のレーンを上下ドラッグ。</li>
        <li><b>パターン</b>：A〜D の 4 スロットを切り替えて別フレーズを作れます。</li>
        <li><b>ソング</b>：「ソング構成」タブでシーンを並べ、トランスポートを「ソング」に切り替えて再生。</li>
      </ul>
      <h3>音づくり</h3>
      <ul>
        <li><b>OSC</b>：波形・オクターブ・デチューン。Super Saw は 7 基のノコギリ波を重ねた厚い音。</li>
        <li><b>FILTER</b>：Ladder は独特の粘りがあるアナログ風、Clean SVF は素直な特性。</li>
        <li><b>LFO</b>：テンポ同期に切り替えると BPM に追従します。</li>
        <li><b>音色保存</b>：ブラウザ内に保存され、次回起動時も残ります。</li>
      </ul>
      <h3>アナライザー</h3>
      <ul>
        <li>画面最上部にマスター出力を常時表示します。左のラベルをクリックすると
          「波形＋スペクトラム → スペクトラム → 波形」の順に切り替わります（選択は記憶されます）。</li>
        <li>右側は L / R のピークメーター。白い線はピークホールド、数値は dBFS です。
          0.0 に近づくと赤くなるので、書き出し前の音量確認に使えます。</li>
      </ul>
      <h3>書き出し</h3>
      <ul>
        <li><b>WAV書出</b>：オフラインレンダリングで高音質・音切れなしの WAV を生成。</li>
        <li><b>MIDI書出</b>：他の DAW に読み込める標準MIDIファイル。</li>
        <li><b>保存 / 読込</b>：曲データ（JSON）。作業内容はブラウザにも自動保存されます。</li>
      </ul>
      <h3>ライセンス</h3>
      <p>音はすべてコード生成（サンプル音源不使用）。作った曲の権利は制作者であるあなたのものです。商用利用も自由です。</p>`;

    const reset = createButton('デモ曲を読み込み直す', () => {
      if (window.confirm('現在の曲は失われます。よろしいですか？')) this.applySong(demoSong());
    }, 'btn-sm');
    openModal('使い方', content, [reset]);
  }

  private startAnimationLoop() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.mixer?.updateMeters();
    };
    requestAnimationFrame(loop);
  }
}

function labeledInput(label: string, type: string, value: string) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.className = 'field-input';
  input.min = '1';
  wrap.append(span, input);
  return { wrap, input };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

void clonePatch;
