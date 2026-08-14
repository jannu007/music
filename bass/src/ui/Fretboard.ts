import { HARMONIC_FRETS, pitchClass } from '../audio/fretboard';

export type LabelMode = 'off' | 'root' | 'all';

export interface FretboardCallbacks {
  /** 弦を弾く */
  onPluck: (str: number, fret: number, velocity: number) => void;
  /** 弾き直さずに音程を変える（スライド） */
  onSlide: (str: number, fret: number) => void;
  /** チョーキング（cent 単位） */
  onBend: (str: number, cents: number) => void;
  /** 指を離す */
  onRelease: (str: number, fret: number) => void;
}

interface Touch {
  str: number;
  fret: number;
  startX: number;
  startY: number;
  bendCents: number;
}

/** 指板に付く位置マーク（ベースは12フレットが2つ） */
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const HARMONIC_SET = new Set(HARMONIC_FRETS.map((h) => h.fret));

/** 半音あたりのチョーキング幅（px） */
const BEND_PIXELS = 46;

/** 弦1本あたりの高さの上限（px）。これ以上広げると実機と比率が違いすぎて楽器に見えない */
const MAX_LANE = 92;

/**
 * キャンバスで描くベースの指板。
 *  - タップ / クリックで弦を弾く（マルチタッチ対応）
 *  - 横方向のドラッグでスライド
 *  - 縦方向のドラッグでチョーキング
 *  - 弾いた弦は実際に振動して見える
 */
