const LOW = 21;
const HIGH = 108;
const COUNT = HIGH - LOW + 1;

/** 響板と弦のビジュアライザー（打鍵した弦が実際に振動して見える） */
export class StringView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private amp = new Float32Array(COUNT);
  private decay = new Float32Array(COUNT);
  private phase = new Float32Array(COUNT);
  private freq = new Float32Array(COUNT);
  private pedal = false;
  private level = 0;
  private raf = 0;
  private lastTime = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    for (let i = 0; i < COUNT; i++) {
      this.decay[i] = 1;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.freq[i] = 5 + i * 0.16;
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  noteOn(note: number, velocity: number) {
    const i = note - LOW;
    if (i < 0 || i >= COUNT) return;
    this.amp[i] = Math.min(1, 0.35 + velocity * 0.75);
    // 低音ほど長く揺れて見える
    this.decay[i] = 0.55 + 2.4 * Math.exp(-0.035 * i);
  }

  noteOff(note: number) {
    const i = note - LOW;
    if (i < 0 || i >= COUNT) return;
    if (!this.pedal && note < 93) this.decay[i] = 0.14;
  }

  setPedal(on: boolean) {
    this.pedal = on;
  }

  setLevel(v: number) {
    this.level = v;
  }

  allOff() {
    for (let i = 0; i < COUNT; i++) this.decay[i] = 0.1;
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
    for (let i = 0; i < COUNT; i++) {
      if (this.amp[i] <= 0.0005) {
        this.amp[i] = 0;
        continue;
      }
      this.amp[i] *= Math.exp(-dt / this.decay[i]);
      this.phase[i] += dt * this.freq[i] * Math.PI * 2;
    }
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const s = this.dpr;

    ctx.clearRect(0, 0, w, h);

    // --- 響板（木目） ---
    const wood = ctx.createLinearGradient(0, 0, w, h);
    wood.addColorStop(0, '#2b1a14');
    wood.addColorStop(0.45, '#4a2c1d');
    wood.addColorStop(1, '#22140f');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#c8934f';
    ctx.lineWidth = 1 * s;
    for (let y = 0; y < h; y += 9 * s) {
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(y * 0.02) * 3 * s);
      ctx.lineTo(w, y + Math.sin(y * 0.02 + 1.7) * 4 * s);
      ctx.stroke();
    }
    ctx.restore();

    // 全体の鳴りに応じてほのかに明るくなる
    if (this.level > 0.01) {
      const glow = ctx.createRadialGradient(w * 0.35, h * 0.9, 0, w * 0.35, h * 0.9, h * 1.5);
      glow.addColorStop(0, `rgba(255, 196, 120, ${0.16 * this.level})`);
      glow.addColorStop(1, 'rgba(255, 196, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }

    const padX = 16 * s;
    const usable = w - padX * 2;
    const step = usable / (COUNT - 1);
    const bottom = h - 8 * s;

    // --- 弦 ---
    for (let i = 0; i < COUNT; i++) {
      const x = padX + i * step;
      // 低音側が長い「ハープ」形状
      const lenRatio = 0.96 - Math.pow(i / (COUNT - 1), 1.45) * 0.74;
      const top = bottom - (h - 20 * s) * lenRatio;
      const amp = this.amp[i];
      const thickness = (0.6 + (1 - i / COUNT) * 1.9) * s;

      if (amp > 0.01) {
        ctx.strokeStyle = `rgba(255, 214, 150, ${0.35 + amp * 0.65})`;
        ctx.lineWidth = thickness + amp * 1.6 * s;
        ctx.shadowColor = 'rgba(255, 190, 110, 0.85)';
        ctx.shadowBlur = 8 * s * amp;
        ctx.beginPath();
        const segments = 14;
        const swing = amp * Math.min(7 * s, step * 0.9);
        for (let k = 0; k <= segments; k++) {
          const t = k / segments;
          const y = top + (bottom - top) * t;
          const envelope = Math.sin(t * Math.PI);
          const dx = Math.sin(this.phase[i] + t * Math.PI) * swing * envelope;
          if (k === 0) ctx.moveTo(x + dx, y);
          else ctx.lineTo(x + dx, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = 'rgba(216, 196, 170, 0.42)';
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
    }

    // --- 駒（ブリッジ）と金属フレーム ---
    ctx.strokeStyle = 'rgba(210, 160, 90, 0.75)';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    for (let i = 0; i < COUNT; i++) {
      const x = padX + i * step;
      const lenRatio = 0.96 - Math.pow(i / (COUNT - 1), 1.45) * 0.74;
      const top = bottom - (h - 20 * s) * lenRatio;
      if (i === 0) ctx.moveTo(x, top);
      else ctx.lineTo(x, top);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(20, 12, 9, 0.55)';
    ctx.fillRect(0, bottom, w, h - bottom);
  }
}
