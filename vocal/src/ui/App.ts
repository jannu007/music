/*
 * 画面全体の組み立てと配線
 */

import { compileSong } from '../audio/compile';
import { chordsToText, parseChordText } from '../audio/chords';
import {
  decodeProject,
  downloadBlob,
  encodeMidi,
  encodeProject,
  encodeWav,
  safeFileName,
  timestampName,
} from '../audio/export';
import {
  applyLyrics,
  createNote,
  createSong,
  midiToNoteName,
  normalizeSong,
  songBeats,
  syncNoteIds,
  transpose,
} from '../audio/song';
import {
  DEFAULT_MIX,
  type AccompStyle,
  type ReverbType,
  type Song,
  type VocalNote,
} from '../audio/types';
import { VocalEngine, renderSong } from '../audio/VocalEngine';
import { MicRecorder, micSupported, type Recording } from '../audio/mic';
import { SpeechCapture, speechSupported } from '../audio/speech';
import { analyzeRecording, measureLevel, quantizeToBeats } from '../audio/transcribe';
import { VOICES, voiceDefaults } from '../audio/voices';
import { DEMOS } from '../data/demos';
import { PianoRoll, type RollTool } from './PianoRoll';
import {
  button,
  el,
  numberField,
  section,
  segmented,
  slider,
  switchRow,
  textArea,
  textField,
  fieldRootOf,
} from './controls';
import { getLocale, onLocaleChange, t, toggleLocale } from './i18n';
import './strings';

const STORAGE_KEY = 'hoshizora-vocal-v1';
const HISTORY_LIMIT = 80;

type TabId = 'voice' | 'expression' | 'accomp' | 'mix' | 'record' | 'song';

/** 録音した歌をどう歌詞にするか */
type LyricMode = 'speech' | 'vowel' | 'ra';

/** 取り込んだ音符をどこへ置くか */
type InsertAt = 'start' | 'playhead' | 'end';

interface RecordSettings {
  /** 録音中もクリックを鳴らす */
  metronome: boolean;
  /** 1小節分のカウントインを入れる */
  countIn: boolean;
  insertAt: InsertAt;
  /** 音符の位置合わせ（拍） */
  snap: number;
  /** 小さな声をどこまで拾うか 0..1 */
  sensitivity: number;
  lyricMode: LyricMode;
  /** 最初の音が先頭に来るように前を詰める */
  trimStart: boolean;
}

const DEFAULT_RECORD: RecordSettings = {
  // 録音中のクリックはスピーカーからマイクへ回り込むため、既定では切っておく
  metronome: false,
  countIn: true,
  insertAt: 'playhead',
  snap: 0.25,
  sensitivity: 0.5,
  lyricMode: 'speech',
  trimStart: true,
};

function snapOptions(): { value: string; label: string }[] {
  return [
    { value: '1', label: t('snap.quarter') },
    { value: '0.5', label: t('snap.eighth') },
    { value: '0.25', label: t('snap.sixteenth') },
    { value: '0.3333333333', label: t('snap.triplet') },
    { value: '0', label: t('snap.none') },
  ];
}

export class VocalApp {
  private root: HTMLElement;
  private engine = new VocalEngine();
  private roll!: PianoRoll;
  private song: Song;

  private audioReady = false;
  private initPromise: Promise<void> | null = null;
  private playing = false;
  private playFromBeat = 0;
  private exporting = false;

  private history: string[] = [];
  private future: string[] = [];
  /** 直近に確定した状態（undo で戻る先） */
  private baseline = '';

  private statusEl!: HTMLElement;
  private positionEl!: HTMLElement;
  private meterFill!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private panelBody!: HTMLElement;
  private inspector!: HTMLElement;
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private activeTab: TabId = 'voice';
  private menu: HTMLElement | null = null;
  private chordArea: HTMLTextAreaElement | null = null;
  private lyricArea: HTMLTextAreaElement | null = null;

