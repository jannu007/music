/*
 * Akatsuki Synth — リアルタイム録音用 AudioWorklet
 * マスター出力をそのまま Float32 のまま取り出してメインスレッドへ渡します。
 * （非推奨の ScriptProcessorNode を使わないため、UI 描画による音切れが起きません）
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'start') this.active = true;
      if (e.data?.type === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input.length > 1 ? input[1] : input[0];
    if (!left) return true;
    this.port.postMessage({
      type: 'chunk',
      channels: [new Float32Array(left), new Float32Array(right)],
    });
    return true;
  }
}

registerProcessor('mss-recorder', RecorderProcessor);
