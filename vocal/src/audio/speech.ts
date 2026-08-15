/*
 * 音声認識（歌った言葉を歌詞にする）
 *
 * ブラウザ内蔵の Web Speech API を使う。追加の課金・アカウント・ライブラリは要らないが、
 * 多くのブラウザでは認識サーバーへ音声を送るため、インターネット接続が必要になる。
 * 使えない環境では静かにあきらめ、母音の推定（transcribe 側）に任せる。
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function constructor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!constructor();
}

/**
 * 録音と並行して動かす音声認識。
 * start() で聞き始め、finish() で「今までに確定した言葉」を返す。
 */
export class SpeechCapture {
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = '';
  private ended = false;
  private endWaiters: (() => void)[] = [];

  /** 認識できなかった理由（画面に出す用） */
  error: string | null = null;

  get isRunning(): boolean {
    return !!this.recognition && !this.ended;
  }

  start(lang = 'ja-JP'): boolean {
    const Ctor = constructor();
    if (!Ctor) return false;
    this.finalText = '';
    this.error = null;
    this.ended = false;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) this.finalText += result[0]?.transcript ?? '';
      }
    };
    recognition.onerror = (event: any) => {
      const code = String(event?.error ?? '');
      if (code === 'no-speech') this.error = '言葉を聞き取れませんでした';
      else if (code === 'not-allowed' || code === 'service-not-allowed') this.error = 'マイクの利用が許可されていません';
      else if (code === 'network') this.error = '音声認識はインターネット接続が必要です';
      else if (code !== 'aborted') this.error = `音声認識のエラー: ${code}`;
    };
    recognition.onend = () => {
      this.ended = true;
      for (const resolve of this.endWaiters) resolve();
      this.endWaiters = [];
    };

    try {
      recognition.start();
    } catch {
      // すでに動いている・許可されていない場合はあきらめる
      return false;
    }
    this.recognition = recognition;
    return true;
  }

  /** 認識を止めて、確定した言葉を受け取る（最大 timeoutMs 待つ） */
  async finish(timeoutMs = 4000): Promise<string> {
    const recognition = this.recognition;
    if (!recognition) return '';
    if (!this.ended) {
      const waitEnd = new Promise<void>((resolve) => this.endWaiters.push(resolve));
      try {
        recognition.stop();
      } catch {
        /* すでに止まっている */
      }
      await Promise.race([waitEnd, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
    }
    this.recognition = null;
    return this.finalText.trim();
  }

  /** 結果を捨てて止める */
  cancel() {
    const recognition = this.recognition;
    this.recognition = null;
    this.endWaiters = [];
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      /* 無視 */
    }
  }
}
