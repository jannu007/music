/**
 * Akatsuki Synth — 可視化コンポーネント
 * オシロスコープ／スペクトラム／エンベロープ／フィルター特性のリアルタイム表示。
 */
import type { Envelope, FilterParams } from '../audio/types';

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface ScopeHandle {
  element: HTMLElement;
  setMode(mode: 'wave' | 'spectrum'): void;
  stop(): void;
}

/** マスター出力の波形／スペクトラム表示 */
export function createScope(analyser: AnalyserNode): ScopeHandle {
  const wrap = document.createElement('div');
  wrap.className = 'scope';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  let mode: 'wave' | 'spectrum' = 'wave';
  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let running = true;

  function draw() {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const accent = css('--accent', '#ff8ab3');
    const accent2 = css('--accent-2', '#8ad7ff');

    if (mode === 'wave') {
      analyser.getFloatTimeDomainData(timeData);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      const stepX = w / timeData.length;
      for (let i = 0; i < timeData.length; i++) {
        const y = h / 2 - timeData[i] * (h / 2) * 0.92;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * stepX, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      analyser.getByteFrequencyData(freqData);
      const bars = 64;
      const gap = 1;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        // 対数周波数軸でビンをまとめる
        const from = Math.floor(Math.pow(i / bars, 2.2) * freqData.length);
        const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 2.2) * freqData.length));
        let sum = 0;
        for (let k = from; k < to; k++) sum += freqData[k];
        const v = sum / (to - from) / 255;
        const bh = Math.max(1, v * h);
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, accent2);
        grad.addColorStop(1, accent);
        ctx.fillStyle = grad;
        ctx.fillRect(i * bw, h - bh, bw - gap, bh);
      }
    }
  }
  draw();

  return {
    element: wrap,
    setMode(m) {
      mode = m;
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

/** ADSR エンベロープの形をグラフ表示 */
export function createEnvelopeView(getEnv: () => Envelope): { element: HTMLElement; update: () => void } {
  const canvas = document.createElement('canvas');
  canvas.className = 'graph graph-env';

  function update() {
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const pad = 4;
    ctx.clearRect(0, 0, w, h);
    const env = getEnv();
    const total = Math.max(0.35, env.attack + env.decay + 0.5 + env.release);
    const x = (t: number) => pad + (t / total) * (w - pad * 2);
    const y = (v: number) => h - pad - v * (h - pad * 2);

    const aX = x(env.attack);
    const dX = x(env.attack + env.decay);
    const sX = x(env.attack + env.decay + 0.5);
    const rX = x(total);

    ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.08)');
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(pad, (h / 4) * i);
      ctx.lineTo(w - pad, (h / 4) * i);
      ctx.stroke();
    }

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, css('--accent', '#ff8ab3') + '55');
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    ctx.lineTo(aX, y(1));
    ctx.lineTo(dX, y(env.sustain));
    ctx.lineTo(sX, y(env.sustain));
    ctx.lineTo(rX, y(0));
    ctx.strokeStyle = css('--accent', '#ff8ab3');
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(x(0), y(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  requestAnimationFrame(update);
  return { element: canvas, update };
}

/** フィルターの周波数特性を表示 */
export function createFilterView(getFilter: () => FilterParams): { element: HTMLElement; update: () => void } {
  const canvas = document.createElement('canvas');
  canvas.className = 'graph graph-filter';

  function response(f: FilterParams, freq: number): number {
    const ratio = freq / Math.max(20, f.cutoff);
    const order = f.slope === 24 ? 4 : 2;
    const q = 0.5 + f.resonance * 12;
    let mag: number;
    switch (f.type) {
      case 'highpass':
        mag = Math.pow(ratio, order) / Math.sqrt(1 + Math.pow(ratio, 2 * order));
        break;
      case 'bandpass':
        mag = 1 / Math.sqrt(1 + Math.pow(q * (ratio - 1 / ratio), 2));
        break;
      case 'notch':
        mag = Math.abs(ratio - 1 / ratio) / Math.sqrt(Math.pow(ratio - 1 / ratio, 2) + 1 / (q * q));
        break;
      default:
        mag = 1 / Math.sqrt(1 + Math.pow(ratio, 2 * order));
        break;
    }
    // レゾナンスによるピーク
    if (f.type !== 'notch') {
      const peak = f.resonance * 2.2;
      mag *= 1 + peak * Math.exp(-Math.pow(Math.log(ratio) * 2.4, 2));
    }
    return mag;
  }

  function update() {
    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    const f = getFilter();
    const minF = 20;
    const maxF = 20000;

    ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.08)');
    ctx.lineWidth = 1;
    for (const mark of [100, 1000, 10000]) {
      const x = (Math.log(mark / minF) / Math.log(maxF / minF)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const n = i / 160;
      const freq = minF * Math.pow(maxF / minF, n);
      const db = 20 * Math.log10(Math.max(1e-4, response(f, freq)));
      const y = h - ((db + 48) / 60) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(n * w, y);
    }
    ctx.strokeStyle = css('--accent-2', '#8ad7ff');
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, css('--accent-2', '#8ad7ff') + '44');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    // カットオフ位置
    const cx = (Math.log(Math.max(minF, f.cutoff) / minF) / Math.log(maxF / minF)) * w;
    ctx.strokeStyle = css('--accent', '#ff8ab3');
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  requestAnimationFrame(update);
  return { element: canvas, update };
}

/** 縦型レベルメーター */
export function createMeter(): { element: HTMLElement; set: (peak: number) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const bar = document.createElement('div');
  bar.className = 'meter-bar';
  wrap.appendChild(bar);
  let shown = 0;
  return {
    element: wrap,
    set(peak: number) {
      const db = 20 * Math.log10(Math.max(1e-4, peak));
      const norm = Math.max(0, Math.min(1, (db + 54) / 54));
      shown = norm > shown ? norm : shown * 0.82 + norm * 0.18;
      bar.style.height = `${(shown * 100).toFixed(1)}%`;
      bar.classList.toggle('hot', peak > 0.94);
    },
  };
}

/** 横型レベルメーター（ミキサー用） */
export function createMeterRow(): { element: HTMLElement; set: (peak: number) => void } {
  const wrap = document.createElement('div');
  wrap.className = 'meter-row';
  const bar = document.createElement('div');
  bar.className = 'meter-row-bar';
  wrap.appendChild(bar);
  let shown = 0;
  return {
    element: wrap,
    set(peak: number) {
      const db = 20 * Math.log10(Math.max(1e-4, peak));
      const norm = Math.max(0, Math.min(1, (db + 54) / 54));
      shown = norm > shown ? norm : shown * 0.8 + norm * 0.2;
      bar.style.width = `${(shown * 100).toFixed(1)}%`;
      bar.classList.toggle('hot', peak > 0.94);
    },
  };
}

// ---------------------------------------------------------------------------
// 常時表示アナライザー（画面最上部のバー）
// ---------------------------------------------------------------------------
export type AnalyzerMode = 'both' | 'wave' | 'spectrum';

export interface AnalyzerBarHandle {
  element: HTMLElement;
  setMode(mode: AnalyzerMode): void;
  stop(): void;
}

const ANALYZER_MODE_KEY = 'mss.analyzerMode';
const MODE_LABEL: Record<AnalyzerMode, string> = { both: 'WAVE + SPECTRUM', wave: 'WAVEFORM', spectrum: 'SPECTRUM' };
const MODE_ORDER: AnalyzerMode[] = ['both', 'spectrum', 'wave'];

/**
 * マスター出力を常時表示するアナライザーバー。
 * スペクトラム（背景の対数バー）と波形（前面のライン）を重ねて描画し、
 * 右側に L / R のピークメーターを出します。
 */
export function createAnalyzerBar(engine: {
  analyser: AnalyserNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}): AnalyzerBarHandle {
  const root = document.createElement('div');
  root.className = 'analyzer';

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'analyzer-mode';
  title.title = '表示を切り替え';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'analyzer-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);

  const meters = document.createElement('div');
  meters.className = 'analyzer-meters';
  const rows: { bar: HTMLElement; peak: HTMLElement; label: HTMLElement }[] = [];
  for (const name of ['L', 'R']) {
    const row = document.createElement('div');
    row.className = 'analyzer-meter-row';
    const label = document.createElement('span');
    label.className = 'analyzer-meter-name';
    label.textContent = name;
    const track = document.createElement('div');
    track.className = 'analyzer-meter-track';
    const bar = document.createElement('div');
    bar.className = 'analyzer-meter-bar';
    const peak = document.createElement('div');
    peak.className = 'analyzer-meter-peak';
    track.append(bar, peak);
    const value = document.createElement('span');
    value.className = 'analyzer-meter-db';
    value.textContent = '-∞';
    row.append(label, track, value);
    meters.appendChild(row);
    rows.push({ bar, peak, label: value });
  }

  root.append(title, canvasWrap, meters);

  let mode: AnalyzerMode = 'both';
  const saved = (() => {
    try {
      return localStorage.getItem(ANALYZER_MODE_KEY) as AnalyzerMode | null;
    } catch {
      return null;
    }
  })();
  if (saved && MODE_ORDER.includes(saved)) mode = saved;
  const renderTitle = () => {
    title.textContent = MODE_LABEL[mode];
  };
  renderTitle();
  title.addEventListener('click', () => {
    mode = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
    renderTitle();
    try {
      localStorage.setItem(ANALYZER_MODE_KEY, mode);
    } catch {
      /* 保存できない環境では記憶しないだけ */
    }
  });

  const timeData = new Float32Array(engine.analyser.fftSize);
  const freqData = new Uint8Array(engine.analyser.frequencyBinCount);
  const chanData = [new Float32Array(engine.analyserL.fftSize), new Float32Array(engine.analyserR.fftSize)];
  const level = [0, 0];
  const holdValue = [0, 0];
  const holdUntil = [0, 0];

  let raf = 0;
  let running = true;

  function drawMeters(now: number) {
    const sources = [engine.analyserL, engine.analyserR];
    for (let i = 0; i < 2; i++) {
      sources[i].getFloatTimeDomainData(chanData[i]);
      let peak = 0;
      const d = chanData[i];
      for (let k = 0; k < d.length; k += 2) {
        const v = Math.abs(d[k]);
        if (v > peak) peak = v;
      }
      // 立ち上がりは即座に、減衰はゆっくり（VU 的な見た目）
      level[i] = peak > level[i] ? peak : level[i] * 0.86 + peak * 0.14;
      if (peak >= holdValue[i] || now > holdUntil[i]) {
        holdValue[i] = peak;
        holdUntil[i] = now + 1200;
      }
      const norm = (v: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-5, v)) + 54) / 54));
      const row = rows[i];
      row.bar.style.width = `${(norm(level[i]) * 100).toFixed(1)}%`;
      row.bar.classList.toggle('hot', level[i] > 0.94);
      row.peak.style.left = `${(norm(holdValue[i]) * 100).toFixed(1)}%`;
      const db = 20 * Math.log10(Math.max(1e-5, holdValue[i]));
      row.label.textContent = db <= -53.9 ? '-∞' : db.toFixed(1);
      row.label.classList.toggle('hot', db > -0.5);
    }
  }

  function draw(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    drawMeters(now);

    const ctx = fitCanvas(canvas);
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 2 || h < 2) return;
    ctx.clearRect(0, 0, w, h);

    const accent = css('--accent', '#ff8ab3');
    const accent2 = css('--accent-2', '#8ad7ff');

    // --- 周波数の目盛り ---
    if (mode !== 'wave') {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (const mark of [100, 1000, 10000]) {
        const x = (Math.log(mark / 20) / Math.log(20000 / 20)) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // --- スペクトラム ---
    if (mode !== 'wave') {
      engine.analyser.getByteFrequencyData(freqData);
      const bars = Math.max(24, Math.min(112, Math.floor(w / 7)));
      const bw = w / bars;
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, `${accent2}33`);
      grad.addColorStop(0.55, `${accent2}aa`);
      grad.addColorStop(1, accent);
      ctx.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        const from = Math.floor(Math.pow(i / bars, 2.2) * freqData.length);
        const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 2.2) * freqData.length));
        let sum = 0;
        for (let k = from; k < to; k++) sum += freqData[k];
        const v = sum / (to - from) / 255;
        const bh = Math.max(1, v * (h - 2));
        ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1.5), bh);
      }
    }

    // --- 波形 ---
    if (mode !== 'spectrum') {
      engine.analyser.getFloatTimeDomainData(timeData);
      ctx.beginPath();
      const stepX = w / timeData.length;
      for (let i = 0; i < timeData.length; i++) {
        const y = h / 2 - timeData[i] * (h / 2) * 0.88;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * stepX, y);
      }
      ctx.strokeStyle = mode === 'both' ? '#ffffff' : accent;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = mode === 'both' ? 0.85 : 1;
      ctx.stroke();
      ctx.globalAlpha = mode === 'both' ? 0.16 : 0.2;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  raf = requestAnimationFrame(draw);

  return {
    element: root,
    setMode(m) {
      mode = m;
      renderTitle();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
