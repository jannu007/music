/**
 * Akatsuki Synth — 音色ブラウザ（検索・カテゴリー・ユーザー音色の保存）
 */
import { CATEGORIES, PRESETS, clonePatch, loadUserPatches, saveUserPatches } from '../audio/presets';
import type { Patch } from '../audio/types';
import { toast } from './widgets';

export interface PatchBrowserOptions {
  currentPatch: Patch;
  onSelect: (patch: Patch) => void;
  onRename: (name: string) => void;
}

export function buildPatchBrowser(container: HTMLElement, opts: PatchBrowserOptions) {
  container.innerHTML = '';
  let query = '';
  let category: string | null = null;
  let userPatches = loadUserPatches();

  const head = document.createElement('div');
  head.className = 'browser-head';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'browser-search';
  search.placeholder = '音色を検索…';
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderList();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-accent';
  saveBtn.textContent = '＋ 音色を保存';
  saveBtn.addEventListener('click', () => {
    const name = window.prompt('音色名を入力してください', opts.currentPatch.name + ' Custom');
    if (!name) return;
    const copy = clonePatch(opts.currentPatch);
    copy.id = `user_${Date.now().toString(36)}`;
    copy.name = name;
    copy.category = 'MY PATCH';
    userPatches = [...userPatches, copy];
    saveUserPatches(userPatches);
    opts.onRename(name);
    renderChips();
    renderList();
    toast(`「${name}」を保存しました`);
  });

  head.append(search, saveBtn);
  container.appendChild(head);

  const chips = document.createElement('div');
  chips.className = 'browser-chips';
  container.appendChild(chips);

  const list = document.createElement('div');
  list.className = 'browser-list';
  container.appendChild(list);

  function allCategories(): string[] {
    const cats: string[] = [...CATEGORIES];
    if (userPatches.length > 0) cats.unshift('MY PATCH');
    return cats;
  }

  function renderChips() {
    chips.innerHTML = '';
    const mk = (label: string, value: string | null) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (category === value ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        category = category === value ? null : value;
        renderChips();
        renderList();
      });
      return b;
    };
    chips.appendChild(mk('ALL', null));
    for (const c of allCategories()) chips.appendChild(mk(c, c));
  }

  function renderList() {
    list.innerHTML = '';
    const pool: Patch[] = [...userPatches, ...PRESETS];
    const filtered = pool.filter((p) => {
      if (category && p.category !== category) return false;
      if (!query) return true;
      return `${p.name} ${p.category}`.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'browser-empty';
      empty.textContent = '該当する音色がありません';
      list.appendChild(empty);
      return;
    }

    const groups = new Map<string, Patch[]>();
    for (const p of filtered) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category)!.push(p);
    }

    for (const [cat, items] of groups) {
      const section = document.createElement('div');
      section.className = 'browser-group';
      const title = document.createElement('div');
      title.className = 'browser-group-title';
      title.textContent = cat;
      section.appendChild(title);
      const wrap = document.createElement('div');
      wrap.className = 'browser-items';
      for (const p of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'patch-btn' + (p.id === opts.currentPatch.id ? ' active' : '');
        const nameEl = document.createElement('span');
        nameEl.textContent = p.name;
        btn.appendChild(nameEl);
        btn.addEventListener('click', () => {
          opts.onSelect(clonePatch(p));
        });
        if (cat === 'MY PATCH') {
          const del = document.createElement('span');
          del.className = 'patch-del';
          del.textContent = '×';
          del.title = '削除';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!window.confirm(`「${p.name}」を削除しますか？`)) return;
            userPatches = userPatches.filter((u) => u.id !== p.id);
            saveUserPatches(userPatches);
            renderChips();
            renderList();
          });
          btn.appendChild(del);
        }
        wrap.appendChild(btn);
      }
      section.appendChild(wrap);
      list.appendChild(wrap.childElementCount ? section : document.createElement('div'));
    }
  }

  renderChips();
  renderList();
}
