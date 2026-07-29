/**
 * Respiration–χ coupling, the third observable and the quantity the filter demo tracks.
 *
 * CLASS C. We wrote this estimator, so a value it returns proves internal consistency and
 * nothing more. It is also the estimator G4 is written in terms of, which is why G4 is class
 * C and still the most important gate in Tier 0: it is the only check that the filter
 * demonstration measures coupling rather than leakage.
 *
 * The demo's whole point is the gap between two numbers on screen: the coupling that was
 * INJECTED (known exactly, because we put it there) and the coupling RECOVERED after
 * filtering. No real dataset can show that gap, because with real data the pre-filter value
 * was never known.
 */
import { scalarValue } from '../core/registry.ts';
import { welch } from './psd.ts';

/**
 * Sliding-window estimate of χ(t) by a two-band log-power ratio.
 *
 * Deliberately NOT a `specparam` fit per window: at ~1 Hz update over a 30 s buffer that
 * would be thirty model fits per second in a browser. This is a cheap monotone proxy, and it
 * is labelled as one.
 *
 * THE WINDOW IS THE ESTIMATOR'S TRANSFER FUNCTION. Harness §4 names this for SPRiNT —
 * "sliding-window smoothing comparable to a ~4 s respiratory cycle will attenuate recovered
 * modulation depth by an amount the ESTIMATOR, not the generator, determines" — and it
 * applies identically here. A window at or above the respiratory period averages the very
 * modulation being measured away.
 */
export function chiOverTime(
  x: Float64Array,
  fs = scalarValue('fs'),
  windowS = 2,
  hopS = 0.25,
): { chi: Float64Array; fsEst: number } {
  const win = Math.round(windowS * fs);
  const hop = Math.round(hopS * fs);
  const nEst = Math.max(0, Math.floor((x.length - win) / hop));
  const out = new Float64Array(nEst);

  const loBand = [2, 8] as const;
  const hiBand = [16, 40] as const;
  const fcLo = Math.sqrt(loBand[0] * loBand[1]);
  const fcHi = Math.sqrt(hiBand[0] * hiBand[1]);
  const span = Math.log10(fcHi) - Math.log10(fcLo);

  for (let k = 0; k < nEst; k++) {
    const seg = x.subarray(k * hop, k * hop + win);
    const psd = welch(seg, fs, Math.min(win, 512), Math.min(win, 512) / 2);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < psd.freqs.length; i++) {
      const f = psd.freqs[i]!;
      if (f >= loBand[0] && f <= loBand[1]) lo += psd.power[i]!;
      else if (f >= hiBand[0] && f <= hiBand[1]) hi += psd.power[i]!;
    }
    out[k] = lo > 0 && hi > 0 ? -(Math.log10(hi) - Math.log10(lo)) / span : Number.NaN;
  }
  return { chi: out, fsEst: 1 / hopS };
}

/**
 * Modulation depth of χ(t) at a given frequency, in χ units.
 *
 * The amplitude of the line at `freqHz` in the χ(t) spectrum, scaled so that a pure cosine of
 * amplitude A returns A. This is directly comparable to the injected `chi_mod_depth`, which
 * is what makes the ground-truth line on Demo 1 meaningful.
 */
export function modulationDepth(chi: Float64Array, fsEst: number, freqHz: number): number {
  const n = chi.length;
  if (n < 8) return Number.NaN;
  let mean = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(chi[i]!)) {
      mean += chi[i]!;
      valid++;
    }
  }
  if (valid < 8) return Number.NaN;
  mean /= valid;

  let re = 0;
  let im = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(chi[i]!)) continue;
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n)); // Hann
    const v = (chi[i]! - mean) * w;
    const ph = (2 * Math.PI * freqHz * i) / fsEst;
    re += v * Math.cos(ph);
    im += v * Math.sin(ph);
    wsum += w;
  }
  // 2/sum(w) recovers the amplitude of a cosine rather than its half-amplitude.
  return (2 * Math.hypot(re, im)) / wsum;
}

export interface CouplingReadout {
  /** What was injected. Known exactly, because the generator put it there. */
  readonly injectedDepth: number;
  /** What the estimator recovers from the (possibly filtered) signal. */
  readonly recoveredDepth: number;
  /** Fraction of the injected coupling that survived. */
  readonly retained: number;
  readonly respFreqHz: number;
}

export function couplingReadout(
  signal: Float64Array,
  injectedDepth: number,
  respFreqHz: number,
  fs = scalarValue('fs'),
): CouplingReadout {
  const { chi, fsEst } = chiOverTime(signal, fs);
  const recovered = modulationDepth(chi, fsEst, respFreqHz);
  return {
    injectedDepth,
    recoveredDepth: recovered,
    retained: injectedDepth > 0 ? recovered / injectedDepth : Number.NaN,
    respFreqHz,
  };
}
