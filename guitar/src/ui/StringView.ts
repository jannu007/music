import type { StringStatus } from '../audio/GuitarEngine';

interface StringVis {
  amp: number;
  phase: number;
  freq: number;
}

/**
 * 弦の振動を描く。
 * エンジンから受け取った弦ごとのレベルと周波数をもとに、
 * それらしい定在波のアニメーションを描画する（音声波形そのものではなく、
 * 「いまどの弦がどのくらい鳴っているか」を見せるための表示）。
 */
export class StringView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private strings: StringVis[] = [];
  private count = 6;
  private raf = 0;
  private last = 0;
  private status: StringStatus | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setCount(6);
    this.resize();
  }

  setCount(n: number) {
    this.count = Math.max(1, n);
    this.strings = Array.from({ length: this.count }, () => ({ amp: 0, phase: 0, freq: 110 }));
  }

  update(status: StringStatus) {
    this.status = status;
  }

  /** 弦が弾かれたことを視覚的に伝える */
  hit(string: number, vel: number) {
    const s = this.strings[string];
    if (s) s.amp = Math.max(s.amp, Math.min(1, vel));
  }

  /**
   * 表示サイズに合わせて描画バッファを整える。
   * 生成直後はまだレイアウトが決まっていないことがあるので、
   * 毎フレーム確認して必要なときだけ作り直す。
   */
  private resize(): { w: number; h: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { w: rect.width, h: rect.height };
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = this.resize();
    if (!size) return;
    const { w, h } = size;

    ctx.clearRect(0, 0, w, h);

    // 背景（焚火のような暖色のにじみ）
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(60, 26, 10, 0.55)');
    grad.addColorStop(1, 'rgba(14, 10, 9, 0.2)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const levels = this.status?.levels;
    const freqs = this.status?.freqs;
    const gap = h / (this.count + 1);

    for (let i = 0; i < this.count; i++) {
      const vis = this.strings[i];
      // エンジンの実レベルへ滑らかに追従させる
      const target = levels ? Math.min(1, (levels[i] ?? 0) * 3.2) : 0;
      vis.amp += (target - vis.amp) * Math.min(1, dt * (target > vis.amp ? 22 : 4));
      if (freqs && freqs[i] > 0) vis.freq = freqs[i];
      // 実周波数だと速すぎて見えないので、見える速さに落とす
      vis.phase += dt * Math.min(24, 3 + vis.freq * 0.02);

      // 上が1弦（高音）になるよう逆順に描く
      const y = gap * (this.count - i);
      const amp = vis.amp * Math.min(16, gap * 0.42);
      const thickness = 0.9 + (this.count - 1 - i) * 0.35;

      ctx.beginPath();
      const steps = 64;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = t * w;
        // 両端は固定（弦の節）、中央が最大に振れる
        const envelope = Math.sin(Math.PI * t);
        const yy = y + Math.sin(vis.phase + t * Math.PI * 2) * amp * envelope;
        if (k === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      const glow = Math.min(1, vis.amp);
      ctx.strokeStyle = `rgba(${210 + glow * 45}, ${140 + glow * 80}, ${70 + glow * 60}, ${0.35 + glow * 0.6})`;
      ctx.lineWidth = thickness + glow * 1.4;
      ctx.shadowBlur = glow * 14;
      ctx.shadowColor = 'rgba(255, 150, 60, 0.75)';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}
