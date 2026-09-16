import { NOTE_NAMES, type Tuning } from '../music/tunings';
import { el } from './controls';
import { t } from './i18n';

export type LabelMode = 'off' | 'note' | 'degree';

export interface FretboardHandlers {
  /** 弦を弾く（fret < 0 はブラッシング） */
  onPluck: (string: number, fret: number, vel: number) => void;
  /** 押さえ直し（スライド/ハンマリング） */
  onSlide: (string: number, fret: number, time: number) => void;
  /** チョーキング（半音単位） */
  onBend: (string: number, semitones: number) => void;
}

/** onPluck の fret に渡す特別な値：いま選ばれているコードフォームに従う */
export const FRET_CHORD = -2;

const MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_MARKERS = [12, 24];

/**
 * 指板のUI。
 *  - フレットをタップ → 押弦して撥弦
 *  - 押したまま上下へドラッグ → チョーキング
 *  - 押したまま左右へドラッグ → スライド
 *  - 下端のストロークバーを左右になぞる → ストローク
 */

/** 出せるフレットの上限。実物の 24 フレットに合わせる */

/**
 * 種を固定した乱数。
 *
 * 木目は描き直すたびに同じでなければならない。毎回変わると、画面の
 * 大きさが変わるたびに木目が踊って、木に見えなくなる。
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_FRETS = 24;
/**
 * いちばん狭いフレットに残す幅。指の腹はおよそ 10mm なので、
 * それを大きく下回ると押さえ分けられない。実測で詰めた値
 */
const MIN_FRET_PX = 22;

export class Fretboard {
  private root: HTMLElement;
  private board: HTMLElement;
  private strumBar: HTMLElement;
  /** 揺れる弦を描く面（App が StringView に渡す） */
  readonly strumCanvas: HTMLCanvasElement;
  /** 木目を描く面。CSS の縞では木に見えないので、その場で描く */
  private texture: HTMLCanvasElement;
  private handlers: FretboardHandlers;
  private tuning: Tuning;
  private capo = 0;
  private frets = 15;
  private labelMode: LabelMode = 'note';
  private cells: HTMLButtonElement[][] = [];
  /** 表示中のコードフォーム（-1 = ミュート、null = 表示なし） */
  private shape: number[] | null = null;
  private rootPitch: number | null = null;

  private sizeWatch: ResizeObserver | null = null;

  private pointerState = new Map<
    number,
    { string: number; fret: number; startX: number; startY: number; bent: boolean }
  >();
  private strumLast = new Map<number, number>();

  constructor(root: HTMLElement, tuning: Tuning, handlers: FretboardHandlers) {
    this.root = root;
    this.tuning = tuning;
    this.handlers = handlers;

    this.board = el('div', 'fretboard');
    this.strumBar = el('div', 'strum-bar');
    // 揺れる弦を、かき鳴らす帯の中に描く。場所を新たに取らずに済み、
    // 弾いている場所で弦が揺れるので、見ていて分かりやすい
    this.texture = el('canvas', 'fb-texture');
    this.texture.setAttribute('aria-hidden', 'true');
    this.strumCanvas = el('canvas', 'strum-canvas');
    this.strumBar.append(this.strumCanvas, el('span', 'strum-hint', t('fretboard.strumHint')));
    this.root.append(this.board, this.strumBar);

    this.build();
    this.bindStrumBar();
  }

  setTuning(tuning: Tuning) {
    this.tuning = tuning;
    this.build();
  }

  setCapo(capo: number) {
    this.capo = capo;
    this.paintLabels();
  }

  setFrets(count: number) {
    this.frets = Math.max(5, Math.min(MAX_FRETS, count));
    this.build();
  }

  setLabelMode(mode: LabelMode) {
    this.labelMode = mode;
    this.paintLabels();
  }

  /** コードフォームを指板に重ねて表示する */
  showShape(frets: number[] | null, rootPitch: number | null = null) {
    this.shape = frets;
    this.rootPitch = rootPitch;
    this.paintShape();
    this.followShape();
  }

  /**
   * 押さえる形が画面の外にあるなら、そこまで送る。
   *
   * 指板は画面より広いので、選んだ和音がいまの位置から外れていると、
   * 「光っているはずなのに何も出ない」ように見える。実物で手を
   * 持ち替えるのと同じことを、こちらでやる。
   */
  private followShape() {
    if (!this.shape) return;
    const used = this.shape.filter((f) => f > 0);
    if (used.length === 0) return;
    const lo = Math.min(...used);
    const hi = Math.max(...used);
    const first = this.cells[0]?.[lo];
    const last = this.cells[0]?.[hi];
    if (!first || !last) return;

    const view = this.root.getBoundingClientRect();
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    // すでに全部見えているなら動かさない。勝手に動くほうが煩わしい
    if (a.left >= view.left && b.right <= view.right) return;

    const center = (a.left + b.right) / 2 - view.left + this.root.scrollLeft;
    this.root.scrollTo({ left: Math.max(0, center - view.width / 2), behavior: 'smooth' });
  }

