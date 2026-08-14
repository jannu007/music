import { STEP_MAX, type Pattern, type Step, type TrackConfig } from '../audio/types';
import { el } from './controls';

export interface StepGridCallbacks {
  /** ステップを書き換える（null で消去） */
  onEdit: (trackId: string, index: number, step: Step | null) => void;
  onSelectTrack: (trackId: string) => void;
  onPreview: (trackId: string) => void;
  onInspect: (trackId: string, index: number, anchor: HTMLElement) => void;
  onMute: (trackId: string) => void;
  onSolo: (trackId: string) => void;
  /** 打ち込みに使うベロシティ */
  inputVelocity: () => number;
}

interface Row {
  track: TrackConfig;
  root: HTMLElement;
  cells: HTMLButtonElement[];
  led: HTMLElement;
  muteBtn: HTMLButtonElement;
  soloBtn: HTMLButtonElement;
  lastPlayed: number;
}

/** 16ステップ×トラックのステップシーケンサー表示 */
export class StepGrid {
  readonly root: HTMLElement;
  private rows: Row[] = [];
  private ruler: HTMLElement;
  private rulerCells: HTMLElement[] = [];
  private scroller: HTMLElement;
  private cb: StepGridCallbacks;
  private pattern: Pattern | null = null;
  private selected = '';
  private painting: 'on' | 'off' | null = null;
  private pressTimer: number | null = null;
  private pressStart = { x: 0, y: 0 };
  private pressTarget: { trackId: string; index: number; cell: HTMLButtonElement } | null = null;

