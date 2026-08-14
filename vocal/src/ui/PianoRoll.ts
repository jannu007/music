/*
 * ピアノロール（歌詞つき）
 *
 * canvas に直接描き、スクロールとズームも自前で持つ。
 * マウス・タッチのどちらでも、音符の追加／移動／長さ変更／歌詞入力ができる。
 */

import { midiToNoteName, snapValue } from '../audio/song';
import type { ChordEvent, Song, VocalNote } from '../audio/types';
import { el } from './controls';

export type RollTool = 'pen' | 'select' | 'erase';

export interface RollCallbacks {
  /** 譜面を書き換えた（履歴と再コンパイルのため） */
  onChange: (label: string) => void;
  onSelect: (ids: number[]) => void;
  /** 音を確かめる */
  onAudition: (note: number, lyric: string) => void;
  /** ルーラーをクリックした */
  onSeek: (beat: number) => void;
}

const GUTTER = 56;
const RULER = 26;
const MIN_NOTE = 36;
const MAX_NOTE = 88;

interface DragState {
  kind: 'move' | 'resize' | 'create' | 'pan' | 'marquee';
  pointerId: number;
  startX: number;
  startY: number;
  startBeat: number;
  startNote: number;
  originals: Map<number, { start: number; length: number; note: number }>;
  scrollBeat: number;
  scrollNote: number;
  moved: boolean;
  targetId: number;
  /** ペンで置いた直後のドラッグ（追加として既に記録済み） */
  created?: boolean;
}

