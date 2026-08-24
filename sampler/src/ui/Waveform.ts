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

/** 色の三つ組。0〜255 */
type Rgb = readonly [number, number, number];

/**
 * 表示の種類ごとの配色。
 *
 * 見せ方を変えたのに色が同じだと、切り替わったことに気づけない。
 * 種類ごとに色の家系を分けておくと、形を見るより先に「いま何で見ているか」が分かる。
 *
 *   core … いちばん明るいところ（塗りの芯、線の色）
 *   edge … 外へ向かうほど濃くなるほうの色
 *   glow … にじみと中心線に使う、いちばん落ち着いた色
 */
interface Palette {
  core: Rgb;
  edge: Rgb;
  glow: Rgb;
}

const PALETTES: Record<WaveMode, Palette> = {
  // 水面。このアプリの地の色なので、山彦だけは青緑のまま置いておく
  echo: { core: [214, 250, 252], edge: [146, 222, 230], glow: [111, 199, 205] },
  // 菫。左右で藍から桃へ流す
  mirror: { core: [232, 222, 255], edge: [138, 128, 238], glow: [124, 110, 224] },
  // 灯。棒の高さで緑から赤へ、音量計のように変わる
  bars: { core: [255, 236, 188], edge: [240, 152, 74], glow: [232, 140, 60] },
  // 若葉。上下の線で色を分ける
  line: { core: [206, 255, 224], edge: [104, 224, 168], glow: [86, 214, 150] },
  // 熱。色そのものが強さを表すので、ここは下の階調表を使う
  heat: { core: [255, 240, 214], edge: [64, 142, 160], glow: [150, 186, 196] },
  // 極光。角度で紫から金へ回す
  radial: { core: [255, 214, 246], edge: [176, 120, 244], glow: [206, 118, 220] },
};

