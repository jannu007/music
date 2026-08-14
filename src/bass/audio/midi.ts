export interface MidiHandlers {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  pitchBend: (semitones: number) => void;
  allNotesOff: () => void;
}

/** Web MIDI 入力（対応ブラウザのみ・任意機能） */
export class MidiInput {
  private handlers: MidiHandlers;
  private access: any = null;
  devices: string[] = [];
  onDevicesChanged: (() => void) | null = null;

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers;
  }

  static get supported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  async init(): Promise<boolean> {
    if (!MidiInput.supported) return false;
    try {
      this.access = await (navigator as any).requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    this.attach();
    this.access.onstatechange = () => {
      this.attach();
      this.onDevicesChanged?.();
    };
    this.onDevicesChanged?.();
    return true;
  }

  private attach() {
    if (!this.access) return;
    this.devices = [];
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e: any) => this.onMessage(e.data);
      this.devices.push(input.name ?? 'MIDI');
    }
  }

  private onMessage(data: Uint8Array | number[]) {
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    if (status === 0x90 && d2 > 0) {
      this.handlers.noteOn(d1, d2 / 127);
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      this.handlers.noteOff(d1);
    } else if (status === 0xe0) {
      // ピッチベンド（±2半音）
      const value = ((d2 << 7) | d1) - 8192;
      this.handlers.pitchBend((value / 8192) * 2);
    } else if (status === 0xb0 && (d1 === 120 || d1 === 123)) {
      this.handlers.allNotesOff();
    }
  }
}

/**
 * PCキーボードの配置。ベースの指板と同じように、
 * 手前の段が低い弦、奥の段が高い弦になっている。
 *   Z X C V B N M , . /  … 1弦目（最も低い弦）の 0〜9 フレット
 *   A S D F G H J K L ;  … 2弦目
 *   Q W E R T Y U I O P  … 3弦目
 *   1 2 3 4 5 6 7 8 9 0  … 4弦目（最も高い弦）
 */
export const KEY_ROWS: string[][] = [
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
];

export interface KeyPosition {
  /** 下から数えた弦の番号（0 = 最も低い弦） */
  row: number;
  /** 0 を基準としたフレット */
  fret: number;
}

/** キーコードから弦・フレットを引く表 */
export const COMPUTER_KEY_MAP: Record<string, KeyPosition> = (() => {
  const map: Record<string, KeyPosition> = {};
  KEY_ROWS.forEach((row, rowIndex) => {
    row.forEach((code, fret) => {
      map[code] = { row: rowIndex, fret };
    });
  });
  return map;
})();
