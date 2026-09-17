/**
 * 指板の木を描く。
 *
 * ■ 色を変えるだけでは、木の違いにならない
 *
 * これまでは、音色ごとに変えていたのは地の色（--wood-1/2/3）だけで、
 * 木目の引き方はどの木でも同じだった。だが実物で「ローズウッドか
 * メイプルか」を見分けているのは色ではない。
 *
 *   ローズウッド … 導管（木の水路）が太く開いていて、長い黒筋が不揃いに走る
 *   メイプル     … 導管がほとんど見えない。代わりに横方向の杢（トラ目）と
 *                  塗装のつやが出る
 *   エボニー     … ほぼ無地。ごくたまに灰色の筋が入るだけ
 *   コア         … 金褐色に、強い杢
 *   合成材       … 木目が無い。均一な黒
 *
 * つまり「どんな模様が、どれくらいの濃さで、どの向きに出るか」が
 * 木の正体で、色はその次。ここでは樹種ごとに描き方そのものを分ける。
 *
 * ■ 写真らしさ
 *
 * 模様を正しく描いても、塗りが滑らかなままだと図形に見える。最後に
 * 画素ほどの細かなざらつき（フィルムグレイン）を薄く掛ける。写真には
 * 必ず乗っているもので、目はそれを「実物を写した」印にしている。
 */

/** 樹種。指板に使われる木のうち、見た目がはっきり違うものだけ */
export type Species = 'rosewood' | 'pauferro' | 'ebony' | 'maple' | 'koa' | 'composite';

export interface WoodColors {
  /** 根元寄りの地の色 */
  c1: string;
  /** 中ほどの地の色（いちばん広く出る） */
  c2: string;
  /** 先端寄りの地の色 */
  c3: string;
}

interface Recipe {
  /** 導管の本数（面の幅 px あたり 1/n 本） */
  pore: number;
  /** 導管の濃さ */
  poreInk: number;
  /** 導管の太さ（px） */
  poreWide: number;
  /** 長い黒筋の本数（幅 px あたり 1/n 本） */
  streak: number;
  /** 黒筋の濃さ */
  streakInk: number;
  /** 斑の本数（幅 px あたり 1/n 個） */
  fleck: number;
  /** 杢（横方向の縞）の強さ */
  curl: number;
  /** 塗装のつや */
  gloss: number;
  /** 大きなむらの強さ */
  blotch: number;
  /** むらの暖かいほう。木ごとに、濃い部分の色味が違う */
  warm: string;
  /** むらの冷たいほう */
  cool: string;
}

/*
 * 樹種ごとの配合。
 *
 * 数字は「実物の写真を見て、何がどれくらい目に付くか」で決めてある。
 * ローズウッドの導管が目立ち、メイプルではほぼ見えない、という差が
 * そのまま pore と poreInk の差になっている。
 */
const RECIPE: Record<Species, Recipe> = {
  rosewood: {
    pore: 6, poreInk: 0.11, poreWide: 2.4,
    streak: 18, streakInk: 0.26, fleck: 9, curl: 0, gloss: 0.1, blotch: 1.5,
    warm: '120, 54, 28', cool: '44, 30, 46',
  },
  pauferro: {
    pore: 7, poreInk: 0.09, poreWide: 2.0,
    streak: 18, streakInk: 0.32, fleck: 12, curl: 0, gloss: 0.12, blotch: 1.1,
    warm: '150, 82, 34', cool: '64, 50, 38',
  },
  ebony: {
    pore: 18, poreInk: 0.05, poreWide: 1.1,
    streak: 90, streakInk: 0.1, fleck: 40, curl: 0, gloss: 0.22, blotch: 0.45,
    warm: '70, 62, 56', cool: '34, 34, 38',
  },
  maple: {
    /*
     * メイプルは導管がほとんど見えない代わりに、長手方向のごく細い
     * 木目と塗装のつやが出る。杢（curl）を強くすると縦の染みに見えるので、
     * 触れるか触れないかに留める。
     */
    pore: 4, poreInk: 0.05, poreWide: 0.8,
    streak: 0, streakInk: 0, fleck: 60, curl: 0.22, gloss: 0.6, blotch: 0.55,
    warm: '214, 150, 70', cool: '150, 118, 76',
  },
  koa: {
    pore: 8, poreInk: 0.075, poreWide: 1.8,
    streak: 40, streakInk: 0.14, fleck: 16, curl: 0.65, gloss: 0.34, blotch: 1,
    warm: '190, 116, 40', cool: '96, 62, 30',
  },
  composite: {
    pore: 0, poreInk: 0, poreWide: 0,
    streak: 0, streakInk: 0, fleck: 0, curl: 0, gloss: 0.14, blotch: 0.3,
    warm: '60, 58, 56', cool: '28, 28, 30',
  },
};

