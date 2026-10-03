/** Tiny WAV helpers shared by the browser (recording) and the server (Whisper input / Piper output). Pure, no DOM, no Node. */

export interface Pcm {
  samples: Float32Array;
  rate: number;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** Reads a PCM WAV (8/16/24/32-bit int or 32-bit float, any channel count) into mono floats. Throws on anything else. */
export function decodeWav(bytes: Uint8Array): Pcm {
  if (bytes.length < 44) throw new Error("not a WAV file (too short)");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("not a WAV file");
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= bytes.length) {
    const id = str(pos, 4);
    let size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt");
      // Streamed WAVs (Piper to stdout) may carry 0 or 0xFFFFFFFF as the size: take everything that is left.
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      return { samples: toMono(v, body, size, fmt), rate: fmt.rate };
    }
    pos = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

function toMono(v: DataView, at: number, size: number, f: { format: number; channels: number; bits: number }): Float32Array {
  const bytes = f.bits / 8;
  const frames = Math.floor(size / (bytes * f.channels));
  const out = new Float32Array(frames);
  const read = (o: number): number => {
    if (f.format === 3 && f.bits === 32) return v.getFloat32(o, true);
    if (f.format !== 1 && f.format !== 0xfffe) throw new Error(`unsupported WAV format ${f.format}`);
    if (f.bits === 16) return v.getInt16(o, true) / 32768;
    if (f.bits === 8) return (v.getUint8(o) - 128) / 128;
    if (f.bits === 24) return ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) as number) / 8388608;
    if (f.bits === 32) return v.getInt32(o, true) / 2147483648;
    throw new Error(`unsupported WAV bit depth ${f.bits}`);
  };
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < f.channels; c++) sum += read(at + (i * f.channels + c) * bytes);
    out[i] = sum / f.channels;
  }
  return out;
}

/** Linear-interpolation resampler with a box low-pass when shrinking (enough for speech going into Whisper). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const n = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  const half = ratio > 1 ? ratio / 2 : 0;
  for (let i = 0; i < n; i++) {
    const centre = i * ratio;
    if (half > 0) {
      const a = Math.max(0, Math.floor(centre - half));
      const b = Math.min(samples.length - 1, Math.ceil(centre + half));
      let s = 0;
      for (let k = a; k <= b; k++) s += samples[k]!;
      out[i] = s / (b - a + 1);
    } else {
      const i0 = Math.floor(centre);
      const f = centre - i0;
      out[i] = samples[i0]! * (1 - f) + (samples[Math.min(samples.length - 1, i0 + 1)] ?? samples[i0]!) * f;
    }
  }
  return out;
}

export const rms = (s: Float32Array): number => {
  if (!s.length) return 0;
  let a = 0;
  for (let i = 0; i < s.length; i++) a += s[i]! * s[i]!;
  return Math.sqrt(a / s.length);
};