export class Fretboard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private cb: FretboardCallbacks;

  private tuning: number[] = [28, 33, 38, 43];
  private startFret = 0;
  private fretCount = 12;
  private labelMode: LabelMode = 'all';
  private rootPitch = -1;
  private fretless = false;
  private showHarmonics = true;

  private pointers = new Map<number, Touch>();
  private amp: Float32Array;
  private phase: Float32Array;
  private decay: Float32Array;
  private flash: Float32Array;
  private flashFret: Int16Array;
  private held: Int16Array;

  private dpr = 1;
  private raf = 0;
  private lastTime = 0;
  private level = 0;

  constructor(canvas: HTMLCanvasElement, cb: FretboardCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;

    const max = 6;
    this.amp = new Float32Array(max);
    this.phase = new Float32Array(max);
    this.decay = new Float32Array(max).fill(1);
    this.flash = new Float32Array(max);
    this.flashFret = new Int16Array(max).fill(-1);
    this.held = new Int16Array(max).fill(-1);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindPointer();
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ config

  setTuning(tuning: number[]) {
    this.tuning = [...tuning];
  }

  setRange(startFret: number, fretCount: number) {
    this.startFret = Math.max(0, Math.min(19, Math.round(startFret)));
    this.fretCount = Math.max(4, Math.min(24, Math.round(fretCount)));
  }

  getRange(): [number, number] {
    return [this.startFret, this.fretCount];
  }

  setLabels(mode: LabelMode) {
    this.labelMode = mode;
  }

  /** ルート音（キー）を指定するとその音がハイライトされる。-1 で解除 */
  setRoot(pitch: number) {
    this.rootPitch = pitch;
  }

  setFretless(on: boolean) {
    this.fretless = on;
  }

  setShowHarmonics(on: boolean) {
    this.showHarmonics = on;
  }

  setLevel(v: number) {
    this.level = v;
  }

  get stringCount() {
    return this.tuning.length;
  }

  // ------------------------------------------------------------------ motion

  /** 外部（デモ再生・MIDI・PCキー）からの表示 */
  showPluck(str: number, fret: number, velocity: number) {
    if (str < 0 || str >= this.amp.length) return;
    this.amp[str] = Math.min(1, 0.35 + velocity * 0.8);
    this.decay[str] = 1.6 + 1.8 * (1 - str / Math.max(1, this.stringCount));
    this.flash[str] = 1;
    this.flashFret[str] = fret;
    this.held[str] = fret;
  }

  showMute(str: number) {
    if (str < 0 || str >= this.amp.length) return;
    this.decay[str] = 0.09;
    this.held[str] = -1;
  }

  showSlide(str: number, fret: number) {
    if (str < 0 || str >= this.amp.length) return;
    this.held[str] = fret;
    this.flashFret[str] = fret;
    this.flash[str] = Math.max(this.flash[str], 0.6);
  }

  allOff() {
    for (let i = 0; i < this.amp.length; i++) {
      this.decay[i] = 0.07;
      this.held[i] = -1;
    }
    this.pointers.clear();
  }

  start() {
    if (this.raf) return;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private update(dt: number) {
    for (let i = 0; i < this.amp.length; i++) {
      if (this.amp[i] > 0.0005) {
        this.amp[i] *= Math.exp(-dt / this.decay[i]);
        // 低い弦ほどゆっくり揺れて見える
        this.phase[i] += dt * (7 + i * 2.6) * Math.PI * 2;
      } else {
        this.amp[i] = 0;
      }
      if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 2.4);
    }
  }

  // ---------------------------------------------------------------- geometry

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  /** ナット（0フレット）の幅を含む、各フレットの左端 x 座標（0..1） */
  private fretEdges(): number[] {
    const n = this.fretCount;
    const start = this.startFret;
    // 実物のフレット間隔（対数）と等間隔を混ぜる。
    // 完全な対数だと高音側が狭すぎてタップしづらいため。
    const widths: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = start + i;
      const real = Math.pow(2, -f / 12) - Math.pow(2, -(f + 1) / 12);
      widths.push(real);
    }
    const realSum = widths.reduce((a, b) => a + b, 0);
    const mix = 0.55;
    const norm = widths.map((w) => (w / realSum) * mix + (1 / n) * (1 - mix));

    const edges = [0];
    let acc = 0;
    for (const w of norm) {
      acc += w;
      edges.push(acc);
    }
    return edges;
  }

  /** 開放弦（ナットより左）の帯の幅（0..1） */
  private get openWidth(): number {
    return this.startFret === 0 ? 0.085 : 0.045;
  }

  private layout() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const open = this.openWidth * w;
    const boardX = open;
    const boardW = w - open;
    // 弦の間隔には上限を設ける。画面が縦に大きくても、ネックは実機に近い比率で描く。
    const lane = Math.min(h / this.stringCount, MAX_LANE * this.dpr);
    const boardH = lane * this.stringCount;
    const boardTop = (h - boardH) / 2;
    return { w, h, open, boardX, boardW, boardTop, boardH, lane };
  }

  /** 弦の中心の y 座標（いちばん下が最も低い弦） */
  private stringY(str: number): number {
    const { boardTop, boardH, lane } = this.layout();
    return boardTop + boardH - (str + 0.5) * lane;
  }

  /** 画面座標 → 弦とフレット */
  private hit(clientX: number, clientY: number): { str: number; fret: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (clientY - rect.top) * (this.canvas.height / rect.height);
    const { h, open, boardX, boardW, boardTop, boardH, lane } = this.layout();
    if (y < 0 || y > h) return null;

    // ネックの外側をタップしても、いちばん近い弦を鳴らす（端が押しにくくならないように）
    const local = Math.max(0, Math.min(boardH - 1, y - boardTop));
    const row = Math.floor(local / lane);
    // いちばん下が最も低い弦（TAB譜と同じ並び）
    const str = this.stringCount - 1 - Math.max(0, Math.min(this.stringCount - 1, row));

    if (this.startFret === 0 && x < open) return { str, fret: 0 };
    if (x < boardX) return { str, fret: this.startFret };

    const edges = this.fretEdges();
    const u = (x - boardX) / boardW;
    for (let i = 0; i < edges.length - 1; i++) {
      if (u >= edges[i] && u < edges[i + 1]) return { str, fret: this.startFret + i + (this.startFret === 0 ? 1 : 0) };
    }
    return { str, fret: this.startFret + this.fretCount - 1 + (this.startFret === 0 ? 1 : 0) };
  }

  // ------------------------------------------------------------------- input

  private bindPointer() {
    const el = this.canvas;

    el.addEventListener('pointerdown', (e) => {
      const hit = this.hit(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);

      // 対応している機器では筆圧を強弱に使う
      let velocity = 1;
      if (e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5) {
        velocity = 0.45 + Math.min(1, e.pressure) * 0.75;
      }
      this.pointers.set(e.pointerId, {
        str: hit.str,
        fret: hit.fret,
        startX: e.clientX,
        startY: e.clientY,
        bendCents: 0,
      });
      this.cb.onPluck(hit.str, hit.fret, velocity);
    });

    el.addEventListener('pointermove', (e) => {
      const touch = this.pointers.get(e.pointerId);
      if (!touch) return;
      e.preventDefault();

      // 上下のドラッグ＝チョーキング（上に引くほど音が上がる）
      const dy = touch.startY - e.clientY;
      const cents = Math.max(0, Math.min(400, (dy / BEND_PIXELS) * 100));
      if (Math.abs(cents - touch.bendCents) > 3) {
        touch.bendCents = cents;
        this.cb.onBend(touch.str, cents);
      }

      // 左右のドラッグ＝スライド（同じ弦の上だけ）
      const hit = this.hit(e.clientX, e.clientY);
      if (hit && hit.fret !== touch.fret && Math.abs(e.clientX - touch.startX) > 6) {
        touch.fret = hit.fret;
        touch.startY = e.clientY;
        touch.bendCents = 0;
        this.cb.onSlide(touch.str, hit.fret);
      }
    });

    const end = (e: PointerEvent) => {
      const touch = this.pointers.get(e.pointerId);
      if (!touch) return;
      this.pointers.delete(e.pointerId);
      if (touch.bendCents > 3) this.cb.onBend(touch.str, 0);
      this.cb.onRelease(touch.str, touch.fret);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => {
      for (const [id, touch] of [...this.pointers]) {
        this.pointers.delete(id);
        this.cb.onRelease(touch.str, touch.fret);
      }
    });
  }

  // -------------------------------------------------------------------- draw

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h, open, boardX, boardW, boardTop, boardH, lane } = this.layout();
    const s = this.dpr;
    const bottom = boardTop + boardH;
    const edges = this.fretEdges();
    const firstFret = this.startFret === 0 ? 1 : this.startFret;
    const centerX = (i: number) => boardX + ((edges[i] + edges[i + 1]) / 2) * boardW;

    ctx.clearRect(0, 0, w, h);

    // --- ネックの影（浮かせて見せる）---
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 18 * s;
    ctx.shadowOffsetY = 5 * s;
    ctx.fillStyle = '#1a120c';
    ctx.fillRect(0, boardTop, w, boardH);
    ctx.restore();

    // --- 指板（ローズウッド／メイプル）---
    const wood = ctx.createLinearGradient(0, boardTop, 0, bottom);
    if (this.fretless) {
      wood.addColorStop(0, '#6b4f30');
      wood.addColorStop(0.5, '#8a6942');
      wood.addColorStop(1, '#4e3821');
    } else {
      wood.addColorStop(0, '#31211a');
      wood.addColorStop(0.45, '#4a3223');
      wood.addColorStop(1, '#261811');
    }
    ctx.fillStyle = wood;
    ctx.fillRect(boardX, boardTop, boardW, boardH);

    // 木目
    ctx.save();
    ctx.beginPath();
    ctx.rect(boardX, boardTop, boardW, boardH);
    ctx.clip();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = this.fretless ? '#d8b483' : '#c08b52';
    ctx.lineWidth = 1 * s;
    for (let y = boardTop; y < bottom; y += 7 * s) {
      ctx.beginPath();
      ctx.moveTo(boardX, y + Math.sin(y * 0.05) * 2 * s);
      ctx.lineTo(w, y + Math.sin(y * 0.05 + 2.1) * 3 * s);
      ctx.stroke();
    }
    ctx.restore();

    // --- ナットと開放弦の帯 ---
    const nut = ctx.createLinearGradient(0, boardTop, 0, bottom);
    nut.addColorStop(0, '#232a33');
    nut.addColorStop(1, '#141920');
    ctx.fillStyle = nut;
    ctx.fillRect(0, boardTop, open, boardH);
    if (this.startFret === 0) {
      const bone = ctx.createLinearGradient(open - 6 * s, 0, open, 0);
      bone.addColorStop(0, '#cfc7b4');
      bone.addColorStop(1, '#f2ece0');
      ctx.fillStyle = bone;
      ctx.fillRect(open - 6 * s, boardTop, 6 * s, boardH);
    }

    // --- ポジションマーク ---
    ctx.fillStyle = 'rgba(232, 222, 200, 0.55)';
    for (let i = 0; i < this.fretCount; i++) {
      const fret = firstFret + i;
      if (!INLAYS.includes(fret)) continue;
      const cx = centerX(i);
      const r = Math.min(lane * 0.22, 9 * s);
      if (fret % 12 === 0) {
        ctx.beginPath();
        ctx.arc(cx, boardTop + boardH * 0.26, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, boardTop + boardH * 0.74, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, boardTop + boardH * 0.5, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- フレット（フレットレスは線だけ）---
    for (let i = 1; i < edges.length; i++) {
      const x = boardX + edges[i] * boardW;
      if (this.fretless) {
        ctx.strokeStyle = 'rgba(60, 42, 26, 0.5)';
        ctx.lineWidth = 1.4 * s;
      } else {
        const metal = ctx.createLinearGradient(x - 2 * s, 0, x + 2 * s, 0);
        metal.addColorStop(0, '#5f646b');
        metal.addColorStop(0.4, '#e6eaee');
        metal.addColorStop(1, '#6b7076');
        ctx.strokeStyle = metal;
        ctx.lineWidth = 3 * s;
      }
      ctx.beginPath();
      ctx.moveTo(x, boardTop);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    // --- 音名 ---
    const labelSize = Math.round(Math.min(lane * 0.32, 14 * s));
    ctx.font = `${labelSize}px 'Helvetica Neue', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let str = 0; str < this.stringCount; str++) {
      const y = this.stringY(str);

      // 開放弦の名前はナットの左に常に出す（どの弦がどの音かの目印）
      if (this.startFret === 0) {
        const openNote = this.tuning[str];
        const isRoot = this.rootPitch >= 0 && (((openNote - this.rootPitch) % 12) + 12) % 12 === 0;
        ctx.fillStyle = isRoot ? 'rgba(240, 161, 60, 0.95)' : 'rgba(228, 222, 208, 0.72)';
        ctx.font = `600 ${labelSize}px 'Helvetica Neue', sans-serif`;
        ctx.fillText(pitchClass(openNote), open * 0.45, y);
        ctx.font = `${labelSize}px 'Helvetica Neue', sans-serif`;
      }

      if (this.labelMode === 'off') continue;
      for (let i = 0; i < this.fretCount; i++) {
        const note = this.tuning[str] + firstFret + i;
        const isRoot = this.rootPitch >= 0 && (((note - this.rootPitch) % 12) + 12) % 12 === 0;
        if (this.labelMode === 'root' && !isRoot) continue;
        const cx = centerX(i);
        if (isRoot) {
          ctx.fillStyle = 'rgba(240, 161, 60, 0.92)';
          ctx.beginPath();
          ctx.arc(cx, y, Math.min(lane * 0.28, 14 * s), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1a1207';
        } else {
          ctx.fillStyle = 'rgba(236, 229, 214, 0.4)';
        }
        ctx.fillText(pitchClass(note), cx, y);
      }
    }

    // --- 弦 ---
    for (let str = 0; str < this.stringCount; str++) {
      const y = this.stringY(str);
      const thickness = (1.1 + (this.stringCount - 1 - str) * 0.85) * s;
      const amp = this.amp[str];

      // 押さえたフレットより右（ブリッジ側）だけが振動する
      const heldFret = this.held[str];
      let nodeX = 0;
      if (heldFret > 0) {
        const idx = heldFret - firstFret;
        if (idx >= 0 && idx < this.fretCount) nodeX = boardX + edges[idx + 1] * boardW;
        else if (heldFret >= firstFret + this.fretCount) nodeX = w;
      } else if (heldFret === 0 && this.startFret === 0) {
        nodeX = open;
      }

      if (amp > 0.01) {
        const swing = amp * Math.min(lane * 0.4, 15 * s);
        ctx.strokeStyle = `rgba(232, 224, 202, ${0.6 + amp * 0.4})`;
        ctx.lineWidth = thickness + amp * 1.2 * s;
        ctx.shadowColor = 'rgba(240, 161, 60, 0.85)';
        ctx.shadowBlur = 10 * s * amp;
        ctx.beginPath();
        const segments = 28;
        for (let k = 0; k <= segments; k++) {
          const t = k / segments;
          const x = nodeX + (w - nodeX) * t;
          const dy = Math.sin(this.phase[str] + t * Math.PI) * swing * Math.sin(t * Math.PI);
          if (k === 0) ctx.moveTo(x, y + dy);
          else ctx.lineTo(x, y + dy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (nodeX > 0) {
          ctx.strokeStyle = 'rgba(186, 178, 160, 0.55)';
          ctx.lineWidth = thickness;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(nodeX, y);
          ctx.stroke();
        }
      } else {
        const g = ctx.createLinearGradient(0, y - thickness, 0, y + thickness);
        g.addColorStop(0, 'rgba(240, 235, 220, 0.92)');
        g.addColorStop(0.55, 'rgba(196, 188, 170, 0.85)');
        g.addColorStop(1, 'rgba(96, 90, 78, 0.8)');
        ctx.strokeStyle = g;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();

        // 巻き弦の質感（太い弦だけ）
        if (str < this.stringCount - 1 && thickness > 2.2 * s) {
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.strokeStyle = '#241f18';
          ctx.lineWidth = 0.9 * s;
          for (let x = 0; x < w; x += 4.5 * s) {
            ctx.beginPath();
            ctx.moveTo(x, y - thickness * 0.5);
            ctx.lineTo(x + 1.8 * s, y + thickness * 0.5);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // --- 押さえている指の位置 ---
      const flash = this.flash[str];
      if (flash > 0 && this.flashFret[str] >= 0) {
        const fret = this.flashFret[str];
        const idx = fret - firstFret;
        let cx = -1;
        if (fret === 0 && this.startFret === 0) cx = open * 0.45;
        else if (idx >= 0 && idx < this.fretCount) cx = centerX(idx);
        if (cx >= 0) {
          const r = Math.min(lane * 0.44, 22 * s) * (0.7 + flash * 0.45);
          const glow = ctx.createRadialGradient(cx, y, 0, cx, y, r);
          glow.addColorStop(0, `rgba(255, 210, 140, ${0.9 * flash})`);
          glow.addColorStop(1, 'rgba(240, 161, 60, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // --- ハーモニクスが鳴る位置の目印 ---
    if (this.showHarmonics && !this.fretless) {
      ctx.fillStyle = 'rgba(150, 214, 236, 0.5)';
      for (let i = 0; i < this.fretCount; i++) {
        if (!HARMONIC_SET.has(firstFret + i)) continue;
        const x = boardX + edges[i + 1] * boardW;
        ctx.beginPath();
        ctx.arc(x, boardTop + 4 * s, 2.6 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- フレット番号（ネックの外側に置く）---
    const rulerY = boardTop > 16 * s ? boardTop - 7 * s : boardTop + 8 * s;
    ctx.font = `${Math.round(11 * s)}px 'Helvetica Neue', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = boardTop > 16 * s ? 'bottom' : 'top';
    for (let i = 0; i < this.fretCount; i++) {
      const fret = firstFret + i;
      if (fret % 12 !== 0 && !INLAYS.includes(fret)) continue;
      ctx.fillStyle = fret % 12 === 0 ? 'rgba(240, 161, 60, 0.95)' : 'rgba(240, 161, 60, 0.6)';
      ctx.fillText(String(fret), centerX(i), rulerY);
    }

    // --- 全体の鳴りに応じてほのかに光る ---
    if (this.level > 0.02) {
      const glow = ctx.createLinearGradient(0, boardTop, 0, bottom);
      glow.addColorStop(0, `rgba(255, 190, 110, ${0.05 * this.level})`);
      glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, boardTop, w, boardH);
    }
  }
}
