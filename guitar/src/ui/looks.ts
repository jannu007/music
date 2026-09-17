/**
 * 音色に合わせて、ギターの見た目を変える。
 *
 * 音は 19 種類あるのに、指板はずっと同じローズウッドだった。ジャズの
 * アーチトップを選んでもファズのハイゲインを選んでも同じ木では、
 * 何を持っているのか分からない。実物は、音が違えば見た目も違う。
 *
 * 19 種類ぶんの絵を描き分けるのは現実的でないので、実物の系統ごとに
 * 束ねる。指板の木（ローズウッド／メイプル／エボニー）と、本体の色、
 * 金物の色。この3つが変われば、別のギターに見える。
 *
 * 音と見た目の対応は、実際のその音を出す楽器に合わせてある。
 * 例えばファンクやサーフのシングルコイルはストラトの音なので、
 * メイプル指板の明るい木になる。
 *
 * 色は CSS 変数で渡す。描き方そのものは guitar.css 側に置いてあり、
 * ここは「どの音がどの楽器か」だけを持つ。
 */

export type LookId =
  | 'acoustic'
  | 'nylon'
  | 'resonator'
  | 'archtop'
  | 'strat'
  | 'stratrose'
  | 'lespaul'
  | 'superstrat'
  | 'offset'
  | 'pbass'
  | 'koa';

export interface Look {
  id: LookId;
  /** 何に見立てているか（ヘルプと読み上げに使う） */
  key: string;
}

/**
 * 音色ごとの見立て。
 *
 *   acoustic    スプルース＋ローズウッド。生のスチール弦
 *   nylon       クラシック。エボニー指板、目印を置かない
 *   resonator   金属ボディ。冷たい銀色
 *   archtop     ジャズ。エボニー指板に貝のブロック
 *   strat       シングルコイル。メイプルの明るい指板
 *   stratrose   同じストラトでも、ローズウッド指板の個体
 *   lespaul     マホガニー＋ゴールドトップ。ローズウッド指板
 *   superstrat  モダン・ハイゲイン。黒い合成材で木目を出さない
 *   offset      オフセット。パーフェローの明るい指板
 *   pbass       エレキベース。メイプル指板
 *   koa         ウクレレ。ハワイの木。強い杢
 *
 * 指板の木は、色ではなく樹種（ローズウッド／メイプル／エボニー／
 * パーフェロー／コア／合成材）で分かれる。導管の太さ、黒筋、杢、
 * つやの出方がそれぞれ違い、そこが木の見分けになる。
 */
const BY_PRESET: Record<string, LookId> = {
  steel: 'acoustic',
  strum: 'acoustic',
  fingerpick: 'acoustic',
  parlor: 'acoustic',
  nylon: 'nylon',
  resonator: 'resonator',
  jazz: 'archtop',
  /*
   * シングルコイルの音はストラトのもの。ただし実物には、メイプル指板の
   * 個体とローズウッド指板の個体がある。カッティングやクリーンは
   * 明るいメイプル、ブルースやワウは温かいローズウッドの個体が多い。
   */
  clean: 'strat',
  funk: 'strat',
  chorus: 'strat',
  blues: 'stratrose',
  wah: 'stratrose',
  surf: 'offset',
  ambient: 'offset',
  // ブリティッシュ・ロックはハムバッカー＋積んだアンプ
  british: 'lespaul',
  metal: 'superstrat',
  fuzz: 'superstrat',
  bass: 'pbass',
  ukulele: 'koa',
};

/** 知らない音色は、いちばん素直なアコースティックに寄せる */
export function lookFor(presetId: string): LookId {
  return BY_PRESET[presetId] ?? 'acoustic';
}
