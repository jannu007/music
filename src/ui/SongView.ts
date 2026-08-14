/**
 * Akatsuki Synth — ソング（シーン）エディタ
 * 各シーンに「どのトラックがどのパターンを鳴らすか」と長さ（小節数）を設定し、
 * 上から順に再生することで一曲を組み立てます。
 */
import { PATTERN_SLOTS, type Scene, type Sequencer } from '../audio/Sequencer';
import { toast } from './widgets';

export interface SongViewHandle {
  refresh(): void;
  setActiveScene(index: number): void;
}

export function buildSongView(container: HTMLElement, sequencer: Sequencer, onChange: () => void): SongViewHandle {
  let activeScene = -1;

  function refresh() {
    container.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'song-intro';
    intro.textContent =
      'シーンを縦に並べて曲の構成を作ります。各セルはトラックが鳴らすパターン（A〜D）です。「ソング」モードで再生すると上から順に演奏されます。';
    container.appendChild(intro);

    const table = document.createElement('div');
    table.className = 'song-table';

    // ヘッダー行
    const header = document.createElement('div');
    header.className = 'song-row song-header';
    header.appendChild(cell('シーン', 'song-name-cell'));
    header.appendChild(cell('小節', 'song-bars-cell'));
    for (const t of sequencer.tracks) header.appendChild(cell(t.name, 'song-cell'));
    header.appendChild(cell('', 'song-actions-cell'));
    table.appendChild(header);

    sequencer.scenes.forEach((scene, index) => {
      const row = document.createElement('div');
      row.className = 'song-row' + (index === activeScene ? ' playing' : '');

      const nameInput = document.createElement('input');
      nameInput.className = 'song-name';
      nameInput.value = scene.name;
      nameInput.addEventListener('change', () => {
        scene.name = nameInput.value || scene.name;
        onChange();
      });
      const nameCell = cell('', 'song-name-cell');
      nameCell.appendChild(nameInput);
      row.appendChild(nameCell);

      const barsInput = document.createElement('input');
      barsInput.type = 'number';
      barsInput.min = '1';
      barsInput.max = '64';
      barsInput.value = String(scene.bars);
      barsInput.className = 'song-bars';
      barsInput.addEventListener('change', () => {
        scene.bars = Math.max(1, Math.min(64, Number(barsInput.value) || 1));
        barsInput.value = String(scene.bars);
        onChange();
      });
      const barsCell = cell('', 'song-bars-cell');
      barsCell.appendChild(barsInput);
      row.appendChild(barsCell);

      for (const track of sequencer.tracks) {
        const c = cell('', 'song-cell');
        const sel = document.createElement('select');
        sel.className = 'song-slot';
        for (let i = 0; i < PATTERN_SLOTS; i++) {
          const o = document.createElement('option');
          o.value = String(i);
          const count = track.patterns[i]?.notes.length ?? 0;
          o.textContent = `${String.fromCharCode(65 + i)}${count > 0 ? '' : '（空）'}`;
          sel.appendChild(o);
        }
        sel.value = String(scene.patterns[track.id] ?? 0);
        sel.addEventListener('change', () => {
          scene.patterns[track.id] = Number(sel.value);
          onChange();
        });
        c.appendChild(sel);
        row.appendChild(c);
      }

      const actions = cell('', 'song-actions-cell');
      actions.appendChild(
        miniButton('複製', () => {
          const copy: Scene = { name: `${scene.name}'`, bars: scene.bars, patterns: { ...scene.patterns } };
          sequencer.scenes.splice(index + 1, 0, copy);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton('↑', () => {
          if (index === 0) return;
          const [s] = sequencer.scenes.splice(index, 1);
          sequencer.scenes.splice(index - 1, 0, s);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton('↓', () => {
          if (index >= sequencer.scenes.length - 1) return;
          const [s] = sequencer.scenes.splice(index, 1);
          sequencer.scenes.splice(index + 1, 0, s);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton('×', () => {
          if (sequencer.scenes.length <= 1) {
            toast('シーンは最低1つ必要です');
            return;
          }
          sequencer.scenes.splice(index, 1);
          refresh();
          onChange();
        })
      );
      row.appendChild(actions);
      table.appendChild(row);
    });

    container.appendChild(table);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-accent';
    add.textContent = '＋ シーンを追加';
    add.addEventListener('click', () => {
      const patterns: Record<string, number> = {};
      for (const t of sequencer.tracks) patterns[t.id] = t.activePattern;
      sequencer.scenes.push({
        name: String.fromCharCode(65 + (sequencer.scenes.length % 26)),
        bars: 4,
        patterns,
      });
      refresh();
      onChange();
    });
    container.appendChild(add);

    const total = document.createElement('p');
    total.className = 'song-total';
    const bars = sequencer.songLengthBars;
    const seconds = (bars * 4 * 60) / sequencer.bpm;
    total.textContent = `全 ${bars} 小節 / 約 ${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒（${sequencer.bpm} BPM）`;
    container.appendChild(total);
  }

  function cell(text: string, className: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function miniButton(label: string, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  refresh();

  return {
    refresh,
    setActiveScene(index: number) {
      if (index === activeScene) return;
      activeScene = index;
      const rows = container.querySelectorAll('.song-row');
      rows.forEach((r, i) => r.classList.toggle('playing', i - 1 === index));
    },
  };
}
