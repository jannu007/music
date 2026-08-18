/**
 * Akatsuki Synth — ソング（シーン）エディタ
 * 各シーンに「どのトラックがどのパターンを鳴らすか」と長さ（小節数）を設定し、
 * 上から順に再生することで一曲を組み立てます。
 */
import { PATTERN_SLOTS, type Scene, type Sequencer } from '../audio/Sequencer';
import { toast } from './widgets';
import { t } from './i18n';
import { DEMOS } from './demoSong';

export interface SongViewHandle {
  refresh(): void;
  setActiveScene(index: number): void;
}

export function buildSongView(
  container: HTMLElement,
  sequencer: Sequencer,
  onChange: () => void,
  onLoadDemo: (song: unknown) => void
): SongViewHandle {
  let activeScene = -1;

  function refresh() {
    container.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'song-intro';
    intro.textContent = t('song.intro');
    container.appendChild(intro);

    const table = document.createElement('div');
    table.className = 'song-table';

    // ヘッダー行
    const header = document.createElement('div');
    header.className = 'song-row song-header';
    header.appendChild(cell(t('song.sceneHeader'), 'song-name-cell'));
    header.appendChild(cell(t('song.barsHeader'), 'song-bars-cell'));
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
          o.textContent = `${String.fromCharCode(65 + i)}${count > 0 ? '' : t('song.emptySuffix')}`;
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
        miniButton(t('song.duplicate'), () => {
          const copy: Scene = { name: `${scene.name}'`, bars: scene.bars, patterns: { ...scene.patterns } };
          sequencer.scenes.splice(index + 1, 0, copy);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton(t('song.moveUp'), () => {
          if (index === 0) return;
          const [s] = sequencer.scenes.splice(index, 1);
          sequencer.scenes.splice(index - 1, 0, s);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton(t('song.moveDown'), () => {
          if (index >= sequencer.scenes.length - 1) return;
          const [s] = sequencer.scenes.splice(index, 1);
          sequencer.scenes.splice(index + 1, 0, s);
          refresh();
          onChange();
        })
      );
      actions.appendChild(
        miniButton(t('song.delete'), () => {
          if (sequencer.scenes.length <= 1) {
            toast(t('toast.sceneMinimum'));
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
    add.textContent = t('song.addScene');
    add.addEventListener('click', () => {
      const patterns: Record<string, number> = {};
      for (const track of sequencer.tracks) patterns[track.id] = track.activePattern;
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
    total.textContent = t('song.total', {
      bars,
      min: Math.floor(seconds / 60),
      sec: Math.round(seconds % 60),
      bpm: sequencer.bpm,
    });
    container.appendChild(total);

    const demoSection = document.createElement('div');
    demoSection.className = 'song-demos';
    const demoTitle = document.createElement('h3');
    demoTitle.textContent = t('song.demos.title');
    demoSection.appendChild(demoTitle);
    const demoHint = document.createElement('p');
    demoHint.className = 'song-demos-hint';
    demoHint.textContent = t('song.demos.hint');
    demoSection.appendChild(demoHint);
    const demoList = document.createElement('div');
    demoList.className = 'song-demo-list';
    for (const demo of DEMOS) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'song-demo-row';
      const titleEl = document.createElement('span');
      titleEl.className = 'song-demo-title';
      titleEl.textContent = demo.title();
      const subEl = document.createElement('span');
      subEl.className = 'song-demo-sub';
      subEl.textContent = demo.subtitle();
      row.append(titleEl, subEl);
      row.addEventListener('click', () => {
        if (!window.confirm(t('confirm.loadDemo', { title: demo.title() }))) return;
        onLoadDemo(demo.build());
        toast(t('flash.demoLoaded', { title: demo.title() }));
      });
      demoList.appendChild(row);
    }
    demoSection.appendChild(demoList);
    container.appendChild(demoSection);
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
