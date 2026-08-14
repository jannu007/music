export interface MidiHandlers {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  /** サステインペダル＝ミュート解除（弦を鳴らしっぱなしにする） */
  hold: (value: number) => void;
  /** エクスプレッションペダル → ブリッジミュート量 */
  palm: (value: number) => void;
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
      // ±2半音レンジとして解釈する
      const value = (d2 << 7) | d1;
      this.handlers.pitchBend(((value - 8192) / 8192) * 2);
    } else if (status === 0xb0) {
      switch (d1) {
        case 64: this.handlers.hold(d2 / 127); break;
        case 11: this.handlers.palm(d2 / 127); break;
        case 120:
        case 123: this.handlers.allNotesOff(); break;
      }
    }
  }
}

/**
 * PCキーボードの配列。
 * 下段（Z〜/）が低いオクターブ、上段（Q〜]）が1オクターブ上。
 * 値は基準音からの半音数。
 */
export const COMPUTER_KEY_MAP: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14,
  Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25,
  KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
};
