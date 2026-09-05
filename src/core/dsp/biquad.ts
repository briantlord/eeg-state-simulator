/**
 * Biquad sections and Butterworth cascades.
 *
 * Realized as SECOND-ORDER SECTIONS, never as a single high-order transfer function.
 * Measured during the tilt-filter characterization: a 12-24 pole cascade built with
 * `zpk2tf` + direct-form recursion overflows to non-finite values within a 120 s impulse
 * response. That is a property of the realization, not of the mathematics, and it applies
 * to every cascade in this project. See docs/Tier0-Estimator-Probe.md Finding 3.
 *
 * @lit-ok-file: the RBJ biquad cookbook and Butterworth pole formulas. Every literal is the
 * DSP mathematics — the 2s and halves of the bilinear transform, cascade indexing. Cutoff
 * frequencies and orders arrive as arguments, sourced by the callers from the registry.
 */

export interface Biquad {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

/** Butterworth Q values for an order-`n` cascade of biquads. */
export function butterworthQs(order: number): number[] {
  if (order % 2 !== 0) throw new Error('biquad: only even Butterworth orders are supported');
  const qs: number[] = [];
  for (let k = 0; k < order / 2; k++) {
    qs.push(1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order))));
  }
  return qs;
}

export function lowpass(fc: number, fs: number, q: number): Biquad {
  const w = (2 * Math.PI * fc) / fs;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cw) / 2) / a0,
    b1: (1 - cw) / a0,
    b2: ((1 - cw) / 2) / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpass(fc: number, fs: number, q: number): Biquad {
  const w = (2 * Math.PI * fc) / fs;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cw) / 2) / a0,
    b1: (-(1 + cw)) / a0,
    b2: ((1 + cw) / 2) / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Apply one section in place, transposed direct form II. */
export function applyBiquad(x: Float64Array, s: Biquad): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i]!;
    const yn = s.b0 * xn + z1;
    z1 = s.b1 * xn - s.a1 * yn + z2;
    z2 = s.b2 * xn - s.a2 * yn;
    x[i] = yn;
  }
}

/** Apply a cascade forwards then backwards: zero phase, order doubled. */
export function filtfilt(x: Float64Array, sections: Biquad[]): void {
  for (const s of sections) applyBiquad(x, s);
  x.reverse();
  for (const s of sections) applyBiquad(x, s);
  x.reverse();
}

/**
 * Butterworth bandpass as a cascade: highpass at `lo`, lowpass at `hi`, each of `order`.
 * This is NOT the frequency-transformed bandpass from scipy.signal.butter(order, [lo, hi]).
 * Its SciPy equivalent concatenates butter(order, lo, 'highpass') and
 * butter(order, hi, 'lowpass') SOS arrays.
 */
export function bandpassSections(lo: number, hi: number, fs: number, order: number): Biquad[] {
  const qs = butterworthQs(order);
  return [
    ...qs.map((q) => highpass(lo, fs, q)),
    ...qs.map((q) => lowpass(hi, fs, q)),
  ];
}

/**
 * Odd-reflection, steady-state forward/reverse filtering. Scoring contract equivalent to
 * scipy.signal.sosfiltfilt for even-order sections, with explicit padlen = 3*(2*sections+1).
 * The unpadded filtfilt above remains available for existing synthesis/fixture contracts.
 */
export function filtfiltPadded(x: Float64Array, sections: Biquad[]): Float64Array {
  const pad = 3 * (2 * sections.length + 1);
  if (x.length <= pad || !x.every(Number.isFinite)) {
    throw new Error(`filtfiltPadded requires more than ${pad} finite samples`);
  }
  const y = new Float64Array(x.length + 2 * pad);
  y.set(x, pad);
  for (let i = 0; i < pad; i++) {
    y[i] = 2 * x[0]! - x[pad - i]!;
    y[pad + x.length + i] = 2 * x[x.length - 1]! - x[x.length - 2 - i]!;
  }
  const pass = (): void => {
    for (const s of sections) {
      const input = y[0]!;
      const output = input * (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
      let z1 = output - s.b0 * input;
      let z2 = s.b2 * input - s.a2 * output;
      for (let i = 0; i < y.length; i++) {
        const xn = y[i]!;
        const yn = s.b0 * xn + z1;
        z1 = s.b1 * xn - s.a1 * yn + z2;
        z2 = s.b2 * xn - s.a2 * yn;
        y[i] = yn;
      }
    }
  };
  pass();
  y.reverse();
  pass();
  y.reverse();
  return y.slice(pad, pad + x.length);
}