const rgba = (c: Rgb, alpha: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/**
 * 熱の階調。
 *
 * 色相をひと続きに回すだけだと、途中がどうしても濁る。
 * 通ってほしい色を先に並べ、間を混ぜて作る。
 * 藍 → 青緑 → 若草 → 琥珀 → 白熱。
 */
const HEAT_STOPS: Rgb[] = [
  [14, 30, 58],
  [26, 108, 142],
  [46, 166, 106],
  [226, 166, 58],
  [255, 242, 214],
];

function heatColor(level: number): Rgb {
  const t = Math.max(0, Math.min(1, level)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = HEAT_STOPS[i];
  const b = HEAT_STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

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
    // 地の色も種類に合わせて変える。canvas の中だけ色が変わると、
    // 周りの青緑と喧嘩して濁って見える
    this.root.dataset.mode = this.mode;
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
    this.root.dataset.mode = mode;
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
    const p = PALETTES.echo;
    // 本体の中心と水面を同じ高さに置くと、本体の下半分と返りが重なって
    // ただの塊に見えてしまうので、中心は水面より上に取る
    const centre = height * 0.37;
    const bodyHeight = height * 0.31;
    const surface = height * 0.72;
    const echoHeight = height * 0.25;

    // 中心ほど明るく、外へ行くほど溶ける。
    // 真ん中を白で抜くと帯に見えてしまうので、いちばん明るいところも色を残す
    const body = ctx.createLinearGradient(0, centre - bodyHeight, 0, centre + bodyHeight);
    body.addColorStop(0, rgba(p.edge, 0.72));
    body.addColorStop(0.32, 'rgba(180, 238, 243, 0.88)');
    body.addColorStop(0.5, rgba(p.core, 1));
    body.addColorStop(0.68, 'rgba(180, 238, 243, 0.88)');
    body.addColorStop(1, rgba(p.edge, 0.72));

    ctx.save();
    // にじみ。輪郭を立てず、光っているように見せる
    ctx.shadowColor = rgba(p.glow, 0.5);
    ctx.shadowBlur = 8;
    ctx.fillStyle = body;
    for (let x = 0; x < width; x++) {
      const top = centre - tops[x] * bodyHeight;
      const bottom = centre - bottoms[x] * bodyHeight;
      ctx.fillRect(x, top, 1, Math.max(0.8, bottom - top));
    }
    ctx.restore();

    // 返り。上下をひっくり返し、遠くへ行くほど薄くする。
    // 本体より深い藍に寄せると、水に沈んでいるように見える
    const echo = ctx.createLinearGradient(0, surface, 0, height);
    echo.addColorStop(0, 'rgba(130, 208, 222, 0.52)');
    echo.addColorStop(0.5, 'rgba(84, 150, 196, 0.24)');
    echo.addColorStop(1, 'rgba(58, 100, 168, 0)');
    ctx.fillStyle = echo;
    for (let x = 0; x < width; x++) {
      const depth = Math.max(Math.abs(tops[x]), Math.abs(bottoms[x])) * echoHeight;
      ctx.fillRect(x, surface, 1, Math.max(0.8, depth));
    }

    // 朝と夕。左端をわずかに藍、右端をわずかに金に振る。
    // 塗ったところだけに乗せたいので source-atop で重ねる
    this.wash(ctx, width, height, [
      [0, 'rgba(64, 126, 214, 0.42)'],
      [0.42, 'rgba(150, 226, 232, 0)'],
      [1, 'rgba(240, 190, 116, 0.40)'],
    ]);

    this.drawSurface(ctx, width, surface, PALETTES.echo);
  }

  /**
   * 上下対称の塗り。波形編集ソフトで見慣れた形。
   *
   * 色は左から右へ、藍から桃へ流す。全体をひと目で見たときに、
   * 曲のどのあたりを見ているのかが色でも分かる。
   */
  private drawMirror(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const p = PALETTES.mirror;
    const mid = height / 2;
    const half = height * 0.46;
    const fill = ctx.createLinearGradient(0, mid - half, 0, mid + half);
    fill.addColorStop(0, rgba(p.edge, 0.6));
    fill.addColorStop(0.5, rgba(p.core, 0.98));
    fill.addColorStop(1, rgba(p.edge, 0.6));
    ctx.fillStyle = fill;
    for (let x = 0; x < width; x++) {
      const top = mid - tops[x] * half;
      const bottom = mid - bottoms[x] * half;
      ctx.fillRect(x, top, 1, Math.max(0.8, bottom - top));
    }

    this.wash(ctx, width, height, [
      [0, 'rgba(86, 108, 255, 0.46)'],
      [0.5, 'rgba(178, 122, 255, 0.10)'],
      [1, 'rgba(255, 118, 186, 0.46)'],
    ]);

    this.drawSurface(ctx, width, mid, p);
  }

  /**
   * 縦の棒。
   *
   * 隙間を空けて束ねると、細かい揺れが均されて全体の起伏が読みやすくなる。
   * ループ点を探すときのように「どこで音量が変わるか」を見たいときに向く。
   *
   * 色は棒の高さで決める。低いところは緑、上がるにつれて琥珀、
   * 振り切ったところは赤。音量計と同じ読み方ができる。
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

    ctx.save();
    ctx.shadowColor = rgba(PALETTES.bars.glow, 0.35);
    ctx.shadowBlur = 5;

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
      const level = Math.max(hi, -lo);

      // 緑(142) → 琥珀 → 赤(6)。上下の端をいちばん濃くし、芯を明るく抜く
      const hue = 142 - level * 136;
      const bar = ctx.createLinearGradient(0, top, 0, top + h);
      bar.addColorStop(0, `hsl(${hue} 82% ${40 + level * 14}%)`);
      bar.addColorStop(0.5, `hsl(${hue + 12} 92% ${68 + level * 20}%)`);
      bar.addColorStop(1, `hsl(${hue} 82% ${40 + level * 14}%)`);
      ctx.fillStyle = bar;

      // 角を丸めると、棒が並んだときに柔らかく見える
      const r = Math.min(barWidth / 2, h / 2);
      ctx.beginPath();
      ctx.roundRect(x, top, barWidth, h, r);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 輪郭だけ。中を塗らないので、下の目盛りや帯が透けて見える。
   *
   * 上と下で色を分ける。重なって見分けがつかなくなる細かい波でも、
   * どちらの線かが色で分かる（測定器の二現象表示と同じ考え）。
   */
  private drawLine(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const p = PALETTES.line;
    const mid = height / 2;
    const half = height * 0.44;

    const traces: { edge: Float32Array; stroke: string; glow: string }[] = [
      { edge: tops, stroke: 'rgba(220, 255, 168, 0.95)', glow: 'rgba(146, 228, 84, 0.72)' },
      { edge: bottoms, stroke: 'rgba(154, 250, 200, 0.92)', glow: 'rgba(58, 206, 138, 0.72)' },
    ];

    ctx.save();
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';

    for (const trace of traces) {
      ctx.shadowColor = trace.glow;
      ctx.strokeStyle = trace.stroke;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const y = mid - trace.edge[x] * half;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    this.drawSurface(ctx, width, mid, p);
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
      const c = heatColor(level);
      const h = Math.max(2, level * half * 2);
      // 縁を落として芯を残すと、帯が平らな板に見えない
      const column = ctx.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);
      const dim = heatColor(level * 0.45);
      column.addColorStop(0, rgba(dim, 0.85));
      column.addColorStop(0.5, rgba(c, 1));
      column.addColorStop(1, rgba(dim, 0.85));
      ctx.fillStyle = column;
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    this.drawSurface(ctx, width, mid, PALETTES.heat);
  }

  /**
   * 放射状。
   *
   * 時間を1周に丸めて、強さを外向きの長さにする。頭から終わりまでが
   * ひと目に収まるので、曲の起伏を「形」として掴みたいときに向く。
   *
   * 帯は横に長く縦に短いので、真円ではなく楕円に開く。真円にすると
   * 高さに合わせた小さな輪が真ん中にぽつんと残ってしまう。
   *
   * 色は角度で回す。真上（始まり）が紫、回るにつれて桃・橙をくぐり、
   * ひと回りして紫に戻る。どこが曲の頭かが色で分かる。
   */
  private drawRadial(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tops: Float32Array,
    bottoms: Float32Array
  ) {
    const p = PALETTES.radial;
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.47;
    const ry = height * 0.46;
    // 内側に輪を残す。中心へ集めきると、細い線が団子になって読めない
    const inner = 0.34;

    // 内側の輪。ここが「始まりの円」になる
    ctx.save();
    ctx.strokeStyle = rgba(p.glow, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * inner, ry * inner, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = rgba(p.edge, 0.45);
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';

    for (let x = 0; x < width; x++) {
      const level = Math.max(Math.abs(tops[x]), Math.abs(bottoms[x]));
      const turn = x / width;
      // 真上から始めて、時計回りにひと回り
      const angle = -Math.PI / 2 + turn * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // 消え入るところも短い棘だけは残す。0 にすると輪の半分が
      // 描かれていないように見えてしまう（減衰する音ではそこが大半になる）
      const outer = inner + (0.07 + level * 0.93) * (1 - inner);

      // 紫(276) から一周ぶん回して、また紫へ戻る。
      // 強いところほど明るく、輪の中でどこが山かも同時に分かる
      const hue = (276 + turn * 300) % 360;
      const spoke = ctx.createLinearGradient(
        cx + rx * inner * cos,
        cy + ry * inner * sin,
        cx + rx * outer * cos,
        cy + ry * outer * sin
      );
      spoke.addColorStop(0, `hsl(${hue} ${52 + level * 30}% ${34 + level * 22}% / ${0.4 + level * 0.4})`);
      spoke.addColorStop(1, `hsl(${(hue + 26) % 360} ${72 + level * 24}% ${58 + level * 32}% / ${0.5 + level * 0.5})`);
      ctx.strokeStyle = spoke;
      ctx.beginPath();
      ctx.moveTo(cx + rx * inner * cos, cy + ry * inner * sin);
      ctx.lineTo(cx + rx * outer * cos, cy + ry * outer * sin);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 塗ったところの上にだけ、左右方向の色を重ねる。
   *
   * source-atop は「すでに描いてあるところ」にしか乗らないので、
   * 波形の形を保ったまま、時間の流れに沿って色を変えられる。
   */
  private wash(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    stops: [number, string][]
  ) {
    const wash = ctx.createLinearGradient(0, 0, width, 0);
    for (const [at, color] of stops) wash.addColorStop(at, color);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /** 中心の線。どの表示でも、基準の高さが分かるように引く */
  private drawSurface(ctx: CanvasRenderingContext2D, width: number, y: number, p: Palette) {
    const line = ctx.createLinearGradient(0, 0, width, 0);
    line.addColorStop(0, rgba(p.glow, 0));
    line.addColorStop(0.5, rgba(p.glow, 0.42));
    line.addColorStop(1, rgba(p.glow, 0));
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
