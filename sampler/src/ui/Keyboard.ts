/*
 * 鍵盤。
 *
 * 画面の下に置きっぱなしにして、どのタブを見ていても弾けるようにする
 * （Kontakt などの多段サンプラーと同じ置き方）。
 *
 * 素材が割り当たっている鍵盤には色を付ける。どこが鳴ってどこが鳴らないかが
 * 一目で分かるようにするため、割り当て編集のときにいちばん役に立つ。
 *
 * 指を置いた縦の位置を「強さ」にしている。上を押せば弱く、下なら強く。
 * 指1本で強弱が付けられるので、画面の狭い端末でも表情が出せる。
 */

import { el } from './controls';
import { noteName } from '../audio/types';

const BLACK = new Set([1, 3, 6, 8, 10]);

export interface KeyboardHandlers {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  /** その鍵盤に素材が割り当たっているか */
  hasZone: (note: number) => boolean;
  /** いま編集中のゾーンの範囲。薄く塗る */
  highlight?: () => { lo: number; hi: number } | null;
}

export class Keyboard {
  readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly keys = new Map<number, HTMLElement>();
  private readonly held = new Map<number, number>();
  private lowest = 48;
  // 画面が狭いと、4オクターブでは1鍵が細くなりすぎて押し分けられない。
  // 足りないぶんは左右の送りで動かす
  private octaves = typeof window !== 'undefined' && window.innerWidth < 520 ? 3 : 4;

  constructor(
    private readonly handlers: KeyboardHandlers,
    private readonly onOctaveChange?: () => void
  ) {
    this.root = el('div', 'keyboard');
    this.scroller = el('div', 'keyboard-keys');

    const bar = el('div', 'keyboard-bar');
    const down = el('button', 'oct-btn', '◀');
    const up = el('button', 'oct-btn', '▶');
    const label = el('span', 'oct-label');
    down.type = 'button';
    up.type = 'button';
    const shift = (by: number) => {
      this.lowest = Math.max(0, Math.min(120 - this.octaves * 12, this.lowest + by));
      label.textContent = `${noteName(this.lowest)} –`;
      this.build();
      this.onOctaveChange?.();
    };
    down.addEventListener('click', () => shift(-12));
    up.addEventListener('click', () => shift(12));
    label.textContent = `${noteName(this.lowest)} –`;
    bar.append(down, label, up);

    this.root.append(bar, this.scroller);
    this.build();
    this.bindPointer();
  }

  /** 表示する音域。狭い画面ではオクターブ数を減らす */
  setRange(lowest: number, octaves: number) {
    this.lowest = Math.max(0, Math.min(127 - octaves * 12, lowest));
    this.octaves = Math.max(1, Math.min(6, octaves));
    this.build();
  }

  private build() {
    this.scroller.textContent = '';
    this.keys.clear();
    const count = this.octaves * 12;
    const whites: HTMLElement[] = [];

    for (let i = 0; i <= count; i++) {
      const note = this.lowest + i;
      if (note > 127) break;
      const black = BLACK.has(((note % 12) + 12) % 12);
      const key = el('div', black ? 'key black' : 'key white');
      key.dataset.note = String(note);
      if (!black) {
        // ドの位置にだけ音名を出す。全部に出すと読みにくい
        if (note % 12 === 0) key.append(el('span', 'key-name', noteName(note)));
        whites.push(key);
      }
      this.keys.set(note, key);
    }

    // 白鍵を並べ、黒鍵はその上に重ねる
    const whiteRow = el('div', 'key-row-white');
    for (const k of whites) whiteRow.append(k);
    const blackRow = el('div', 'key-row-black');
    let whiteIndex = 0;
    for (let i = 0; i <= count; i++) {
      const note = this.lowest + i;
      if (note > 127) break;
      const key = this.keys.get(note);
      if (!key) continue;
      if (key.classList.contains('black')) {
        // 直前の白鍵の右端に寄せる
        key.style.left = `calc(${whiteIndex} * var(--key-w) - var(--key-w) * 0.3)`;
        blackRow.append(key);
      } else {
        whiteIndex++;
      }
    }
    this.scroller.style.setProperty('--white-count', String(whites.length));
    this.scroller.append(whiteRow, blackRow);
    this.paint();
  }

  /** 割り当てのある鍵盤に色を付け直す */
  paint() {
    const range = this.handlers.highlight?.() ?? null;
    for (const [note, key] of this.keys) {
      key.classList.toggle('mapped', this.handlers.hasZone(note));
      key.classList.toggle('in-zone', range !== null && note >= range.lo && note <= range.hi);
    }
  }

  private noteAt(x: number, y: number): { note: number; velocity: number } | null {
    const target = document.elementFromPoint(x, y);
    const key = target instanceof HTMLElement ? target.closest('.key') : null;
    if (!(key instanceof HTMLElement) || !key.dataset.note) return null;
    const box = key.getBoundingClientRect();
    // 上のほうを押すと弱く、下へ行くほど強く
    const depth = box.height > 0 ? (y - box.top) / box.height : 0.7;
    const velocity = Math.round(30 + Math.max(0, Math.min(1, depth)) * 97);
    return { note: Number(key.dataset.note), velocity };
  }

  private bindPointer() {
    const press = (pointerId: number, x: number, y: number) => {
      const hit = this.noteAt(x, y);
      const prev = this.held.get(pointerId);
      if (!hit) {
        if (prev !== undefined) this.release(pointerId);
        return;
      }
      if (prev === hit.note) return;
      if (prev !== undefined) this.release(pointerId);
      this.held.set(pointerId, hit.note);
      this.keys.get(hit.note)?.classList.add('down');
      this.handlers.noteOn(hit.note, hit.velocity);
    };

    this.scroller.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 指を離すまで、指が鍵盤から外れても追いかける
      this.scroller.setPointerCapture(e.pointerId);
      press(e.pointerId, e.clientX, e.clientY);
    });
    this.scroller.addEventListener('pointermove', (e) => {
      if (!this.held.has(e.pointerId)) return;
      press(e.pointerId, e.clientX, e.clientY);
    });
    const up = (e: PointerEvent) => this.release(e.pointerId);
    this.scroller.addEventListener('pointerup', up);
    this.scroller.addEventListener('pointercancel', up);
    // 画面の外まで指が出ていったときの取りこぼしを拾う
    window.addEventListener('pointerup', up);
  }

  private release(pointerId: number) {
    const note = this.held.get(pointerId);
    if (note === undefined) return;
    this.held.delete(pointerId);
    this.keys.get(note)?.classList.remove('down');
    this.handlers.noteOff(note);
  }

  /** 外から鳴らしたときにも鍵盤を光らせる（録音の再生など） */
  flash(note: number, on: boolean) {
    this.keys.get(note)?.classList.toggle('playing', on);
  }

  /** 押しっぱなしを全部離す */
  releaseAll() {
    for (const pointerId of [...this.held.keys()]) this.release(pointerId);
    for (const key of this.keys.values()) key.classList.remove('playing');
  }
}
