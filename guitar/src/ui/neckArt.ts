/**
 * ヘッドとボディを描く。
 *
 * 弦は糸巻きに巻かれ、ナットを通り、ブリッジで留まっている。その両端が
 * 無いと、木の板に線を引いたものにしか見えない。指板は横に送れるので、
 * 左いっぱいでヘッド、右いっぱいでブリッジが出る。
 *
 * ■ 寸法は実物のミリで書く
 *
 * 一度目は「面の高さ」と「面の幅」を混ぜて大きさを出し、糸巻きが重なって
 * 潰れた。二度目は基準を1つにしたが、今度は形が合わなかった。理由は、
 * 縦と横で縮尺が違うことを勘定に入れていなかったから。
 *
 *   縦 … 弦の広がり（ナットで 35mm）が、そのまま画面の弦の間隔になる
 *   横 … ヘッドの長さ 165mm を、決めた幅に押し込む
 *
 * この2つは一致しない。横のほうが縮む。実物を斜め上から見たときと同じで、
 * そこで大事なのは「すべての部品が同じ割合で縮む」こと。丸い糸巻きは
 * 縦長の楕円になり、間隔も同じだけ詰まる。ばらばらに決めると、
 * 大きさだけ実物、間隔だけ画面、という前回の壊れ方になる。
 *
 * そこで、寸法は実物のミリで書き、X() と Y() を通して画面に移す。
 * 数字を読めば実物のどこの寸法か分かるようにしてある。
 *
 * 絵は読み込まず、その場で描く（通信を増やさないため）。
 */

export interface NeckColors {
  /** 指板の木（濃いほう） */
  wood: string;
  /** ヘッドの木。ふつうはメイプルなので指板より明るい */
  head: string;
  /** ボディの色 */
  body: string;
  /** ピックガード */
  guard: string;
  /** 金物（糸巻き・ブリッジ） */
  metal: string;
}

/**
 * 弦が通る帯。指板の1弦と6弦の中心を、面の高さに対する割合で渡す。
 *
 * ここが合っていないと、ヘッドから来た弦が指板の弦とつながらず、
 * 継ぎ目で折れて見える。実測した値を使う。
 */
export interface StringBand {
  top: number;
  bottom: number;
}

/**
 * 楽器の系統。
 *
 * 音色ごとの「見立て」（looks.ts）は10種類あるが、ヘッドとボディの
 * 作りそのものは2つに分かれる。ここを1つにまとめていたころは、
 * アコースティックを選んでいるのにトレモロブリッジとピックガードが
 * 出ていた。弦を留める仕組みが違うものを同じ絵で描いてはいけない。
 *
 *   electric  … 片側6連のヘッド、ピックガード、ピックアップ、ブリッジ
 *   acoustic  … 3対3のヘッド、サウンドホール、ブリッジピン
 */
export type NeckKind = 'electric' | 'acoustic';

/** ナットでの1弦〜6弦の広がり（ストラトの実寸） */
const SPREAD_MM = 35;
/** ナットからヘッド先端まで */
const HEAD_MM = 165;
/*
 * ボディ側に描く長さ。
 *
 * 実物では 24 フレットの位置からブリッジまで 162mm、その先に胴が続く。
 * だがこの縮尺（弦の間隔から出るので 1mm ≒ 12px）でそのまま描くと、
 * いちばん手前のピックアップだけで画面の高さを超え、何を見ているのか
 * 分からない板になる。実際そう言われた。
 *
 * そこで、間の何も無いところを詰めて 200mm ぶんの窓にしてある。
 * ピックアップ3つとブリッジの並びは実物の比率のまま。こうすると
 * ボディの端ひとそろいが、送らずに1画面へ収まる。
 */
const BODY_MM = 200;
/** ブリッジのサドルの位置（ボディ面の左端から） */
const BRIDGE_MM = 160;
/** ボディの奥行き。指板との継ぎ目を 1、いちばん奥を BODY_TIP とする */
const BODY_TIP = 0.15;

/**
 * 弦の太さ（mm）。1弦から6弦へ。009-042 の標準的な組み合わせ。
 * 指板側の弦もこの表から引くので、継ぎ目で太さが変わらない。
 */
export const STRING_MM = [0.23, 0.30, 0.43, 0.66, 0.89, 1.17];

/** 決まった種を持つ乱数。木目が画面の大きさを変えるたびに踊らないように */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 遠近。手前を 1、いちばん奥を tip として、その間を結ぶ。
 *
 * 直線で結ぶ（1 → tip をまっすぐ）と、奥がまだ大きすぎた。実際の
 * 見え方は 1/(1 + k·距離) で、手前で急に縮んで奥では緩やかになる。
 * ブリッジの台（実寸 84mm）が画面に収まるかどうかは、この形の違いで
 * 決まった（直線では 620px、こちらでは 265px）。
 *
 *   near  … その位置での縮み。物の大きさに掛ける
 *   along … そこまでの見かけの距離。手前ほど mm あたりが広い
 */
function perspective(lengthMm: number, tip: number) {
  const k = (1 / tip - 1) / lengthMm;
  const near = (mm: number) => 1 / (1 + k * mm);
  const along = (mm: number) => Math.log(1 + k * mm) / k;
  return { near, along, span: along(lengthMm) };
}

/** 折れ線を、角の取れた曲線としてなぞる */
function through(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  g.lineTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 2; i++) {
    const [x1, y1] = pts[i + 1];
    const [x2, y2] = pts[i + 2];
    g.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last[0], last[1]);
}

/**
 * 閉じた輪郭を、角の取れた曲線としてなぞる。
 *
 * through() は「始まりと終わりが繋がらない線」を引く。ブリッジのように
 * ぐるりと閉じる形にそのまま使うと、最後だけ直線で戻るので、そこに
 * 平らな切り欠きが出た。始点を辺の真ん中に置いて、全周を同じ引き方で回る。
 */
function loop(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  const n = pts.length;
  const mid = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  g.beginPath();
  g.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const m = mid(cur, next);
    g.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  g.closePath();
}

/** 金物の丸み。上が光って下に影が落ちる */
function metal(
  g: CanvasRenderingContext2D,
  y: number, h: number, base: string
): CanvasGradient {
  return chrome(g, y, h, base);
}

/** #rgb / #rrggbb を読む。読めなければクロムの既定色 */
function rgbOf(hex: string): [number, number, number] {
  const t = hex.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)];
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  return [200, 205, 210];
}

/** 色を白（t>0）または黒（t<0）へ寄せる */
function mix(rgb: [number, number, number], t: number): string {
  const to = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const v = rgb.map((c) => Math.round(c + (to - c) * k));
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
}

/**
 * クロムの塗り。
 *
 * ■ なぜ滑らかなグラデーションでは金属に見えないか
 *
 * 磨いた金属は、自分の色を持たずに周りを映す。上半分には明るい空が、
 * 下半分には暗い床が映り、その境目（地平線）が真ん中に鋭い暗い帯として
 * 出る。これが金属とプラスチックを分ける、いちばん強い手がかり。
 *
 * ここを「上が白くて下が黒い」だけの滑らかな帯にしていたので、
 * どれだけ形を合わせても樹脂の部品に見えていた。明→暗→明と折り返す
 * 段を入れると、同じ図形がそのままクロムになる。
 *
 * 色は金物の色（クロム／ゴールド）から作るので、金メッキの楽器でも
 * 同じ構造のまま色だけ変わる。
 */
