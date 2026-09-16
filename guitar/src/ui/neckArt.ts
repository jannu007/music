/**
 * ヘッドとボディを描く。
 *
 * これまで画面にあったのは指板だけで、ネックがどこから始まってどこで
 * 終わるのかが無かった。実物の写真と並べると、そこがいちばん違う。
 * 弦は糸巻きに巻かれ、ナットを通り、ブリッジで留まっている。その両端が
 * 無いと、木の板に線を引いたものにしか見えない。
 *
 * 指板は横に送れるので、左端までいけばヘッド、右端までいけばボディが
 * 出てくる。楽器1本ぶんが、そのまま画面の中にある形になる。
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
 * 弦が通る帯。指板の1弦の上端と6弦の下端を、面の高さに対する割合で渡す。
 *
 * ここが合っていないと、ヘッドから来た弦が指板の弦とつながらず、
 * 継ぎ目で折れて見える。実測した値を使う。
 */
export interface StringBand {
  top: number;
  bottom: number;
}

/** 金物の丸みを、上が光って下に影が落ちる形で塗る */
function metalFill(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  base: string
): CanvasGradient {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.3, base);
  grad.addColorStop(0.62, base);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  return grad;
}

/**
 * ヘッド（糸巻きのある先端）。
 *
 * 右端がナットで、そこから左へ伸びる。実物と同じく6個の糸巻きが
 * 片側に一列で並ぶ。弦はナットから糸巻きへ、少しずつ広がりながら向かう。
 */
export function drawHeadstock(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: NeckColors,
  strings: number,
  band: StringBand
): void {
  g.clearRect(0, 0, w, h);

  // ネックが続いている高さ。指板の弦の位置をそのまま受け取る
  const neckTop = h * band.top;
  const neckBottom = h * band.bottom;

  // 輪郭。右（ナット）から左へ、いちど広がって先で丸く落ちる
  g.beginPath();
  g.moveTo(w, neckTop);
  g.lineTo(w * 0.72, neckTop - h * 0.1);
  g.quadraticCurveTo(w * 0.4, h * 0.02, w * 0.12, h * 0.1);
  g.quadraticCurveTo(w * 0.0, h * 0.16, w * 0.015, h * 0.34);
  g.quadraticCurveTo(w * 0.03, h * 0.62, w * 0.16, h * 0.72);
  g.quadraticCurveTo(w * 0.42, h * 0.88, w * 0.74, neckBottom + h * 0.06);
  g.lineTo(w, neckBottom);
  g.closePath();

  const wood = g.createLinearGradient(0, 0, 0, h);
  wood.addColorStop(0, c.head);
  wood.addColorStop(0.45, c.head);
  wood.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  g.fillStyle = wood;
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.lineWidth = 1.2;
  g.stroke();

  // 糸巻き。実物と同じく上側に一列。ナット側から先へ向かって並ぶ
  const pegR = Math.max(3.2, h * 0.055);
  for (let i = 0; i < strings; i++) {
    const t = i / Math.max(1, strings - 1);
    const px = w * 0.76 - t * w * 0.6;
    const py = h * 0.2 - t * h * 0.045;

    // 軸（ポスト）
    g.fillStyle = metalFill(g, px - pegR * 0.34, py, pegR * 0.68, pegR * 1.7, c.metal);
    g.fillRect(px - pegR * 0.34, py, pegR * 0.68, pegR * 1.7);

    // つまみ
    g.beginPath();
    g.ellipse(px, py - pegR * 0.2, pegR * 0.95, pegR * 0.62, 0, 0, Math.PI * 2);
    g.fillStyle = metalFill(g, px - pegR, py - pegR, pegR * 2, pegR * 1.6, c.metal);
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 0.8;
    g.stroke();

    // 弦。ナット（右端）から、この糸巻きへ向かう
    const nutY = neckTop + ((neckBottom - neckTop) * (strings - 1 - i)) / (strings - 1);
    g.beginPath();
    g.moveTo(w, nutY);
    g.lineTo(px, py + pegR * 0.9);
    g.strokeStyle = 'rgba(232, 226, 214, 0.8)';
    g.lineWidth = 0.7 + (strings - 1 - i) * 0.18;
    g.stroke();
  }

  // ナット（牛骨）。右端に立つ
  const nutW = Math.max(3, w * 0.022);
  const nut = g.createLinearGradient(w - nutW, 0, w, 0);
  nut.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  nut.addColorStop(0.35, '#efe6d4');
  nut.addColorStop(0.7, '#fffaf0');
  nut.addColorStop(1, '#c9bca3');
  g.fillStyle = nut;
  g.fillRect(w - nutW, neckTop - 1, nutW, neckBottom - neckTop + 2);
}

