/**
 * Akatsuki Synth — 入力（Web MIDI / PCキーボード）
 */
export type NoteHandler = (note: number, velocity: number) => void;

export interface ControlHandlers {
  onNoteOn: NoteHandler;
  onNoteOff: (note: number) => void;
  onPitchBend?: (value: number) => void; // -1..1
  onModWheel?: (value: number) => void;  // 0..1
  onSustain?: (on: boolean) => void;
  onProgramChange?: (program: number) => void;
}

export class MidiInput {
  private handlers: ControlHandlers;
  access: MIDIAccess | null = null;
  connectedNames: string[] = [];
  onDevicesChanged: (() => void) | null = null;
  supported = false;

  constructor(handlers: ControlHandlers) {
    this.handlers = handlers;
  }

  async init(): Promise<boolean> {
    if (!('requestMIDIAccess' in navigator)) return false;
    this.supported = true;
    try {
      const access = await navigator.requestMIDIAccess();
      this.access = access;
      this.attachAll();
      access.onstatechange = () => {
        this.attachAll();
        this.onDevicesChanged?.();
      };
      this.onDevicesChanged?.();
      return true;
    } catch {
      return false;
    }
  }

  private attachAll() {
    if (!this.access) return;
    this.connectedNames = [];
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (e) => this.handleMessage(e as MIDIMessageEvent);
      this.connectedNames.push(input.name ?? 'MIDI Device');
    });
  }

  private handleMessage(e: MIDIMessageEvent) {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    switch (status) {
      case 0x90:
        if (d2 > 0) this.handlers.onNoteOn(d1, d2 / 127);
        else this.handlers.onNoteOff(d1);
        break;
      case 0x80:
        this.handlers.onNoteOff(d1);
        break;
      case 0xe0: {
        const value = ((d2 << 7) | d1) / 8192 - 1;
        this.handlers.onPitchBend?.(Math.max(-1, Math.min(1, value)));
        break;
      }
      case 0xb0:
        if (d1 === 1) this.handlers.onModWheel?.(d2 / 127);
        else if (d1 === 64) this.handlers.onSustain?.(d2 >= 64);
        else if (d1 === 123 || d1 === 120) this.handlers.onSustain?.(false);
        break;
      case 0xc0:
        this.handlers.onProgramChange?.(d1);
        break;
      default:
        break;
    }
  }
}

/* PCキーボードの2段配置（下段 = 基準オクターブ、上段 = 1オクターブ上） */
const KEY_ORDER = [
  'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU',
  'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP',
];

export class ComputerKeyboard {
  private handlers: ControlHandlers;
  octaveBase = 60; // C4
  velocity = 0.85;
  private held = new Set<string>();
  enabled = true;
  onOctaveChange: ((base: number) => void) | null = null;
  onNoteVisual: ((note: number, on: boolean) => void) | null = null;

  constructor(handlers: ControlHandlers) {
    this.handlers = handlers;
    window.addEventListener('keydown', this.handleDown);
    window.addEventListener('keyup', this.handleUp);
    window.addEventListener('blur', this.releaseAll);
  }

  noteFor(code: string): number | null {
    const idx = KEY_ORDER.indexOf(code);
    return idx === -1 ? null : this.octaveBase - 12 + idx;
  }

  private handleDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;

    if (e.code === 'ArrowLeft') {
      this.setOctave(this.octaveBase - 12);
      return;
    }
    if (e.code === 'ArrowRight') {
      this.setOctave(this.octaveBase + 12);
      return;
    }
    const note = this.noteFor(e.code);
    if (note === null || this.held.has(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
    this.handlers.onNoteOn(note, this.velocity);
    this.onNoteVisual?.(note, true);
  };

  private handleUp = (e: KeyboardEvent) => {
    const note = this.noteFor(e.code);
    if (note === null || !this.held.has(e.code)) return;
    this.held.delete(e.code);
    this.handlers.onNoteOff(note);
    this.onNoteVisual?.(note, false);
  };

  private releaseAll = () => {
    for (const code of [...this.held]) {
      const note = this.noteFor(code);
      if (note !== null) {
        this.handlers.onNoteOff(note);
        this.onNoteVisual?.(note, false);
      }
    }
    this.held.clear();
  };

  setOctave(base: number) {
    this.releaseAll();
    this.octaveBase = Math.max(24, Math.min(96, base));
    this.onOctaveChange?.(this.octaveBase);
  }

  dispose() {
    window.removeEventListener('keydown', this.handleDown);
    window.removeEventListener('keyup', this.handleUp);
    window.removeEventListener('blur', this.releaseAll);
  }
}
