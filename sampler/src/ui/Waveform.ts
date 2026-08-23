/*
 * 波形の表示と、範囲・ループ点の編集。
 *
 * 波形は canvas に描く。数万〜数百万点をそのまま線にすると潰れるので、
 * 画面の横1ピクセルぶんの区間について最小値と最大値を取り、縦の棒として描く
 * （波形編集ソフトが昔からやっている方法。形がいちばん正直に出る）。
 *
 * 掴んで動かすのは4つの印だけ。始め・終わり・ループ始め・ループ終わり。
 */

import { el } from './controls';

export type Marker = 'start' | 'end' | 'loopStart' | 'loopEnd';

export interface WaveformValues {
  start: number;
  end: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

export class Waveform {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly handles = new Map<Marker, HTMLElement>();
  private channels: Float32Array[] = [];
  private values: WaveformValues = { start: 0, end: 1, loop: false, loopStart: 0.35, loopEnd: 0.95 };
  private dragging: Marker | null = null;
  /** 直近に描いた波形の見た目。画面の幅が変わったら描き直す */
  private drawnWidth = 0;

  constructor(private readonly onChange: (values: WaveformValues) => void) {
    this.root = el('div', 'waveform');
    this.canvas = el('canvas', 'waveform-canvas');
    this.overlay = el('div', 'waveform-overlay');

    for (const marker of ['start', 'end', 'loopStart', 'loopEnd'] as Marker[]) {
      const handle = el('div', `wave-handle ${marker}`);
      handle.dataset.marker = marker;
      this.handles.set(marker, handle);
      this.overlay.append(handle);
    }
    // 鳴らす範囲の外を暗くする帯
    this.overlay.prepend(el('div', 'wave-shade left'), el('div', 'wave-shade right'), el('div', 'wave-loop'));

    this.root.append(this.canvas, this.overlay);
    this.bindDrag();

    // 画面の幅が変わったら描き直す（横向きにしたときなど）
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.draw()).observe(this.root);
    }
  }

  setSample(channels: Float32Array[], values: WaveformValues) {
    this.channels = channels;
    this.values = { ...values };
    this.drawnWidth = 0;
    this.draw();
    this.layout();
  }

  setValues(values: WaveformValues) {
    this.values = { ...values };
    this.layout();
  }

  /** 波形を描く。1ピクセルごとに最小・最大を取って縦棒にする */
  private draw() {
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === this.drawnWidth && this.canvas.height === height) return;
    this.drawnWidth = width;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const data = this.channels[0];
    if (!data || data.length === 0) return;

    // そのままの振幅で描くと、撥弦のように頭だけ大きい音は、
    // 立ち上がり以外がぜんぶ中心線に潰れて何も見えない。
    // いちばん大きいところを基準にそろえ、さらに小さい音を持ち上げる。
    // 波形編集の画面では見慣れたやり方で、ループ点を探すのに要る。
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    const scale = peak > 1e-6 ? 1 / peak : 1;
    const shape = (v: number) => Math.sign(v) * Math.pow(Math.abs(v) * scale, 0.62);

    const mid = height / 2;
    const perPixel = data.length / width;
    ctx.fillStyle = 'rgba(126, 200, 205, 0.85)';
    for (let x = 0; x < width; x++) {
      const from = Math.floor(x * perPixel);
      const to = Math.min(data.length, Math.floor((x + 1) * perPixel));
      let lo = 0;
      let hi = 0;
      for (let i = from; i < to; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        else if (v > hi) hi = v;
      }
      const top = mid - shape(hi) * mid * 0.92;
      const bottom = mid - shape(lo) * mid * 0.92;
      // 無音でも線が消えないように、最低1ピクセルは描く
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    // 中心線
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, mid, width, 1);
  }

  /** 印と帯を、いまの値の位置へ動かす */
  private layout() {
    const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
    for (const [marker, handle] of this.handles) {
      handle.style.left = pct(this.values[marker]);
      const loopHandle = marker === 'loopStart' || marker === 'loopEnd';
      handle.style.display = loopHandle && !this.values.loop ? 'none' : '';
    }
    const shadeL = this.overlay.querySelector('.wave-shade.left');
    const shadeR = this.overlay.querySelector('.wave-shade.right');
    if (shadeL instanceof HTMLElement) shadeL.style.width = pct(this.values.start);
    if (shadeR instanceof HTMLElement) shadeR.style.width = pct(1 - this.values.end);
    const loop = this.overlay.querySelector('.wave-loop');
    if (loop instanceof HTMLElement) {
      loop.style.display = this.values.loop ? '' : 'none';
      loop.style.left = pct(this.values.loopStart);
      loop.style.width = pct(Math.max(0, this.values.loopEnd - this.values.loopStart));
    }
  }

  /** 掴んだ印を動かす。範囲が入れ替わらないよう、隣を追い越さない */
  private commit(marker: Marker, position: number) {
    const v = { ...this.values };
    const gap = 0.002;
    const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
    switch (marker) {
      case 'start':
        v.start = clamp(position, 0, v.end - gap);
        v.loopStart = Math.max(v.loopStart, v.start);
        break;
      case 'end':
        v.end = clamp(position, v.start + gap, 1);
        v.loopEnd = Math.min(v.loopEnd, v.end);
        break;
      case 'loopStart':
        v.loopStart = clamp(position, v.start, v.loopEnd - gap);
        break;
      case 'loopEnd':
        v.loopEnd = clamp(position, v.loopStart + gap, v.end);
        break;
    }
    this.values = v;
    this.layout();
    this.onChange({ ...v });
  }

  private positionFor(clientX: number): number {
    const box = this.root.getBoundingClientRect();
    return box.width > 0 ? (clientX - box.left) / box.width : 0;
  }

  /** いちばん近い印を探す。指では細い印を正確には掴めない */
  private nearestMarker(position: number): Marker {
    const candidates: Marker[] = this.values.loop
      ? ['start', 'end', 'loopStart', 'loopEnd']
      : ['start', 'end'];
    let best: Marker = 'start';
    let bestDistance = Infinity;
    for (const marker of candidates) {
      const d = Math.abs(this.values[marker] - position);
      if (d < bestDistance) {
        bestDistance = d;
        best = marker;
      }
    }
    return best;
  }

  private bindDrag() {
    this.overlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.overlay.setPointerCapture(e.pointerId);
      const position = this.positionFor(e.clientX);
      const target = e.target instanceof HTMLElement ? e.target.dataset.marker : undefined;
      this.dragging = (target as Marker | undefined) ?? this.nearestMarker(position);
      this.handles.get(this.dragging)?.classList.add('active');
      this.commit(this.dragging, position);
    });
    this.overlay.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.commit(this.dragging, this.positionFor(e.clientX));
    });
    const stop = () => {
      if (!this.dragging) return;
      this.handles.get(this.dragging)?.classList.remove('active');
      this.dragging = null;
    };
    this.overlay.addEventListener('pointerup', stop);
    this.overlay.addEventListener('pointercancel', stop);
  }
}
