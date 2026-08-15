/*
 * Hoshizora Vocal — マイク録音用 AudioWorklet
 *
 * マイク入力をモノラルの Float32 のまま取り出してメインスレッドへ渡す。
 * ScriptProcessorNode と違い UI 描画で取りこぼさないため、歌の頭が欠けない。
 * 128 サンプルごとに送ると回数が多すぎるので、一定量ためてからまとめて送る。
 */

const CHUNK = 4096;

class MicRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.buffer = new Float32Array(CHUNK);
    this.filled = 0;
    // レベル表示用（録音していないときもマイクの入力を確かめられるように送る）
    this.peak = 0;
    this.sinceLevel = 0;

    this.port.onmessage = (e) => {
      const type = e.data && e.data.type;
      if (type === 'start') {
        this.active = true;
        this.filled = 0;
      } else if (type === 'stop') {
        this.flush();
        this.active = false;
      }
    };
  }

  flush() {
    if (this.filled > 0) {
      this.port.postMessage({ type: 'chunk', data: this.buffer.slice(0, this.filled) });
      this.filled = 0;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const v = channel[i] < 0 ? -channel[i] : channel[i];
      if (v > this.peak) this.peak = v;
    }
    this.sinceLevel += channel.length;
    if (this.sinceLevel >= 2048) {
      this.port.postMessage({ type: 'level', peak: this.peak });
      this.peak = 0;
      this.sinceLevel = 0;
    }

    if (this.active) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled >= CHUNK) this.flush();
      }
    }
    return true;
  }
}

registerProcessor('hoshizora-mic-recorder', MicRecorderProcessor);
