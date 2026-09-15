/**
 * 止まった音を、画面のどこを叩いても戻せるようにする。
 *
 * ブラウザは自動再生を禁じているので、最初は利用者の操作の中で
 * AudioContext を起こす必要がある。7本ともそれはやっていた。
 * ただし受け手を { once: true } で張っていたため、最初の一回で外れていた。
 *
 * 止まるのは最初の一回だけではない。電話が来た、他のアプリが音を出した、
 * 画面を消した——どれでも止まる。二度目からは、画面にこう出しておきながら
 *
 *   音が止まっています。画面をもう一度タップすると戻ります
 *
 * 叩いても何も起きない状態になっていた。案内のほうが嘘になる。
 * Xperia で実際にそうなった（Galaxy では一度も止まらず、出会わなかった）。
 *
 * ここは外さない受け手を1つ置く。ただし「鳴らす処理」は通さない。
 * 通すと、弾いていないのに無音の見張りが動き、タブを切り替えただけで
 * 「音が出ていません」と出てしまうため。やることは戻すことだけに絞る。
 */

export interface AudioResumeOptions {
  /** いまの AudioContext。まだ作っていなければ null か undefined */
  ctx: () => AudioContext | null | undefined;
  /** まだ一度も用意していないときに呼ぶ（初期化） */
  start: () => void;
  /** 閉じられていて作り直しが要るときに呼ぶ。省略すると start を使う */
  rebuild?: () => void;
  /** 実際に戻ったときに呼ぶ。画面に出した断りを消すため */
  onResumed?: () => void;
}

/**
 * 画面のどこかが押されたら、止まっている音を戻す。
 * 返り値を呼ぶと受け手を外せる（ふだんは外さない）。
 */
export function resumeAudioOnGesture(opts: AudioResumeOptions): () => void {
  const wake = () => {
    const ctx = opts.ctx();

    // まだ音を用意していない。ここが最初の一回にあたる
    if (!ctx) {
      opts.start();
      return;
    }

    // 長く放置されて閉じられた。resume() では戻らないので作り直す
    if (ctx.state === 'closed') {
      (opts.rebuild ?? opts.start)();
      return;
    }

    // 止まっているときだけ戻す。動いているなら何もしない
    if (ctx.state === 'suspended') {
      void ctx.resume().then(
        () => opts.onResumed?.(),
        () => {
          // 戻せないこともある（音の出口が他に取られている等）。
          // ここで騒いでも直らないので、次の操作に任せる
        }
      );
    }
  };

  // 端末とブラウザによって、どれが最初に来るかが違う。
  // capture で拾うのは、途中で止められても届くようにするため。
  const events = ['pointerdown', 'touchstart', 'mousedown', 'keydown'] as const;
  for (const ev of events) {
    window.addEventListener(ev, wake, { capture: true, passive: true });
  }

  // 画面に戻ってきたときも見る。ロック解除の直後は、
  // 叩く前から止まったままのことがある
  const onVisible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    for (const ev of events) {
      window.removeEventListener(ev, wake, { capture: true } as EventListenerOptions);
    }
    document.removeEventListener('visibilitychange', onVisible);
  };
}
