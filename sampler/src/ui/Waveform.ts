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

/** 波形の見せ方 */
export type WaveMode = 'echo' | 'mirror' | 'bars' | 'line' | 'heat' | 'radial';

export const WAVE_MODES: WaveMode[] = ['echo', 'mirror', 'bars', 'line', 'heat', 'radial'];

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
  private mode: WaveMode = 'echo';
  /** 幅が変わっていなくても描き直したいとき（表示の種類を変えたなど） */
  private dirty = false;

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
    this.dirty = true;
    this.draw();
    this.layout();
  }

  /** 見せ方を変える */
  setMode(mode: WaveMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.dirty = true;
    this.draw();
  }

  get displayMode(): WaveMode {
    return this.mode;
  }

  setValues(values: WaveformValues) {
    this.values = { ...values };
    this.layout();
  }

  /**
   * 波形を描く。
   *
   * 1ピクセルごとに最小・最大を取って縦棒にする、という下ごしらえは
   * どの表示でも同じ（波形編集ソフトが昔からやっているとおり）。
   * そのあとの見せ方だけを、選ばれた種類ごとに変える。
   */
  private draw() {
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = this.dpr();
    if (width === this.drawnWidth && this.canvas.height === Math.floor(height * dpr) && !this.dirty) {
      return;
    }
    this.drawnWidth = width;
    this.dirty = false;

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
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    const scale = peak > 1e-6 ? 1 / peak : 1;
    const shape = (v: number) => Math.sign(v) * Math.pow(Math.abs(v) * scale, 0.62);

    // 1ピクセルごとの上端・下端。どの表示でも、ここまでは同じ
    const perPixel = data.length / width;
    const tops = new Float32Array(width);
    const bottoms = new Float32Array(width);
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
      tops[x] = shape(hi);
      bottoms[x] = shape(lo);
    }

    switch (this.mode) {
      case 'mirror':
        this.drawMirror(ctx, width, height, tops, bottoms);
        break;
      case 'bars':
        this.drawBars(ctx, width, height, tops, bottoms);
        break;
      case 'line':
        this.drawLine(ctx, width, height, tops, bottoms);
        break;
      case 'heat':
        this.drawHeat(ctx, width, height, tops, bottoms);
        break;
      case 'radial':
        this.drawRadial(ctx, width, height, tops, bottoms);
        break;
      default:
        this.drawEcho(ctx, width, height, tops, bottoms);
    }
  }

  /**
   * 本体と、その下の「返り」。
   *
   * 返りを描くのは飾りではなく、このアプリの名前（山彦）そのもの。
   * アイコンも同じ形をしていて、画面と入口で言っていることをそろえている。
   */
  private drawEcho(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    // 本体の中心と水面を同じ高さに置くと、本体の下半分と返りが重なって
    // ただの塊に見えてしまうので、中心は水面より上に取る
    const centre = height * 0.37;
    const bodyHeight = height * 0.31;
    const surface = height * 0.72;
    const echoHeight = height * 0.25;

    // 中心ほど明るく、外へ行くほど溶ける。
    // 真ん中を白で抜くと帯に見えてしまうので、いちばん明るいところも色を残す
    const body = ctx.createLinearGradient(0, centre - bodyHeight, 0, centre + bodyHeight);
    body.addColorStop(0, 'rgba(146, 222, 230, 0.72)');
    body.addColorStop(0.32, 'rgba(180, 238, 243, 0.88)');
    body.addColorStop(0.5, 'rgba(214, 250, 252, 1)');
    body.addColorStop(0.68, 'rgba(180, 238, 243, 0.88)');
    body.addColorStop(1, 'rgba(146, 222, 230, 0.72)');

    ctx.save();
    // にじみ。輪郭を立てず、光っているように見せる
    ctx.shadowColor = 'rgba(111, 199, 205, 0.5)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = body;
    for (let x = 0; x < width; x++) {
      const top = centre - tops[x] * bodyHeight;
      const bottom = centre - bottoms[x] * bodyHeight;
      ctx.fillRect(x, top, 1, Math.max(0.8, bottom - top));
    }
    ctx.restore();

    // 返り。上下をひっくり返し、遠くへ行くほど薄くする
    const echo = ctx.createLinearGradient(0, surface, 0, height);
    echo.addColorStop(0, 'rgba(138, 212, 218, 0.52)');
    echo.addColorStop(0.5, 'rgba(104, 174, 182, 0.22)');
    echo.addColorStop(1, 'rgba(80, 140, 150, 0)');
    ctx.fillStyle = echo;
    for (let x = 0; x < width; x++) {
      const depth = Math.max(Math.abs(tops[x]), Math.abs(bottoms[x])) * echoHeight;
      ctx.fillRect(x, surface, 1, Math.max(0.8, depth));
    }

    this.drawSurface(ctx, width, surface);
  }

  /** 上下対称の塗り。波形編集ソフトで見慣れた形 */
  private drawMirror(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const mid = height / 2;
    const half = height * 0.46;
    const fill = ctx.createLinearGradient(0, mid - half, 0, mid + half);
    fill.addColorStop(0, 'rgba(120, 206, 214, 0.55)');
    fill.addColorStop(0.5, 'rgba(206, 248, 251, 0.98)');
    fill.addColorStop(1, 'rgba(120, 206, 214, 0.55)');
    ctx.fillStyle = fill;
    for (let x = 0; x < width; x++) {
      const top = mid - tops[x] * half;
      const bottom = mid - bottoms[x] * half;
      ctx.fillRect(x, top, 1, Math.max(0.8, bottom - top));
    }
    this.drawSurface(ctx, width, mid);
  }

  /**
   * 縦の棒。
   *
   * 隙間を空けて束ねると、細かい揺れが均されて全体の起伏が読みやすくなる。
   * ループ点を探すときのように「どこで音量が変わるか」を見たいときに向く。
   */
  private drawBars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const mid = height / 2;
    const half = height * 0.44;
    const barWidth = 3;
    const gap = 2;
    const step = barWidth + gap;

    const fill = ctx.createLinearGradient(0, mid - half, 0, mid + half);
    fill.addColorStop(0, 'rgba(126, 208, 216, 0.75)');
    fill.addColorStop(0.5, 'rgba(198, 246, 249, 1)');
    fill.addColorStop(1, 'rgba(126, 208, 216, 0.75)');
    ctx.fillStyle = fill;

    for (let x = 0; x < width; x += step) {
      // 束ねる範囲でいちばん大きいところを、その棒の高さにする
      let hi = 0;
      let lo = 0;
      for (let i = x; i < Math.min(width, x + step); i++) {
        if (tops[i] > hi) hi = tops[i];
        if (bottoms[i] < lo) lo = bottoms[i];
      }
      const top = mid - hi * half;
      const bottom = mid - lo * half;
      const h = Math.max(2, bottom - top);
      // 角を丸めると、棒が並んだときに柔らかく見える
      const r = Math.min(barWidth / 2, h / 2);
      ctx.beginPath();
      ctx.roundRect(x, top, barWidth, h, r);
      ctx.fill();
    }
  }

  /** 輪郭だけ。中を塗らないので、下の目盛りや帯が透けて見える */
  private drawLine(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const mid = height / 2;
    const half = height * 0.44;

    ctx.save();
    ctx.shadowColor = 'rgba(111, 199, 205, 0.65)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(198, 246, 249, 0.95)';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';

    for (const edge of [tops, bottoms]) {
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const y = mid - edge[x] * half;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    this.drawSurface(ctx, width, mid);
  }

  /**
   * 強さで色が変わる帯。
   *
   * 高さではなく色で音量を見せる。細かい形は分からなくなるが、
   * どこが盛り上がっているかだけを掴みたいときは、こちらのほうが速い。
   */
  private drawHeat(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const mid = height / 2;
    const half = height * 0.44;
    for (let x = 0; x < width; x++) {
      const level = Math.max(Math.abs(tops[x]), Math.abs(bottoms[x]));
      // 静かなところは青緑、大きいところは暖色へ
      const hue = 186 - level * 160;
      const light = 26 + level * 46;
      ctx.fillStyle = `hsl(${hue} 72% ${light}%)`;
      const h = Math.max(2, level * half * 2);
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    this.drawSurface(ctx, width, mid);
  }

  /**
   * 放射状。
   *
   * 時間を1周に丸めて、強さを外向きの長さにする。頭から終わりまでが
   * ひと目に収まるので、曲の起伏を「形」として掴みたいときに向く。
   *
   * 帯は横に長く縦に短いので、真円ではなく楕円に開く。真円にすると
   * 高さに合わせた小さな輪が真ん中にぽつんと残ってしまう。
   */
  private drawRadial(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.47;
    const ry = height * 0.46;
    // 内側に輪を残す。中心へ集めきると、細い線が団子になって読めない
    const inner = 0.34;

    // 内側の輪。ここが「始まりの円」になる
    ctx.save();
    ctx.strokeStyle = 'rgba(111, 199, 205, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * inner, ry * inner, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(111, 199, 205, 0.45)';
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';

    for (let x = 0; x < width; x++) {
      const level = Math.max(Math.abs(tops[x]), Math.abs(bottoms[x]));
      // 真上から始めて、時計回りにひと回り
      const angle = -Math.PI / 2 + (x / width) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // 消え入るところも短い棘だけは残す。0 にすると輪の半分が
      // 描かれていないように見えてしまう（減衰する音ではそこが大半になる）
      const outer = inner + (0.07 + level * 0.93) * (1 - inner);

      // 強いところほど明るく。輪の中でどこが山かが分かる
      ctx.strokeStyle = `hsl(186 ${58 + level * 24}% ${44 + level * 38}% / ${0.45 + level * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(cx + rx * inner * cos, cy + ry * inner * sin);
      ctx.lineTo(cx + rx * outer * cos, cy + ry * outer * sin);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 中心の線。どの表示でも、基準の高さが分かるように引く */
  private drawSurface(ctx: CanvasRenderingContext2D, width: number, y: number) {
    const line = ctx.createLinearGradient(0, 0, width, 0);
    line.addColorStop(0, 'rgba(111, 199, 205, 0)');
    line.addColorStop(0.5, 'rgba(111, 199, 205, 0.42)');
    line.addColorStop(1, 'rgba(111, 199, 205, 0)');
    ctx.fillStyle = line;
    ctx.fillRect(0, y, width, 1);
  }

  private dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
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
