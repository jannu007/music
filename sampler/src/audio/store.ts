/*
 * 取り込んだ素材の保管庫（IndexedDB）。
 *
 * 波形は localStorage に入れるには大きすぎるので IndexedDB に置く。
 * 付属音源は**保存しない**。決まった順番の乱数から合成しているので、
 * 起動のたびに作り直しても同じ音になる（factory.ts）。保存するのは
 * 利用者が取り込んだ音と録音した音だけ。
 *
 * 保存形式は 16bit 整数。Float32 のまま置くと容量が倍になり、
 * 素材の出どころ（マイク・音声ファイル）を考えると 16bit で十分。
 *
 * 通信は一切しない。ここに入った音が端末の外へ出ることはない。
 */

import type { SampleMeta } from './types';

const DB_NAME = 'yamabiko-sampler';
const DB_VERSION = 1;
const STORE = 'samples';

/** 1つの素材の上限。長すぎる音を掴まされて端末が固まるのを防ぐ */
export const MAX_SAMPLE_SECONDS = 90;
/** 取り込むファイルの上限。展開すると数倍になるので控えめに */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** 保管庫ぜんたいの目安。超えたら古いものから消す */
export const MAX_STORE_BYTES = 256 * 1024 * 1024;

export interface StoredSample {
  meta: SampleMeta;
  /** チャンネルごとの 16bit 波形 */
  data: Int16Array[];
  /** 最後に使った時刻。容量が足りなくなったとき、古いものから消す */
  touched: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('この環境では保存できません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'meta.id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('保管庫を開けませんでした'));
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('保管庫の操作に失敗しました'));
      })
  );
}

export function toInt16(channels: Float32Array[]): Int16Array[] {
  return channels.map((ch) => {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      // 範囲外は丸める。歪ませるより切り落とす方が、聞いていて分かりやすい
      const v = Math.max(-1, Math.min(1, ch[i]));
      out[i] = Math.round(v * 32767);
    }
    return out;
  });
}

export function toFloat32(channels: Int16Array[]): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i] / 32767;
    return out;
  });
}

export function sampleBytes(meta: SampleMeta): number {
  return meta.frames * meta.channels * 2;
}

export async function putSample(meta: SampleMeta, channels: Float32Array[]): Promise<void> {
  const record: StoredSample = { meta, data: toInt16(channels), touched: Date.now() };
  await run('readwrite', (s) => s.put(record));
  await enforceQuota();
}

export async function getSample(id: string): Promise<{ meta: SampleMeta; channels: Float32Array[] } | null> {
  const record = (await run<StoredSample | undefined>('readonly', (s) => s.get(id))) ?? null;
  if (!record) return null;
  // 壊れた記録を掴んでも落ちないようにする（別のバージョンが書いた可能性）
  if (!Array.isArray(record.data) || record.data.length === 0) return null;
  run('readwrite', (s) => s.put({ ...record, touched: Date.now() })).catch(() => {});
  return { meta: record.meta, channels: toFloat32(record.data) };
}

export async function listSamples(): Promise<SampleMeta[]> {
  const all = (await run<StoredSample[]>('readonly', (s) => s.getAll())) ?? [];
  return all.map((r) => r.meta).filter((m): m is SampleMeta => Boolean(m?.id));
}

export async function deleteSample(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** 使っている容量（およそ） */
export async function usedBytes(): Promise<number> {
  const all = (await run<StoredSample[]>('readonly', (s) => s.getAll())) ?? [];
  return all.reduce((sum, r) => sum + (r.meta ? sampleBytes(r.meta) : 0), 0);
}

/** 上限を超えていたら、使っていないものから消す */
async function enforceQuota(): Promise<void> {
  const all = (await run<StoredSample[]>('readonly', (s) => s.getAll())) ?? [];
  let total = all.reduce((sum, r) => sum + (r.meta ? sampleBytes(r.meta) : 0), 0);
  if (total <= MAX_STORE_BYTES) return;
  const byAge = all.filter((r) => r.meta).sort((a, b) => (a.touched ?? 0) - (b.touched ?? 0));
  for (const record of byAge) {
    if (total <= MAX_STORE_BYTES) break;
    await run('readwrite', (s) => s.delete(record.meta.id));
    total -= sampleBytes(record.meta);
  }
}

/** 保管庫を空にする（設定画面から呼ぶ） */
export async function clearSamples(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}
