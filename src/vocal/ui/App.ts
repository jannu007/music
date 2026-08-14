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
import { ROOM_LABEL } from '../audio/reverb';
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

const STORAGE_KEY = 'hoshizora-vocal-v1';
const HISTORY_LIMIT = 80;

type TabId = 'voice' | 'expression' | 'accomp' | 'mix' | 'song';

const SNAP_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1/4' },
  { value: '0.5', label: '1/8' },
  { value: '0.25', label: '1/16' },
  { value: '0.3333333333', label: '3連' },
  { value: '0', label: 'なし' },
];

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

  constructor(root: HTMLElement) {
    this.root = root;
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
    this.afterSongReplaced('元に戻しました');
  }

  private redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(this.snapshot());
    this.song = normalizeSong(JSON.parse(next));
    this.afterSongReplaced('やり直しました');
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
    if (this.audioReady) return;
    if (!this.initPromise) {
      this.initPromise = this.engine
        .init(this.song.settings, this.song.bpm)
        .then(() => {
          this.audioReady = true;
          this.engine.onPosition = () => undefined;
          this.engine.onEnd = () => this.stop();
          this.setStatus('準備ができました');
        })
        .catch((err) => {
          this.initPromise = null;
          this.setStatus(`オーディオを開始できません: ${err}`);
          throw err;
        });
    }
    return this.initPromise;
  }

  private async play(fromBeat = 0) {
    await this.ensureAudio();
    if (this.song.notes.length === 0 && this.song.chords.length === 0) {
      this.setStatus('音符がありません。ピアノロールに書き込んでください');
      return;
    }
    this.engine.updateSettings(this.song.settings, this.song.bpm);
    const compiled = compileSong(this.song, { fromBeat });
    this.playFromBeat = fromBeat;
    this.engine.play(compiled);
    this.playing = true;
    this.playButton.textContent = '■ 停止';
    this.playButton.classList.add('active');
    this.setStatus('再生中');
  }

  private stop() {
    this.engine.stop();
    this.playing = false;
    this.playButton.textContent = '▶ 再生';
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
    this.statusEl = el('span', 'status-text', 'ピアノロールに音符を書いて、再生してみてください');
    status.append(this.statusEl);
    const credit = el('span', 'status-credit', 'サンプル音源なし・完全無料・オフライン動作');
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
    titles.append(el('span', 'brand-sub', '日本語 歌声シンセサイザー'));
    brand.append(mark, titles);

    const transport = el('div', 'transport');
    this.playButton = button('▶ 再生', 'primary', () => this.toggle());
    const rewind = button('⏮', 'icon', () => {
      this.playFromBeat = 0;
      if (this.playing) void this.play(0);
      else this.roll.setPlayhead(0);
    });
    rewind.title = '先頭へ';
    this.positionEl = el('span', 'position', '001 : 1');

    const meter = el('div', 'meter');
    this.meterFill = el('div', 'meter-fill');
    meter.append(this.meterFill);

    transport.append(rewind, this.playButton, this.positionEl, meter);

    const actions = el('div', 'top-actions');
    actions.append(
      button('書き出し', 'ghost', (
      ) => this.openExportMenu(actions))
    );
    actions.append(button('保存', 'ghost', () => this.saveProject()));
    actions.append(button('読込', 'ghost', () => this.openProject()));

    bar.append(brand, transport, actions);
    return bar;
  }

  private buildRollToolbar(): HTMLElement {
    const bar = el('div', 'roll-toolbar');

    const tools: { value: RollTool; label: string; hint: string }[] = [
      { value: 'pen', label: '✏️ ペン', hint: 'クリックで音符を追加' },
      { value: 'select', label: '✋ 選択', hint: 'ドラッグで画面移動・Shiftで範囲選択' },
      { value: 'erase', label: '🧽 消す', hint: 'クリックで音符を削除' },
    ];
    const group = el('div', 'segmented compact');
    const buttons: HTMLButtonElement[] = [];
    for (const t of tools) {
      const btn = el('button', 'seg-btn', t.label);
      btn.type = 'button';
      btn.title = t.hint;
      if (t.value === 'pen') btn.classList.add('active');
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.remove('active');
        btn.classList.add('active');
        this.roll.setTool(t.value);
      });
      buttons.push(btn);
      group.append(btn);
    }
    bar.append(group);

    const snapWrap = el('label', 'inline-field');
    snapWrap.append(el('span', 'inline-label', 'スナップ'));
    const snapSelect = el('select', 'select');
    for (const opt of SNAP_OPTIONS) {
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
    lenWrap.append(el('span', 'inline-label', '長さ'));
    const lenSelect = el('select', 'select');
    for (const [value, label] of [['2', '2拍'], ['1', '1拍'], ['0.5', '8分'], ['0.25', '16分']]) {
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
    bar.append(button('全選択', 'ghost', () => this.roll.selectAll()));
    bar.append(button('削除', 'ghost danger', () => this.roll.deleteSelection()));
    return bar;
  }

  private buildTabs(): HTMLElement {
    const tabs = el('div', 'tabs');
    const items: { id: TabId; label: string }[] = [
      { id: 'voice', label: '声' },
      { id: 'expression', label: '歌い方' },
      { id: 'accomp', label: '伴奏' },
      { id: 'mix', label: 'ミックス' },
      { id: 'song', label: '曲' },
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
    const list = section('ボイス', '声帯と声道の設定一式');
    const grid = el('div', 'voice-grid');
    for (const voice of VOICES) {
      const card = el('button', 'voice-card');
      card.type = 'button';
      if (voice.id === s.voiceId) card.classList.add('active');
      card.append(el('span', 'voice-name', voice.name));
      card.append(el('span', 'voice-desc', voice.description));
      card.append(
        el('span', 'voice-range', `得意音域 ${midiToNoteName(voice.range[0])} 〜 ${midiToNoteName(voice.range[1])}`)
      );
      card.addEventListener('click', () => {
        const defaults = voiceDefaults(voice.id);
        s.voiceId = voice.id;
        s.character = { ...defaults.character };
        s.expression = { ...defaults.expression };
        this.changed('');
        this.commitSettings(`${voice.name} に切り替えました`);
        this.renderPanel();
      });
      grid.append(card);
    }
    list.append(grid);
    this.panelBody.append(list);

    const c = s.character;
    const tone = section('声色の調整', 'プリセットを土台に微調整できます');
    tone.append(
      slider({
        label: '声の高さ感（声道の長さ）', min: 0.85, max: 1.4, step: 0.01, value: c.tract,
        hint: '大きいほど幼く・女性的に、小さいほど太く・男性的になります',
        format: (v) => v.toFixed(2),
        onInput: (v) => { c.tract = v; this.commitSettings(); },
      }),
      slider({
        label: '明るさ', min: -1, max: 1, step: 0.01, value: c.brightness,
        format: (v) => v.toFixed(2),
        onInput: (v) => { c.brightness = v; this.commitSettings(); },
      }),
      slider({
        label: '息（ブレス感）', min: 0, max: 1, step: 0.01, value: c.breath,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.breath = v; this.commitSettings(); },
      }),
      slider({
        label: '声の張り', min: 0, max: 1, step: 0.01, value: c.tension,
        hint: '強いほど前に出る硬い声、弱いほど柔らかい声',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.tension = v; this.commitSettings(); },
      }),
      slider({
        label: '鼻にかかる量', min: 0, max: 1, step: 0.01, value: c.nasality,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.nasality = v; this.commitSettings(); },
      }),
      slider({
        label: '声の太さ', min: 0, max: 1, step: 0.01, value: c.body,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.body = v; this.commitSettings(); },
      }),
      slider({
        label: 'エッジ（うなり）', min: 0, max: 1, step: 0.01, value: c.growl,
        hint: 'ロック系のかすれ・パワー感',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { c.growl = v; this.commitSettings(); },
      }),
      slider({
        label: '基準ピッチ A4', min: 415, max: 466, step: 1, value: s.a4,
        format: (v) => `${v} Hz`,
        onInput: (v) => { s.a4 = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(tone);
  }

  private panelExpression() {
    const e = this.song.settings.expression;
    const vib = section('ビブラート');
    vib.append(
      slider({
        label: '深さ', min: 0, max: 90, step: 1, value: e.vibDepth,
        format: (v) => `${Math.round(v)} セント`,
        onInput: (v) => { e.vibDepth = v; this.commitSettings(); },
      }),
      slider({
        label: '速さ', min: 3.5, max: 8, step: 0.1, value: e.vibRate,
        format: (v) => `${v.toFixed(1)} Hz`,
        onInput: (v) => { e.vibRate = v; this.commitSettings(); },
      }),
      slider({
        label: 'かかり始め', min: 0, max: 0.9, step: 0.01, value: e.vibDelay,
        hint: '音符の長さに対する位置。遅いほど「まっすぐ伸ばしてから揺れる」',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.vibDelay = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(vib);

    const legato = section('音のつなぎ');
    legato.append(
      slider({
        label: 'ポルタメント', min: 0, max: 250, step: 5, value: e.portamento,
        hint: '次の音へ音程が滑る時間',
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.portamento = v; this.commitSettings(); },
      }),
      slider({
        label: 'しゃくり', min: 0, max: 1, step: 0.01, value: e.scoop,
        hint: 'フレーズ頭を下からすくい上げる量',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.scoop = v; this.commitSettings(); },
      }),
      slider({
        label: '子音の長さ', min: 0.5, max: 1.8, step: 0.01, value: e.consonant,
        hint: '長いほど言葉がはっきりする',
        format: (v) => `${v.toFixed(2)} 倍`,
        onInput: (v) => { e.consonant = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(legato);

    const dyn = section('強弱と息');
    dyn.append(
      slider({
        label: '抑揚', min: 0, max: 1, step: 0.01, value: e.dynamics,
        hint: '音符ごとの強さ（ベロシティ）の効き',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.dynamics = v; this.commitSettings(); },
      }),
      slider({
        label: '立ち上がり', min: 5, max: 120, step: 1, value: e.attack,
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.attack = v; this.commitSettings(); },
      }),
      slider({
        label: '語尾の消え方', min: 20, max: 400, step: 5, value: e.release,
        format: (v) => `${Math.round(v)} ms`,
        onInput: (v) => { e.release = v; this.commitSettings(); },
      }),
      slider({
        label: 'ブレス（息継ぎ音）', min: 0, max: 1, step: 0.01, value: e.breathNoise,
        hint: 'フレーズの前に入る息の音',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.breathNoise = v; this.commitSettings(); },
      }),
      slider({
        label: 'ゆらぎ', min: 0, max: 1, step: 0.01, value: e.drift,
        hint: '人の声らしい微妙なピッチの揺れ',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { e.drift = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(dyn);
  }

  private panelAccomp() {
    const styles: { value: AccompStyle; label: string }[] = [
      { value: 'off', label: 'なし' },
      { value: 'ballad', label: 'バラード' },
      { value: 'pop', label: 'ポップ' },
      { value: 'arpeggio', label: 'アルペジオ' },
      { value: 'pad', label: 'パッド' },
      { value: 'band', label: 'バンド' },
    ];
    const s = section('伴奏スタイル', 'コード進行から自動で伴奏を作ります');
    s.append(
      segmented('', styles, this.song.style, (v) => {
        this.song.style = v;
        this.changed('伴奏を変更');
      })
    );
    s.append(
      slider({
        label: '伴奏の音量', min: 0, max: 1, step: 0.01, value: this.song.settings.mix.accompLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { this.song.settings.mix.accompLevel = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(s);

    const chordSection = section('コード進行', '1行 = 1小節。1行に複数書くと小節を分割します');
    const area = textArea(
      'コード',
      chordsToText(this.song.chords, this.song.beatsPerBar),
      10,
      (v) => {
        this.song.chords = parseChordText(v, this.song.beatsPerBar);
        this.changed('コードを変更');
        this.roll.refresh();
      },
      '例）C / Am7 / F G / G7sus4 / F#m7b5 / C/E'
    );
    this.chordArea = area;
    chordSection.append(fieldRootOf(area));
    this.panelBody.append(chordSection);
  }

  private panelMix() {
    const m = this.song.settings.mix;
    const balance = section('バランス');
    balance.append(
      slider({
        label: 'マスター音量', min: 0, max: 1, step: 0.01, value: m.volume,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.volume = v; this.commitSettings(); },
      }),
      slider({
        label: 'ボーカル', min: 0, max: 1, step: 0.01, value: m.vocalLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.vocalLevel = v; this.commitSettings(); },
      }),
      slider({
        label: '伴奏', min: 0, max: 1, step: 0.01, value: m.accompLevel,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.accompLevel = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(balance);

    const tone = section('音作り');
    tone.append(
      slider({
        label: 'トーン（明るさ）', min: -1, max: 1, step: 0.01, value: m.tone,
        format: (v) => v.toFixed(2),
        onInput: (v) => { m.tone = v; this.commitSettings(); },
      }),
      slider({
        label: '低域の整理', min: 0, max: 1, step: 0.01, value: m.lowCut,
        hint: 'こもりを取ってボーカルを前に出します',
        format: (v) => `${Math.round(70 + v * 90)} Hz`,
        onInput: (v) => { m.lowCut = v; this.commitSettings(); },
      }),
      slider({
        label: 'コンプレッサー', min: 0, max: 1, step: 0.01, value: m.comp,
        hint: '音量のばらつきをそろえます',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.comp = v; this.commitSettings(); },
      })
    );
    this.panelBody.append(tone);

    const space = section('空間');
    space.append(
      slider({
        label: 'ダブラー（厚み）', min: 0, max: 1, step: 0.01, value: m.doubler,
        hint: '少しずらした声を左右に重ねます',
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.doubler = v; this.commitSettings(); },
      }),
      slider({
        label: '広がり', min: 0, max: 1, step: 0.01, value: m.width,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.width = v; this.commitSettings(); },
      }),
      segmented<ReverbType>(
        'リバーブ',
        (['off', 'room', 'plate', 'hall', 'church'] as ReverbType[]).map((v) => ({
          value: v,
          label: ROOM_LABEL[v],
        })),
        m.reverbType,
        (v) => { m.reverbType = v; this.commitSettings(); }
      ),
      slider({
        label: 'リバーブ量', min: 0, max: 1, step: 0.01, value: m.reverbMix,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.reverbMix = v; this.commitSettings(); },
      }),
      slider({
        label: 'ディレイ量', min: 0, max: 1, step: 0.01, value: m.delayMix,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => { m.delayMix = v; this.commitSettings(); },
      }),
      segmented(
        'ディレイの間隔',
        [
          { value: '0.25', label: '16分' },
          { value: '0.5', label: '8分' },
          { value: '0.75', label: '付点8分' },
          { value: '1', label: '4分' },
        ],
        String(m.delayBeats),
        (v) => { m.delayBeats = Number(v); this.commitSettings(); }
      )
    );
    this.panelBody.append(space);

    const reset = section('初期化');
    reset.append(
      button('ミックスを既定値に戻す', 'ghost', () => {
        this.song.settings.mix = { ...DEFAULT_MIX };
        this.changed('');
        this.commitSettings('ミックスを戻しました');
        this.renderPanel();
      })
    );
    this.panelBody.append(reset);
  }

  private panelSong() {
    const info = section('曲の設定');
    info.append(
      textField({
        label: '曲名',
        value: this.song.title,
        onChange: (v) => {
          this.song.title = v || '無題';
          this.changed('');
        },
      }),
      numberField('テンポ（BPM）', this.song.bpm, 40, 240, (v) => {
        this.song.bpm = v;
        this.changed('テンポを変更');
        this.commitSettings();
      }),
      numberField('1小節の拍数', this.song.beatsPerBar, 2, 7, (v) => {
        this.song.beatsPerBar = v;
        this.changed('拍子を変更');
        this.roll.refresh();
      })
    );
    const tools = el('div', 'button-row');
    tools.append(
      button('半音下げ', 'ghost', () => {
        transpose(this.song.notes, -1);
        this.changed('');
        this.roll.refresh();
      }),
      button('半音上げ', 'ghost', () => {
        transpose(this.song.notes, 1);
        this.changed('');
        this.roll.refresh();
      }),
      button('1オクターブ下', 'ghost', () => {
        transpose(this.song.notes, -12);
        this.changed('');
        this.roll.refresh();
      }),
      button('1オクターブ上', 'ghost', () => {
        transpose(this.song.notes, 12);
        this.changed('');
        this.roll.refresh();
      })
    );
    info.append(tools);
    this.panelBody.append(info);

    const lyrics = section('歌詞のまとめ入力', 'ひらがな・カタカナ・ローマ字で書くと、先頭の音符から順に割り当てます');
    const area = textArea(
      '歌詞',
      this.song.notes.map((n) => n.lyric).join(''),
      6,
      () => undefined,
      '例）よぞらに ひかる ほしのこえ（空白は息継ぎの位置になります）'
    );
    this.lyricArea = area;
    lyrics.append(fieldRootOf(area));
    const lyricButtons = el('div', 'button-row');
    lyricButtons.append(
      button('先頭から流し込む', 'primary', () => {
        const applied = applyLyrics(this.song.notes, area.value);
        this.changed(`${applied} 音符に歌詞を入れました`);
        this.roll.refresh();
      }),
      button('選択した音符から', 'ghost', () => {
        const selected = this.roll.selectedNotes();
        if (selected.length === 0) {
          this.setStatus('先に音符を選んでください');
          return;
        }
        const sorted = [...this.song.notes].sort((a, b) => a.start - b.start);
        const index = sorted.findIndex((n) => n.id === selected[0].id);
        const applied = applyLyrics(this.song.notes, area.value, Math.max(0, index));
        this.changed(`${applied} 音符に歌詞を入れました`);
        this.roll.refresh();
      })
    );
    lyrics.append(lyricButtons);
    this.panelBody.append(lyrics);

    const demos = section('デモ曲', 'すべてこのアプリのための書き下ろし（オリジナル）です');
    for (const demo of DEMOS) {
      const row = el('button', 'demo-row');
      row.type = 'button';
      row.append(el('span', 'demo-title', demo.title));
      row.append(el('span', 'demo-sub', demo.subtitle));
      row.addEventListener('click', () => {
        this.pushHistory();
        this.song = normalizeSong(JSON.parse(JSON.stringify(demo.song)) as Song);
        syncNoteIds(this.song.notes);
        this.afterSongReplaced(`${demo.title} を読み込みました`);
      });
      demos.append(row);
    }
    this.panelBody.append(demos);

    const files = section('ファイル');
    const row = el('div', 'button-row');
    row.append(
      button('新しい曲', 'ghost', () => {
        if (!confirm('編集中の曲を破棄して新しい曲を作りますか？')) return;
        this.pushHistory();
        this.song = createSong({ notes: [], chords: parseChordText('C\nG\nAm\nF', 4) });
        this.afterSongReplaced('新しい曲を作りました');
      }),
      button('プロジェクトを保存', 'ghost', () => this.saveProject()),
      button('プロジェクトを読込', 'ghost', () => this.openProject())
    );
    files.append(row);
    this.panelBody.append(files);

    const about = section('このアプリについて');
    const text = el('p', 'about-text');
    text.textContent =
      '音声はすべてその場で計算して作っています（録音素材・外部ライブラリ・課金・広告はありません）。' +
      '書き出した音源は自由に配信・販売に使えます。';
    about.append(text);
    const links = el('div', 'button-row');
    links.append(button('プライバシー', 'ghost', () => window.open('./privacy.html', '_blank')));
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
        el('span', 'inspector-hint', 'ペンで音符を追加 → ダブルクリック（またはEnter）で歌詞を入力できます')
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
          ? `${midiToNoteName(notes[0].note)} ・ ${notes[0].lyric}`
          : `${notes.length} 音を選択中`
      )
    );
    this.inspector.append(head);

    if (notes.length === 1) {
      const note = notes[0];
      const lyricWrap = el('label', 'inline-field grow');
      lyricWrap.append(el('span', 'inline-label', '歌詞'));
      const input = el('input', 'text-input');
      input.type = 'text';
      input.value = note.lyric;
      input.addEventListener('change', () => {
        note.lyric = input.value.trim() || note.lyric;
        this.changed('歌詞を変更');
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
    velWrap.append(el('span', 'inline-label', '強さ'));
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
    vibWrap.append(el('span', 'inline-label', 'ビブラート'));
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
      apply((n) => (n.breath = box.checked), box.checked ? 'ブレスを入れました' : 'ブレスを外しました')
    );
    breath.append(box, el('span', '', 'ここでブレス'));
    this.inspector.append(breath);

    this.inspector.append(
      button('この音を聴く', 'ghost', () => this.audition(notes[0].note, notes[0].lyric))
    );
  }

  // ------------------------------------------------------------------ 書き出し

  private openExportMenu(anchor: HTMLElement) {
    this.closeMenu();
    const menu = el('div', 'menu');
    const items: [string, () => void][] = [
      ['WAV（ミックス）', () => void this.exportWav('mix')],
      ['WAV（ボーカルのみ）', () => void this.exportWav('vocal')],
      ['WAV（伴奏のみ）', () => void this.exportWav('accomp')],
      ['MIDI（歌詞つき）', () => this.exportMidi()],
      ['プロジェクト（JSON）', () => this.saveProject()],
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
      this.setStatus('書き出す内容がありません');
      return;
    }
    this.exporting = true;
    this.setStatus('WAV を書き出しています…');
    try {
      this.stop();
      const compiled = compileSong(this.song);
      const mute = {
        vocal: kind === 'accomp',
        accomp: kind === 'vocal',
      };
      const buffer = await renderSong(compiled, this.song.settings, this.song.bpm, { mute });
      const suffix = kind === 'mix' ? '' : kind === 'vocal' ? '-vocal' : '-inst';
      downloadBlob(
        encodeWav(buffer),
        `${safeFileName(this.song.title)}${suffix}-${timestampName('', 'wav').slice(1)}`
      );
      this.setStatus('WAV を書き出しました');
    } catch (err) {
      this.setStatus(`書き出しに失敗しました: ${err}`);
    } finally {
      this.exporting = false;
    }
  }

  private exportMidi() {
    downloadBlob(encodeMidi(this.song), `${safeFileName(this.song.title)}.mid`);
    this.setStatus('MIDI を書き出しました');
  }

  private saveProject() {
    downloadBlob(encodeProject(this.song), `${safeFileName(this.song.title)}.hvocal.json`);
    this.setStatus('プロジェクトを保存しました');
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
          this.setStatus('読み込めるプロジェクトではありませんでした');
          return;
        }
        this.pushHistory();
        this.song = normalizeSong(song);
        syncNoteIds(this.song.notes);
        this.afterSongReplaced('プロジェクトを読み込みました');
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