const CHROME_RAMP: [number, number][] = [
  [0.0, -0.18], [0.14, 0.85], [0.3, 0.12], [0.42, -0.52],
  [0.5, -0.74], [0.58, -0.22], [0.74, 0.62], [0.88, -0.04], [1.0, -0.52],
];

function chrome(
  g: CanvasRenderingContext2D, y: number, h: number, base: string
): CanvasGradient {
  const rgb = rgbOf(base);
  const grad = g.createLinearGradient(0, y, 0, y + Math.max(1, h));
  for (const [at, t] of CHROME_RAMP) grad.addColorStop(at, mix(rgb, t));
  return grad;
}

/**
 * 磨き目。金属の面を、光の向きに細かく走る筋。
 * 一様な塗りのままだと、大きな面ほど作り物に見える。
 */
function brushed(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, seed: number
): void {
  const rnd = seeded(seed);
  const lines = Math.max(10, Math.round(h / 3));
  for (let i = 0; i < lines; i++) {
    const ly = y + rnd() * h;
    g.beginPath();
    g.moveTo(x, ly);
    g.lineTo(x + w, ly);
    g.strokeStyle = rnd() > 0.5
      ? `rgba(255, 255, 255, ${0.03 + rnd() * 0.07})`
      : `rgba(0, 0, 0, ${0.03 + rnd() * 0.07})`;
    g.lineWidth = 0.5 + rnd() * 1.2;
    g.stroke();
  }
}

/**
 * フィルムグレイン。面の全体に、画素ほどの細かなざらつきを掛ける。
 *
 * これが無いと、どれだけ陰影を足しても「ベクターの絵」に見える。
 * 写真にはレンズとセンサーのざらつきが必ず乗っていて、目はそれを
 * 「実物を写したもの」の印になっている。灰色の雑音を overlay で
 * 薄く重ねるだけで、同じ絵が急に写真寄りになる。
 *
 * 画素の大きさで掛けたいので、いったん拡大率を戻してから塗る。
 */
let noiseTile: HTMLCanvasElement | null = null;
function tile(): HTMLCanvasElement | null {
  if (noiseTile) return noiseTile;
  if (typeof document === 'undefined') return null;
  const n = document.createElement('canvas');
  n.width = 128;
  n.height = 128;
  const tg = n.getContext('2d');
  if (!tg) return null;
  const img = tg.createImageData(128, 128);
  const rnd = seeded(0x2f19a7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(128 + (rnd() - 0.5) * 210)));
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tg.putImageData(img, 0, 0);
  noiseTile = n;
  return n;
}

function filmGrain(g: CanvasRenderingContext2D, alpha: number): void {
  const t = tile();
  if (!t) return;
  const pat = g.createPattern(t, 'repeat');
  if (!pat) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = alpha;
  g.fillStyle = pat;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}

/**
 * 弦を1本引く。折れ点の並びで受け取る。
 *
 * ■ 光らせ方
 * はじめは縦のグラデーションを持つ1本の線で引いていた。真横に走る弦なら
 * それで丸く見えるが、ヘッドやブリッジへ斜めに向かう弦では、線の大半が
 * グラデーションの範囲から外れて端の色（暗い）で塗り潰され、黒い帯に
 * なっていた。向きに関係なく丸く見せるには、太い暗線の上に細い明線を
 * 少しずらして重ねる。これなら斜めでも斜めなりに光る。
 *
 * ■ なぜ2点ではなく並びで受け取るか
 * 弦は空中では真っすぐだが、奥行きをつけた面の上では真っすぐには写らない。
 * 2点を直線で結んでいたときは、弦がピックアップのポールピースの上を
 * 通らず、横にずれていった。同じ座標の作りで刻んだ点を繋げば、
 * ポールピースともサドルとも必ず合う。
 *
 * ■ 太さも点ごとに渡せる
 * 奥へ向かう弦は、細く見えていく。太さを一定にしていたときは、ナットで
 * 13px の帯が6本、小さくなったヘッドへ向かって扇に開いていて、
 * 何の絵なのか分からなかった。奥ほど細くすれば、素直に遠ざかって見える。
 */
function stringOn(
  g: CanvasRenderingContext2D,
  pts: [number, number][],
  t: number | number[], wound: boolean
): void {
  if (pts.length < 2) return;
  const at = (i: number) => (typeof t === 'number' ? t : t[Math.min(i, t.length - 1)]);
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  // 線に直交する向き。ここへ明線をずらす
  const ux = -(y1 - y0) / len;
  const uy = (x1 - x0) / len;
  const pass = (shift: number, scale: number, color: string) => {
    g.lineCap = 'round';
    g.strokeStyle = color;
    for (let i = 1; i < pts.length; i++) {
      const w = ((at(i - 1) + at(i)) / 2) * scale;
      const ox = ux * ((at(i - 1) + at(i)) / 2) * shift;
      const oy = uy * ((at(i - 1) + at(i)) / 2) * shift;
      g.beginPath();
      g.moveTo(pts[i - 1][0] + ox, pts[i - 1][1] + oy);
      g.lineTo(pts[i][0] + ox, pts[i][1] + oy);
      g.lineWidth = Math.max(0.5, w);
      g.stroke();
    }
  };
  pass(0, 1, wound ? '#6b6250' : '#7a746a');
  pass(0.2, 0.62, wound ? '#c8bc98' : '#ddd6c8');
  pass(0.38, 0.3, wound ? '#f7f0dc' : '#fdfbf6');
}

/**
 * 面のいちばん上に重ねる、光と影。
 *
 * 平らな塗りを並べるだけだと、どれだけ形を合わせても「切り絵」に見える。
 * 実物の写真で効いているのは、奥へ向かって落ちる暗さと、面の上を斜めに
 * 走る光の帯、そして上下の縁が沈むこと。この3つを最後に掛けるだけで、
 * 同じ図形が「板」から「物」になる。
 *
 *   fade … 奥（右／左）へ向かってどれだけ沈めるか
 *   dir  … 沈む向き。1 なら右が奥、-1 なら左が奥
 */
