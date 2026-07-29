/**
 * Biquad sections and Butterworth cascades.
 *
 * Realized as SECOND-ORDER SECTIONS, never as a single high-order transfer function.
 * Measured during the tilt-filter characterization: a 12-24 pole cascade built with
 * `zpk2tf` + direct-form recursion overflows to non-finite values within a 120 s impulse
 * response. That is a property of the realization, not of the mathematics, and it applies
 * to every cascade in this project. See docs/Tier0-Estimator-Probe.md Finding 3.
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
 * Matches the convention `scipy.signal.butter(order, [lo, hi], 'bandpass')` uses.
 */
export function bandpassSections(lo: number, hi: number, fs: number, order: number): Biquad[] {
  const qs = butterworthQs(order);
  return [
    ...qs.map((q) => highpass(lo, fs, q)),
    ...qs.map((q) => lowpass(hi, fs, q)),
  ];
}
