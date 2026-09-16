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
/** ボディ側に描く長さ。24フレット位置からブリッジの先まで */
const BODY_MM = 234;
/** ブリッジのサドルの位置（ボディ面の左端から） */
const BRIDGE_MM = 162;
/** ボディの奥行き。指板との継ぎ目を 1、いちばん奥を BODY_TIP とする */
const BODY_TIP = 0.25;

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
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, 'rgba(60, 64, 68, 0.9)');
  grad.addColorStop(0.16, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.42, base);
  grad.addColorStop(0.72, base);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
  return grad;
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
  grain(g, w, h, 0x51d0, 1);

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
    // 座金
    g.beginPath();
    g.ellipse(pxc, pyc, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = metal(g, pyc - ry, ry * 2, c.metal);
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.lineWidth = 0.8;
    g.stroke();
    // ポスト（弦を巻く軸）
    g.beginPath();
    g.ellipse(pxc, pyc, rx * 0.52, ry * 0.52, 0, 0, Math.PI * 2);
    g.fillStyle = metal(g, pyc - ry * 0.52, ry * 1.04, c.metal);
    g.fill();
    // 軸の穴
    g.beginPath();
    g.ellipse(pxc, pyc, rx * 0.17, ry * 0.17, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20, 20, 22, 0.8)';
    g.fill();
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
    const gRy = 3.5 * py * near(guideAt);
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
   * 継ぎ目での 1mm。指板の弦の広がりは、ボディ側では 42mm ぶんに
   * あたる（ブリッジへ向かって弦は広がるので）。ここを取り違えると
   * 継ぎ目で弦が段になる
   */
  const py = (botY - topY) / 42;

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
  if (kind === 'acoustic') grain(g, w, h, 0x9a31, 0.8);

  if (kind === 'electric') {
    // ── ピックガード。上下は画面の外まで続く ──
    g.save();
    g.beginPath();
    g.moveTo(X(0), 0);
    /*
     * 実物のピックガードは幅 250mm ある（＝中心から 125mm）。
     * ここを ±58mm にしていたので、白い帯が弦の周りにだけ乗った
     * 細長い板になり、つまみもブリッジの台に食い込んでいた。
     */
    through(g, [
      P(0, -112), P(24, -118), P(60, -122),
      P(120, -120), P(180, -114), P(225, -104), [X(225), 0],
    ]);
    g.lineTo(X(225), h);
    through(g, [
      [X(225), h], P(225, 104), P(180, 114), P(120, 120),
      P(60, 122), P(24, 118), P(0, 112),
    ]);
    g.closePath();
    const guard = g.createLinearGradient(0, Y(0, -112), 0, Y(0, 112));
    guard.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    guard.addColorStop(0.35, c.guard);
    guard.addColorStop(0.75, c.guard);
    guard.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    g.fillStyle = guard;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = Math.max(1, py * 0.4);
    g.stroke();
    g.restore();
  } else {
    /*
     * ── サウンドホールとロゼッタ ──
     * 実物は直径 100mm ほど。ネックの付け根から 60mm あたりに開く。
     * 縁には木を寄せた飾り輪（ロゼッタ）が回っている
     */
    const holeMM = 56;
    const hr = 50 * py * near(holeMM);
    const hx = X(holeMM);
    const hy = cy;
    for (const ring of [1.18, 1.1]) {
      g.beginPath();
      g.ellipse(hx, hy, hr * ring * flat, hr * ring, 0, 0, Math.PI * 2);
      g.strokeStyle = ring > 1.14 ? 'rgba(52, 32, 18, 0.75)' : 'rgba(215, 186, 140, 0.6)';
      g.lineWidth = Math.max(1.2, 2.5 * py * near(holeMM));
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
  endGrad.addColorStop(0.55, c.wood);
  endGrad.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
  g.fillStyle = endGrad;
  g.fillRect(0, Y(0, -26), endW, Y(0, 26) - Y(0, -26));

  if (kind === 'electric') {
    // ── ピックアップ。写真と同じ並び（シングル2＋ブリッジにハムバッカー）──
    const pus: { mm: number; wide: boolean }[] = [
      { mm: 19, wide: false },
      { mm: 69, wide: false },
      { mm: 119, wide: true },
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
      g.save();
      g.shadowColor = 'rgba(0, 0, 0, 0.55)';
      g.shadowBlur = Math.max(2, py * 0.6);
      g.shadowOffsetY = Math.max(1, py * 0.25);
      g.fillStyle = pu.wide ? '#17171a' : '#f3efe3';
      g.beginPath();
      if (g.roundRect) g.roundRect(bx, cy - half, bw, half * 2, Math.min(bw * 0.3, 6));
      else g.rect(bx, cy - half, bw, half * 2);
      g.fill();
      g.restore();
      g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      g.lineWidth = Math.max(1, py * 0.35);
      g.stroke();

      // ポールピース。弦の真下に来る。実物は黒っぽい鉄で、銀色に光らない
      for (const colMM of pu.wide ? [pu.mm - 9, pu.mm + 9] : [pu.mm]) {
        const pr = 2.4 * py * near(colMM);
        for (let i = 0; i < strings; i++) {
          const yy = Y(colMM, stringOff(i, colMM));
          g.beginPath();
          g.ellipse(X(colMM), yy, Math.max(1, pr * flat), pr, 0, 0, Math.PI * 2);
          g.fillStyle = metal(g, yy - pr, pr * 2, pu.wide ? '#7d8286' : '#54585c');
          g.fill();
        }
      }

      // 取り付けネジ。シングルコイルは長手の両端で留まっている
      if (!pu.wide) {
        const sr = 2 * py * near(pu.mm);
        for (const yy of [cy - half * 0.88, cy + half * 0.88]) {
          g.beginPath();
          g.ellipse(bx + bw / 2, yy, Math.max(1, sr * flat), sr, 0, 0, Math.PI * 2);
          g.fillStyle = metal(g, yy - sr, sr * 2, '#b9bec3');
          g.fill();
          g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          g.lineWidth = 0.7;
          g.stroke();
        }
      }
    }

    // ── つまみ（ボリューム・トーン2つ）──
    for (const k of [{ mm: 148, off: 64 }, { mm: 172, off: 74 }, { mm: 196, off: 82 }]) {
      const kr = 9.5 * py * near(k.mm);
      const kx = X(k.mm);
      const ky = Y(k.mm, k.off);
      g.beginPath();
      g.ellipse(kx, ky, kr * flat, kr, 0, 0, Math.PI * 2);
      const kg = g.createLinearGradient(0, ky - kr, 0, ky + kr);
      kg.addColorStop(0, '#fdfbf6');
      kg.addColorStop(0.45, '#e2dccd');
      kg.addColorStop(1, '#7c7767');
      g.fillStyle = kg;
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      g.lineWidth = 0.9;
      g.stroke();
    }

    // ── トレモロブリッジの台 ──
    const plateH = 42 * py * near(BRIDGE_MM);
    const plateL = X(BRIDGE_MM - 10);
    const plateR = X(BRIDGE_MM + 42);
    g.fillStyle = metal(g, cy - plateH, plateH * 2, c.metal);
    g.fillRect(plateL, cy - plateH, plateR - plateL, plateH * 2);
    g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    g.lineWidth = Math.max(1, py * 0.3);
    g.strokeRect(plateL, cy - plateH, plateR - plateL, plateH * 2);
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
    const path: [number, number][] = [];
    const wide: number[] = [];
    for (let k = 0; k <= 12; k++) {
      const mm = (endMM * k) / 12;
      path.push([X(mm), Y(mm, stringOff(i, mm))]);
      wide.push(Math.max(0.7, t * near(mm)));
    }
    stringOn(g, path, wide, i >= strings - 3);

    if (kind === 'electric') {
      // サドル
      const sh = Math.max(3, 8 * py * near(BRIDGE_MM));
      const sw = Math.max(4, X(BRIDGE_MM + 8) - X(BRIDGE_MM - 8));
      g.fillStyle = metal(g, y1 - sh / 2, sh, c.metal);
      g.fillRect(X(BRIDGE_MM) - sw / 2, y1 - sh / 2, sw, sh);
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      g.lineWidth = 0.7;
      g.strokeRect(X(BRIDGE_MM) - sw / 2, y1 - sh / 2, sw, sh);
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
    const ar = 5 * py * near(BRIDGE_MM + 30);
    const aX = X(BRIDGE_MM + 30);
    const aY = Y(BRIDGE_MM + 30, 40);
    g.beginPath();
    g.ellipse(aX, aY, ar * flat, ar, 0, 0, Math.PI * 2);
    g.fillStyle = metal(g, aY - ar, ar * 2, c.metal);
    g.fill();
  }
}