  /** 弦が鳴っていることを示す（アニメーション） */
  flash(string: number, fret: number) {
    const row = this.cells[string];
    if (!row) return;
    const cell = row[Math.max(0, fret)];
    if (!cell) return;
    cell.classList.remove('hit');
    // 連打でもアニメーションをやり直すため、一度リフローを挟む
    void cell.offsetWidth;
    cell.classList.add('hit');
    const stringEl = this.board.querySelector<HTMLElement>(`.fb-row[data-string="${string}"]`);
    if (stringEl) {
      stringEl.classList.remove('ringing');
      void stringEl.offsetWidth;
      stringEl.classList.add('ringing');
    }
  }

  private build() {
    this.board.innerHTML = '';
    this.cells = [];
    const count = this.tuning.notes.length;

    // フレット幅は実物と同じく、高音側ほど狭くする
    const widths: number[] = [];
    for (let f = 0; f <= this.frets; f++) {
      widths.push(f === 0 ? 1.15 : Math.pow(2, -(f - 1) / 12));
    }
    const total = widths.reduce((a, b) => a + b, 0);
    const template = widths.map((w) => `${((w / total) * 100).toFixed(3)}fr`).join(' ');

    // 指板は fr で組んであるので、放っておくと何フレットあっても画面幅に
    // 収まってしまう。24 まで出すと1フレット 15px ほどになり、押さえられない。
    //
    // いちばん狭い高音側のフレットが指で押さえられる幅を保つように、
    // 指板全体の最小幅を決める。画面からはみ出すぶんは、横に送って届かせる。
    const narrowest = widths[widths.length - 1] / total;
    const minWidth = Math.round(MIN_FRET_PX / narrowest);
    this.board.style.minWidth = `${minWidth}px`;
    // かき鳴らす帯も同じ幅にする。ずれると、弦と帯が横に食い違う
    this.strumBar.style.minWidth = `${minWidth}px`;

    // 木目の面は、いちばん下に敷く
    this.board.append(this.texture);

    // 目印（ポジションマーク）の帯
    const markerRow = el('div', 'fb-markers');
    markerRow.style.gridTemplateColumns = template;
    // 掴んで横に送れることを伝える。弦の上は演奏に使われていて空いていない
    markerRow.title = t('fretboard.slideHint');
    markerRow.setAttribute('aria-label', t('fretboard.slideHint'));
    for (let f = 0; f <= this.frets; f++) {
      const cell = el('div', 'fb-marker');
      if (DOUBLE_MARKERS.includes(f)) cell.classList.add('double');
      else if (MARKERS.includes(f)) cell.classList.add('single');
      if (f > 0) cell.append(el('span', 'fb-fretnum', String(f)));
      markerRow.append(cell);
    }
    this.board.append(markerRow);

    // 弦は上が高音（1弦）になるよう逆順に並べる
    for (let s = count - 1; s >= 0; s--) {
      const row = el('div', 'fb-row');
      row.dataset.string = String(s);
      row.style.gridTemplateColumns = template;
      // 低音弦ほど太く描く
      row.style.setProperty('--string-w', `${1 + (count - 1 - s) * 0.55}px`);

      // 実物は低音側の3本が巻き弦（ブロンズを巻いてあるので黄みがかり、
      // 表面に巻き目が見える）、高音側の3本が素の鋼線（白く、つるり）。
      // s は 0 が高音側なので、下から数えて何番目かで分ける
      const fromLow = count - 1 - s;
      const wound = fromLow >= count - 3;
      if (wound) {
        row.style.setProperty('--str-hi', '#f0d9a8');
        row.style.setProperty('--str-mid', '#c19a5e');
        row.style.setProperty('--str-lo', '#6b5230');
        // 巻き目。太い弦ほどはっきり見える
        row.style.setProperty('--wind', String(0.16 + fromLow * 0.04));
      } else {
        row.style.setProperty('--str-hi', '#fdfaf4');
        row.style.setProperty('--str-mid', '#d7cfc1');
        row.style.setProperty('--str-lo', '#776e60');
        row.style.setProperty('--wind', '0');
      }
      const rowCells: HTMLButtonElement[] = [];
      for (let f = 0; f <= this.frets; f++) {
        const cell = el('button', 'fb-cell');
        cell.type = 'button';
        cell.dataset.string = String(s);
        cell.dataset.fret = String(f);
        if (f === 0) cell.classList.add('open');
        cell.append(el('span', 'fb-dot'), el('span', 'fb-label'));
        row.append(cell);
        rowCells.push(cell);
      }
      this.cells[s] = rowCells;
      this.board.append(row);
    }

    // ネックの側面。実物はここに小さな目印（サイドドット）が並んでいて、
    // 弾いている本人からはこちらのほうがよく見える。位置がずれると
    // 嘘になるので、指板と同じ割り付けを使う
    const side = el('div', 'fb-side');
    side.style.gridTemplateColumns = template;
    side.setAttribute('aria-hidden', 'true');
    for (let f = 0; f <= this.frets; f++) {
      const cell = el('div', 'fb-side-cell');
      if (DOUBLE_MARKERS.includes(f)) cell.classList.add('double');
      else if (MARKERS.includes(f)) cell.classList.add('single');
      side.append(cell);
    }
    this.board.append(side);

    this.bindBoard();
    this.paintLabels();
    this.paintShape();
    this.paintTexture();
    this.watchSize();
  }

