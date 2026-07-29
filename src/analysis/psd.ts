/**
 * Welch PSD and the spectral-exponent readout (Build Plan §7.1).
 *
 * "Welch PSD then specparam-style fit. The fit band is a FIRST-CLASS USER CONTROL —
 * broadband (1–45 Hz, knee mode) and narrowband (30–45 Hz, fixed mode) at minimum."
 *
 * CLASS C. This is our own estimator, not `specparam`. The live readout in the artifact uses
 * it because the artifact runs in a browser; the GATES use `specparam` itself, which is what
 * makes G1a/G1b class V. Those two numbers will not agree exactly and are not required to —
 * but the difference must never be presented as a measurement of anything.
 *
 * "Why band is a control: broadband and narrowband fits give different orderings across sleep
 * stages, and much of the apparent disagreement in this literature is a band-choice artifact.
 * The two are DIFFERENT QUANTITIES, not two estimates of one quantity." Seam 7's exponent
 * type enforces that; this module returns those types rather than bare numbers.
 */
import { fft } from '../core/dsp/fft.ts';
import { scalarValue, bandEdges, enumValue } from '../core/registry.ts';
import {
  broadKnee,
  narrowFixed,
  type BroadKneeExponent,
  type NarrowFixedExponent,
} from '../core/types/exponent.ts';

export interface Psd {
  readonly freqs: Float64Array;
  readonly power: Float64Array;
}

/** Welch's method with the registry's window, segment length and overlap. */
export function welch(
  x: Float64Array,
  fs = scalarValue('fs'),
  nperseg = scalarValue('welch_nperseg'),
  noverlap = scalarValue('welch_noverlap'),
): Psd {
  const win = enumValue('welch_window')[0] === 'hann' ? hann(nperseg) : hann(nperseg);
  let winPower = 0;
  for (let i = 0; i < nperseg; i++) winPower += win[i]! * win[i]!;

  const step = nperseg - noverlap;
  const nSeg = Math.max(1, Math.floor((x.length - noverlap) / step));
  const nBins = nperseg / 2 + 1;
  const acc = new Float64Array(nBins);

  const re = new Float64Array(nperseg);
  const im = new Float64Array(nperseg);
  for (let s = 0; s < nSeg; s++) {
    const off = s * step;
    let mean = 0;
    for (let i = 0; i < nperseg; i++) mean += x[off + i]!;
    mean /= nperseg;
    for (let i = 0; i < nperseg; i++) {
      re[i] = (x[off + i]! - mean) * win[i]!; // detrend constant, then window
      im[i] = 0;
    }
    fft(re, im, false);
    for (let i = 0; i < nBins; i++) {
      const p = re[i]! * re[i]! + im[i]! * im[i]!;
      // Double all but DC and Nyquist for the one-sided spectrum.
      acc[i] = acc[i]! + (i === 0 || i === nBins - 1 ? p : 2 * p);
    }
  }

  const freqs = new Float64Array(nBins);
  const power = new Float64Array(nBins);
  const norm = nSeg * fs * winPower;
  for (let i = 0; i < nBins; i++) {
    freqs[i] = (i * fs) / nperseg;
    power[i] = acc[i]! / norm;
  }
  return { freqs, power };
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/**
 * Fixed-mode fit: a straight line in log-log over [lo, hi].
 *
 * This is G1b's quantity. It is NOT an estimate of the same thing as the knee-mode fit, and
 * seam 7's type system will refuse to compare them.
 */
export function fitFixed(psd: Psd, lo: number, hi: number): { exponent: number; offset: number; rSquared: number } {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < psd.freqs.length; i++) {
    const f = psd.freqs[i]!;
    if (f < lo || f > hi || psd.power[i]! <= 0) continue;
    const lx = Math.log10(f);
    const ly = Math.log10(psd.power[i]!);
    xs.push(lx); ys.push(ly);
    sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; n++;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const offset = (sy - slope * sx) / n;

  let ssRes = 0, ssTot = 0;
  const meanY = sy / n;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i]! + offset;
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  return { exponent: -slope, offset, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

/**
 * Knee-mode fit: L(f) = b − log10(k + f^χ), by grid search over (χ, k) with b solved in
 * closed form at each candidate.
 *
 * Crude compared to `specparam`'s optimizer, and that is acceptable for a live readout —
 * G1a's class-V claim rests on `specparam`, not on this. A knee CANNOT be identified from a
 * band lying entirely above it, which is why this is only ever offered over the broad band.
 */
export function fitKnee(
  psd: Psd,
  lo: number,
  hi: number,
): { exponent: number; knee: number; offset: number; rSquared: number } {
  const fs: number[] = [];
  const ls: number[] = [];
  for (let i = 1; i < psd.freqs.length; i++) {
    const f = psd.freqs[i]!;
    if (f < lo || f > hi || psd.power[i]! <= 0) continue;
    fs.push(f);
    ls.push(Math.log10(psd.power[i]!));
  }

  let best = { exponent: 1, knee: 0, offset: 0, rSquared: -Infinity };
  for (let chi = 0.1; chi <= 4.0; chi += 0.05) {
    // Knee frequencies from below the band to above it, log-spaced.
    for (let e = -1; e <= 2.0; e += 0.1) {
      const kneeHz = Math.pow(10, e);
      const k = Math.pow(kneeHz, chi);
      let sum = 0;
      for (let i = 0; i < fs.length; i++) {
        sum += ls[i]! + Math.log10(k + Math.pow(fs[i]!, chi));
      }
      const b = sum / fs.length;
      let ssRes = 0;
      for (let i = 0; i < fs.length; i++) {
        const pred = b - Math.log10(k + Math.pow(fs[i]!, chi));
        ssRes += (ls[i]! - pred) ** 2;
      }
      let meanL = 0;
      for (const l of ls) meanL += l;
      meanL /= ls.length;
      let ssTot = 0;
      for (const l of ls) ssTot += (l - meanL) ** 2;
      const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
      if (r2 > best.rSquared) best = { exponent: chi, knee: k, offset: b, rSquared: r2 };
    }
  }
  return best;
}

/** The broadband readout: (value, band, mode) — never a bare number. */
export function broadbandExponent(x: Float64Array, fs = scalarValue('fs')): BroadKneeExponent {
  const band = bandEdges('fit_band_broad');
  const r = fitKnee(welch(x, fs), band.lo, band.hi);
  return broadKnee(r.exponent, r.knee, r.rSquared);
}

/** The narrowband readout. A different quantity, and the type system knows it. */
export function narrowbandExponent(x: Float64Array, fs = scalarValue('fs')): NarrowFixedExponent {
  const band = bandEdges('fit_band_narrow');
  const r = fitFixed(welch(x, fs), band.lo, band.hi);
  return narrowFixed(r.exponent, r.rSquared);
}