/** 決まった種を持つ乱数。画面の大きさを変えるたびに木目が踊らないように */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 画素ほどの細かなざらつき。写真らしさは、ほぼこれで決まる */
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
  const rnd = seeded(0x51a3c7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, Math.round(128 + (rnd() - 0.5) * 200)));
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
 * 指板の面を描く。
 *
 * 木目はネックの長手方向（画面では横）に走る。1枚の板から切り出して
 * いるので、根元から先まで模様は続いている。
 */
export function paintWood(
  g: CanvasRenderingContext2D,
  w: number, h: number,
  species: Species,
  c: WoodColors
): void {
  const r = RECIPE[species] ?? RECIPE.rosewood;
  const rnd = seeded(20260917);

  // ── 地の色 ──
  // 一枚板でも、根元と先で色は一様ではない
  const base = g.createLinearGradient(0, 0, w, 0);
  base.addColorStop(0, c.c1);
  base.addColorStop(0.42, c.c2);
  base.addColorStop(0.78, c.c1);
  base.addColorStop(1, c.c3);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  /*
   * ── 大きなむら ──
   *
   * 均一な塗りのままだと、木ではなく「その色の板」に見える。
   * しかも濃淡だけでは足りない。実物のローズウッドには赤みの強い
   * ところと紫がかって沈んだところがあり、その色味の揺れが
   * 「1本の木から切り出した板」らしさになる。木ごとに暖色と寒色を
   * 持たせて、明暗と一緒に振る。
   */
  for (let i = 0; i < 11; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const rad = (0.12 + rnd() * 0.3) * w;
    const pick = rnd();
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, pick > 0.66
      ? `rgba(255, 228, 190, ${(0.045 * r.blotch).toFixed(3)})`
      : pick > 0.33
        ? `rgba(${r.warm}, ${(0.075 * r.blotch).toFixed(3)})`
        : `rgba(${r.cool}, ${(0.085 * r.blotch).toFixed(3)})`);
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  }

  /*
   * ── 板目の帯 ──
   * 一枚板から切り出した木には、長手方向に沿って幅の広い濃淡の帯が
   * 通っている。細い線だけを引いていたころは、どこを見ても同じ密度で、
   * 木ではなく網掛けに見えていた。ここで大きな構造を先に作る。
   */
  if (r.blotch > 0.4) {
    const bands = 5 + Math.round(rnd() * 4);
    for (let i = 0; i < bands; i++) {
      const y = rnd() * h;
      const thick = h * (0.06 + rnd() * 0.22);
      const bow = (rnd() - 0.5) * h * 0.1;
      const band = g.createLinearGradient(0, y - thick, 0, y + thick);
      const ink = 0.05 + rnd() * 0.07;
      band.addColorStop(0, 'rgba(0, 0, 0, 0)');
      band.addColorStop(0.5, `rgba(24, 12, 5, ${(ink * r.blotch).toFixed(3)})`);
      band.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.save();
      g.beginPath();
      g.moveTo(-10, y - thick);
      g.quadraticCurveTo(w * 0.5, y - thick + bow, w + 10, y - thick);
      g.lineTo(w + 10, y + thick);
      g.quadraticCurveTo(w * 0.5, y + thick + bow, -10, y + thick);
      g.closePath();
      g.clip();
      g.fillStyle = band;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  }

  /*
   * ── 杢（トラ目）──
   * 木目と直交して走る、細かな明暗の縞。メイプルとコアの見どころで、
   * 光の向きで明暗が入れ替わるので、縞の中でも濃さを変える。
   * ローズウッドやエボニーには出ないので curl = 0。
   */
  if (r.curl > 0) {
    // 細かく数多く。太い帯にすると、木ではなく縦縞の布に見える
    const bands = Math.max(24, Math.round(w / 9));
    for (let i = 0; i < bands; i++) {
      const x = rnd() * w;
      const lean = (rnd() - 0.5) * w * 0.02;
      const wide = 1.2 + rnd() * 3.6;
      g.beginPath();
      g.moveTo(x, -h * 0.05);
      g.quadraticCurveTo(x + lean, h * 0.5, x + lean * 0.4, h * 1.05);
      g.strokeStyle = rnd() > 0.5
        ? `rgba(92, 58, 24, ${(0.05 + rnd() * 0.06) * r.curl})`
        : `rgba(255, 236, 200, ${(0.05 + rnd() * 0.07) * r.curl})`;
      g.lineWidth = wide;
      g.stroke();
    }
  }

  /*
   * ── 長い黒筋 ──
   * ローズウッドを「ローズウッドらしく」しているのは、この不揃いな
   * 濃い筋。板の端から端まで通り、途中で太さが変わる。
   */
  if (r.streak > 0) {
    const n = Math.max(3, Math.round(w / r.streak));
    for (let i = 0; i < n; i++) {
      const y = rnd() * h;
      const sway = (rnd() - 0.5) * h * 0.06;
      g.beginPath();
      g.moveTo(-w * 0.05, y);
      g.bezierCurveTo(w * 0.3, y + sway, w * 0.7, y - sway, w * 1.05, y + sway * 0.3);
      g.strokeStyle = `rgba(18, 9, 4, ${(r.streakInk * (0.5 + rnd() * 0.5)).toFixed(3)})`;
      g.lineWidth = 1.5 + rnd() * 5;
      g.stroke();
    }
  }

  /*
   * ── 導管 ──
   * 木が水を通していた管。長手方向に走る細い線。多すぎると、木ではなく
   * ブラシをかけた金属に見えるので、濃さはごく薄く、長さも不揃いにする。
   */
  if (r.pore > 0) {
    const lines = Math.max(20, Math.round(w / r.pore));
    for (let i = 0; i < lines; i++) {
      const dark = rnd() < 0.74;
      g.strokeStyle = dark
        ? `rgba(0, 0, 0, ${(r.poreInk * (0.3 + rnd())).toFixed(3)})`
        : `rgba(255, 224, 186, ${(r.poreInk * 0.4 * (0.3 + rnd())).toFixed(3)})`;
      g.lineWidth = r.poreWide * (0.3 + rnd() * 0.9);
      g.beginPath();
      let x = -40 - rnd() * 80;
      let y = rnd() * h;
      g.moveTo(x, y);
      const len = w * (0.2 + rnd() * 0.95);
      const steps = 16;
      for (let k = 1; k <= steps; k++) {
        x += len / steps;
        y += (rnd() - 0.5) * 1.8;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  // ── 斑 ──
  // 導管の切り口。これが無いと、線を引いただけに見える
  if (r.fleck > 0) {
    const flecks = Math.round(w / r.fleck);
    for (let i = 0; i < flecks; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${(0.03 + rnd() * 0.07).toFixed(3)})`;
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, 0.6 + rnd() * 2.4, 0.4 + rnd() * 0.9, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  /*
   * ── 塗装のつや ──
   * メイプル指板は塗装してあるので、面を斜めに光が走る。
   * 無塗装のローズウッドやエボニーではほとんど出ない。
   */
  if (r.gloss > 0) {
    const sheen = g.createLinearGradient(0, 0, w * 0.75, h);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(0.4, `rgba(255, 252, 244, ${(0.1 * r.gloss).toFixed(3)})`);
    sheen.addColorStop(0.55, `rgba(255, 252, 244, ${(0.03 * r.gloss).toFixed(3)})`);
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
  }

  // ── 面の丸み（指板R）。中央が明るく、上下の縁が落ちる ──
  const round = g.createLinearGradient(0, 0, 0, h);
  round.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  round.addColorStop(0.14, 'rgba(0, 0, 0, 0.12)');
  round.addColorStop(0.46, 'rgba(255, 238, 214, 0.08)');
  round.addColorStop(0.8, 'rgba(0, 0, 0, 0.14)');
  round.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  g.fillStyle = round;
  g.fillRect(0, 0, w, h);

  // ── 画素のざらつき ──
  filmGrain(g, 0.12);
}

/** CSS から受け取った名前を樹種に直す。知らない名前はローズウッド */
export function speciesOf(name: string): Species {
  const t = name.trim() as Species;
  return t in RECIPE ? t : 'rosewood';
}
