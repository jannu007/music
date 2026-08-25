/*
 * 依存ライブラリ無しの最小 PNG エンコーダ／デコーダ。
 * アイコン生成スクリプトから共通で使う。
 *
 * 読み込みは、自分たちが書いた 8bit RGBA の PNG を読み直すためのもの。
 * ストア用や Android 用に、512px の絵を各サイズへ縮めるのに使う。
 */
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * PNG を読む。8bit・RGBA / RGB / グレースケール（+アルファ）に対応。
 * インターレースは扱わない（自分たちが書いた PNG は使っていない）。
 */
function decodePng(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  let at = 8;
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('インターレース PNG は読めません');
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8) throw new Error(`8bit 以外の PNG は読めません（${depth}bit）`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`未対応の色の形式です（${colorType}）`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const lines = Buffer.alloc(stride * height);

  // フィルタを戻す。PNG は行ごとに 5 種類の予測から 1 つを選んで差分を書いている
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? lines[dst + i - channels] : 0;
      const b = y > 0 ? lines[up + i] : 0;
      const c = y > 0 && i >= channels ? lines[up + i - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知のフィルタ ${filter}`);
      }
      lines[dst + i] = value & 0xff;
    }
  }

  // どの形式でも RGBA にそろえて返す
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const s = i * channels;
    if (colorType === 6) {
      lines.copy(rgba, o, s, s + 4);
    } else if (colorType === 2) {
      rgba[o] = lines[s];
      rgba[o + 1] = lines[s + 1];
      rgba[o + 2] = lines[s + 2];
      rgba[o + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = lines[s];
      rgba[o + 3] = colorType === 4 ? lines[s + 1] : 255;
    } else {
      const k = lines[s];
      rgba[o] = palette[k * 3];
      rgba[o + 1] = palette[k * 3 + 1];
      rgba[o + 2] = palette[k * 3 + 2];
      rgba[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
    }
  }
  return { width, height, data: rgba };
}

/**
 * 縮小・拡大する。
 *
 * 元の 1 画素を点で拾うと、縮めたときに細い線が消えたりギザギザになる。
 * 出力の 1 画素が覆う範囲を元の絵の上で求め、その中を面積で平均する
 * （箱型フィルタ）。縮小ではこれがいちばん素直で、絵柄も崩れない。
 *
 * 色はアルファを掛けてから混ぜる。透明な部分の色は意味を持たないので、
 * そのまま混ぜると縁に黒や白のふちが出る。
 */
function resize(image, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let py = Math.floor(y0); py < Math.min(image.height, Math.ceil(y1)); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0) continue;
        for (let px = Math.floor(x0); px < Math.min(image.width, Math.ceil(x1)); px++) {
          const wx = Math.min(x1, px + 1) - Math.max(x0, px);
          if (wx <= 0) continue;
          const w = wx * wy;
          const o = (py * image.width + px) * 4;
          const alpha = image.data[o + 3] / 255;
          r += image.data[o] * alpha * w;
          g += image.data[o + 1] * alpha * w;
          b += image.data[o + 2] * alpha * w;
          a += image.data[o + 3] * w;
          weight += w;
        }
      }
      const o = (y * width + x) * 4;
      if (weight <= 0 || a <= 0) continue;
      const alpha = a / weight / 255;
      out[o] = Math.round(r / weight / alpha);
      out[o + 1] = Math.round(g / weight / alpha);
      out[o + 2] = Math.round(b / weight / alpha);
      out[o + 3] = Math.round(a / weight);
    }
  }
  return { width, height, data: out };
}

export { encodePng, decodePng, resize };
