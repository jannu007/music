import { NOTE_NAMES, type Tuning } from '../music/tunings';
import { el } from './controls';

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
export class Fretboard {
  private root: HTMLElement;
  private board: HTMLElement;
  private strumBar: HTMLElement;
  private handlers: FretboardHandlers;
  private tuning: Tuning;
  private capo = 0;
  private frets = 15;
  private labelMode: LabelMode = 'note';
  private cells: HTMLButtonElement[][] = [];
  /** 表示中のコードフォーム（-1 = ミュート、null = 表示なし） */
  private shape: number[] | null = null;
  private rootPitch: number | null = null;

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
    this.strumBar.innerHTML = '<span>ここを左右になぞってストローク</span>';
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
    this.frets = Math.max(5, Math.min(24, count));
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

    // 目印（ポジションマーク）の帯
    const markerRow = el('div', 'fb-markers');
    markerRow.style.gridTemplateColumns = template;
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

    this.bindBoard();
    this.paintLabels();
    this.paintShape();
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

      // 縦の動きが大きければチョーキング
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        const semis = Math.max(-1, Math.min(2, (-dy - Math.sign(-dy) * 12) / 55));
        this.handlers.onBend(state.string, semis);
        state.bent = true;
        return;
      }
      if (state.bent) return;

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