  constructor(tracks: TrackConfig[], cb: StepGridCallbacks) {
    this.cb = cb;
    this.root = el('div', 'grid-wrap');
    this.scroller = el('div', 'grid-scroll');

    this.ruler = el('div', 'grid-ruler');
    const rulerHead = el('div', 'track-head ruler-head');
    rulerHead.append(el('span', 'ruler-title', 'STEP'));
    this.ruler.append(rulerHead);
    const rulerSteps = el('div', 'track-steps');
    for (let i = 0; i < STEP_MAX; i++) {
      const cell = el('div', 'ruler-cell', String(i + 1));
      if (i % 4 === 0) cell.classList.add('beat');
      this.rulerCells.push(cell);
      rulerSteps.append(cell);
    }
    this.ruler.append(rulerSteps);
    this.scroller.append(this.ruler);

    for (const track of tracks) this.rows.push(this.buildRow(track));
    for (const row of this.rows) this.scroller.append(row.root);
    this.root.append(this.scroller);

    this.scroller.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.endPress());
    window.addEventListener('pointercancel', () => this.endPress());
  }

  private buildRow(track: TrackConfig): Row {
    const root = el('div', 'grid-track');
    root.dataset.track = track.id;

    const head = el('div', 'track-head');
    const name = el('button', 'track-name');
    name.type = 'button';
    name.append(el('span', 'track-short', track.short), el('span', 'track-full', track.name));
    name.addEventListener('click', () => {
      this.cb.onSelectTrack(track.id);
      this.cb.onPreview(track.id);
    });

    const led = el('span', 'track-led');
    const muteBtn = el('button', 'mini-btn mute', 'M');
    muteBtn.type = 'button';
    muteBtn.title = 'ミュート';
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onMute(track.id);
    });
    const soloBtn = el('button', 'mini-btn solo', 'S');
    soloBtn.type = 'button';
    soloBtn.title = 'ソロ';
    soloBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onSolo(track.id);
    });

    const tools = el('div', 'track-tools');
    tools.append(led, muteBtn, soloBtn);
    head.append(name, tools);

    const steps = el('div', 'track-steps');
    const cells: HTMLButtonElement[] = [];
    for (let i = 0; i < STEP_MAX; i++) {
      const cell = el('button', 'step-cell');
      cell.type = 'button';
      cell.dataset.index = String(i);
      cell.dataset.track = track.id;
      if (i % 4 === 0) cell.classList.add('beat');
      cell.addEventListener('pointerdown', (e) => this.onPointerDown(e, track.id, i, cell));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onInspect(track.id, i, cell);
      });
      cells.push(cell);
      steps.append(cell);
    }

    root.append(head, steps);
    return { track, root, cells, led, muteBtn, soloBtn, lastPlayed: -1 };
  }

  // ------------------------------------------------------------- 入力の処理

  private onPointerDown(e: PointerEvent, trackId: string, index: number, cell: HTMLButtonElement) {
    if (e.button === 2) return;
    this.cb.onSelectTrack(trackId);
    const current = this.stepAt(trackId, index);
    const vel = this.cb.inputVelocity();
    if (current && Math.abs(current.v - vel) < 0.02) {
      this.painting = 'off';
      this.cb.onEdit(trackId, index, null);
    } else {
      this.painting = 'on';
      this.cb.onEdit(trackId, index, { v: vel, p: current?.p ?? 1, r: current?.r ?? 1, s: current?.s ?? 0 });
    }
    // マウス以外はなぞり書きしない（画面の横スクロールを優先する）
    if (e.pointerType !== 'mouse') this.painting = null;

    this.pressStart = { x: e.clientX, y: e.clientY };
    this.pressTarget = { trackId, index, cell };
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = null;
      this.painting = null;
      if (this.pressTarget) this.cb.onInspect(this.pressTarget.trackId, this.pressTarget.index, cell);
    }, 480);
  }

  private onPointerMove(e: PointerEvent) {
    if (this.pressTimer !== null) {
      const dx = e.clientX - this.pressStart.x;
      const dy = e.clientY - this.pressStart.y;
      if (Math.hypot(dx, dy) > 8) {
        window.clearTimeout(this.pressTimer);
        this.pressTimer = null;
      }
    }
    if (!this.painting) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('step-cell')) return;
    const trackId = target.dataset.track;
    const index = Number(target.dataset.index);
    if (!trackId || Number.isNaN(index)) return;
    const current = this.stepAt(trackId, index);
    if (this.painting === 'off') {
      if (current) this.cb.onEdit(trackId, index, null);
    } else if (!current) {
      this.cb.onEdit(trackId, index, { v: this.cb.inputVelocity(), p: 1, r: 1, s: 0 });
    }
  }

  private endPress() {
    this.painting = null;
    if (this.pressTimer !== null) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
    this.pressTarget = null;
  }

  private stepAt(trackId: string, index: number): Step | null {
    return this.pattern?.tracks[trackId]?.steps[index] ?? null;
  }

  // ----------------------------------------------------------------- 表示更新

  setSelected(trackId: string) {
    this.selected = trackId;
    for (const row of this.rows) row.root.classList.toggle('selected', row.track.id === trackId);
  }

  setTracks(tracks: TrackConfig[]) {
    for (const row of this.rows) {
      const track = tracks.find((t) => t.id === row.track.id);
      if (!track) continue;
      row.track = track;
      row.muteBtn.classList.toggle('active', track.mute);
      row.soloBtn.classList.toggle('active', track.solo);
      row.root.classList.toggle('muted', track.mute);
    }
  }

  render(pattern: Pattern) {
    this.pattern = pattern;
    for (let i = 0; i < STEP_MAX; i++) {
      this.rulerCells[i].classList.toggle('hidden', i >= pattern.length);
    }
    for (const row of this.rows) {
      const tp = pattern.tracks[row.track.id];
      const length = tp && tp.length > 0 ? tp.length : pattern.length;
      row.root.classList.toggle('poly', !!tp && tp.length > 0);
      for (let i = 0; i < STEP_MAX; i++) {
        const cell = row.cells[i];
        cell.classList.toggle('hidden', i >= Math.max(length, pattern.length));
        cell.classList.toggle('out', i >= length);
        const step = tp?.steps[i] ?? null;
        cell.classList.toggle('on', !!step);
        cell.classList.toggle('accent', !!step && step.v >= 0.85);
        cell.classList.toggle('ghost', !!step && step.v < 0.5);
        cell.classList.toggle('prob', !!step && step.p < 1);
        cell.classList.toggle('roll', !!step && step.r > 1);
        cell.classList.toggle('shifted', !!step && step.s !== 0);
        if (step) cell.style.setProperty('--v', String(Math.max(0.18, step.v)));
        else cell.style.removeProperty('--v');
      }
    }
    this.setSelected(this.selected);
  }

  /** 再生位置の表示（ポリメーターのトラックは自分の周期で光る） */
  setPlayhead(step: number, abs: number) {
    for (let i = 0; i < STEP_MAX; i++) this.rulerCells[i].classList.toggle('playing', i === step);
    for (const row of this.rows) {
      const tp = this.pattern?.tracks[row.track.id];
      const own = tp && tp.length > 0 ? tp.length : 0;
      const index = step < 0 ? -1 : own > 0 ? abs % own : step;
      if (row.lastPlayed === index) continue;
      if (row.lastPlayed >= 0) row.cells[row.lastPlayed]?.classList.remove('playing');
      if (index >= 0) row.cells[index]?.classList.add('playing');
      row.lastPlayed = index;
    }
  }

  setMeters(peaks: number[]) {
    for (let i = 0; i < this.rows.length; i++) {
      const v = Math.min(1, (peaks[i] ?? 0) * 1.6);
      this.rows[i].led.style.setProperty('--peak', v.toFixed(2));
    }
  }

  /** 再生中の列が見えるように横スクロールを追従させる */
  followPlayhead(step: number) {
    if (step < 0) return;
    const cell = this.rows[0]?.cells[step];
    if (!cell) return;
    const box = this.scroller.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    if (rect.right > box.right - 8) {
      this.scroller.scrollLeft += rect.right - box.right + 80;
    } else if (rect.left < box.left + 120) {
      this.scroller.scrollLeft -= box.left + 120 - rect.left;
    }
  }
}