/**
 * ボディ（ピックアップとブリッジのあるところ）。
 *
 * 左端でネックと繋がり、右へ向かってボディが広がる。指板を右へ
 * 送りきると出てくる。弦はブリッジのサドルで留まる。
 */
export function drawBody(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  c: NeckColors,
  strings: number,
  band: StringBand
): void {
  g.clearRect(0, 0, w, h);

  const neckTop = h * band.top;
  const neckBottom = h * band.bottom;

  // ボディの輪郭。左上と左下がえぐれている（ダブルカッタウェイ）
  g.beginPath();
  g.moveTo(0, neckTop);
  g.quadraticCurveTo(w * 0.1, h * 0.06, w * 0.26, h * 0.015);
  g.lineTo(w, 0);
  g.lineTo(w, h);
  g.lineTo(w * 0.26, h * 0.985);
  g.quadraticCurveTo(w * 0.1, h * 0.94, 0, neckBottom);
  g.closePath();

  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  body.addColorStop(0.2, c.body);
  body.addColorStop(0.75, c.body);
  body.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  g.lineWidth = 1.2;
  g.stroke();

  // ピックガード
  g.save();
  g.beginPath();
  g.moveTo(w * 0.1, h * 0.18);
  g.quadraticCurveTo(w * 0.3, h * 0.07, w * 0.98, h * 0.12);
  g.lineTo(w * 0.98, h * 0.88);
  g.quadraticCurveTo(w * 0.3, h * 0.93, w * 0.1, h * 0.82);
  g.closePath();
  g.fillStyle = c.guard;
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  g.lineWidth = 1;
  g.stroke();
  g.clip();

  // ピックアップ。写真と同じ並び（シングル2つ＋ハムバッカー）
  const pus = [
    { x: w * 0.3, wide: false },
    { x: w * 0.52, wide: false },
    { x: w * 0.74, wide: true },
  ];
  for (const pu of pus) {
    const pw = pu.wide ? w * 0.12 : w * 0.06;
    const ph = h * 0.52;
    const px = pu.x - pw / 2;
    const py = h * 0.5 - ph / 2;
    g.fillStyle = pu.wide ? '#20201f' : '#efeae0';
    g.beginPath();
    g.roundRect?.(px, py, pw, ph, 3);
    if (!g.roundRect) g.rect(px, py, pw, ph);
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 0.9;
    g.stroke();

    // ポールピース。弦の数だけ並ぶ
    for (let i = 0; i < strings; i++) {
      const t = (i + 0.5) / strings;
      const y = py + ph * t;
      const cols = pu.wide ? [px + pw * 0.3, px + pw * 0.7] : [px + pw * 0.5];
      for (const x of cols) {
        g.beginPath();
        g.arc(x, y, Math.max(0.9, w * 0.006), 0, Math.PI * 2);
        g.fillStyle = pu.wide ? '#b9bcc0' : '#9aa0a6';
        g.fill();
      }
    }
  }
  g.restore();

  // ブリッジ。サドルが弦の数だけ並ぶ
  const brX = w * 0.9;
  const brW = Math.max(10, w * 0.07);
  g.fillStyle = metalFill(g, brX, h * 0.2, brW, h * 0.6, c.metal);
  g.fillRect(brX, h * 0.2, brW, h * 0.6);
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.lineWidth = 0.9;
  g.strokeRect(brX, h * 0.2, brW, h * 0.6);

  for (let i = 0; i < strings; i++) {
    const y = neckTop + ((neckBottom - neckTop) * i) / (strings - 1);
    // サドル
    g.fillStyle = metalFill(g, brX + brW * 0.15, y - 2.4, brW * 0.7, 4.8, c.metal);
    g.fillRect(brX + brW * 0.15, y - 2.4, brW * 0.7, 4.8);
    // 弦。左端（ネックから続く）からサドルまで
    g.beginPath();
    g.moveTo(0, neckTop + ((neckBottom - neckTop) * i) / (strings - 1));
    g.lineTo(brX + brW * 0.2, y);
    g.strokeStyle = 'rgba(236, 230, 218, 0.85)';
    g.lineWidth = 0.7 + (strings - 1 - i) * 0.2;
    g.stroke();
  }

  // つまみ（ボリュームとトーン）
  for (const k of [{ x: w * 0.55, y: h * 0.16 }, { x: w * 0.72, y: h * 0.2 }]) {
    const r = Math.max(4, h * 0.075);
    g.beginPath();
    g.arc(k.x, k.y, r, 0, Math.PI * 2);
    const kg = g.createLinearGradient(k.x, k.y - r, k.x, k.y + r);
    kg.addColorStop(0, '#fbf8f2');
    kg.addColorStop(0.6, '#ded8cc');
    kg.addColorStop(1, '#8e887c');
    g.fillStyle = kg;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 0.9;
    g.stroke();
  }
}