function isBlackKey(note: number): boolean {
  const n = ((note % 12) + 12) % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

export class PianoRoll {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: RollCallbacks;
  private song: Song | null = null;

  selection = new Set<number>();
  tool: RollTool = 'pen';
  snap = 0.25;
  defaultLength = 1;
  defaultLyric = 'ら';

  private pxPerBeat = 64;
  private rowHeight = 15;
  private scrollBeat = 0;
  private scrollNote = 76; // 画面上端のノート番号
  private playhead: number | null = null;
  private drag: DragState | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private pinchPx = 0;
  private editor: HTMLInputElement | null = null;
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** 一度でも自分でスクロール／ズームしたら、自動で位置合わせをしない */
  private userScrolled = false;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, cb: RollCallbacks) {
    this.cb = cb;
    this.root = el('div', 'roll');
    this.canvas = el('canvas', 'roll-canvas');
    this.root.append(this.canvas);
    container.append(this.root);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context を作成できません');
    this.ctx = ctx;

    this.bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.resize();
  }

  // ------------------------------------------------------------------ 外部API

  setSong(song: Song) {
    this.song = song;
    this.selection.clear();
    this.userScrolled = false;
    this.scrollToFirstNote();
    this.draw();
  }

  refresh() {
    this.draw();
  }

  setPlayhead(beat: number | null) {
    this.playhead = beat;
    if (beat !== null) this.followPlayhead(beat);
    this.draw();
  }

  setTool(tool: RollTool) {
    this.tool = tool;
    this.canvas.classList.toggle('tool-erase', tool === 'erase');
  }

  selectedNotes(): VocalNote[] {
    if (!this.song) return [];
    return this.song.notes.filter((n) => this.selection.has(n.id));
  }

  selectAll() {
    if (!this.song) return;
    this.selection = new Set(this.song.notes.map((n) => n.id));
    this.cb.onSelect([...this.selection]);
    this.draw();
  }

  clearSelection() {
    this.selection.clear();
    this.cb.onSelect([]);
    this.draw();
  }

  deleteSelection() {
    if (!this.song || this.selection.size === 0) return;
    this.song.notes = this.song.notes.filter((n) => !this.selection.has(n.id));
    this.selection.clear();
    this.cb.onSelect([]);
    this.cb.onChange('音符を削除');
    this.draw();
  }

  /** 選択した音符を動かす（キーボード操作用） */
  nudge(dBeat: number, dNote: number) {
    const notes = this.selectedNotes();
    if (notes.length === 0) return;
    for (const n of notes) {
      n.start = Math.max(0, n.start + dBeat);
      n.note = Math.max(MIN_NOTE, Math.min(MAX_NOTE, n.note + dNote));
    }
    this.cb.onChange('音符を移動');
    this.draw();
  }

  zoom(factor: number) {
    this.userScrolled = true;
    this.pxPerBeat = Math.max(18, Math.min(220, this.pxPerBeat * factor));
    this.draw();
  }

  zoomVertical(factor: number) {
    this.userScrolled = true;
    this.rowHeight = Math.max(9, Math.min(34, this.rowHeight * factor));
    this.draw();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  // ------------------------------------------------------------------ 座標

  private get viewWidth() {
    return this.canvas.clientWidth;
  }

  private get viewHeight() {
    return this.canvas.clientHeight;
  }

  private get rows() {
    return Math.ceil((this.viewHeight - RULER) / this.rowHeight) + 1;
  }

  private beatToX(beat: number): number {
    return GUTTER + (beat - this.scrollBeat) * this.pxPerBeat;
  }

  private xToBeat(x: number): number {
    return (x - GUTTER) / this.pxPerBeat + this.scrollBeat;
  }

  private noteToY(note: number): number {
    return RULER + (this.scrollNote - note) * this.rowHeight;
  }

  private yToNote(y: number): number {
    return Math.round(this.scrollNote - (y - RULER) / this.rowHeight);
  }

  private clampScroll() {
    this.scrollBeat = Math.max(0, this.scrollBeat);
    const top = MAX_NOTE;
    const bottom = MIN_NOTE + this.rows - 1;
    this.scrollNote = Math.max(Math.min(bottom, top), Math.min(top, this.scrollNote));
  }

  /** 曲の音域が画面に収まるよう、縦位置と行の高さを合わせる */
  private scrollToFirstNote() {
    if (!this.song || this.song.notes.length === 0 || this.viewHeight <= 0) return;
    let hi = -Infinity;
    let lo = Infinity;
    for (const n of this.song.notes) {
      hi = Math.max(hi, n.note);
      lo = Math.min(lo, n.note);
    }
    const needed = hi - lo + 5;
    const usable = this.viewHeight - RULER;
    if (needed * this.rowHeight > usable) {
      this.rowHeight = Math.max(9, Math.min(34, Math.floor(usable / needed)));
    }
    const center = (hi + lo) / 2;
    this.scrollNote = Math.round(center + this.rows / 2 - 1);
    this.scrollBeat = 0;
    this.clampScroll();
  }

  private followPlayhead(beat: number) {
    if (this.viewWidth <= 0) return;
    const x = this.beatToX(beat);
    if (x > this.viewWidth - 120) {
      this.scrollBeat = beat - (this.viewWidth - GUTTER) / this.pxPerBeat * 0.25;
    } else if (x < GUTTER) {
      this.scrollBeat = Math.max(0, beat - 1);
    }
    this.clampScroll();
  }

  // ------------------------------------------------------------------ 入力

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private localPoint(e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private noteAt(x: number, y: number): VocalNote | null {
    if (!this.song || x < GUTTER || y < RULER) return null;
    const note = this.yToNote(y);
    const beat = this.xToBeat(x);
    // 後ろに描かれているものを優先して拾う
    for (let i = this.song.notes.length - 1; i >= 0; i--) {
      const n = this.song.notes[i];
      if (n.note !== note) continue;
      if (beat >= n.start && beat <= n.start + n.length) return n;
    }
    return null;
  }

  private onPointerDown(e: PointerEvent) {
    const { x, y } = this.localPoint(e);
    this.pointers.set(e.pointerId, { x, y });
    this.commitEditor();

    if (this.pointers.size === 2) {
      // 2本指：ピンチでズーム、ドラッグでスクロール
      const pts = [...this.pointers.values()];
      this.pinchStart = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchPx = this.pxPerBeat;
      this.drag = null;
      return;
    }

    this.canvas.setPointerCapture(e.pointerId);

    // ルーラー：再生位置の指定
    if (y < RULER && x >= GUTTER) {
      const beat = Math.max(0, snapValue(this.xToBeat(x), this.snap));
      this.cb.onSeek(beat);
      return;
    }
    // 鍵盤：音の確認
    if (x < GUTTER) {
      if (y >= RULER) {
        const note = this.yToNote(y);
        this.cb.onAudition(note, this.defaultLyric);
      }
      this.drag = {
        kind: 'pan', pointerId: e.pointerId, startX: x, startY: y,
        startBeat: 0, startNote: 0, originals: new Map(),
        scrollBeat: this.scrollBeat, scrollNote: this.scrollNote, moved: false, targetId: -1,
      };
      return;
    }

    const hit = this.noteAt(x, y);
    const beat = this.xToBeat(x);

    if (this.tool === 'erase') {
      if (hit && this.song) {
        this.song.notes = this.song.notes.filter((n) => n.id !== hit.id);
        this.selection.delete(hit.id);
        this.cb.onChange('音符を削除');
        this.draw();
      }
      return;
    }

    if (hit) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!this.selection.has(hit.id)) {
        if (!additive) this.selection.clear();
        this.selection.add(hit.id);
      } else if (additive) {
        this.selection.delete(hit.id);
      }
      this.cb.onSelect([...this.selection]);
      this.cb.onAudition(hit.note, hit.lyric);

      const edgeBeats = Math.min(0.35, 10 / this.pxPerBeat);
      const onEdge = beat > hit.start + hit.length - edgeBeats;
      const originals = new Map<number, { start: number; length: number; note: number }>();
      for (const n of this.selectedNotes()) {
        originals.set(n.id, { start: n.start, length: n.length, note: n.note });
      }
      this.drag = {
        kind: onEdge ? 'resize' : 'move',
        pointerId: e.pointerId,
        startX: x, startY: y,
        startBeat: beat, startNote: this.yToNote(y),
        originals,
        scrollBeat: this.scrollBeat, scrollNote: this.scrollNote,
        moved: false, targetId: hit.id,
      };
      this.draw();
      return;
    }

    // 何もないところ
    if (this.tool === 'pen' && e.button !== 1) {
      const created = this.createNote(snapValue(beat, this.snap), this.yToNote(y));
      if (created) {
        this.selection.clear();
        this.selection.add(created.id);
        this.cb.onSelect([...this.selection]);
        this.cb.onAudition(created.note, created.lyric);
        const originals = new Map([[created.id, { start: created.start, length: created.length, note: created.note }]]);
        this.drag = {
          kind: 'resize', pointerId: e.pointerId, startX: x, startY: y,
          startBeat: created.start + created.length, startNote: created.note,
          originals, scrollBeat: this.scrollBeat, scrollNote: this.scrollNote,
          moved: false, targetId: created.id, created: true,
        };
      }
      return;
    }

    if (e.shiftKey) {
      this.marquee = { x0: x, y0: y, x1: x, y1: y };
      this.drag = {
        kind: 'marquee', pointerId: e.pointerId, startX: x, startY: y,
        startBeat: beat, startNote: this.yToNote(y), originals: new Map(),
        scrollBeat: this.scrollBeat, scrollNote: this.scrollNote, moved: false, targetId: -1,
      };
      return;
    }

    this.selection.clear();
    this.cb.onSelect([]);
    this.drag = {
      kind: 'pan', pointerId: e.pointerId, startX: x, startY: y,
      startBeat: beat, startNote: 0, originals: new Map(),
      scrollBeat: this.scrollBeat, scrollNote: this.scrollNote, moved: false, targetId: -1,
    };
    this.draw();
  }

  private onPointerMove(e: PointerEvent) {
    const { x, y } = this.localPoint(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStart > 8) {
        this.userScrolled = true;
        this.pxPerBeat = Math.max(18, Math.min(220, (this.pinchPx * dist) / this.pinchStart));
        this.draw();
      }
      return;
    }

    // カーソルの形（右端は長さ変更）
    if (!this.drag) {
      const hit = this.noteAt(x, y);
      if (hit) {
        const edgeBeats = Math.min(0.35, 10 / this.pxPerBeat);
        const onEdge = this.xToBeat(x) > hit.start + hit.length - edgeBeats;
        this.canvas.style.cursor = onEdge ? 'ew-resize' : 'grab';
      } else if (y < RULER) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = this.tool === 'pen' ? 'crosshair' : 'default';
      }
      return;
    }

    const d = this.drag;
    if (Math.abs(x - d.startX) > 3 || Math.abs(y - d.startY) > 3) d.moved = true;

    switch (d.kind) {
      case 'pan': {
        this.userScrolled = true;
        this.scrollBeat = d.scrollBeat - (x - d.startX) / this.pxPerBeat;
        this.scrollNote = d.scrollNote + Math.round((y - d.startY) / this.rowHeight);
        this.clampScroll();
        this.draw();
        break;
      }
      case 'marquee': {
        this.marquee = { x0: d.startX, y0: d.startY, x1: x, y1: y };
        this.applyMarquee();
        this.draw();
        break;
      }
      case 'move': {
        const dBeat = snapValue(this.xToBeat(x) - d.startBeat, this.snap);
        const dNote = this.yToNote(y) - d.startNote;
        for (const [id, o] of d.originals) {
          const n = this.findNote(id);
          if (!n) continue;
          n.start = Math.max(0, snapValue(o.start + dBeat, this.snap));
          n.note = Math.max(MIN_NOTE, Math.min(MAX_NOTE, o.note + dNote));
        }
        this.draw();
        break;
      }
      case 'resize': {
        const dBeat = this.xToBeat(x) - d.startBeat;
        for (const [id, o] of d.originals) {
          const n = this.findNote(id);
          if (!n) continue;
          const raw = o.length + dBeat;
          n.length = Math.max(this.snap || 0.125, snapValue(raw, this.snap));
        }
        this.draw();
        break;
      }
      default:
        break;
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    this.marquee = null;
    this.drag = null;
    if (!d) {
      this.draw();
      return;
    }
    // 追加そのものは createNote() の中で記録済みなので、ここでは長さ変更だけを記録する
    if (d.kind === 'move' && d.moved) this.cb.onChange('音符を移動');
    else if (d.kind === 'resize' && d.moved && !d.created) this.cb.onChange('長さを変更');
    else if (d.kind === 'marquee') this.cb.onSelect([...this.selection]);
    this.draw();
  }

  private onDoubleClick(e: MouseEvent) {
    const { x, y } = this.localPoint(e);
    const hit = this.noteAt(x, y);
    if (hit) this.openEditor(hit);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.userScrolled = true;
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const before = this.xToBeat(this.localPoint(e).x);
      this.pxPerBeat = Math.max(18, Math.min(220, this.pxPerBeat * factor));
      const after = this.xToBeat(this.localPoint(e).x);
      this.scrollBeat += before - after;
    } else if (e.shiftKey) {
      this.scrollBeat += e.deltaY / this.pxPerBeat;
    } else {
      this.scrollBeat += e.deltaX / this.pxPerBeat;
      this.scrollNote -= Math.round(e.deltaY / this.rowHeight) || (e.deltaY > 0 ? 1 : -1);
    }
    this.clampScroll();
    this.draw();
  }

  private applyMarquee() {
    if (!this.marquee || !this.song) return;
    const { x0, y0, x1, y1 } = this.marquee;
    const b0 = this.xToBeat(Math.min(x0, x1));
    const b1 = this.xToBeat(Math.max(x0, x1));
    const n0 = this.yToNote(Math.max(y0, y1));
    const n1 = this.yToNote(Math.min(y0, y1));
    this.selection.clear();
    for (const n of this.song.notes) {
      if (n.note >= n0 && n.note <= n1 && n.start + n.length >= b0 && n.start <= b1) {
        this.selection.add(n.id);
      }
    }
  }

  private findNote(id: number): VocalNote | undefined {
    return this.song?.notes.find((n) => n.id === id);
  }

  private createNote(start: number, note: number): VocalNote | null {
    if (!this.song) return null;
    const created: VocalNote = {
      id: Math.max(0, ...this.song.notes.map((n) => n.id)) + 1,
      start: Math.max(0, start),
      length: this.defaultLength,
      note: Math.max(MIN_NOTE, Math.min(MAX_NOTE, note)),
      lyric: this.defaultLyric,
      vel: 0.72,
      vib: -1,
      scoop: -1,
      breath: false,
    };
    this.song.notes.push(created);
    this.song.notes.sort((a, b) => a.start - b.start);
    this.cb.onChange('音符を追加');
    return created;
  }

  // -------------------------------------------------------------- 歌詞の編集

  /** 音符の上に入力欄を重ねて歌詞を打つ */
  openEditor(note: VocalNote) {
    this.commitEditor();
    const input = el('input', 'roll-lyric-input');
    input.type = 'text';
    input.value = note.lyric;
    input.style.left = `${this.beatToX(note.start)}px`;
    input.style.top = `${this.noteToY(note.note)}px`;
    input.style.width = `${Math.max(48, note.length * this.pxPerBeat)}px`;
    input.style.height = `${Math.max(20, this.rowHeight)}px`;
    input.dataset.noteId = String(note.id);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitEditor();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.editor?.remove();
        this.editor = null;
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const next = this.nextNoteAfter(note);
        this.commitEditor();
        if (next) {
          this.selection.clear();
          this.selection.add(next.id);
          this.cb.onSelect([...this.selection]);
          this.openEditor(next);
        }
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => this.commitEditor());
    this.root.append(input);
    this.editor = input;
    input.focus();
    input.select();
  }

  private nextNoteAfter(note: VocalNote): VocalNote | null {
    if (!this.song) return null;
    const sorted = [...this.song.notes].sort((a, b) => a.start - b.start || a.note - b.note);
    const index = sorted.findIndex((n) => n.id === note.id);
    return index >= 0 && index + 1 < sorted.length ? sorted[index + 1] : null;
  }

  private commitEditor() {
    const input = this.editor;
    if (!input) return;
    this.editor = null;
    const id = Number(input.dataset.noteId);
    const note = this.findNote(id);
    const value = input.value.trim();
    input.remove();
    if (note && value && value !== note.lyric) {
      note.lyric = value;
      this.cb.onChange('歌詞を変更');
    }
    this.draw();
  }

  // ------------------------------------------------------------------ 描画

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // レイアウトが落ち着くまで高さが変わるので、自分で動かしていなければ合わせ直す
    if (this.userScrolled) this.clampScroll();
    else this.scrollToFirstNote();
    this.draw();
  }

  private draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  }

  private paint() {
    const ctx = this.ctx;
    const w = this.viewWidth;
    const h = this.viewHeight;
    if (w <= 0 || h <= 0) return;
    const song = this.song;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0e1a';
    ctx.fillRect(0, 0, w, h);

    const beatsPerBar = song?.beatsPerBar ?? 4;
    const firstBeat = this.scrollBeat;
    const lastBeat = this.xToBeat(w);

    // --- 行（鍵盤に対応する横縞） ---
    for (let i = 0; i < this.rows; i++) {
      const note = this.scrollNote - i;
      const y = this.noteToY(note);
      ctx.fillStyle = isBlackKey(note) ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.045)';
      ctx.fillRect(GUTTER, y, w - GUTTER, this.rowHeight);
      if (note % 12 === 0) {
        ctx.fillStyle = 'rgba(126, 200, 255, 0.10)';
        ctx.fillRect(GUTTER, y, w - GUTTER, this.rowHeight);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(GUTTER, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    // --- 縦線（拍・小節） ---
    const sub = this.snap > 0 && this.pxPerBeat * this.snap > 7 ? this.snap : 1;
    const start = Math.floor(firstBeat / sub) * sub;
    for (let b = start; b <= lastBeat; b += sub) {
      const x = Math.round(this.beatToX(b)) + 0.5;
      if (x < GUTTER) continue;
      const isBar = Math.abs(b % beatsPerBar) < 1e-6;
      const isBeat = Math.abs(b % 1) < 1e-6;
      ctx.strokeStyle = isBar
        ? 'rgba(150, 190, 255, 0.34)'
        : isBeat
        ? 'rgba(255,255,255,0.13)'
        : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // --- 音符 ---
    if (song) this.paintNotes(song);

    // --- 選択枠 ---
    if (this.marquee) {
      const { x0, y0, x1, y1 } = this.marquee;
      ctx.fillStyle = 'rgba(126, 200, 255, 0.12)';
      ctx.strokeStyle = 'rgba(126, 200, 255, 0.6)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }

    // --- 再生位置 ---
    if (this.playhead !== null) {
      const x = Math.round(this.beatToX(this.playhead)) + 0.5;
      if (x >= GUTTER) {
        ctx.strokeStyle = '#ff9ecb';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, RULER);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    this.paintKeys();
    this.paintRuler(song?.chords ?? [], beatsPerBar);
  }

  private paintNotes(song: Song) {
    const ctx = this.ctx;
    const w = this.viewWidth;
    const h = this.viewHeight;
    const fontSize = Math.min(13, Math.max(9, this.rowHeight - 3));
    ctx.font = `${fontSize}px 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif`;
    ctx.textBaseline = 'middle';

    for (const n of song.notes) {
      const x = this.beatToX(n.start);
      const width = Math.max(4, n.length * this.pxPerBeat);
      const y = this.noteToY(n.note);
      if (x + width < GUTTER || x > w || y + this.rowHeight < RULER || y > h) continue;

      const selected = this.selection.has(n.id);
      const height = Math.max(6, this.rowHeight - 2);
      const radius = Math.min(5, height / 2);

      const grad = ctx.createLinearGradient(0, y, 0, y + height);
      if (selected) {
        grad.addColorStop(0, '#ffd9ec');
        grad.addColorStop(1, '#ff8fc4');
      } else {
        const v = Math.max(0.25, Math.min(1, n.vel));
        grad.addColorStop(0, `rgba(150, 226, 255, ${0.55 + v * 0.4})`);
        grad.addColorStop(1, `rgba(70, 150, 230, ${0.5 + v * 0.4})`);
      }
      ctx.fillStyle = grad;
      this.roundRect(x, y + 1, width, height, radius);
      ctx.fill();

      ctx.strokeStyle = selected ? '#fff2f8' : 'rgba(10, 18, 34, 0.75)';
      ctx.stroke();

      if (n.breath) {
        ctx.fillStyle = 'rgba(255, 220, 130, 0.9)';
        ctx.fillRect(x - 3, y + 1, 2, height);
      }

      if (width > 14 && height >= 9) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width - 2, height + 2);
        ctx.clip();
        ctx.fillStyle = selected ? '#3a0f24' : '#04121f';
        ctx.fillText(n.lyric, x + 4, y + height / 2 + 1);
        ctx.restore();
      }
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private paintKeys() {
    const ctx = this.ctx;
    const h = this.viewHeight;
    ctx.fillStyle = '#0e1424';
    ctx.fillRect(0, RULER, GUTTER, h - RULER);

    ctx.font = `10px 'Helvetica Neue', sans-serif`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.rows; i++) {
      const note = this.scrollNote - i;
      if (note < MIN_NOTE || note > MAX_NOTE) continue;
      const y = this.noteToY(note);
      const black = isBlackKey(note);
      ctx.fillStyle = black ? '#161d31' : '#e8eef8';
      ctx.fillRect(0, y + 1, GUTTER - 6, this.rowHeight - 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(GUTTER - 6, y + 0.5);
      ctx.stroke();
      if (note % 12 === 0 && this.rowHeight >= 11) {
        ctx.fillStyle = '#5a6480';
        ctx.fillText(midiToNoteName(note), 6, y + this.rowHeight / 2);
      }
    }
    ctx.fillStyle = 'rgba(126, 200, 255, 0.25)';
    ctx.fillRect(GUTTER - 6, RULER, 1, h - RULER);
  }

  private paintRuler(chords: ChordEvent[], beatsPerBar: number) {
    const ctx = this.ctx;
    const w = this.viewWidth;
    ctx.fillStyle = '#101728';
    ctx.fillRect(0, 0, w, RULER);
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, RULER + 0.5);
    ctx.lineTo(w, RULER + 0.5);
    ctx.stroke();

    ctx.font = `10px 'Helvetica Neue', sans-serif`;
    ctx.textBaseline = 'middle';
    const firstBar = Math.floor(this.scrollBeat / beatsPerBar);
    const lastBeat = this.xToBeat(w);
    for (let bar = firstBar; bar * beatsPerBar <= lastBeat; bar++) {
      const x = this.beatToX(bar * beatsPerBar);
      if (x < GUTTER - 20) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, RULER);
      ctx.stroke();
      ctx.fillStyle = '#66739a';
      ctx.fillText(String(bar + 1), x + 4, 8);
    }

    // コードネーム
    ctx.font = `600 11px 'Helvetica Neue', sans-serif`;
    for (const c of chords) {
      const x = this.beatToX(c.start);
      if (x < GUTTER - 40 || x > w) continue;
      ctx.fillStyle = '#9fe0ff';
      ctx.fillText(c.symbol, Math.max(GUTTER + 2, x + 4), RULER - 8);
    }

    ctx.fillStyle = '#101728';
    ctx.fillRect(0, 0, GUTTER, RULER);
    ctx.fillStyle = '#5a6480';
    ctx.font = `10px 'Helvetica Neue', sans-serif`;
    ctx.fillText('小節', 8, RULER / 2);

    if (this.playhead !== null) {
      const x = this.beatToX(this.playhead);
      if (x >= GUTTER) {
        ctx.fillStyle = '#ff9ecb';
        ctx.beginPath();
        ctx.moveTo(x - 5, 2);
        ctx.lineTo(x + 5, 2);
        ctx.lineTo(x, 11);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}
