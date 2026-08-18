/**
 * Akatsuki Synth — アプリケーション本体（画面構成とすべての配線）
 */
import { AudioEngine, defaultMasterSettings, loadWorklets } from '../audio/AudioEngine';
import { Arpeggiator } from '../audio/Arpeggiator';
import { ComputerKeyboard, MidiInput } from '../audio/MidiInput';
import { exportMidi } from '../audio/midifile';
import { PRESETS, clonePatch, patchLabel } from '../audio/presets';
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
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

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
    document.documentElement.lang = getLocale();
    onLocaleChange(() => this.buildLayout());
    this.root.innerHTML = `<div class="loading">${t('loading')}</div>`;
    void this.boot();
  }

  // ------------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------------
  private async boot() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      await loadWorklets(this.ctx);
    } catch (err) {
      this.root.innerHTML = `<div class="loading"><p>${t('boot.error')}</p><pre>${String(err)}</pre></div>`;
      return;
    }

    this.engine = new AudioEngine(this.ctx, defaultMasterSettings());
    this.unlockAudioOnFirstGesture();
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

  // ブラウザの自動再生制限のため、AudioContext はユーザー操作の中で resume() する必要がある。
  // 対応イベントの種類やタイミングはブラウザ・端末によって差があるため、複数のイベントで待ち構える。
  private unlockAudioOnFirstGesture() {
    const events = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'];
    const unlock = () => {
      this.engine.resume();
      for (const ev of events) document.removeEventListener(ev, unlock, true);
    };
    for (const ev of events) document.addEventListener(ev, unlock, { capture: true, passive: true });
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
      { id: 'synth', label: t('tab.synth') },
      { id: 'master', label: t('tab.master') },
      { id: 'song', label: t('tab.song') },
    ];
    for (const def of tabDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (this.tab === def.id ? ' on' : '');
      b.textContent = def.label;
      b.dataset.tab = def.id;
      b.addEventListener('click', () => this.setTab(def.id));
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
    playBtn.title = t('transport.play.title');
    transport.appendChild(playBtn);

    const stopBtn = createButton('■', () => this.stopAll(), 'btn-transport');
    stopBtn.title = t('transport.stop.title');
    transport.appendChild(stopBtn);

    const recBtn = createButton('●', () => this.toggleRecord(), 'btn-transport btn-rec');
    recBtn.id = 'rec-btn';
    recBtn.title = t('transport.rec.title');
    transport.appendChild(recBtn);

    const position = document.createElement('div');
    position.className = 'position';
    position.id = 'position';
    position.textContent = '001 : 1';
    transport.appendChild(position);

    const modeWrap = document.createElement('div');
    modeWrap.className = 'seg';
    for (const [value, label] of [['pattern', t('mode.pattern')], ['song', t('mode.song')]] as const) {
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
    tap.title = t('tap.title');
    tempo.appendChild(tap);
    const metro = createButton('🔔', () => {
      this.sequencer.metronome = !this.sequencer.metronome;
      metro.classList.toggle('on', this.sequencer.metronome);
    }, 'btn-sm btn-icon');
    metro.title = t('metro.title');
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
    actions.appendChild(createButton(t('lang.toggle'), () => toggleLocale(), 'btn-sm lang-btn'));
    actions.appendChild(createButton(t('action.exportWav'), () => void this.exportWav(), 'btn-sm btn-accent'));
    actions.appendChild(createButton(t('action.exportMidi'), () => this.exportMidiFile(), 'btn-sm'));
    actions.appendChild(createButton(t('action.save'), () => this.saveSongFile(), 'btn-sm'));

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = 'application/json,.mss.json';
    loadInput.style.display = 'none';
    loadInput.addEventListener('change', () => this.loadSongFile(loadInput));
    actions.appendChild(createButton(t('action.load'), () => loadInput.click(), 'btn-sm'));
    actions.appendChild(loadInput);
    actions.appendChild(createButton(t('action.help'), () => this.showHelp(), 'btn-sm btn-icon'));
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
          const track = this.sequencer.addTrack(p.id, patchLabel(p));
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
    close = openModal(t('addTrack.title'), content);
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
    toast(t('toast.tempo', { bpm }));
  }

  private toggleRecord() {
    const btn = document.getElementById('rec-btn');
    if (this.engine.recording) {
      const result = this.engine.stopRecording();
      btn?.classList.remove('on');
      if (result) {
        const blob = encodeWav(result.channels, result.sampleRate, 24);
        this.download(blob, `akatsuki-recording-${stamp()}.wav`);
        toast(t('toast.recordSaved'));
      } else {
        toast(t('toast.noRecordData'));
      }
    } else {
      if (this.engine.startRecording()) {
        btn?.classList.add('on');
        toast(t('toast.recording'));
      } else {
        toast(t('toast.recordUnavailable'));
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
    info.textContent = t('export.info');
    content.appendChild(info);

    const barsInput = labeledInput(t('export.bars'), 'number', String(this.sequencer.mode === 'song' ? this.sequencer.songLengthBars : 4));
    const repeatInput = labeledInput(t('export.repeat'), 'number', '1');
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
    rateLabel.textContent = t('export.sampleRate');
    rateWrap.append(rateLabel, rateSelect);

    content.append(barsInput.wrap, repeatInput.wrap, rateWrap);

    const progress = document.createElement('div');
    progress.className = 'progress';
    content.appendChild(progress);

    let close = () => {};
    const go = createButton(t('export.go'), async () => {
      go.disabled = true;
      progress.textContent = t('export.rendering');
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
        progress.textContent = t('export.done');
        toast(t('toast.wavExported'));
        close();
      } catch (err) {
        progress.textContent = t('export.failed', { err: String(err) });
        go.disabled = false;
      }
    }, 'btn-accent');

    close = openModal(t('export.modalTitle'), content, [go]);
  }

  private exportMidiFile() {
    try {
      const blob = exportMidi(this.sequencer);
      this.download(blob, `akatsuki-song-${stamp()}.mid`);
      toast(t('toast.midiExported'));
    } catch (err) {
      toast(t('toast.midiExportFailed', { err: String(err) }));
    }
  }

  private saveSongFile() {
    const data = this.sequencer.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.download(blob, `akatsuki-song-${stamp()}.json`);
    this.autosave();
    toast(t('toast.songSaved'));
  }

  private loadSongFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        this.applySong(data);
        toast(t('toast.songLoaded'));
      } catch (err) {
        toast(t('toast.loadFailed', { err: String(err) }));
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
    lcd.innerHTML = `<span class="lcd-track">${escapeHtml(track.name)}</span><span class="lcd-patch">${escapeHtml(patchLabel(track.patch))}</span><span class="lcd-meta">${track.patch.kind === 'drum' ? 'DRUM' : track.patch.voiceMode.toUpperCase()}</span>`;
    const patchName = document.querySelector('.track-row.selected .track-patch');
    if (patchName) patchName.textContent = patchLabel(track.patch);
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
    const midi = this.midi?.connectedNames.length
      ? t('status.midiConnected', { names: this.midi.connectedNames.join(', ') })
      : t('status.midiDisconnected');
    const oct = t('status.keyboardBase', { oct: Math.floor(this.computerKeys.octaveBase / 12) - 1 });
    el.innerHTML = `<span>${escapeHtml(midi)}</span><span>${escapeHtml(oct)}</span><span>${escapeHtml(t('status.hints'))}</span>`;
  }

  private showHelp() {
    const content = document.createElement('div');
    content.className = 'help';
    content.innerHTML = `
      <h3>${t('help.basics.heading')}</h3>
      <ul>
        <li>${t('help.basics.play')}</li>
        <li>${t('help.basics.octave')}</li>
        <li>${t('help.basics.input')}</li>
        <li>${t('help.basics.velocity')}</li>
        <li>${t('help.basics.pattern')}</li>
        <li>${t('help.basics.song')}</li>
      </ul>
      <h3>${t('help.tone.heading')}</h3>
      <ul>
        <li>${t('help.tone.osc')}</li>
        <li>${t('help.tone.filter')}</li>
        <li>${t('help.tone.lfo')}</li>
        <li>${t('help.tone.save')}</li>
      </ul>
      <h3>${t('help.analyzer.heading')}</h3>
      <ul>
        <li>${t('help.analyzer.top')}</li>
        <li>${t('help.analyzer.meter')}</li>
      </ul>
      <h3>${t('help.export.heading')}</h3>
      <ul>
        <li>${t('help.export.wav')}</li>
        <li>${t('help.export.midi')}</li>
        <li>${t('help.export.save')}</li>
      </ul>
      <h3>${t('help.license.heading')}</h3>
      <p>${t('help.license.text')}</p>`;

    const reset = createButton(t('help.reloadDemo'), () => {
      if (window.confirm(t('confirm.reloadDemo'))) this.applySong(demoSong());
    }, 'btn-sm');
    openModal(t('help.title'), content, [reset]);
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