function finish(
  g: CanvasRenderingContext2D, w: number, h: number, fade: number, dir: number
): void {
  // 斜めに走る光の帯
  const sheen = g.createLinearGradient(0, 0, w * 0.8, h);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(0.42, 'rgba(255, 255, 255, 0.075)');
  sheen.addColorStop(0.58, 'rgba(255, 255, 255, 0.03)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);

  // 奥へ向かって沈む
  const away = dir > 0
    ? g.createLinearGradient(0, 0, w, 0)
    : g.createLinearGradient(w, 0, 0, 0);
  away.addColorStop(0, 'rgba(0, 0, 0, 0)');
  away.addColorStop(0.55, `rgba(0, 0, 0, ${fade * 0.35})`);
  away.addColorStop(1, `rgba(0, 0, 0, ${fade})`);
  g.fillStyle = away;
  g.fillRect(0, 0, w, h);

  // 上下の縁が沈む
  const edge = g.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  edge.addColorStop(0.24, 'rgba(0, 0, 0, 0.03)');
  edge.addColorStop(0.78, 'rgba(0, 0, 0, 0.05)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.46)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
}

/**
 * 金物の丸い部品（ポールピース・ネジ・つまみ・糸巻きの軸）。
 *
 * 面から浮いて見えるかどうかは、次の4枚の重ね順でほぼ決まる。
 *
 *   1. 接地影 … 部品が面に触れているすぐ外側の、狭くて濃い影。
 *               ぼかした落ち影だけだと、浮いているのに触れていない
 *               ように見える（実際そう見えていた）
 *   2. 本体   … クロムの映り込み（chrome）。滑らかな灰色では樹脂になる
 *   3. 縁     … 上側に明るい細線、下側に暗い細線。厚みが出る
 *   4. 光点   … 小さく鋭いハイライト。金属はここが一点に集まる
 */
type Material = 'chrome' | 'steel' | 'plastic';

function stud(
  g: CanvasRenderingContext2D,
  x: number, y: number, rx: number, ry: number, base: string,
  mat: Material = 'chrome'
): void {
  const ring = (kx: number, ky: number, f: number) => {
    g.beginPath();
    g.ellipse(x + kx, y + ky, rx * f, ry * f, 0, 0, Math.PI * 2);
  };

  // 1. 接地影
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = Math.max(1, ry * 0.35);
  g.shadowOffsetY = Math.max(0.5, ry * 0.2);
  ring(0, 0, 1.02);
  g.fillStyle = 'rgba(0, 0, 0, 0.85)';
  g.fill();
  g.restore();

  // 2. 本体
  ring(0, 0, 1);
  if (mat === 'plastic' || mat === 'steel') {
    /*
     * 樹脂は周りを映さない。上から素直に明るく、下へ落ちるだけ。
     * つまみにクロムの段を掛けていたころは、白いプラスチックの
     * ノブが金属の円盤に見えていた。ポールピースのような小さな鉄も
     * 同じで、段を出すと真ん中の暗い帯がネジの溝に見えてしまう。
     * 鋭く映り込むのは、磨いたクロムの大きな面だけ。
     */
    const rgb = rgbOf(base);
    const pl = g.createLinearGradient(0, y - ry, 0, y + ry);
    pl.addColorStop(0, mix(rgb, mat === 'steel' ? 0.75 : 0.55));
    pl.addColorStop(0.3, mix(rgb, mat === 'steel' ? 0.25 : 0.12));
    pl.addColorStop(0.7, mix(rgb, -0.18));
    pl.addColorStop(1, mix(rgb, mat === 'steel' ? -0.62 : -0.5));
    g.fillStyle = pl;
  } else {
    g.fillStyle = chrome(g, y - ry, ry * 2, base);
  }
  g.fill();


  // 3. 縁
  ring(0, 0, 1);
  const edge = g.createLinearGradient(0, y - ry, 0, y + ry);
  edge.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  edge.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  edge.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  g.strokeStyle = edge;
  g.lineWidth = Math.max(0.6, ry * 0.12);
  g.stroke();

  // 4. 光点
  if (mat === 'plastic') return;
  const sx = x - rx * 0.3;
  const sy = y - ry * 0.42;
  const spot = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, ry * 0.5));
  spot.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  spot.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
  spot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.beginPath();
  g.ellipse(sx, sy, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2);
  g.fillStyle = spot;
  g.fill();
}

/**
 * メイプルの杢（トラ目）。木目と直交して走る、細かな明暗の縞。
 *
 * 長手方向の木目だけだと、色を塗った板にしか見えない。実物のメイプルは
 * これがあるから木に見える。強く出すと安物の化粧板になるので、
 * 触れるか触れないかの濃さで置く。
 */
function flame(
  g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength: number
): void {
  const rnd = seeded(seed);
  const bands = Math.max(10, Math.round(w / 26));
  for (let i = 0; i < bands; i++) {
    const x = rnd() * w;
    const lean = (rnd() - 0.5) * w * 0.06;
    g.beginPath();
    g.moveTo(x, -h * 0.05);
    g.quadraticCurveTo(x + lean, h * 0.5, x + lean * 0.3, h * 1.05);
    g.strokeStyle = rnd() > 0.5
      ? `rgba(70, 45, 22, ${(0.02 + rnd() * 0.05) * strength})`
      : `rgba(255, 238, 205, ${(0.02 + rnd() * 0.06) * strength})`;
    g.lineWidth = 3 + rnd() * 9;
    g.stroke();
  }
}

/**
 * 大きなむら。木の面が一様に明るいと、板を塗った色に見える。
 * 幅の広いぼやけた斑を数枚重ねて、光の当たり方を不揃いにする。
 */
function blotch(
  g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength: number
): void {
  const rnd = seeded(seed);
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.25 + rnd() * 0.45) * Math.max(w, h);
    const up = rnd() > 0.5;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, up
      ? `rgba(255, 236, 200, ${0.05 * strength})`
      : `rgba(40, 24, 10, ${0.07 * strength})`);
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  }
}

/** 木目。長手方向に流れる、太さの揃わない線 */
function grain(
  g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength: number
): void {
  const rnd = seeded(seed);
  const lines = Math.max(30, Math.round(h / 7));
  for (let i = 0; i < lines; i++) {
    const y = rnd() * h;
    const sway = (rnd() - 0.5) * h * 0.05;
    g.beginPath();
    g.moveTo(-w * 0.05, y);
    g.quadraticCurveTo(w * 0.5, y + sway, w * 1.05, y + sway * 0.4);
    const dark = rnd() > 0.45;
    g.strokeStyle = dark
      ? `rgba(28, 16, 8, ${(0.03 + rnd() * 0.09) * strength})`
      : `rgba(255, 226, 186, ${(0.02 + rnd() * 0.05) * strength})`;
    g.lineWidth = 0.4 + rnd() * 2.2;
    g.stroke();
  }
}

/**
 * ヘッド（糸巻きのある先端）。右端がナットで、そこから左へ伸びる。
 *
 * エレキは片側6連（低音弦の糸巻きがナットにいちばん近い）、
 * アコースティックは3対3。弦を巻く向きが違うので、同じ絵では描けない。
 *
 * ■ 遠近をつける
 *
 * 弦の間隔は、指で押さえられる大きさから決まっていて、実寸に直すと
 * 1mm がおよそ 14px になる。その縮尺のままヘッドを描くと、幅 82mm の
 * ヘッドは 1150px になり、画面の高さ（648px）に収まらない。前は
 * これで画面いっぱいの木の塊になっていた。
 *
 * 実物を構えて見下ろすと、ヘッドは遠いぶん小さく見え、弦はそちらへ
 * 向かってすぼまっていく。写真もそう写っている。だから縮めるのは
 * ごまかしではなく、そちらのほうが実物に近い。
 *
 * TIP の決め方には幅がある。
 *
 *   弱すぎる（0.42）… ヘッドが画面いっぱいの木の塊になり、何を見て
 *                      いるのか分からない
 *   強すぎる（0.12）… ナットの側だけが画面の高さいっぱいに開き、
 *                      そこから急に細るので、魚の尾びれに見える
 *
 * 0.3 は、ナット（幅 42mm）とヘッドのいちばん広いところ（82mm）が
 * 画面では 1.4 倍しか違わない見え方になる。実物のネックからヘッドへの
 * 広がりがそのくらいなので、継ぎ目で形が破綻しない。
 */