  // ------------------------------------------------------------------ 録音
  private mic = new MicRecorder();
  private speech: SpeechCapture | null = null;
  private recordSettings: RecordSettings = { ...DEFAULT_RECORD };
  private recording = false;
  private analyzing = false;
  /** 直前の録音（設定を変えて解析し直せるように取っておく） */
  private lastRecording: Recording | null = null;
  private lastTranscript = '';
  private speechNote = '';
  /** うまくいかないときに原因を伝えるための実測値 */
  private lastLevelNote = '';
  private monitoring = false;
  private recordStartTimer = 0;
  private clickTimer = 0;
  private clickBeat = 0;
  private clickFrom = 0;
  private recordUi: {
    button: HTMLButtonElement;
    level: HTMLElement;
    status: HTMLElement;
  } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    document.documentElement.lang = getLocale();
    onLocaleChange(() => this.build());
    this.song = this.load();
    this.baseline = this.snapshot();
    this.build();
    this.bindKeys();
    this.loop();
  }

  // ------------------------------------------------------------ 保存と復元

  private load(): Song {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.song) {
          const song = normalizeSong(data.song);
          syncNoteIds(song.notes);
          return song;
        }
      }
    } catch {
      /* 壊れた保存データは無視して初期状態で開く */
    }
    return this.cloneDemo(0);
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ song: this.song }));
    } catch {
      /* プライベートモードなどで保存できない場合は無視 */
    }
  }

  private cloneDemo(index: number): Song {
    const demo = DEMOS[index] ?? DEMOS[0];
    const song = normalizeSong(JSON.parse(JSON.stringify(demo.song)) as Song);
    syncNoteIds(song.notes);
    return song;
  }

  // ---------------------------------------------------------------- 履歴

  private snapshot(): string {
    return JSON.stringify(this.song);
  }

  /** 変更前の状態（baseline）を積む。編集の直前・直後どちらから呼んでも同じ結果になる */
  private pushHistory() {
    this.history.push(this.baseline);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
  }

  /** 編集を確定する（履歴に積んで保存する） */
  private changed(label: string) {
    this.pushHistory();
    this.baseline = this.snapshot();
    this.save();
    if (label) this.setStatus(label);
  }

  private undo() {
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.future.push(this.snapshot());
    this.song = normalizeSong(JSON.parse(prev));
    this.afterSongReplaced(t('flash.undone'));
  }

  private redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(this.snapshot());
    this.song = normalizeSong(JSON.parse(next));
    this.afterSongReplaced(t('flash.redone'));
  }

  private afterSongReplaced(message: string) {
    this.baseline = this.snapshot();
    this.roll.setSong(this.song);
    this.renderPanel();
    this.renderInspector();
    this.save();
    this.engine.updateSettings(this.song.settings, this.song.bpm);
    this.setStatus(message);
  }

  // ---------------------------------------------------------------- 音まわり

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
        .init(this.song.settings, this.song.bpm)
        .then(() => {
          this.audioReady = true;
          this.engine.onPosition = () => undefined;
          this.engine.onEnd = () => this.stop();
          this.setStatus(t('status.audioReady'));
        })
        .catch((err) => {
          this.initPromise = null;
          this.setStatus(t('status.audioError', { err: String(err) }));
          throw err;
        });
    }
    return this.initPromise;
  }

  private async play(fromBeat = 0) {
    await this.ensureAudio();
    if (this.song.notes.length === 0 && this.song.chords.length === 0) {
      this.setStatus(t('status.noNotes'));
      return;
    }
    this.engine.updateSettings(this.song.settings, this.song.bpm);
    const compiled = compileSong(this.song, { fromBeat });
    this.playFromBeat = fromBeat;
    this.engine.play(compiled);
    this.playing = true;
    this.playButton.textContent = t('transport.stop');
    this.playButton.classList.add('active');
    this.setStatus(t('status.playing'));
  }

  private stop() {
    this.engine.stop();
    this.playing = false;
    this.playButton.textContent = t('transport.play');
    this.playButton.classList.remove('active');
    this.roll.setPlayhead(null);
  }

  private toggle() {
    if (this.playing) this.stop();
    else void this.play(this.playFromBeat);
  }

  /** 音符ひとつを鳴らして確かめる */
  private audition(note: number, lyric: string) {
    if (this.playing) return;
    void this.ensureAudio().then(() => {
      const beats = (this.song.bpm / 60) * 0.65;
      const probe: Song = {
        ...this.song,
        notes: [createNote({ start: 0, length: beats, note, lyric, vel: 0.75 })],
        chords: [],
        style: 'off',
      };
      this.engine.updateSettings(this.song.settings, this.song.bpm);
      this.engine.play(compileSong(probe), 0.02);
    });
  }

  // ------------------------------------------------------------------ 画面

  private build() {
    this.root.innerHTML = '';
    const app = el('div', 'vocal-app');

    app.append(this.buildTopbar());

    const workspace = el('div', 'workspace');
    const rollArea = el('div', 'roll-area');
    rollArea.append(this.buildRollToolbar());

    const rollHost = el('div', 'roll-host');
    rollArea.append(rollHost);

    this.inspector = el('div', 'inspector');
    rollArea.append(this.inspector);

    const side = el('aside', 'side');
    side.append(this.buildTabs());
    this.panelBody = el('div', 'panel-body');
    side.append(this.panelBody);

    workspace.append(rollArea, side);
    app.append(workspace);

    const status = el('div', 'statusbar');
    this.statusEl = el('span', 'status-text', t('status.initial'));
    status.append(this.statusEl);
    const credit = el('span', 'status-credit', t('status.credit'));
    status.append(credit);
    app.append(status);

    this.root.append(app);

    this.roll = new PianoRoll(rollHost, {
      onChange: (label) => {
        this.changed(label);
        this.renderInspector();
      },
      onSelect: () => this.renderInspector(),
      onAudition: (note, lyric) => this.audition(note, lyric),
      onSeek: (beat) => {
        this.playFromBeat = beat;
        if (this.playing) void this.play(beat);
        else this.roll.setPlayhead(beat);
      },
    });
    this.roll.setSong(this.song);
    this.renderPanel();
    this.renderInspector();
    this.save();
  }

  private buildTopbar(): HTMLElement {
    const bar = el('div', 'topbar');

    const brand = el('div', 'brand');
    const mark = el('div', 'brand-mark');
    mark.innerHTML =
      '<svg viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.45"/>' +
      '<path d="M20 7c-3.6 0-6 2.6-6 6.4v6.2c0 3.8 2.4 6.4 6 6.4s6-2.6 6-6.4v-6.2C26 9.6 23.6 7 20 7z" fill="currentColor" opacity="0.9"/>' +
      '<path d="M11 19.5c0 5.4 3.9 9.3 9 9.3s9-3.9 9-9.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M20 28.8V34" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>';
    const titles = el('div', 'brand-text');
    titles.append(el('span', 'brand-title', 'Hoshizora Vocal'));
    titles.append(el('span', 'brand-sub', t('brand.sub')));
    brand.append(mark, titles);

    const transport = el('div', 'transport');
    this.playButton = button(t('transport.play'), 'primary', () => this.toggle());
    const rewind = button('⏮', 'icon', () => {
      this.playFromBeat = 0;
      if (this.playing) void this.play(0);
      else this.roll.setPlayhead(0);
    });
    rewind.title = t('rewind.title');
    this.positionEl = el('span', 'position', '001 : 1');

    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);

    transport.append(rewind, this.playButton, this.positionEl, meter);

    const langButton = button(t('lang.toggle'), 'ghost round lang-btn', () => toggleLocale());

    const actions = el('div', 'top-actions');
    actions.append(langButton);
    actions.append(
      button(t('action.export'), 'ghost', (
      ) => this.openExportMenu(actions))
    );
    actions.append(button(t('action.save'), 'ghost', () => this.saveProject()));
    actions.append(button(t('action.load'), 'ghost', () => this.openProject()));

    bar.append(brand, transport, actions);
    return bar;
  }

  private buildRollToolbar(): HTMLElement {
    const bar = el('div', 'roll-toolbar');

    const tools: { value: RollTool; label: string; hint: string }[] = [
      { value: 'pen', label: t('tool.pen.label'), hint: t('tool.pen.hint') },
      { value: 'select', label: t('tool.select.label'), hint: t('tool.select.hint') },
      { value: 'erase', label: t('tool.erase.label'), hint: t('tool.erase.hint') },
    ];
    const group = el('div', 'segmented compact');
    const buttons: HTMLButtonElement[] = [];
    for (const tool of tools) {
      const btn = el('button', 'seg-btn', tool.label);
      btn.type = 'button';
      btn.title = tool.hint;
      if (tool.value === 'pen') btn.classList.add('active');
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.remove('active');
        btn.classList.add('active');
        this.roll.setTool(tool.value);
      });
      buttons.push(btn);
      group.append(btn);
    }
    bar.append(group);

    const snapWrap = el('label', 'inline-field');
    snapWrap.append(el('span', 'inline-label', t('roll.snap.label')));
    const snapSelect = el('select', 'select');
    for (const opt of snapOptions()) {
      const o = el('option', '', opt.label);
      o.value = opt.value;
      if (opt.value === '0.25') o.selected = true;
      snapSelect.append(o);
    }
    snapSelect.addEventListener('change', () => {
      this.roll.snap = Number(snapSelect.value);
      this.roll.refresh();
    });
    snapWrap.append(snapSelect);
    bar.append(snapWrap);

    const lenWrap = el('label', 'inline-field');
    lenWrap.append(el('span', 'inline-label', t('roll.length.label')));
    const lenSelect = el('select', 'select');
    for (const [value, label] of [['2', t('length.2beat')], ['1', t('length.1beat')], ['0.5', t('length.eighth')], ['0.25', t('length.sixteenth')]]) {
      const o = el('option', '', label);
      o.value = value;
      if (value === '1') o.selected = true;
      lenSelect.append(o);
    }
    lenSelect.addEventListener('change', () => {
      this.roll.defaultLength = Number(lenSelect.value);
    });
    lenWrap.append(lenSelect);
    bar.append(lenWrap);

    const spacer = el('div', 'spacer');
    bar.append(spacer);

    bar.append(button('−', 'icon', () => this.roll.zoom(1 / 1.25)));
    bar.append(button('＋', 'icon', () => this.roll.zoom(1.25)));
    bar.append(button('⇕−', 'icon', () => this.roll.zoomVertical(1 / 1.2)));
    bar.append(button('⇕＋', 'icon', () => this.roll.zoomVertical(1.2)));
    bar.append(button(t('roll.selectAll'), 'ghost', () => this.roll.selectAll()));
    bar.append(button(t('roll.deleteSelection'), 'ghost danger', () => this.roll.deleteSelection()));
    return bar;
  }

  private buildTabs(): HTMLElement {
    const tabs = el('div', 'tabs');
    const items: { id: TabId; label: string }[] = [
      { id: 'voice', label: t('tab.voice') },
      { id: 'expression', label: t('tab.expression') },
      { id: 'accomp', label: t('tab.accomp') },
      { id: 'mix', label: t('tab.mix') },
      { id: 'record', label: t('tab.record') },
      { id: 'song', label: t('tab.song') },
    ];
    for (const item of items) {
      const btn = el('button', 'tab', item.label);
      btn.type = 'button';
      if (item.id === this.activeTab) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.activeTab = item.id;
        for (const [id, b] of this.tabButtons) b.classList.toggle('active', id === item.id);
        this.renderPanel();
      });
      this.tabButtons.set(item.id, btn);
      tabs.append(btn);
    }
    return tabs;
  }

  // ------------------------------------------------------------------ パネル

  private renderPanel() {
    this.panelBody.innerHTML = '';
    this.recordUi = null;
    switch (this.activeTab) {
      case 'voice':
        this.panelVoice();
        break;
      case 'expression':
        this.panelExpression();
        break;
      case 'accomp':
        this.panelAccomp();
        break;
      case 'mix':
        this.panelMix();
        break;
      case 'record':
        this.panelRecord();
        break;
      case 'song':
        this.panelSong();
        break;
    }
  }

  private commitSettings(label = '') {
    this.engine.updateSettings(this.song.settings, this.song.bpm);
    this.save();
    if (label) this.setStatus(label);
  }

  private panelVoice() {
    const s = this.song.settings;
    const list = section(t('section.voice.title'), t('section.voice.hint'));
    const grid = el('div', 'voice-grid');
    for (const voice of VOICES) {
      const card = el('button', 'voice-card');
      card.type = 'button';
      if (voice.id === s.voiceId) card.classList.add('active');
      card.append(el('span', 'voice-name', t(`voice.${voice.id}.name`)));
      card.append(el('span', 'voice-desc', t(`voice.${voice.id}.description`)));
      card.append(
        el('span', 'voice-range', t('voice.range', { lo: midiToNoteName(voice.range[0]), hi: midiToNoteName(voice.range[1]) }))
      );
      card.addEventListener('click', () => {
        const defaults = voiceDefaults(voice.id);
        s.voiceId = voice.id;
        s.character = { ...defaults.character };
        s.expression = { ...defaults.expression };
        this.changed('');
        this.commitSettings(t('flash.voiceSwitched', { name: t(`voice.${voice.id}.name`) }));
        this.renderPanel();
      });
      grid.append(card);
    }
    list.append(grid);
    this.panelBody.append(list);

    const c = s.character;
    const tone = section(t('section.toneAdjust.title'), t('section.toneAdjust.hint'));
    tone.append(
      slider({
        label: t('ctl.tract.label'), min: 0.85, max: 1.4, step: 0.01, value: c.tract,
        hint: t('ctl.tract.hint'),
        format: (v) => v.toFixed(2),
        onInput: (v) => { c.tract = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.brightness.label'), min: -1, max: 1, step: 0.01, value: c.brightness,
        format: (v) => v.toFixed(2),
        onInput: (v) => { c.brightness = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.breath.label'), min: 0, max: 1, step: 0.01, value: c.breath,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.breath = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.tension.label'), min: 0, max: 1, step: 0.01, value: c.tension,
        hint: t('ctl.tension.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.tension = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.nasality.label'), min: 0, max: 1, step: 0.01, value: c.nasality,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.nasality = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.body.label'), min: 0, max: 1, step: 0.01, value: c.body,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.body = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.growl.label'), min: 0, max: 1, step: 0.01, value: c.growl,
        hint: t('ctl.growl.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.growl = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.a4.label'), min: 415, max: 466, step: 1, value: s.a4,
        format: (v) => `${v} Hz`,
        onInput: (v) => { s.a4 = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(tone);
  }

  private panelExpression() {
    const e = this.song.settings.expression;
    const vib = section(t('section.vibrato.title'));
    vib.append(
      slider({
        label: t('ctl.vibDepth.label'), min: 0, max: 90, step: 1, value: e.vibDepth,
        format: (v) => `${Math.round(v)} ${t('unit.cents')}`,
        onInput: (v) => { e.vibDepth = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.vibRate.label'), min: 3.5, max: 8, step: 0.1, value: e.vibRate,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { e.vibRate = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.vibDelay.label'), min: 0, max: 0.9, step: 0.01, value: e.vibDelay,
        hint: t('ctl.vibDelay.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.vibDelay = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(vib);

    const legato = section(t('section.legato.title'));
    legato.append(
      slider({
        label: t('ctl.portamento.label'), min: 0, max: 250, step: 5, value: e.portamento,
        hint: t('ctl.portamento.hint'),
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.portamento = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.scoop.label'), min: 0, max: 1, step: 0.01, value: e.scoop,
        hint: t('ctl.scoop.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.scoop = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.consonant.label'), min: 0.5, max: 1.8, step: 0.01, value: e.consonant,
        hint: t('ctl.consonant.hint'),
        format: (v) => `${v.toFixed(2)} ${t('unit.times')}`,
        onInput: (v) => { e.consonant = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(legato);

    const dyn = section(t('section.dynamics.title'));
    dyn.append(
      slider({
        label: t('ctl.dynamics.label'), min: 0, max: 1, step: 0.01, value: e.dynamics,
        hint: t('ctl.dynamics.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.dynamics = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.attack.label'), min: 5, max: 120, step: 1, value: e.attack,
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.attack = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.release.label'), min: 20, max: 400, step: 5, value: e.release,
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.release = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.breathNoise.label'), min: 0, max: 1, step: 0.01, value: e.breathNoise,
        hint: t('ctl.breathNoise.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.breathNoise = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.drift.label'), min: 0, max: 1, step: 0.01, value: e.drift,
        hint: t('ctl.drift.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.drift = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(dyn);
  }

  private panelAccomp() {
    const styles: { value: AccompStyle; label: string }[] = [
      { value: 'off', label: t('style.off') },
      { value: 'ballad', label: t('style.ballad') },
      { value: 'pop', label: t('style.pop') },
      { value: 'arpeggio', label: t('style.arpeggio') },
      { value: 'pad', label: t('style.pad') },
      { value: 'band', label: t('style.band') },
    ];
    const s = section(t('section.accompStyle.title'), t('section.accompStyle.hint'));
    s.append(
      segmented('', styles, this.song.style, (v) => {
        this.song.style = v;
        this.changed(t('flash.accompChanged'));
      })
    );
    s.append(
      slider({
        label: t('ctl.accompLevel.label'), min: 0, max: 1, step: 0.01, value: this.song.settings.mix.accompLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { this.song.settings.mix.accompLevel = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(s);

    const chordSection = section(t('section.chords.title'), t('section.chords.hint'));
    const area = textArea(
      t('field.chords.label'),
      chordsToText(this.song.chords, this.song.beatsPerBar),
      10,
      (v) => {
        this.song.chords = parseChordText(v, this.song.beatsPerBar);
        this.changed(t('flash.chordsChanged'));
        this.roll.refresh();
      },
      t('chords.placeholder')
    );
    this.chordArea = area;
    chordSection.append(fieldRootOf(area));
    this.panelBody.append(chordSection);
  }

  private panelMix() {
    const m = this.song.settings.mix;
    const balance = section(t('section.balance.title'));
    balance.append(
      slider({
        label: t('ctl.masterVolume.label'), min: 0, max: 1, step: 0.01, value: m.volume,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.volume = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.vocalLevel.label'), min: 0, max: 1, step: 0.01, value: m.vocalLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.vocalLevel = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.accompLevel2.label'), min: 0, max: 1, step: 0.01, value: m.accompLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.accompLevel = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(balance);

    const tone = section(t('section.mixTone.title'));
    tone.append(
      slider({
        label: t('ctl.mixTone.label'), min: -1, max: 1, step: 0.01, value: m.tone,
        format: (v) => v.toFixed(2),
        onInput: (v) => { m.tone = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.lowCut.label'), min: 0, max: 1, step: 0.01, value: m.lowCut,
        hint: t('ctl.lowCut.hint'),
        format: (v) => `${Math.round(70 + v * 90)} Hz`,
        onInput: (v) => { m.lowCut = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.comp.label'), min: 0, max: 1, step: 0.01, value: m.comp,
        hint: t('ctl.comp.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.comp = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(tone);

    const space = section(t('section.space.title'));
    space.append(
      slider({
        label: t('ctl.doubler.label'), min: 0, max: 1, step: 0.01, value: m.doubler,
        hint: t('ctl.doubler.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.doubler = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.width.label'), min: 0, max: 1, step: 0.01, value: m.width,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.width = v; this.commitSettings(); },
      }),
      segmented<ReverbType>(
        t('ctl.reverbType.label'),
        (['off', 'room', 'plate', 'hall', 'church'] as ReverbType[]).map((v) => ({
          value: v,
          label: t(`room.${v}.label`),
        })),
        m.reverbType,
        (v) => { m.reverbType = v; this.commitSettings(); }
      ),
      slider({
        label: t('ctl.reverbMix.label'), min: 0, max: 1, step: 0.01, value: m.reverbMix,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.reverbMix = v; this.commitSettings(); },
      }),
      slider({
        label: t('ctl.delayMix.label'), min: 0, max: 1, step: 0.01, value: m.delayMix,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.delayMix = v; this.commitSettings(); },
      }),
      segmented(
        t('ctl.delayBeats.label'),
        [
          { value: '0.25', label: t('delaybeats.16') },
          { value: '0.5', label: t('delaybeats.8') },
          { value: '0.75', label: t('delaybeats.dotted8') },
          { value: '1', label: t('delaybeats.4') },
        ],
        String(m.delayBeats),
        (v) => { m.delayBeats = Number(v); this.commitSettings(); }
      )
    );
    this.panelBody.append(space);

    const reset = section(t('section.reset.title'));
    reset.append(
      button(t('action.resetMix'), 'ghost', () => {
        this.song.settings.mix = { ...DEFAULT_MIX };
        this.changed('');
        this.commitSettings(t('flash.mixReset'));
        this.renderPanel();
      })
    );
    this.panelBody.append(reset);
  }

  // ------------------------------------------------------------------ 録音

  private panelRecord() {
    const s = this.recordSettings;

    const capture = section(t('section.micRecord.title'), t('section.micRecord.hint'));
    if (!micSupported()) {
      capture.append(
        el('div', 'ctl-hint', t('mic.unsupported'))
      );
      this.panelBody.append(capture);
      return;
    }

    const box = el('div', 'record-box');
    const recordButton = button(
      this.recording ? t('record.stopAndImport') : t('record.start'),
      this.recording ? 'danger record-main active' : 'primary record-main',
      () => void this.toggleRecording()
    );
    recordButton.disabled = this.analyzing;
    const level = el('div', 'record-level');
    const levelFill = el('div', 'record-level-fill');
    level.append(levelFill);
    const status = el('div', 'record-status', this.recordHint());
    box.append(recordButton, level, status);

    // マイクが本当に音を拾えているかを、録音する前に目で確かめられるようにする
    const checkRow = el('div', 'button-row');
    checkRow.append(
      button(
        this.monitoring ? t('mic.stopMonitor') : t('mic.checkMic'),
        this.monitoring ? 'ghost active' : 'ghost',
        () => void this.toggleMonitor()
      )
    );
    box.append(checkRow);
    if (this.monitoring) {
      box.append(el('div', 'ctl-hint', t('mic.monitorHint')));
    }
    if (this.lastLevelNote) box.append(el('div', 'record-note', this.lastLevelNote));

    capture.append(box);
    this.recordUi = { button: recordButton, level: levelFill, status };
    this.panelBody.append(capture);

    const setup = section(t('section.recordSettings.title'), t('section.recordSettings.hint'));
    setup.append(
      switchRow(t('ctl.countIn.label'), s.countIn, (v) => {
        s.countIn = v;
      }, t('ctl.countIn.hint')),
      switchRow(t('ctl.metronomeDuringRec.label'), s.metronome, (v) => {
        s.metronome = v;
      }),
      switchRow(t('ctl.trimStart.label'), s.trimStart, (v) => {
        s.trimStart = v;
      }, t('ctl.trimStart.hint')),
      segmented<InsertAt>(
        t('ctl.insertAt.label'),
        [
          { value: 'start', label: t('insertAt.start') },
          { value: 'playhead', label: t('insertAt.playhead') },
          { value: 'end', label: t('insertAt.end') },
        ],
        s.insertAt,
        (v) => {
          s.insertAt = v;
        }
      )
    );

    const snapWrap = el('div', 'ctl');
    snapWrap.append(el('div', 'ctl-label', t('ctl.snapNote.label')));
    const snapSelect = el('select', 'select');
    for (const opt of snapOptions()) {
      const o = el('option', '', opt.label);
      o.value = opt.value;
      if (Number(opt.value) === s.snap) o.selected = true;
      snapSelect.append(o);
    }
    snapSelect.addEventListener('change', () => {
      s.snap = Number(snapSelect.value);
    });
    snapWrap.append(snapSelect);
    setup.append(snapWrap);

    setup.append(
      slider({
        label: t('ctl.sensitivity.label'),
        min: 0,
        max: 1,
        step: 0.01,
        value: s.sensitivity,
        hint: t('ctl.sensitivity.hint'),
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => {
          s.sensitivity = v;
        },
      })
    );

    const lyricOptions: { value: LyricMode; label: string }[] = [
      { value: 'speech', label: t('lyricMode.speech') },
      { value: 'vowel', label: t('lyricMode.vowel') },
      { value: 'ra', label: t('lyricMode.ra') },
    ];
    setup.append(segmented<LyricMode>(t('ctl.lyricMode.label'), lyricOptions, s.lyricMode, (v) => {
      s.lyricMode = v;
      this.renderPanel();
    }));
    if (s.lyricMode === 'speech') {
      setup.append(
        el(
          'div',
          'ctl-hint',
          speechSupported()
            ? t('speech.supportedHint')
            : t('speech.unsupportedHint')
        )
      );
    } else if (s.lyricMode === 'vowel') {
      setup.append(el('div', 'ctl-hint', t('vowel.hint')));
    }
    this.panelBody.append(setup);

    if (this.lastRecording) {
      const seconds = this.lastRecording.samples.length / this.lastRecording.sampleRate;
      const last = section(t('section.lastRecording.title'), t('lastRecording.subtitle', { seconds: seconds.toFixed(1) }));
      if (this.lastTranscript) {
        last.append(el('div', 'ctl-label', t('label.heardWords')));
        last.append(el('div', 'record-transcript', this.lastTranscript));
      } else if (this.speechNote) {
        last.append(el('div', 'ctl-hint', this.speechNote));
      }
      const again = el('div', 'button-row');
      again.append(
        button(t('action.reimport'), 'ghost', () => void this.applyRecording())
      );
      last.append(again);
      last.append(
        el('div', 'ctl-hint', t('reimport.hint'))
      );
      this.panelBody.append(last);
    }

    const help = section(t('section.recordTips.title'));
    const tips = el('ul', 'tips');
    for (const tip of [
      t('tip.1'),
      t('tip.2'),
      t('tip.3'),
      t('tip.4'),
    ]) {
      tips.append(el('li', '', tip));
    }
    help.append(tips);
    this.panelBody.append(help);
  }

  private recordHint(): string {
    if (this.recording) return t('status.recordingStop');
    if (this.analyzing) return t('status.analyzing');
    return t('status.pressToRecord');
  }

  private setRecordStatus(text: string) {
    if (this.recordUi?.status.isConnected) this.recordUi.status.textContent = text;
    this.setStatus(text);
  }

  private updateRecordUi() {
    const ui = this.recordUi;
    if (!ui?.button.isConnected) return;
    ui.button.textContent = this.recording ? t('record.stopAndImport') : t('record.start');
    ui.button.className = this.recording ? 'btn danger record-main active' : 'btn primary record-main';
    ui.button.disabled = this.analyzing;
    if (!this.recording) ui.level.style.width = '0%';
  }

  private toggleRecording() {
    if (this.recording) return this.stopRecording();
    return this.startRecording();
  }

  /** 録音せずにマイクの入力レベルだけを見る */
  private async toggleMonitor(): Promise<void> {
    if (this.recording) return;
    if (this.monitoring) {
      this.monitoring = false;
      this.mic.onLevel = null;
      this.mic.close();
      this.renderPanel();
      return;
    }
    try {
      await this.ensureAudio();
    } catch {
      return;
    }
    const ctx = this.engine.ctx;
    if (!ctx) return;
    try {
      await this.mic.open(ctx);
    } catch (err) {
      this.setRecordStatus(t('status.micUnavailable', { err: this.errorText(err) }));
      return;
    }
    let seen = 0;
    this.mic.onLevel = (peak) => {
      if (peak > seen) seen = peak;
      if (this.recordUi?.level.isConnected) {
        this.recordUi.level.style.width = `${Math.min(100, peak * 140)}%`;
      }
      if (this.recordUi?.status.isConnected) {
        this.recordUi.status.textContent = t('status.micMonitoring', { peak: (peak * 100).toFixed(0), max: (seen * 100).toFixed(0) });
      }
    };
    this.monitoring = true;
    this.renderPanel();
  }

  private async startRecording(): Promise<void> {
    if (this.recording || this.analyzing) return;
    if (this.playing) this.stop();
    this.monitoring = false;
    this.lastLevelNote = '';

    try {
      await this.ensureAudio();
    } catch {
      return;
    }
    const ctx = this.engine.ctx;
    if (!ctx) return;

    this.setRecordStatus(t('status.requestMic'));
    try {
      await this.mic.open(ctx);
    } catch (err) {
      this.setRecordStatus(t('status.micUnavailable', { err: this.errorText(err) }));
      return;
    }
    this.mic.onLevel = (peak) => {
      if (this.recordUi?.level.isConnected) {
        this.recordUi.level.style.width = `${Math.min(100, peak * 140)}%`;
      }
    };

    const s = this.recordSettings;
    const secondsPerBeat = 60 / this.song.bpm;
    const countInBeats = s.countIn ? this.song.beatsPerBar : 0;
    const from = ctx.currentTime + 0.2;
    if (s.countIn || s.metronome) this.startClicks(ctx, from);

    this.recording = true;
    this.speechNote = '';
    this.updateRecordUi();

    const waitMs = countInBeats * secondsPerBeat * 1000;
    this.setRecordStatus(countInBeats > 0 ? t('status.countIn') : t('status.recordingStop'));
    this.recordStartTimer = window.setTimeout(() => {
      if (!this.recording) return;
      if (!s.metronome) this.stopClicks();
      this.mic.start();
      if (s.lyricMode === 'speech' && speechSupported()) {
        const speech = new SpeechCapture();
        if (speech.start()) this.speech = speech;
      }
      this.setRecordStatus(t('status.recordingStop'));
    }, waitMs);
  }

  private async stopRecording(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    window.clearTimeout(this.recordStartTimer);
    this.stopClicks();

    const recording = this.mic.isCapturing ? await this.mic.stop() : null;
    this.mic.onLevel = null;
    this.mic.close();
    this.updateRecordUi();

    if (this.speech) {
      this.setRecordStatus(t('status.transcribing'));
      this.lastTranscript = await this.speech.finish();
      this.speechNote = this.lastTranscript ? '' : this.speech.error ?? '';
      this.speech = null;
    } else {
      this.lastTranscript = '';
    }

    if (!recording || recording.samples.length < recording.sampleRate * 0.25) {
      this.lastRecording = null;
      this.setRecordStatus(t('status.recordingTooShort'));
      this.renderPanel();
      return;
    }

    const level = measureLevel(recording);
    this.lastLevelNote = t('record.levelNote', {
      seconds: level.seconds.toFixed(1),
      peak: (level.peak * 100).toFixed(1),
      rms: (level.rms * 100).toFixed(2),
    });

    // マイクから何も入っていないなら、感度を上げても解決しない。原因を分けて伝える
    if (level.peak < 0.002) {
      this.lastRecording = null;
      this.setRecordStatus(t('status.noMicSignal'));
      this.renderPanel();
      return;
    }

    this.lastRecording = recording;
    await this.applyRecording();
  }

  /** 録音を解析して音符にし、曲へ差し込む */
  private async applyRecording(): Promise<void> {
    const recording = this.lastRecording;
    if (!recording || this.analyzing) return;
    const s = this.recordSettings;

    this.analyzing = true;
    this.updateRecordUi();
    this.setRecordStatus(t('status.analyzing'));

    let detected;
    try {
      detected = await analyzeRecording(
        recording,
        {
          a4: this.song.settings.a4,
          sensitivity: s.sensitivity,
          // 言葉を聞き取れなかったときも歌詞が付くよう、母音の推定は保険として動かす
          detectVowels: s.lyricMode === 'vowel' || (s.lyricMode === 'speech' && !this.lastTranscript),
        },
        (ratio) => this.setRecordStatus(t('status.analyzingProgress', { pct: Math.round(ratio * 100) }))
      );
    } catch (err) {
      this.analyzing = false;
      this.updateRecordUi();
      this.setRecordStatus(t('status.analyzeFailed', { err: this.errorText(err) }));
      return;
    }

    this.analyzing = false;
    this.updateRecordUi();

    if (detected.length === 0) {
      this.setRecordStatus(t('status.noNotesExtracted'));
      this.renderPanel();
      return;
    }

    const quantized = quantizeToBeats(detected, {
      bpm: this.song.bpm,
      snap: s.snap,
      offsetBeats: this.insertOffsetBeats(),
      trimStart: s.trimStart,
    });

    const notes = quantized.map((q) =>
      createNote({
        start: q.start,
        length: q.length,
        note: q.note,
        vel: q.vel,
        lyric: q.vowel ?? 'ら',
      })
    );

    let lyricNote = '';
    if (s.lyricMode === 'speech' && this.lastTranscript) {
      const applied = applyLyrics(notes, this.lastTranscript);
      lyricNote = t('lyricNote.suffix', { n: applied });
    } else if (s.lyricMode === 'ra') {
      for (const note of notes) note.lyric = 'ら';
    }

    this.song.notes.push(...notes);
    this.song.notes.sort((a, b) => a.start - b.start);
    this.changed(t('flash.notesImported', { count: notes.length, lyricNote }));
    this.roll.refresh();
    this.renderPanel();
  }

  private insertOffsetBeats(): number {
    const perBar = this.song.beatsPerBar;
    switch (this.recordSettings.insertAt) {
      case 'start':
        return 0;
      case 'end': {
        const beats = songBeats(this.song);
        return beats <= 0 ? 0 : Math.ceil(beats / perBar) * perBar;
      }
      default:
        return Math.max(0, this.playFromBeat);
    }
  }

  private errorText(err: unknown): string {
    if (err && typeof err === 'object' && 'name' in err) {
      const name = String((err as Error).name);
      if (name === 'NotAllowedError') return t('error.micNotAllowed');
      if (name === 'NotFoundError') return t('error.micNotFound');
    }
    return err instanceof Error ? err.message : String(err);
  }

  // ------------------------------------------------------------ メトロノーム

  /** 先読みしながらクリックを並べる（setInterval だけだと揺れるため） */
  private startClicks(ctx: AudioContext, from: number) {
    this.stopClicks();
    this.clickFrom = from;
    this.clickBeat = 0;
    const secondsPerBeat = 60 / this.song.bpm;
    const schedule = () => {
      const until = ctx.currentTime + 0.4;
      while (this.clickFrom + this.clickBeat * secondsPerBeat < until) {
        const at = this.clickFrom + this.clickBeat * secondsPerBeat;
        if (at >= ctx.currentTime) this.click(ctx, at, this.clickBeat % this.song.beatsPerBar === 0);
        this.clickBeat++;
      }
    };
    schedule();
    this.clickTimer = window.setInterval(schedule, 120);
  }

  private stopClicks() {
    if (this.clickTimer) window.clearInterval(this.clickTimer);
    this.clickTimer = 0;
  }

  private click(ctx: AudioContext, at: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1560 : 1040;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.3 : 0.16, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.09);
  }

  private panelSong() {
    const info = section(t('section.songSettings.title'));
    info.append(
      textField({
        label: t('field.title.label'),
        value: this.song.title,
        onChange: (v) => {
          this.song.title = v || t('title.untitled');
          this.changed('');
        },
      }),
      numberField(t('field.tempo.label'), this.song.bpm, 40, 240, (v) => {
        this.song.bpm = v;
        this.changed(t('flash.tempoChanged'));
        this.commitSettings();
      }),
      numberField(t('field.beatsPerBar.label'), this.song.beatsPerBar, 2, 7, (v) => {
        this.song.beatsPerBar = v;
        this.changed(t('flash.timeSigChanged'));
        this.roll.refresh();
      })
    );
    const tools = el('div', 'button-row');
    tools.append(
      button(t('action.semitoneDown'), 'ghost', () => {
        transpose(this.song.notes, -1);
        this.changed('');
        this.roll.refresh();
      }),
      button(t('action.semitoneUp'), 'ghost', () => {
        transpose(this.song.notes, 1);
        this.changed('');
        this.roll.refresh();
      }),
      button(t('action.octaveDown'), 'ghost', () => {
        transpose(this.song.notes, -12);
        this.changed('');
        this.roll.refresh();
      }),
      button(t('action.octaveUp'), 'ghost', () => {
        transpose(this.song.notes, 12);
        this.changed('');
        this.roll.refresh();
      })
    );
    info.append(tools);
    this.panelBody.append(info);

    const lyrics = section(t('section.lyricBulk.title'), t('section.lyricBulk.hint'));
    const area = textArea(
      t('field.lyrics.label'),
      this.song.notes.map((n) => n.lyric).join(''),
      6,
      () => undefined,
      t('lyrics.placeholder')
    );
    this.lyricArea = area;
    lyrics.append(fieldRootOf(area));
    const lyricButtons = el('div', 'button-row');
    lyricButtons.append(
      button(t('action.fillFromStart'), 'primary', () => {
        const applied = applyLyrics(this.song.notes, area.value);
        this.changed(t('flash.lyricsApplied', { n: applied }));
        this.roll.refresh();
      }),
      button(t('action.fillFromSelected'), 'ghost', () => {
        const selected = this.roll.selectedNotes();
        if (selected.length === 0) {
          this.setStatus(t('status.selectNoteFirst'));
          return;
        }
        const sorted = [...this.song.notes].sort((a, b) => a.start - b.start);
        const index = sorted.findIndex((n) => n.id === selected[0].id);
        const applied = applyLyrics(this.song.notes, area.value, Math.max(0, index));
        this.changed(t('flash.lyricsApplied', { n: applied }));
        this.roll.refresh();
      })
    );
    lyrics.append(lyricButtons);
    this.panelBody.append(lyrics);

    const demos = section(t('section.demoSongs.title'), t('section.demoSongs.hint'));
    for (const demo of DEMOS) {
      const row = el('button', 'demo-row');
      row.type = 'button';
      row.append(el('span', 'demo-title', t(`demo.${demo.id}.title`)));
      row.append(el('span', 'demo-sub', t(`demo.${demo.id}.subtitle`)));
      row.addEventListener('click', () => {
        this.pushHistory();
        this.song = normalizeSong(JSON.parse(JSON.stringify(demo.song)) as Song);
        syncNoteIds(this.song.notes);
        this.afterSongReplaced(t('flash.demoLoaded', { title: t(`demo.${demo.id}.title`) }));
      });
      demos.append(row);
    }
    this.panelBody.append(demos);

    const files = section(t('section.files.title'));
    const row = el('div', 'button-row');
    row.append(
      button(t('action.newSong'), 'ghost', () => {
        if (!confirm(t('confirm.discardSong'))) return;
        this.pushHistory();
        this.song = createSong({ notes: [], chords: parseChordText('C\nG\nAm\nF', 4) });
        this.afterSongReplaced(t('flash.newSongCreated'));
      }),
      button(t('action.saveProject'), 'ghost', () => this.saveProject()),
      button(t('action.loadProject'), 'ghost', () => this.openProject())
    );
    files.append(row);
    this.panelBody.append(files);

    const about = section(t('section.about.title'));
    const text = el('p', 'about-text');
    text.textContent = t('about.text');
    about.append(text);
    const links = el('div', 'button-row');
    links.append(button(t('action.privacy'), 'ghost', () => window.open('./privacy.html', '_blank')));
    about.append(links);
    this.panelBody.append(about);
  }

  // -------------------------------------------------------------- 選択の詳細

  private renderInspector() {
    const notes = this.roll.selectedNotes();
    this.inspector.innerHTML = '';
    if (notes.length === 0) {
      this.inspector.classList.add('empty');
      this.inspector.append(
        el('span', 'inspector-hint', t('inspector.hint'))
      );
      return;
    }
    this.inspector.classList.remove('empty');

    const head = el('div', 'inspector-head');
    head.append(
      el(
        'span',
        'inspector-title',
        notes.length === 1
          ? t('inspector.singleNote', { note: midiToNoteName(notes[0].note), lyric: notes[0].lyric })
          : t('inspector.multiSelect', { count: notes.length })
      )
    );
    this.inspector.append(head);

    if (notes.length === 1) {
      const note = notes[0];
      const lyricWrap = el('label', 'inline-field grow');
      lyricWrap.append(el('span', 'inline-label', t('field.lyric.label')));
      const input = el('input', 'text-input');
      input.type = 'text';
      input.value = note.lyric;
      input.addEventListener('change', () => {
        note.lyric = input.value.trim() || note.lyric;
        this.changed(t('flash.lyricChanged'));
        this.roll.refresh();
      });
      lyricWrap.append(input);
      this.inspector.append(lyricWrap);
    }

    const apply = (fn: (n: VocalNote) => void, label: string) => {
      for (const n of notes) fn(n);
      this.save();
      this.setStatus(label);
      this.roll.refresh();
    };

    const velWrap = el('div', 'inline-slider');
    velWrap.append(el('span', 'inline-label', t('inline.velocity')));
    const vel = el('input', 'ctl-range');
    vel.type = 'range';
    vel.min = '0.2';
    vel.max = '1';
    vel.step = '0.01';
    vel.value = String(notes[0].vel);
    vel.addEventListener('input', () => apply((n) => (n.vel = Number(vel.value)), ''));
    vel.addEventListener('change', () => this.changed(''));
    velWrap.append(vel);
    this.inspector.append(velWrap);

    const vibWrap = el('div', 'inline-slider');
    vibWrap.append(el('span', 'inline-label', t('inline.vibrato')));
    const vib = el('input', 'ctl-range');
    vib.type = 'range';
    vib.min = '0';
    vib.max = '1';
    vib.step = '0.01';
    vib.value = String(notes[0].vib < 0 ? 1 : notes[0].vib);
    vib.addEventListener('input', () => apply((n) => (n.vib = Number(vib.value)), ''));
    vib.addEventListener('change', () => this.changed(''));
    vibWrap.append(vib);
    this.inspector.append(vibWrap);

    const breath = el('label', 'inline-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = notes[0].breath;
    box.addEventListener('change', () =>
      apply((n) => (n.breath = box.checked), box.checked ? t('flash.breathOn') : t('flash.breathOff'))
    );
    breath.append(box, el('span', '', t('check.breathHere')));
    this.inspector.append(breath);

    this.inspector.append(
      button(t('action.listenNote'), 'ghost', () => this.audition(notes[0].note, notes[0].lyric))
    );
  }

  // ------------------------------------------------------------------ 書き出し

  private openExportMenu(anchor: HTMLElement) {
    this.closeMenu();
    const menu = el('div', 'menu');
    const items: [string, () => void][] = [
      [t('menu.wavMix'), () => void this.exportWav('mix')],
      [t('menu.wavVocal'), () => void this.exportWav('vocal')],
      [t('menu.wavAccomp'), () => void this.exportWav('accomp')],
      [t('menu.midiLyrics'), () => this.exportMidi()],
      [t('menu.projectJson'), () => this.saveProject()],
    ];
    for (const [label, action] of items) {
      const item = el('button', 'menu-item', label);
      item.type = 'button';
      item.addEventListener('click', () => {
        this.closeMenu();
        action();
      });
      menu.append(item);
    }
    anchor.append(menu);
    this.menu = menu;
    setTimeout(() => {
      const close = (e: MouseEvent) => {
        if (menu.contains(e.target as Node)) return;
        this.closeMenu();
        window.removeEventListener('pointerdown', close);
      };
      window.addEventListener('pointerdown', close);
    }, 0);
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private async exportWav(kind: 'mix' | 'vocal' | 'accomp') {
    if (this.exporting) return;
    if (this.song.notes.length === 0 && this.song.chords.length === 0) {
      this.setStatus(t('status.noExportContent'));
      return;
    }
    this.exporting = true;
    this.setStatus(t('status.exportingWav'));
    try {
      this.stop();
      const compiled = compileSong(this.song);
      const mute = {
        vocal: kind === 'accomp',
        accomp: kind === 'vocal',
      };
      const buffer = await renderSong(compiled, this.song.settings, this.song.bpm, { mute });
      const suffix = kind === 'mix' ? '' : kind === 'vocal' ? '-vocal' : '-inst';
      await this.saveFile(
        encodeWav(buffer),
        `${safeFileName(this.song.title)}${suffix}-${timestampName('', 'wav').slice(1)}`,
        t('status.wavExported')
      );
    } catch (err) {
      this.setStatus(t('status.exportFailed', { err: String(err) }));
    } finally {
      this.exporting = false;
    }
  }

  private async exportMidi() {
    try {
      await this.saveFile(
        encodeMidi(this.song),
        `${safeFileName(this.song.title)}.mid`,
        t('status.midiExported')
      );
    } catch (err) {
      this.setStatus(t('status.exportFailed', { err: String(err) }));
    }
  }

  private async saveProject() {
    try {
      await this.saveFile(
        encodeProject(this.song),
        `${safeFileName(this.song.title)}.hvocal.json`,
        t('status.projectSaved')
      );
    } catch (err) {
      this.setStatus(t('status.exportFailed', { err: String(err) }));
    }
  }

  /**
   * 保存して、済んだことを伝える。
   * 同梱アプリでは端末のどこに置いたかまで出す（web ではブラウザ任せなので出さない）
   */
  private async saveFile(blob: Blob, filename: string, done: string) {
    const outcome = await downloadBlob(blob, filename);
    this.setStatus(outcome.kind === 'file' ? `${done} → ${outcome.path}` : done);
  }


  private openProject() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const song = decodeProject(String(reader.result));
        if (!song) {
          this.setStatus(t('status.invalidProject'));
          return;
        }
        this.pushHistory();
        this.song = normalizeSong(song);
        syncNoteIds(this.song.notes);
        this.afterSongReplaced(t('flash.projectLoaded'));
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ------------------------------------------------------------------ その他

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.toggle();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.roll.selectAll();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.roll.deleteSelection();
        return;
      }
      if (e.key === 'Enter') {
        const selected = this.roll.selectedNotes();
        if (selected.length > 0) {
          e.preventDefault();
          this.roll.openEditor(selected[0]);
        }
        return;
      }
      const step = e.shiftKey ? 12 : 1;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.roll.nudge(0, step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.roll.nudge(0, -step);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.roll.nudge(-(this.roll.snap || 0.25), 0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.roll.nudge(this.roll.snap || 0.25, 0);
      }
    });
  }

  private setStatus(text: string) {
    if (text) this.statusEl.textContent = text;
  }

  private loop() {
    const tick = () => {
      if (this.playing) {
        const beat = this.playFromBeat + (this.engine.elapsed() * this.song.bpm) / 60;
        this.roll.setPlayhead(beat);
        this.updatePosition(beat);
        const total = songBeats(this.song);
        if (beat > total + 4) this.stop();
      }
      const level = this.audioReady ? this.engine.level() : 0;
      this.meterFill.style.width = `${Math.min(100, level * 118)}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private updatePosition(beat: number) {
    const bar = Math.floor(beat / this.song.beatsPerBar) + 1;
    const inBar = Math.floor(beat % this.song.beatsPerBar) + 1;
    this.positionEl.textContent = `${String(bar).padStart(3, '0')} : ${inBar}`;
  }
}
