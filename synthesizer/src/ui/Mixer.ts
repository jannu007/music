/**
 * Akatsuki Synth — トラック・ミキサー
 */
import type { Sequencer, Track } from '../audio/Sequencer';
import { createKnob } from './widgets';
import { createMeterRow } from './Visualizers';

export interface MixerOptions {
  sequencer: Sequencer;
  getSelectedId: () => string;
  onSelect: (id: string) => void;
  onChange: () => void;
  onAddTrack: () => void;
}

export interface MixerHandle {
  refresh(): void;
  updateMeters(): void;
}

export function buildMixer(container: HTMLElement, opts: MixerOptions): MixerHandle {
  const meters: { track: Track; set: (v: number) => void }[] = [];

  function refresh() {
    container.innerHTML = '';
    meters.length = 0;

    const head = document.createElement('div');
    head.className = 'mixer-head';
    head.innerHTML = '<span>トラック</span>';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-accent';
    addBtn.textContent = '＋ 追加';
    addBtn.addEventListener('click', () => opts.onAddTrack());
    head.appendChild(addBtn);
    container.appendChild(head);

    const list = document.createElement('div');
    list.className = 'mixer-list';
    container.appendChild(list);

    for (const track of opts.sequencer.tracks) {
      const row = document.createElement('div');
      row.className = 'track-row' + (track.id === opts.getSelectedId() ? ' selected' : '');
      row.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('button, input, .knob')) return;
        opts.onSelect(track.id);
      });

      const top = document.createElement('div');
      top.className = 'track-top';

      const name = document.createElement('input');
      name.className = 'track-name';
      name.value = track.name;
      name.spellcheck = false;
      name.addEventListener('change', () => {
        track.name = name.value || track.name;
        opts.onChange();
      });
      top.appendChild(name);

      const mute = document.createElement('button');
      mute.type = 'button';
      mute.className = 'mini-btn' + (track.muted ? ' on' : '');
      mute.textContent = 'M';
      mute.title = 'ミュート';
      mute.addEventListener('click', () => {
        track.muted = !track.muted;
        if (track.muted) track.allNotesOff();
        mute.classList.toggle('on', track.muted);
        opts.onChange();
      });

      const solo = document.createElement('button');
      solo.type = 'button';
      solo.className = 'mini-btn solo' + (track.solo ? ' on' : '');
      solo.textContent = 'S';
      solo.title = 'ソロ';
      solo.addEventListener('click', () => {
        track.solo = !track.solo;
        solo.classList.toggle('on', track.solo);
        for (const t of opts.sequencer.tracks) if (t !== track && !t.solo) t.allNotesOff();
        opts.onChange();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn danger';
      del.textContent = '×';
      del.title = 'トラックを削除';
      del.addEventListener('click', () => {
        if (opts.sequencer.tracks.length <= 1) return;
        if (!window.confirm(`トラック「${track.name}」を削除しますか？`)) return;
        opts.sequencer.removeTrack(track.id);
        if (opts.getSelectedId() === track.id) opts.onSelect(opts.sequencer.tracks[0].id);
        refresh();
        opts.onChange();
      });

      top.append(mute, solo, del);
      row.appendChild(top);

      const patchName = document.createElement('div');
      patchName.className = 'track-patch';
      patchName.textContent = track.patch.name;
      row.appendChild(patchName);

      const controls = document.createElement('div');
      controls.className = 'track-controls';

      const meter = createMeterRow();
      meters.push({ track, set: meter.set });
      controls.appendChild(meter.element);

      controls.appendChild(
        createKnob({
          label: 'Vol',
          min: 0,
          max: 1.2,
          value: track.volume,
          size: 'sm',
          format: (v) => `${Math.round(v * 100)}`,
          onChange: (v) => {
            track.setVolume(v);
            opts.onChange();
          },
        })
      );
      controls.appendChild(
        createKnob({
          label: 'Pan',
          min: -1,
          max: 1,
          bipolar: true,
          value: track.pan,
          size: 'sm',
          format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
          onChange: (v) => {
            track.setPan(v);
            opts.onChange();
          },
        })
      );
      row.appendChild(controls);
      list.appendChild(row);
    }
  }

  refresh();

  return {
    refresh,
    updateMeters() {
      for (const m of meters) m.set(m.track.peak);
    },
  };
}
