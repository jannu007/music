/*
 * マイク入力（録音）
 *
 * 再生用の AudioContext をそのまま借りて録音する。
 * 録音した波形は Float32 の生データのまま持ち、音符の取り出し（transcribe）へ渡す。
 */

import micProcessorUrl from './mic-processor.js?url';

export interface Recording {
  /** モノラルの波形 */
  samples: Float32Array;
  sampleRate: number;
}

/** マイクは端末ごとに癖が強いので、歌の解析に不利な補正はすべて切る */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

export function micSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private capturing = false;
  /** ワークレットが送り終えるまでは受け取り続ける */
  private collecting = false;
  private stopWaiters: (() => void)[] = [];

  /** 入力レベル 0..1（メーター用） */
  onLevel: ((peak: number) => void) | null = null;

  get isOpen(): boolean {
    return !!this.node;
  }

  get isCapturing(): boolean {
    return this.capturing;
  }

  /** マイクの使用許可を取り、録音経路を用意する（許可されるまで解決しない） */
  async open(ctx: AudioContext): Promise<void> {
    if (this.node && this.ctx === ctx) return;
    this.close();
    if (!micSupported()) throw new Error('この端末ではマイクを使えません');

    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    try {
      await ctx.audioWorklet.addModule(micProcessorUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'hoshizora-mic-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (e) => {
        const data = e.data;
        if (data?.type === 'chunk') {
          if (this.collecting) this.chunks.push(data.data as Float32Array);
        } else if (data?.type === 'level') {
          this.onLevel?.(data.peak as number);
        } else if (data?.type === 'stopped') {
          this.collecting = false;
          for (const resolve of this.stopWaiters) resolve();
          this.stopWaiters = [];
        }
      };

      // ワークレットは出力が繋がっていないと動かないブラウザがあるため、
      // 無音のゲインを通して出口まで繋いでおく（マイクの音は外へ出さない）。
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      this.ctx = ctx;
      this.stream = stream;
      this.source = source;
      this.node = node;
      this.sink = sink;
    } catch (err) {
      for (const track of stream.getTracks()) track.stop();
      throw err;
    }
  }

  /** 録音を始める（open 済みであること） */
  start() {
    if (!this.node) throw new Error('マイクが用意できていません');
    this.chunks = [];
    this.capturing = true;
    this.collecting = true;
    this.node.port.postMessage({ type: 'start' });
  }

  /**
   * 録音を止めて波形を取り出す。
   * ワークレットは音声スレッドで動いているため、止めた合図が返るまで待ってから
   * 繋ぎ合わせる（待たずに読むと、最後のひと息分が抜け落ちる）。
   */
  async stop(): Promise<Recording> {
    const rate = this.ctx?.sampleRate ?? 48000;
    this.capturing = false;
    if (this.node && this.collecting) {
      const stopped = new Promise<void>((resolve) => this.stopWaiters.push(resolve));
      this.node.port.postMessage({ type: 'stop' });
      await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, 400))]);
    }
    this.collecting = false;
    this.stopWaiters = [];

    let total = 0;
    for (const c of this.chunks) total += c.length;
    const samples = new Float32Array(total);
    let at = 0;
    for (const c of this.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    return { samples, sampleRate: rate };
  }

  /** マイクを解放する（録音ランプを消す） */
  close() {
    this.capturing = false;
    this.collecting = false;
    for (const resolve of this.stopWaiters) resolve();
    this.stopWaiters = [];
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.node = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
  }
}
