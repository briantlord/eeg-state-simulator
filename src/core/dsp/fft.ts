/**
 * In-place iterative radix-2 FFT. No dependency, typed arrays only.
 *
 * Node has no built-in FFT and the Build Plan's stack table takes "no framework dependency"
 * as a constraint, so this is written rather than imported. `synth_block` = 4096 = 2^12, so
 * radix-2 suffices; the length check is an assertion rather than a padding step, because a
 * silently padded block would change the PSD the aperiodic generator is trying to hit.
 *
 * @lit-ok-file: a radix-2 FFT. Every literal is the algorithm — the radix, bit widths, the 31
 * in the clz32 power-of-two check. No signal parameter lives here.
 */

/** Bit-reversal permutation, computed once per length and cached. */
const revCache = new Map<number, Uint32Array>();

function bitReversal(n: number): Uint32Array {
  const cached = revCache.get(n);
  if (cached) return cached;
  const bits = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>>= 1;
    }
    rev[i] = r;
  }
  revCache.set(n, rev);
  return rev;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place complex FFT. `inverse` applies the 1/n scaling.
 * `re` and `im` must be the same power-of-two length.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re and im length mismatch');
  if (!isPowerOfTwo(n)) throw new Error(`fft: length ${n} is not a power of two`);

  const rev = bitReversal(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const theta = (sign * 2 * Math.PI) / size;
    const wRe = Math.cos(theta);
    const wIm = Math.sin(theta);
    for (let start = 0; start < n; start += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const i0 = start + k;
        const i1 = i0 + half;
        const xRe = re[i1]! * curRe - im[i1]! * curIm;
        const xIm = re[i1]! * curIm + im[i1]! * curRe;
        re[i1] = re[i0]! - xRe;
        im[i1] = im[i0]! - xIm;
        re[i0] = re[i0]! + xRe;
        im[i0] = im[i0]! + xIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

/**
 * Analytic signal via the Hilbert transform: zero the negative frequencies, double the
 * positive ones, invert.
 *
 * Needed in two places: waveform shaping (which re-renders a rhythm from its instantaneous
 * phase and envelope) and the Lempel-Ziv readout, which §7 specifies as "bandpass, Hilbert,
 * binarize around the median".
 *
 * Input length must be a power of two. Returns { re, im }; envelope is hypot(re, im) and
 * instantaneous phase is atan2(im, re).
 */
export function analyticSignal(x: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  if (!isPowerOfTwo(n)) throw new Error(`analyticSignal: length ${n} is not a power of two`);
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fft(re, im, false);

  // h = 1 at DC and Nyquist, 2 on the positive frequencies, 0 on the negative ones.
  const half = n >> 1;
  for (let i = 1; i < half; i++) {
    re[i] = re[i]! * 2;
    im[i] = im[i]! * 2;
  }
  for (let i = half + 1; i < n; i++) {
    re[i] = 0;
    im[i] = 0;
  }

  fft(re, im, true);
  return { re, im };
}

/** Envelope and unwrapped-free instantaneous phase of a real signal. */
export function envelopeAndPhase(x: Float64Array): {
  envelope: Float64Array;
  phase: Float64Array;
} {
  const { re, im } = analyticSignal(x);
  const envelope = new Float64Array(x.length);
  const phase = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    envelope[i] = Math.hypot(re[i]!, im[i]!);
    phase[i] = Math.atan2(im[i]!, re[i]!);
  }
  return { envelope, phase };
}

/** Largest power of two not exceeding n. */
export function floorPow2(n: number): number {
  return 1 << (31 - Math.clz32(n));
}

/** Magnitude spectrum of a real signal, bins 0..n/2. For tests and the PSD readout. */
export function magnitudeSpectrum(x: Float64Array): Float64Array {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fft(re, im, false);
  const out = new Float64Array(n / 2 + 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.hypot(re[i]!, im[i]!);
  }
  return out;
}
