import { QUALITIES, chordName, findQuality, type Chord } from '../music/chords';
import { NOTE_NAMES } from '../music/tunings';
import { el } from './controls';

export interface ChordPadHandlers {
  /** パッドを弾いた（ストローク） */
  onStrum: (chord: Chord, dir: 'down' | 'up') => void;
  /** コードを選んだ（指板に表示するだけ） */
  onSelect: (chord: Chord) => void;
}

/** ダイアトニックコードの度数と種類（メジャーキー） */
const MAJOR_DEGREES: { semis: number; triad: string; seventh: string; label: string }[] = [
  { semis: 0, triad: 'maj', seventh: 'maj7', label: 'I' },
  { semis: 2, triad: 'min', seventh: 'min7', label: 'ii' },
  { semis: 4, triad: 'min', seventh: 'min7', label: 'iii' },
  { semis: 5, triad: 'maj', seventh: 'maj7', label: 'IV' },
  { semis: 7, triad: 'maj', seventh: 'dom7', label: 'V' },
  { semis: 9, triad: 'min', seventh: 'min7', label: 'vi' },
  { semis: 11, triad: 'dim7', seventh: 'min7b5', label: 'vii' },
];

/** ダイアトニックコード（ナチュラルマイナーキー） */
const MINOR_DEGREES: { semis: number; triad: string; seventh: string; label: string }[] = [
  { semis: 0, triad: 'min', seventh: 'min7', label: 'i' },
  { semis: 2, triad: 'dim7', seventh: 'min7b5', label: 'ii' },
  { semis: 3, triad: 'maj', seventh: 'maj7', label: 'III' },
  { semis: 5, triad: 'min', seventh: 'min7', label: 'iv' },
  { semis: 7, triad: 'min', seventh: 'dom7', label: 'v / V7' },
  { semis: 8, triad: 'maj', seventh: 'maj7', label: 'VI' },
  { semis: 10, triad: 'maj', seventh: 'dom7', label: 'VII' },
];

/**
 * コードパッド。
 * タップでダウンストローク、上へスワイプするとアップストローク。
 */
export class ChordPads {
  private root: HTMLElement;
  private handlers: ChordPadHandlers;
  private keyRoot = 0;
  private minorKey = false;
  private freeRoot = 0;
  private freeQuality = 'maj';
  private selected: Chord | null = null;
  private padGrid!: HTMLElement;

  constructor(root: HTMLElement, handlers: ChordPadHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.build();
  }

  getSelected(): Chord | null {
    return this.selected;
  }

  setKey(rootPitch: number, minor: boolean) {
    this.keyRoot = ((rootPitch % 12) + 12) % 12;
    this.minorKey = minor;
    this.paintPads();
  }

  private build() {
    this.root.innerHTML = '';

    // ---- キー選択 ----
    const keyRow = el('div', 'chord-keyrow');
    const keyLabel = el('span', 'ctl-label', 'キー');
    const keySelect = el('select', 'ctl-select compact');
    for (let i = 0; i < 12; i++) {
      const o = el('option', undefined, NOTE_NAMES[i]);
      o.value = String(i);
      keySelect.append(o);
    }
    keySelect.value = String(this.keyRoot);
    keySelect.addEventListener('change', () => {
      this.keyRoot = Number(keySelect.value);
      this.paintPads();
    });

    const modeSelect = el('select', 'ctl-select compact');
    for (const [value, label] of [['major', 'メジャー'], ['minor', 'マイナー']]) {
      const o = el('option', undefined, label);
      o.value = value;
      modeSelect.append(o);
    }
    modeSelect.value = this.minorKey ? 'minor' : 'major';
    modeSelect.addEventListener('change', () => {
      this.minorKey = modeSelect.value === 'minor';
      this.paintPads();
    });

    keyRow.append(keyLabel, keySelect, modeSelect);

    // ---- 自由選択 ----
    const freeRow = el('div', 'chord-keyrow');
    freeRow.append(el('span', 'ctl-label', '任意'));
    const rootSelect = el('select', 'ctl-select compact');
    for (let i = 0; i < 12; i++) {
      const o = el('option', undefined, NOTE_NAMES[i]);
      o.value = String(i);
      rootSelect.append(o);
    }
    rootSelect.value = String(this.freeRoot);
    const qualitySelect = el('select', 'ctl-select compact wide');
    for (const q of QUALITIES) {
      const o = el('option', undefined, `${q.suffix || '（メジャー）'} — ${q.name}`);
      o.value = q.id;
      qualitySelect.append(o);
    }
    qualitySelect.value = this.freeQuality;
    const addFree = () => {
      this.freeRoot = Number(rootSelect.value);
      this.freeQuality = qualitySelect.value;
      const chord: Chord = { root: this.freeRoot, quality: findQuality(this.freeQuality) };
      this.select(chord);
      this.handlers.onStrum(chord, 'down');
    };
    rootSelect.addEventListener('change', addFree);
    qualitySelect.addEventListener('change', addFree);
    const playFree = el('button', 'btn small', '鳴らす');
    playFree.type = 'button';
    playFree.addEventListener('click', addFree);
    freeRow.append(rootSelect, qualitySelect, playFree);

    this.padGrid = el('div', 'chord-grid');

    this.root.append(keyRow, this.padGrid, freeRow);
    this.paintPads();
  }

  private paintPads() {
    this.padGrid.innerHTML = '';
    const degrees = this.minorKey ? MINOR_DEGREES : MAJOR_DEGREES;

    for (const row of [
      { list: degrees, seventh: false },
      { list: degrees, seventh: true },
    ]) {
      for (const deg of row.list) {
        const chord: Chord = {
          root: (this.keyRoot + deg.semis) % 12,
          quality: findQuality(row.seventh ? deg.seventh : deg.triad),
        };
        this.padGrid.append(this.makePad(chord, deg.label));
      }
    }
  }

  private makePad(chord: Chord, degreeLabel: string): HTMLElement {
    const pad = el('button', 'chord-pad');
    pad.type = 'button';
    pad.dataset.chord = `${chord.root}:${chord.quality.id}`;
    pad.append(
      el('span', 'chord-pad-name', chordName(chord)),
      el('span', 'chord-pad-degree', degreeLabel)
    );
    if (
      this.selected &&
      this.selected.root === chord.root &&
      this.selected.quality.id === chord.quality.id
    ) {
      pad.classList.add('active');
    }

    let startY = 0;
    pad.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('pressed');
    });
    pad.addEventListener('pointerup', (e) => {
      pad.classList.remove('pressed');
      const dy = e.clientY - startY;
      this.select(chord);
      this.handlers.onStrum(chord, dy < -18 ? 'up' : 'down');
    });
    pad.addEventListener('pointercancel', () => pad.classList.remove('pressed'));
    return pad;
  }

  private select(chord: Chord) {
    this.selected = chord;
    const key = `${chord.root}:${chord.quality.id}`;
    for (const pad of this.padGrid.querySelectorAll<HTMLElement>('.chord-pad')) {
      pad.classList.toggle('active', pad.dataset.chord === key);
    }
    this.handlers.onSelect(chord);
  }
}
