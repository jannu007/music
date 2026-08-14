import type { TrackConfig } from '../audio/types';
import { el } from './controls';

/** PCキーの割り当て（上段＝生音系、下段＝金物・パーカッション） */
export const PAD_KEYS = [
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM',
];

const KEY_LABELS: Record<string, string> = {
  KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyJ: 'J',
  KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B', KeyN: 'N', KeyM: 'M',
};

export interface PadCallbacks {
  onHit: (trackId: string, velocity: number) => void;
  onSelect: (trackId: string) => void;
}

/** 指で叩けるパッド。上の方を押すほど強く鳴る */
export class DrumPads {
  readonly root: HTMLElement;
  private pads = new Map<string, HTMLElement>();

  constructor(tracks: TrackConfig[], cb: PadCallbacks) {
    this.root = el('div', 'pads');
    tracks.forEach((track, i) => {
      const pad = el('button', 'pad');
      pad.type = 'button';
      pad.append(
        el('span', 'pad-name', track.name),
        el('span', 'pad-key', KEY_LABELS[PAD_KEYS[i]] ?? '')
      );
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const rect = pad.getBoundingClientRect();
        const y = (e.clientY - rect.top) / rect.height;
        const vel = Math.max(0.25, Math.min(1, 1.05 - y * 0.75));
        cb.onSelect(track.id);
        cb.onHit(track.id, vel);
        this.flash(track.id);
      });
      this.pads.set(track.id, pad);
      this.root.append(pad);
    });
  }

  flash(trackId: string) {
    const pad = this.pads.get(trackId);
    if (!pad) return;
    pad.classList.remove('hit');
    // 再生成せずにアニメーションをやり直す
    void pad.offsetWidth;
    pad.classList.add('hit');
  }

  trackIdForKey(code: string, tracks: TrackConfig[]): string | null {
    const index = PAD_KEYS.indexOf(code);
    if (index < 0 || index >= tracks.length) return null;
    return tracks[index].id;
  }
}
