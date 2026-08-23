/*
 * 保存ファイルの読み込みが、おかしなものを渡されても壊れないか。
 *
 * 楽器ファイルは、利用者が別の端末から持ってきたり、人からもらったりする。
 * つまり**中身を書いた人はこちらではない**。ここでは、その前提で
 * わざと壊れたもの・悪意のあるものを渡して、次の3つを確かめる。
 *
 *   1. 例外を投げずに、必ず使える設定が返るか
 *   2. 値が決めた範囲に収まるか（負のループ長や、桁外れの周波数を弾く）
 *   3. __proto__ などで、他のオブジェクトのふるまいまで書き換えられないか
 *      （プロトタイプ汚染。渡されたデータを組み立てにそのまま使うと起きる）
 *
 * ブラウザを立てずに、検証関数そのものへ直接渡す。
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  … ${detail}` : ''}`);
  if (!ok) failures++;
}

const tmp = await mkdtemp(join(tmpdir(), 'sampler-test-'));
try {
  const outfile = join(tmp, 'project.mjs');
  await build({
    entryPoints: [join(ROOT, 'sampler/src/audio/project.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
  });
  const { decodeInstrument, decodeProjectFile, safeName, MAX_ZONES } = await import(
    pathToFileURL(outfile).href
  );

  // ---------------------------------------------------------- 1. 壊れたもの
  const junk = [
    null,
    undefined,
    42,
    'instrument',
    [],
    { zones: 'not an array' },
    { zones: [null, 1, 'x', {}] },
    { amp: { attack: 'soon' }, filter: { freq: 'high' } },
    { polyphony: Infinity, gainDb: NaN, transpose: -1e9 },
  ];
  let threw = 0;
  let allValid = true;
  for (const input of junk) {
    try {
      const inst = decodeInstrument(input);
      if (!Array.isArray(inst.zones) || !Number.isFinite(inst.polyphony) || !inst.amp) {
        allValid = false;
      }
    } catch {
      threw++;
    }
  }
  check('壊れたものを渡しても例外を投げない', threw === 0, `${threw} 件で例外`);
  check('必ず使える設定が返る', allValid);

  // ------------------------------------------------------------ 2. 範囲
  const extreme = decodeInstrument({
    polyphony: 100000,
    gainDb: 999,
    transpose: 500,
    velToFilter: -50,
    glide: 1e9,
    amp: { attack: -5, decay: 0, sustain: 12, release: Infinity },
    filter: { freq: 1e9, q: 1e6, keyTrack: -3, envAmount: 100 },
    lfo: { rate: 1e6, toPitch: 1e6, toFilter: 99, toAmp: 5, delay: -1 },
    fx: { crushBits: 0, flangerFeedback: 1.5, phaserFeedback: 2, delayTime: 60, reverbMix: 9 },
    zones: [
      {
        sampleId: 'a',
        loKey: 200,
        hiKey: -50,
        loVel: 500,
        hiVel: -9,
        start: 5,
        end: -3,
        loopStart: 9,
        loopEnd: -2,
        pan: 40,
        group: 999,
      },
    ],
  });

  const within = (label, value, lo, hi) =>
    check(`${label} が範囲に収まる`, value >= lo && value <= hi, String(value));

  within('同時発音数', extreme.polyphony, 1, 64);
  within('音量', extreme.gainDb, -60, 12);
  within('移調', extreme.transpose, -24, 24);
  within('立ち上がり', extreme.amp.attack, 0, 10);
  within('持続', extreme.amp.sustain, 0, 1);
  within('余韻', extreme.amp.release, 0.001, 20);
  within('遮断周波数', extreme.filter.freq, 20, 20000);
  within('レゾナンス', extreme.filter.q, 0.05, 24);
  within('LFO の速さ', extreme.lfo.rate, 0.01, 40);
  within('ビット数', extreme.fx.crushBits, 1, 16);
  within('フランジャーの戻し', extreme.fx.flangerFeedback, 0, 0.95);
  within('ディレイの間隔', extreme.fx.delayTime, 0.01, 2.5);
  within('リバーブの量', extreme.fx.reverbMix, 0, 1);

  const zone = extreme.zones[0];
  check('ゾーンが残る', Boolean(zone));
  if (zone) {
    // 逆さまに入っていても、必ず lo <= hi になっていること
    check('鍵盤の範囲が逆転しない', zone.loKey <= zone.hiKey, `${zone.loKey}..${zone.hiKey}`);
    check('強さの範囲が逆転しない', zone.loVel <= zone.hiVel, `${zone.loVel}..${zone.hiVel}`);
    check('鳴らす範囲が逆転しない', zone.start <= zone.end, `${zone.start}..${zone.end}`);
    check('ループが逆転しない', zone.loopStart <= zone.loopEnd, `${zone.loopStart}..${zone.loopEnd}`);
    within('定位', zone.pan, -1, 1);
    within('組', zone.group, 0, 31);
  }

  // 素材を指していないゾーンは、鳴らないので落とす
  const noSample = decodeInstrument({ zones: [{ loKey: 0, hiKey: 127 }, { sampleId: 'ok' }] });
  check('素材の無いゾーンは落とす', noSample.zones.length === 1, `${noSample.zones.length} 個`);

  // 際限なく持たせない
  const many = decodeInstrument({ zones: Array.from({ length: 5000 }, () => ({ sampleId: 'a' })) });
  check('ゾーン数に上限がある', many.zones.length <= MAX_ZONES, `${many.zones.length} 個`);

  // ------------------------------------------------ 3. プロトタイプ汚染
  {
    // JSON.parse は __proto__ を「ただの鍵」として持つ。組み立てにそのまま
    // 使うと、Object.prototype ごと書き換わる
    const hostile = JSON.parse('{"__proto__":{"polluted":"yes"},"zones":[]}');
    decodeInstrument(hostile);
    check('__proto__ で他のオブジェクトが汚れない', {}.polluted === undefined, String({}.polluted));
  }
  {
    const hostile = JSON.parse('{"constructor":{"prototype":{"polluted2":"yes"}},"zones":[]}');
    decodeInstrument(hostile);
    check('constructor 経由でも汚れない', {}.polluted2 === undefined, String({}.polluted2));
  }
  {
    const hostile = JSON.parse(
      '{"app":"yamabiko-sampler","instrument":{"zones":[{"sampleId":"a","__proto__":{"polluted3":"yes"}}]},"samples":[]}'
    );
    decodeProjectFile(hostile);
    check('ゾーンの中からも汚れない', {}.polluted3 === undefined, String({}.polluted3));
  }

  // ------------------------------------------------------- ファイル全体
  check('別のアプリのファイルは受け取らない', decodeProjectFile({ app: 'something-else' }) === null);
  check('中身の無いファイルは受け取らない', decodeProjectFile({ app: 'yamabiko-sampler' }) === null);
  check('ただの文字列は受け取らない', decodeProjectFile('hello') === null);

  {
    // base64 でない素材は、復号でつまずく前にここで落とす
    const file = decodeProjectFile({
      app: 'yamabiko-sampler',
      instrument: { zones: [{ sampleId: 'a' }] },
      samples: [
        { id: 'a', name: 'ok', sampleRate: 48000, channels: 1, data: 'AAAA' },
        { id: 'b', name: 'bad', sampleRate: 48000, channels: 1, data: '<script>' },
        { id: 'c', name: 'no data', sampleRate: 48000, channels: 1 },
      ],
    });
    check('base64 でない素材を落とす', file?.samples.length === 1, `${file?.samples.length} 件`);
  }

  {
    // id は参照にしか使わないので、余計な文字を通さない
    const file = decodeProjectFile({
      app: 'yamabiko-sampler',
      instrument: { zones: [] },
      samples: [{ id: '../../etc/passwd', name: 'x', sampleRate: 48000, channels: 1, data: 'AAAA' }],
    });
    const id = file?.samples[0]?.id ?? '';
    check('id からパスの区切りを落とす', !id.includes('/') && !id.includes('.'), id);
  }

  // ------------------------------------------------------ ファイル名
  check('ファイル名からパスの区切りを落とす', !safeName('../../evil').includes('/'), safeName('../../evil'));
  check('ファイル名が空にならない', safeName('///') !== '', safeName('///'));
  check(
    'ファイル名から制御文字を落とす',
    !/[\u0000-\u001f\u007f]/.test(safeName('a\u0000b\u001fc')),
    JSON.stringify(safeName('a\u0000b\u001fc'))
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n壊れたファイルを渡しても安全に扱えています');