const TIP = 0.3;

export function drawHeadstock(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: NeckColors,
  strings: number,
  band: StringBand,
  kind: NeckKind = 'electric'
): void {
  g.clearRect(0, 0, w, h);

  const topY = h * band.top;
  const botY = h * band.bottom;
  const cy = (topY + botY) / 2;
  const py = (botY - topY) / SPREAD_MM;

  const { near, along, span } = perspective(HEAD_MM, TIP);
  /** ナットからの距離（mm）→ 画面の x。右端がナット */
  const X = (mm: number) => w - (w * along(mm)) / span;
  /** 中心からのずれ（mm、上が負）→ 画面の y */
  const Y = (mm: number, off: number) => cy + off * py * near(mm);
  const P = (mm: number, off: number): [number, number] => [X(mm), Y(mm, off)];
  /** 丸い物の横半径。縦と同じ割合だけ詰める */
  const flat = (w / span) / py;

  // ── 輪郭 ──
  // エレキ（ストラト）は低音側だけが外へ膨らみ、先端で丸く収まる。
  // アコースティックはほぼ左右対称で、先端がゆるく広がる
  /*
   * どちらが低音側か。
   *
   * この画面は指板のいちばん下が 6弦（低音）。実物を構えたときとは
   * 上下が逆なので、糸巻きも低音側＝下に付く。上に付けていたときは、
   * 6弦がナットの下から上の糸巻きへ、1弦が上から下へ渡って、
   * ヘッドの上で弦が×に交差していた。
   */
  const outline: [number, number][] = kind === 'electric'
    ? [
        P(0, 21), P(25, 27), P(60, 35), P(95, 40),
        P(125, 41), P(147, 35), P(159, 22), P(164, 6),
        P(161, -6), P(150, -13), P(126, -17), P(92, -20),
        P(50, -21), P(20, -21), P(0, -21),
      ]
    : [
        P(0, -22), P(30, -28), P(70, -34), P(110, -37),
        P(145, -37), P(158, -32), P(163, -20), P(164, 0),
        P(163, 20), P(158, 32), P(145, 37), P(110, 37),
        P(70, 34), P(30, 28), P(0, 22),
      ];
  const trace = () => {
    g.beginPath();
    g.moveTo(outline[0][0], outline[0][1]);
    through(g, outline);
    g.closePath();
  };

  trace();
  g.save();
  g.clip();

  const wood = g.createLinearGradient(0, Y(0, -22), 0, Y(0, 42));
  wood.addColorStop(0, 'rgba(255, 244, 222, 0.22)');
  wood.addColorStop(0.22, c.head);
  wood.addColorStop(0.72, c.head);
  wood.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  g.fillStyle = wood;
  g.fillRect(0, 0, w, h);
  /*
   * 杢（flame）と木目（grain）を同じ濃さで重ねたら、縦線と横線が
   * 網の目になり、木ではなく布に見えていた。杢はうんと薄くし、
   * 代わりに大きなむら（blotch）で不揃いさを出す。
   */
  blotch(g, w, h, 0x2a67, 1);
  grain(g, w, h, 0x51d0, 0.75);
  flame(g, w, h, 0x7c41, 0.3);

  // 面の丸み。中央が明るく、縁が落ちる
  const round = g.createLinearGradient(0, Y(0, -21), 0, Y(0, 41));
  round.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  round.addColorStop(0.3, 'rgba(255, 240, 215, 0.08)');
  round.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  g.fillStyle = round;
  g.fillRect(0, 0, w, h);
  g.restore();

  trace();
  g.strokeStyle = 'rgba(0, 0, 0, 0.72)';
  g.lineWidth = Math.max(1, py * 0.25);
  g.stroke();

  /*
   * 糸巻きの位置。
   *
   *   エレキ  … 片側6連。間隔 23mm、低音弦がナット側
   *   アコギ  … 3対3。低音側の3本が上、高音側の3本が下
   *
   * i は 0 が低音弦（6弦）。実物の巻き順に合わせてある
   */
  const posts: { mm: number; off: number }[] = kind === 'electric'
    ? [
        { mm: 20, off: 15 }, { mm: 43, off: 20 }, { mm: 66, off: 24 },
        { mm: 89, off: 27 }, { mm: 112, off: 28 }, { mm: 135, off: 26 },
      ]
    : [
        /*
         * 3対3。低音側の3本が上、高音側の3本が下。
         *
         * 中心から 20〜27mm は、ヘッドの縁（35mm ほど）より内側。前は
         * 30〜34mm に置いていたので、糸巻きが板の外に浮いていた。
         * 並び順も実物に合わせてある（6弦がいちばん先、4弦がナット寄り）。
         * ナット寄りの糸巻きほど中心に近いのは、そうしないと内側の弦が
         * 外側の弦を追い越して交差するため。
         */
        { mm: 116, off: 27 }, { mm: 80, off: 24 }, { mm: 44, off: 20 },
        { mm: 44, off: -20 }, { mm: 80, off: -24 }, { mm: 116, off: -27 },
      ];

  for (let i = 0; i < strings; i++) {
    const post = posts[Math.min(i, posts.length - 1)];
    // 弦。ナット（右端）からこのポストへ。i=0 が低音弦
    const nutMM = -SPREAD_MM / 2 + (SPREAD_MM * (strings - 1 - i)) / (strings - 1);
    const gauge = STRING_MM[Math.min(strings - 1 - i, STRING_MM.length - 1)];
    // i=0 が低音弦。巻いてあるのは低音側の3本
    const path: [number, number][] = [];
    const wide: number[] = [];
    for (let k = 0; k <= 10; k++) {
      const mm = (post.mm * k) / 10;
      const off = nutMM + (post.off - nutMM) * (k / 10);
      path.push([X(mm), Y(mm, off)]);
      wide.push(Math.max(0.7, gauge * py * near(mm) * 0.85));
    }
    stringOn(g, path, wide, i < 3);
  }

  for (let i = 0; i < strings; i++) {
    const post = posts[Math.min(i, posts.length - 1)];
    const pxc = X(post.mm);
    const pyc = Y(post.mm, post.off);
    // 遠いポストほど小さい。丸い物なので、横は縦と同じ割合で潰す
    const ry = 5 * py * near(post.mm);
    const rx = ry * flat;
    /*
     * 座金 → 落ち込み → 軸 → 巻いた弦、の順で重ねる。
     *
     * 前は平らな楕円を2枚重ねただけだったので、木の上に銀色の目玉が
     * 並んでいるように見えていた。実物で分かるのは、面より一段低い
     * 落ち込みと、そこから立っている軸と、その軸に巻かれた弦。
     */
    stud(g, pxc, pyc, rx, ry, c.metal, 'chrome');
    // 座金の内側の落ち込み
    g.beginPath();
    g.ellipse(pxc, pyc, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    const hole = g.createLinearGradient(0, pyc - ry * 0.62, 0, pyc + ry * 0.62);
    hole.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    hole.addColorStop(0.7, 'rgba(120, 126, 132, 0.5)');
    hole.addColorStop(1, 'rgba(255, 255, 255, 0.4)');
    g.fillStyle = hole;
    g.fill();
    // 弦を巻く軸
    stud(g, pxc, pyc, rx * 0.4, ry * 0.4, '#d3d8dc', 'chrome');
    // 軸に巻かれた弦
    for (const t of [0.55, 0.78]) {
      g.beginPath();
      g.ellipse(pxc, pyc, rx * 0.4 * t, ry * 0.4 * t, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(60, 58, 52, 0.45)';
      g.lineWidth = Math.max(0.5, ry * 0.05);
      g.stroke();
    }
  }

  /*
   * ロゴ。実物のヘッドには必ず何か書いてある。無地のままだと、
   * 形は合っていても「木を切り抜いた絵」に見える。
   * 他社の名前は載せられないので、このアプリの名前を入れる。
   */
  {
    const logoMM = 86;
    const size = 11 * py * near(logoMM);
    if (size > 7) {
      g.save();
      g.translate(X(logoMM), Y(logoMM, -4));
      /*
       * ネックの傾きに合わせて寝かせる。
       *
       * 向きは「ナット側 → 先端側」で取る。逆に取ると、この面では
       * ナットが右にあるぶん角度が 180 度回り、文字が上下逆さまの
       * 鏡文字になる（一度そうなった）。
       */
      const ax = X(logoMM - 20) - X(logoMM + 20);
      const ay = Y(logoMM - 20, -4) - Y(logoMM + 20, -4);
      g.rotate(Math.atan2(ay, ax));
      g.font = `italic 600 ${size}px "Times New Roman", "Hiragino Mincho ProN", serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(28, 18, 8, 0.4)';
      g.fillText('Kagari', 0, size * 0.04);
      g.fillStyle = 'rgba(255, 246, 226, 0.55)';
      g.fillText('Kagari', 0, 0);
      g.restore();
    }
  }

  // ── ストリングガイド（1・2弦を押さえる金具）。片側6連だけに付く ──
  if (kind === 'electric') {
    /*
     * 1・2弦をナットへ押さえつける金具。実物ではナットから 52mm ほどの
     * ところで、その2本の弦の真上に付いている。中心線からの距離で
     * 置いていたときは、弦が上へ寄っているぶん独りだけ面の真ん中に
     * 浮いていた。弦の通り道そのものから位置を出す
     */
    const guideAt = 52;
    const top = posts[Math.min(strings - 1, posts.length - 1)];
    const nutTop = -SPREAD_MM / 2;
    const gRy = 2.6 * py * near(guideAt);
    const gy = Y(guideAt, nutTop + (top.off - nutTop) * (guideAt / top.mm));
    g.beginPath();
    g.ellipse(X(guideAt), gy, gRy * flat, gRy, 0, 0, Math.PI * 2);
    g.fillStyle = metal(g, gy - gRy, gRy * 2, c.metal);
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 0.7;
    g.stroke();
  }

  /*
   * ナットはここには描かない。
   *
   * 指板側の「開放弦」の列の右端に、すでに牛骨のナットが立っている
   * （.fb-cell.open::before）。ここにも描くと、ナットが離れて2本並ぶ。
   * 弦を留めている物は1つだけにする。
   */

  // 最後に、奥へ向かう暗さと面の光、そして画素のざらつきを掛ける
  finish(g, w, h, 0.4, -1);
  filmGrain(g, 0.13);
}

/**
 * ボディ。左端が 24 フレットの位置で、そこから右へ 234mm。
 *
 * エレキはピックガード・ピックアップ3つ・トレモロブリッジ・つまみ。
 * アコースティックはサウンドホールとブリッジピン。弦をどこで留めて
 * いるかが違うので、ここも作りごと分ける。
 *
 * ■ ここにも奥行きをつける
 *
 * 弦の間隔から出る縮尺のままだと、ブリッジの台（実寸 84mm）だけで
 * 1000px を超え、画面には金物の一部しか映らなかった。何を見ているのか
 * 分からない絵になる。ヘッドと同じように、継ぎ目から奥へ向かって
 * 縮ませる。弦もそれに沿ってすぼまる。
 */
export function drawBody(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: NeckColors,
  strings: number,
  band: StringBand,
  kind: NeckKind = 'electric'
): void {
  g.clearRect(0, 0, w, h);

  const topY = h * band.top;
  const botY = h * band.bottom;
  const cy = (topY + botY) / 2;
  /*
   * 継ぎ目での 1mm。
   *
   * 指板から渡ってきた弦の広がりは、そこでは 35mm（ナットと同じ）。
   * ブリッジへ向かって 42mm まで広がるのは、その先の話。
   * ここを 42 で割っていたので、ボディ側の弦だけが 35/42＝83% の
   * 幅に縮み、継ぎ目で6本いっせいに段差ができていた。
   */
  const py = (botY - topY) / 35;

  const { near, along, span } = perspective(BODY_MM, BODY_TIP);
  const X = (mm: number) => (w * along(mm)) / span;
  const Y = (mm: number, off: number) => cy + off * py * near(mm);
  const P = (mm: number, off: number): [number, number] => [X(mm), Y(mm, off)];
  const flat = (w / span) / py;
  /*
   * 弦の通り道。i 番目（0 が高音側）の弦が、継ぎ目から mm 進んだ
   * ところで中心からどれだけ離れているか（ナットで 35mm、ブリッジで 42mm）。
   *
   * ピックアップのポールピースもサドルもこれで置く。前は「その位置での
   * 弦の広がり」を別に出していたうえ、ポールピースの x は箱の端から、
   * y は箱の中心の mm から、と出どころが食い違っていた。そのため弦が
   * 玉の上を通らず、少しずつずれていった。通り道を1か所に持てば、
   * ずれようがない。
   */
  /*
   * トレモロの台。弦を引く輪の中でも使うので、ここで出しておく
   * （駒を台の中に収めたいが、台は先に描いてしまうため）
   */
  const plateH = 42 * py * near(BRIDGE_MM);
  const plateL = X(BRIDGE_MM - 8);
  const plateR = X(BRIDGE_MM + 30);
  const plateW = plateR - plateL;

  const stringOff = (i: number, mm: number) => {
    const a = -35 / 2 + (35 * i) / (strings - 1);
    const b = -42 / 2 + (42 * i) / (strings - 1);
    return a + (b - a) * Math.min(1, mm / BRIDGE_MM);
  };

  // ── ボディの塗り ──
  const paint = g.createLinearGradient(0, 0, 0, h);
  paint.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  paint.addColorStop(0.32, c.body);
  paint.addColorStop(0.62, c.body);
  paint.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
  g.fillStyle = paint;
  g.fillRect(0, 0, w, h);
  if (kind === 'acoustic') {
    /*
     * スプルースの表板。木目は胴の長手方向に走る。杢を強く出すと
     * 縦縞の板に見えるので、大きなむらのほうで不揃いさを作る。
     */
    blotch(g, w, h, 0x6f18, 0.9);
    grain(g, w, h, 0x9a31, 0.7);
    flame(g, w, h, 0x4d92, 0.16);
  } else {
    /*
     * 塗装のつや。エレキの胴はポリウレタンで鏡のように光るので、
     * 縁に沿って細く強い光が走る。ここが無いと、同じ黒でも
     * 「黒く塗った紙」に見える
     */
    const gloss = g.createLinearGradient(0, 0, 0, h);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gloss.addColorStop(0.07, 'rgba(255, 255, 255, 0.22)');
    gloss.addColorStop(0.13, 'rgba(255, 255, 255, 0.02)');
    gloss.addColorStop(0.86, 'rgba(255, 255, 255, 0.02)');
    gloss.addColorStop(0.93, 'rgba(255, 255, 255, 0.16)');
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gloss;
    g.fillRect(0, 0, w, h);
  }

  if (kind === 'electric') {
    // ── ピックガード。上下は画面の外まで続く ──
    g.save();
    g.beginPath();
    g.moveTo(X(0), 0);
    /*
     * ピックガードの幅。
     *
     * 実物は 250mm（中心から 125mm）あるが、そのまま描くと、この
     * 画面で見える範囲（継ぎ目でおよそ 42mm ぶん）に対して広すぎて、
     * 端から端まで白一色になる。いただいた写真は黒い胴に白いガードが
     * 乗っているところが要で、白しか映らないとその対比が消えてしまう。
     *
     * 縁が画面の半ばから入ってくる ±80mm ほどに詰めてある。
     * こうすると、奥へ行くほど黒い胴が見えてきて、写真と同じ見え方になる。
     */
    through(g, [
      P(0, -64), P(22, -67), P(55, -69),
      P(110, -68), P(155, -65), P(196, -60), [X(196), 0],
    ]);
    g.lineTo(X(196), h);
    through(g, [
      [X(196), h], P(196, 60), P(155, 65), P(110, 68),
      P(55, 69), P(22, 67), P(0, 64),
    ]);
    g.closePath();
    const guard = g.createLinearGradient(0, Y(0, -69), 0, Y(0, 69));
    guard.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    guard.addColorStop(0.3, c.guard);
    guard.addColorStop(0.62, c.guard);
    guard.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    g.fillStyle = guard;
    g.fill();
    /*
     * 縁は3層（白・黒・白）の積層板を斜めに削り出したもので、実物では
     * ここがいちばん目に付く。1本の細い線で描いていたので、紙を切り
     * 抜いて置いたように見えていた。外から順に、影・黒・白と重ねる。
     */
    const ply = Math.max(1.2, py * 0.5);
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = ply * 3;
    g.stroke();
    g.strokeStyle = 'rgba(22, 20, 18, 0.9)';
    g.lineWidth = ply * 1.6;
    g.stroke();
    g.strokeStyle = 'rgba(255, 253, 246, 0.85)';
    g.lineWidth = ply * 0.6;
    g.stroke();
    g.restore();
  } else {
    /*
     * ── サウンドホールとロゼッタ ──
     * 実物は直径 100mm ほど。ネックの付け根から 60mm あたりに開く。
     * 縁には木を寄せた飾り輪（ロゼッタ）が回っている
     */
    const holeMM = 84;
    const hr = 50 * py * near(holeMM);
    const hx = X(holeMM);
    const hy = cy;
    /*
     * ロゼッタ。実物は細い木を何本も寄せた輪が何重にも回っている。
     * 2本だけだと、穴のまわりに線を引いただけに見える。
     */
    const rings: [number, string, number][] = [
      [1.28, 'rgba(38, 22, 12, 0.85)', 2.2],
      [1.22, 'rgba(226, 200, 156, 0.75)', 1.2],
      [1.18, 'rgba(48, 28, 15, 0.8)', 3.2],
      [1.12, 'rgba(232, 208, 166, 0.8)', 2.4],
      [1.07, 'rgba(40, 24, 13, 0.85)', 1.6],
      [1.03, 'rgba(210, 180, 136, 0.6)', 1.0],
    ];
    for (const [ring, color, wide] of rings) {
      g.beginPath();
      g.ellipse(hx, hy, hr * ring * flat, hr * ring, 0, 0, Math.PI * 2);
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, wide * py * near(holeMM));
      g.stroke();
    }
    g.beginPath();
    g.ellipse(hx, hy, hr * flat, hr, 0, 0, Math.PI * 2);
    const hole = g.createLinearGradient(0, hy - hr, 0, hy + hr);
    hole.addColorStop(0, '#120b06');
    hole.addColorStop(0.5, '#050302');
    hole.addColorStop(1, '#1d1208');
    g.fillStyle = hole;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    g.lineWidth = 1;
    g.stroke();
  }

  /*
   * ── 指板の終わり ──
   * 実物でも、指板の先はボディ（ピックガード）の上に乗り上げている。
   * ただし幅を取りすぎると、白いピックガードの上に茶色い帯が引いて
   * あるようにしか見えない。木口の影を濃く入れて、板が「切れている」
   * ことが分かるようにする
   */
  const endW = Math.max(5, X(5));
  const endGrad = g.createLinearGradient(0, 0, endW, 0);
  endGrad.addColorStop(0, c.wood);
  endGrad.addColorStop(0.5, c.wood);
  endGrad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  g.fillStyle = endGrad;
  g.fillRect(0, Y(0, -26), endW, Y(0, 26) - Y(0, -26));

  if (kind === 'electric') {
    // ── ピックアップ。写真と同じ並び（シングル2＋ブリッジにハムバッカー）──
    const pus: { mm: number; wide: boolean }[] = [
      { mm: 62, wide: false },
      { mm: 106, wide: false },
      { mm: 140, wide: true },
    ];
    for (const pu of pus) {
      // 実寸で幅（弦に沿う向き）18mm、長さ（弦をまたぐ向き）70mm
      const half = 35 * py * near(pu.mm);
      const bx = X(pu.mm - (pu.wide ? 19 : 9));
      const bw = X(pu.mm + (pu.wide ? 19 : 9)) - bx;
      /*
       * シングルコイルの樹脂カバーは、白いピックガードとほとんど同じ色。
       * 前は c.guard をそのまま塗っていたので、白の上に白で、細い枠と
       * 銀色の玉だけが浮いた「画面の部品」に見えていた。実物で形が
       * 分かるのは、縁に落ちる影と、黒いポールピースと、両端のネジ。
       * 色ではなくそこで描く。
       */
      const box = () => {
        g.beginPath();
        if (g.roundRect) g.roundRect(bx, cy - half, bw, half * 2, Math.min(bw * 0.28, half * 0.12));
        else g.rect(bx, cy - half, bw, half * 2);
      };
      // 落ち影。ピックガードの上に浮いていることを、これで伝える
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.5)';
      g.shadowBlur = Math.max(3, bw * 0.35);
      g.shadowOffsetY = Math.max(1.5, half * 0.05);
      box();
      g.fillStyle = pu.wide ? '#17171a' : '#f1ecdd';
      g.fill();
      g.restore();
      // カバーの丸み。横方向に光が回る
      box();
      const cover = g.createLinearGradient(bx, 0, bx + bw, 0);
      cover.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
      cover.addColorStop(0.22, 'rgba(255, 255, 255, 0.28)');
      cover.addColorStop(0.55, 'rgba(255, 255, 255, 0.04)');
      cover.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
      g.fillStyle = cover;
      g.fill();
      box();
      g.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      g.lineWidth = Math.max(1, bw * 0.05);
      g.stroke();

      // ポールピース。弦の真下に来る。実物は黒っぽい鉄で、銀色に光らない
      for (const colMM of pu.wide ? [pu.mm - 9, pu.mm + 9] : [pu.mm]) {
        const pr = 2.4 * py * near(colMM);
        for (let i = 0; i < strings; i++) {
          const yy = Y(colMM, stringOff(i, colMM));
          stud(g, X(colMM), yy, Math.max(1, pr * flat), pr,
            pu.wide ? '#9aa0a5' : '#5a5f64', 'steel');
        }
      }

      // 取り付けネジ。シングルコイルは長手の両端で留まっている
      if (!pu.wide) {
        const sr = 2 * py * near(pu.mm);
        for (const yy of [cy - half * 0.88, cy + half * 0.88]) {
          stud(g, bx + bw / 2, yy, Math.max(1, sr * flat), sr, '#b9bec3', 'chrome');
          // ネジの溝
          g.beginPath();
          g.moveTo(bx + bw / 2 - sr * flat * 0.6, yy);
          g.lineTo(bx + bw / 2 + sr * flat * 0.6, yy);
          g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          g.lineWidth = Math.max(0.6, sr * 0.22);
          g.stroke();
        }
      }
    }

    /*
     * ピックガードを留めるネジ。
     *
     * 実物は縁に沿って 11 本並んでいる。無地の白い面が広がっているだけ
     * だと、どれだけ縁を作り込んでも「白い紙」に見える。奥のほうは縁が
     * 画面に入ってくるので、そこに並べるだけで一気に楽器になる。
     */
    for (const sc of [
      { mm: 118, off: 61 }, { mm: 152, off: 58 }, { mm: 180, off: 55 },
    ]) {
      const sr = 2.6 * py * near(sc.mm);
      for (const sign of [-1, 1]) {
        const sy = Y(sc.mm, sc.off * sign);
        if (sy < -sr || sy > h + sr) continue;
        stud(g, X(sc.mm), sy, Math.max(1, sr * flat), sr, '#c6cbd0', 'chrome');
        g.beginPath();
        g.moveTo(X(sc.mm) - sr * flat * 0.6, sy);
        g.lineTo(X(sc.mm) + sr * flat * 0.6, sy);
        g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        g.lineWidth = Math.max(0.5, sr * 0.2);
        g.stroke();
      }
    }

    /*
     * 5点スイッチ。中央のピックアップとつまみの間に立っている。
     * 白いレバーが1本あるかないかで、ストラトかどうかが決まる。
     */
    {
      const swMM = 116;
      const swY = Y(swMM, 28);
      const len = 16 * py * near(swMM);
      const wid = 5 * py * near(swMM) * flat;
      g.save();
      g.translate(X(swMM), swY);
      g.rotate(-0.5);
      g.beginPath();
      if (g.roundRect) g.roundRect(-wid / 2, -len * 0.5, wid, len, wid * 0.5);
      else g.rect(-wid / 2, -len * 0.5, wid, len);
      const lever = g.createLinearGradient(-wid / 2, 0, wid / 2, 0);
      lever.addColorStop(0, '#8e8a7e');
      lever.addColorStop(0.35, '#fffdf6');
      lever.addColorStop(1, '#a9a498');
      g.fillStyle = lever;
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      g.lineWidth = Math.max(0.6, wid * 0.12);
      g.stroke();
      g.restore();
    }

    // ── つまみ（ボリューム・トーン2つ）──
    for (const k of [{ mm: 112, off: 38 }, { mm: 142, off: 43 }, { mm: 170, off: 46 }]) {
      const kr = 9.5 * py * near(k.mm);
      const kx = X(k.mm);
      const ky = Y(k.mm, k.off);
      stud(g, kx, ky, kr * flat, kr, '#f2ece0', 'plastic');
      // 段（スカート）。実物のノブは裾が広がっていて、天面が一段低い
      g.beginPath();
      g.ellipse(kx, ky, kr * flat * 0.74, kr * 0.74, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      g.lineWidth = Math.max(0.6, kr * 0.06);
      g.stroke();
      // 天面のくぼみ
      g.beginPath();
      g.ellipse(kx, ky - kr * 0.12, kr * flat * 0.6, kr * 0.6, 0, 0, Math.PI * 2);
      const top = g.createLinearGradient(0, ky - kr * 0.72, 0, ky + kr * 0.48);
      top.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
      top.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
      top.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
      g.fillStyle = top;
      g.fill();
    }

    // ── トレモロブリッジの台 ──

    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.55)';
    g.shadowBlur = Math.max(3, plateW * 0.2);
    g.shadowOffsetY = Math.max(1.5, plateH * 0.05);
    g.fillStyle = metal(g, cy - plateH, plateH * 2, c.metal);
    g.fillRect(plateL, cy - plateH, plateW, plateH * 2);
    g.restore();
    // 磨き目。大きな面ほど、一様な塗りだと作り物に見える
    g.save();
    g.beginPath();
    g.rect(plateL, cy - plateH, plateW, plateH * 2);
    g.clip();
    brushed(g, plateL, cy - plateH, plateW, plateH * 2, 0x3b71);
    g.restore();
    // 板の縁が起きている（曲げ加工）。横方向にも光を回す
    const bevel = g.createLinearGradient(plateL, 0, plateR, 0);
    bevel.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    bevel.addColorStop(0.12, 'rgba(0, 0, 0, 0.18)');
    bevel.addColorStop(0.62, 'rgba(255, 255, 255, 0.14)');
    bevel.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    g.fillStyle = bevel;
    g.fillRect(plateL, cy - plateH, plateW, plateH * 2);
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.lineWidth = Math.max(1, py * 0.3);
    g.strokeRect(plateL, cy - plateH, plateW, plateH * 2);
    // 起きた縁の頂点に乗る、細く強い光
    g.beginPath();
    g.moveTo(plateL + plateW * 0.02, cy - plateH * 0.98);
    g.lineTo(plateR - plateW * 0.02, cy - plateH * 0.98);
    g.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    g.lineWidth = Math.max(0.8, plateH * 0.02);
    g.stroke();
    // 台を留めているネジ。ナット寄りに6本並ぶ
    const scr = 2.6 * py * near(BRIDGE_MM);
    for (let i = 0; i < strings; i++) {
      stud(g, plateL + plateW * 0.16, Y(BRIDGE_MM, stringOff(i, BRIDGE_MM)),
        Math.max(1, scr * flat), scr, '#c3c8cd', 'chrome');
    }
  } else {
    /*
     * ── ブリッジ（ローズウッドの板）──
     * 弦はブリッジピンで留める。サドルは牛骨で、ピンより少し手前
     */
    /*
     * ── ブリッジ（ローズウッドの板）──
     *
     * 弦をまたぐ向きに 110mm、弦に沿う向きに 34mm。ピン側にだけ
     * 「ベリー」と呼ばれる膨らみがある。実物は 152mm あるが、この絵では
     * ブリッジでの弦の広がりを 42mm に抑えてある（そうしないと端の弦が
     * 面からはみ出す）ので、板の長さもその比に合わせる。合わせないと、
     * 弦が真ん中にだけ寄った、間延びした板になる。
     */
    const half = 55;
    g.save();
    loop(g, [
      P(BRIDGE_MM - 13, -half), P(BRIDGE_MM - 16, -half * 0.55),
      P(BRIDGE_MM - 16, half * 0.55), P(BRIDGE_MM - 13, half),
      P(BRIDGE_MM + 15, half), P(BRIDGE_MM + 20, half * 0.45),
      P(BRIDGE_MM + 20, -half * 0.45), P(BRIDGE_MM + 15, -half),
    ]);
    const brH = half * py * near(BRIDGE_MM);
    const br = g.createLinearGradient(0, cy - brH, 0, cy + brH);
    br.addColorStop(0, 'rgba(255, 235, 210, 0.22)');
    br.addColorStop(0.3, c.wood);
    br.addColorStop(0.8, c.wood);
    br.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = br;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.lineWidth = Math.max(1, py * 0.3);
    g.stroke();
    g.restore();

    // サドル（牛骨）。弦はここで折れて、後ろのピンへ落ちる
    const sadX = X(BRIDGE_MM);
    const sadW = Math.max(3, X(BRIDGE_MM + 2) - X(BRIDGE_MM - 2));
    const sadH = 29 * py * near(BRIDGE_MM);
    const saddle = g.createLinearGradient(sadX - sadW / 2, 0, sadX + sadW / 2, 0);
    saddle.addColorStop(0, 'rgba(30, 22, 14, 0.8)');
    saddle.addColorStop(0.45, '#e4dac4');
    saddle.addColorStop(1, '#90866f');
    g.fillStyle = saddle;
    g.fillRect(sadX - sadW / 2, cy - sadH, sadW, sadH * 2);
  }

  // ── 弦。左端（ネックから続く）から留まるところまで ──
  const endMM = BRIDGE_MM;
  for (let i = 0; i < strings; i++) {
    // i=0 が上＝高音側
    const gauge = STRING_MM[Math.min(i, STRING_MM.length - 1)];
    const y1 = Y(endMM, stringOff(i, endMM));
    const t = Math.max(1, gauge * py);
    /*
     * 刻みは継ぎ目の近くほど細かく取る。
     *
     * 等間隔で12点にしていたとき、最初の1本が 13mm ぶんもあり、その間に
     * 遠近が 1.00 から 0.85 へ動くので、指板から出たところで弦が
     * 折れ曲がって見えた。手前を詰めれば、同じ点数でも滑らかに繋がる。
     */
    const STEPS = 22;
    const path: [number, number][] = [];
    const wide: number[] = [];
    for (let k = 0; k <= STEPS; k++) {
      const mm = endMM * Math.pow(k / STEPS, 1.7);
      path.push([X(mm), Y(mm, stringOff(i, mm))]);
      wide.push(Math.max(0.7, t * near(mm)));
    }
    stringOn(g, path, wide, i >= strings - 3);

    if (kind === 'electric') {
      /*
       * 駒（サドル）。実物は6つの短い筒が並んでいて、その1つ1つに
       * 高さと長さを合わせるネジが付いている。台の幅いっぱいに横線を
       * 引いていたころは、暖房器具のような縞板に見えていた。
       * 台の手前寄りに短く置き、間に濃い隙間を入れる。
       */
      const sh = Math.max(3, 8 * py * near(BRIDGE_MM));
      const sx = plateL + plateW * 0.08;
      const sw = plateW * 0.44;
      g.fillStyle = 'rgba(0, 0, 0, 0.6)';
      g.fillRect(sx - sw * 0.04, y1 - sh * 0.62, sw * 1.08, sh * 1.24);
      g.fillStyle = chrome(g, y1 - sh / 2, sh, c.metal);
      g.fillRect(sx, y1 - sh / 2, sw, sh);
      // 筒なので、左右の端が落ちる
      const curve = g.createLinearGradient(sx, 0, sx + sw, 0);
      curve.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
      curve.addColorStop(0.26, 'rgba(255, 255, 255, 0.34)');
      curve.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
      g.fillStyle = curve;
      g.fillRect(sx, y1 - sh / 2, sw, sh);
      // 頂点の細い光
      g.beginPath();
      g.moveTo(sx, y1 - sh * 0.36);
      g.lineTo(sx + sw, y1 - sh * 0.36);
      g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      g.lineWidth = Math.max(0.6, sh * 0.12);
      g.stroke();
    } else {
      // ブリッジピン。弦はサドルを越えて、ここで板に刺さって止まる
      const pinMM = BRIDGE_MM + 12;
      const pr = 4 * py * near(pinMM);
      const pxp = X(pinMM);
      const pyp = Y(pinMM, stringOff(i, pinMM));
      stringOn(g, [[X(endMM), y1], [pxp, pyp]], t * near(BRIDGE_MM) * 0.9, i >= strings - 3);
      g.beginPath();
      g.ellipse(pxp, pyp, Math.max(1.2, pr * flat), pr, 0, 0, Math.PI * 2);
      const pin = g.createLinearGradient(0, pyp - pr, 0, pyp + pr);
      pin.addColorStop(0, '#fbf6ea');
      pin.addColorStop(0.5, '#ded3bb');
      pin.addColorStop(1, '#6f6654');
      g.fillStyle = pin;
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.lineWidth = 0.7;
      g.stroke();
    }
  }

  // ── トレモロアーム受け ──
  if (kind === 'electric') {
    const ar = 5 * py * near(BRIDGE_MM + 22);
    const aX = X(BRIDGE_MM + 22);
    const aY = Y(BRIDGE_MM + 22, 40);
    stud(g, aX, aY, ar * flat, ar, c.metal, 'chrome');
    g.beginPath();
    g.ellipse(aX, aY, ar * flat * 0.45, ar * 0.45, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(12, 12, 14, 0.85)';
    g.fill();
  }

  // 最後に、奥へ向かう暗さと面の光、そして画素のざらつきを掛ける
  finish(g, w, h, 0.24, 1);
  filmGrain(g, 0.13);
}
