/*
 * 日本語と英語の辞書が、鍵の集合として一致しているかを見る。
 *
 * 5本は `const en: typeof ja` と書いてあるので型検査が守ってくれるが、
 * **piano と sampler は Record<string, string>** なので、片方だけ足しても
 * 何も言われずに通ってしまう。
 *
 * 訳が抜けると、英語で開いているのに日本語がそのまま出る
 * （t() は英語→日本語→鍵、の順に落ちるため、画面は壊れず気づけない）。
 * 世界に向けて売る以上、ここは見張っておきたい。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPS = ['synthesizer', 'piano', 'drums', 'guitar', 'bass', 'vocal', 'sampler'];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    console.log(` FAIL  ${name}${detail ? `  … ${detail}` : ''}`);
    failures++;
  }
}

/** `const ja = { … };` の本体を取り出す */
function body(source, name) {
  const re = new RegExp(`^const ${name}[^=]*= \\{(.*?)^\\};`, 'ms');
  const m = re.exec(source);
  return m ? m[1] : null;
}

/** 2スペース字下げの `'key':` を鍵とみなす */
function keys(text) {
  return new Set([...text.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
}

console.log('アプリ         日本語  英語   状態');
console.log('--------------------------------------------');

for (const app of APPS) {
  const source = await readFile(resolve(ROOT, app, 'src/ui/strings.ts'), 'utf8');
  const ja = body(source, 'ja');
  const en = body(source, 'en');
  if (!ja || !en) {
    check(`${app}: 辞書を読み取れる`, false, '書き方が変わった可能性があります');
    continue;
  }
  const a = keys(ja);
  const b = keys(en);
  const missingEn = [...a].filter((k) => !b.has(k));
  const missingJa = [...b].filter((k) => !a.has(k));

  console.log(
    app.padEnd(14),
    String(a.size).padEnd(7),
    String(b.size).padEnd(6),
    missingEn.length + missingJa.length === 0 ? '一致' : '欠けています'
  );
  check(`${app}: 英語に訳が揃っている`, missingEn.length === 0, missingEn.slice(0, 5).join(' '));
  check(`${app}: 日本語に訳が揃っている`, missingJa.length === 0, missingJa.slice(0, 5).join(' '));
  check(`${app}: 訳が空でない`, !/^ {2}'[^']+': '',$/m.test(ja + en));
}

if (failures) {
  console.error(`\n${failures} 件の不合格`);
  process.exit(1);
}
console.log('\n7本とも、日本語と英語の訳が揃っています');