  /** 大きさが変わったら木目を描き直す（向きを変えたときなど） */
  private watchSize() {
    if (this.sizeWatch || typeof ResizeObserver === 'undefined') return;
    this.sizeWatch = new ResizeObserver(() => this.paintTexture());
    this.sizeWatch.observe(this.board);
  }

  /** 音色が変わって木が変わったときに、外から呼ぶ */
  repaintTexture() {
    this.paintTexture();
  }

  /**
   * 指板の木目を描く。
   *
   * CSS のグラデーションでは、等間隔の縞しか引けない。木目は本来
   * 不揃いで、太さも間隔も走り方もばらばらなので、縞のままだと
   * 木ではなく布の柄に見える。ここでは1本ずつ、太さと濃さと蛇行を
   * 変えて引く。種は固定してあるので、描き直しても同じ木目が出る。
   */
  private paintTexture() {
    const canvas = this.texture;
    const rect = this.board.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(this.board);
    const pick = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const c1 = pick('--wood-1', '#3a2414');
    const c2 = pick('--wood-2', '#4e3220');
    const c3 = pick('--wood-3', '#2e1c10');

    // 地の色。根元と先で濃さが違う（一枚板でも色は一様ではない）
    const base = g.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, c1);
    base.addColorStop(0.42, c2);
    base.addColorStop(0.78, c1);
    base.addColorStop(1, c3);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);

    const rnd = seeded(20260916);

    // 導管。ネックの長手方向に走る。太さ・濃さ・長さ・蛇行をすべて変える
    const lines = Math.max(60, Math.round(w / 1.8));
    for (let i = 0; i < lines; i++) {
      const dark = rnd() < 0.74;
      g.strokeStyle = dark
        ? `rgba(0, 0, 0, ${(0.04 + rnd() * 0.2).toFixed(3)})`
        : `rgba(255, 224, 186, ${(0.02 + rnd() * 0.08).toFixed(3)})`;
      g.lineWidth = 0.4 + rnd() * 1.7;
      g.beginPath();
      let x = -40 - rnd() * 80;
      let y = rnd() * h;
      g.moveTo(x, y);
      const len = w * (0.2 + rnd() * 0.95);
      const steps = 16;
      for (let k = 1; k <= steps; k++) {
        x += len / steps;
        y += (rnd() - 0.5) * 1.8;
        g.lineTo(x, y);
      }
      g.stroke();
    }

    // 小さな斑（ローズウッドの点々）。これが無いと、線を引いただけに見える
    const flecks = Math.round(w / 9);
    for (let i = 0; i < flecks; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${(0.05 + rnd() * 0.16).toFixed(3)})`;
      const x = rnd() * w;
      const y = rnd() * h;
      g.beginPath();
      g.ellipse(x, y, 0.6 + rnd() * 2.4, 0.4 + rnd() * 0.9, 0, 0, Math.PI * 2);
      g.fill();
    }

    // 面の丸み（指板R）。中央が明るく、上下の縁が落ちる
    const round = g.createLinearGradient(0, 0, 0, h);
    round.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    round.addColorStop(0.14, 'rgba(0, 0, 0, 0.12)');
    round.addColorStop(0.46, 'rgba(255, 238, 214, 0.08)');
    round.addColorStop(0.8, 'rgba(0, 0, 0, 0.14)');
    round.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    g.fillStyle = round;
    g.fillRect(0, 0, w, h);
  }

  private paintLabels() {
    for (let s = 0; s < this.cells.length; s++) {
      for (let f = 0; f < this.cells[s].length; f++) {
        const label = this.cells[s][f].querySelector<HTMLElement>('.fb-label');
        if (!label) continue;
        if (this.labelMode === 'off') {
          label.textContent = '';
          continue;
        }
        const note = this.tuning.notes[s] + f + this.capo;
        if (this.labelMode === 'note') {
          label.textContent = NOTE_NAMES[((note % 12) + 12) % 12];
        } else if (this.rootPitch !== null) {
          const semis = ((note - this.rootPitch) % 12 + 12) % 12;
          label.textContent = DEGREE_NAMES[semis];
        } else {
          label.textContent = '';
        }
      }
    }
  }

  private paintShape() {
    for (let s = 0; s < this.cells.length; s++) {
      const target = this.shape ? this.shape[s] : undefined;
      for (let f = 0; f < this.cells[s].length; f++) {
        const cell = this.cells[s][f];
        cell.classList.toggle('in-shape', target !== undefined && target === f);
        if (target !== undefined && target >= 0 && f === 0) {
          cell.classList.toggle('muted-string', false);
        }
      }
      const row = this.board.querySelector<HTMLElement>(`.fb-row[data-string="${s}"]`);
      if (row) row.classList.toggle('muted', this.shape ? this.shape[s] < 0 : false);
    }
    if (this.labelMode === 'degree') this.paintLabels();
  }

  private cellFromPoint(x: number, y: number): { string: number; fret: number } | null {
    const target = document.elementFromPoint(x, y);
    const cell = target?.closest<HTMLElement>('.fb-cell');
    if (!cell) return null;
    return { string: Number(cell.dataset.string), fret: Number(cell.dataset.fret) };
  }

  private bindBoard() {
    this.board.addEventListener('pointerdown', (e) => {
      const hit = this.cellFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      this.board.setPointerCapture(e.pointerId);
      this.pointerState.set(e.pointerId, {
        string: hit.string,
        fret: hit.fret,
        startX: e.clientX,
        startY: e.clientY,
        bent: false,
      });
      const vel = velocityFromEvent(e);
      this.handlers.onPluck(hit.string, hit.fret, vel);
      this.flash(hit.string, hit.fret);
    });

    this.board.addEventListener('pointermove', (e) => {
      const state = this.pointerState.get(e.pointerId);
      if (!state) return;
      const dy = e.clientY - state.startY;
      const dx = e.clientX - state.startX;

      // 縦の動きが大きければチョーキング。一度チョーキングと判定したら、指を
      // 戻す動き（ビブラート）も含めて追従し続ける（戻したところで固まらないように）
      if (state.bent || (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx))) {
        const semis = Math.max(-1, Math.min(2, -dy / 55));
        this.handlers.onBend(state.string, semis);
        state.bent = true;
        return;
      }

      // 横の動きなら同じ弦の上をスライド
      const hit = this.cellFromPoint(e.clientX, e.clientY);
      if (!hit || hit.string !== state.string || hit.fret === state.fret) return;
      this.handlers.onSlide(state.string, hit.fret, 0.06);
      this.flash(state.string, hit.fret);
      state.fret = hit.fret;
    });

    const release = (e: PointerEvent) => {
      const state = this.pointerState.get(e.pointerId);
      if (!state) return;
      if (state.bent) this.handlers.onBend(state.string, 0);
      this.pointerState.delete(e.pointerId);
    };
    this.board.addEventListener('pointerup', release);
    this.board.addEventListener('pointercancel', release);
  }

  private bindStrumBar() {
    const positionToString = (x: number): number => {
      const rect = this.strumBar.getBoundingClientRect();
      const count = this.tuning.notes.length;
      const t = (x - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(count - 1, Math.floor(t * count)));
    };

    this.strumBar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.strumBar.setPointerCapture(e.pointerId);
      const s = positionToString(e.clientX);
      this.strumLast.set(e.pointerId, s);
      this.handlers.onPluck(s, FRET_CHORD, velocityFromEvent(e));
    });
    this.strumBar.addEventListener('pointermove', (e) => {
      if (!this.strumLast.has(e.pointerId)) return;
      const s = positionToString(e.clientX);
      const last = this.strumLast.get(e.pointerId)!;
      if (s === last) return;
      const step = s > last ? 1 : -1;
      for (let i = last + step; ; i += step) {
        this.handlers.onPluck(i, FRET_CHORD, velocityFromEvent(e));
        if (i === s) break;
      }
      this.strumLast.set(e.pointerId, s);
    });
    const end = (e: PointerEvent) => this.strumLast.delete(e.pointerId);
    this.strumBar.addEventListener('pointerup', end);
    this.strumBar.addEventListener('pointercancel', end);
  }
}

const DEGREE_NAMES = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

/** タッチの強さ（対応端末のみ）からベロシティを決める */
function velocityFromEvent(e: PointerEvent): number {
  if (e.pointerType === 'touch' && e.pressure > 0 && e.pressure < 1) {
    return 0.35 + e.pressure * 0.65;
  }
  return 0.82;
}
