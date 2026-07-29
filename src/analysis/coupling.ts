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
import { bandpassSections, filtfilt } from '../core/dsp/biquad.ts';
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
  hopS = 0.25, // @lit-ok chi-proxy sliding-window hop (s); estimator-internal, provisional -- Finding 13/14, replaced at T1-M2
): { chi: Float64Array; fsEst: number } {
  const win = Math.round(windowS * fs);
  const hop = Math.round(hopS * fs);
  const nEst = Math.max(0, Math.floor((x.length - win) / hop));
  const out = new Float64Array(nEst);

  const loBand = [2, 8] as const; // @lit-ok chi-proxy low band edges (Hz); estimator-internal, provisional (Finding 13/14)
  const hiBand = [16, 40] as const; // @lit-ok chi-proxy high band edges (Hz); estimator-internal, provisional (Finding 13/14)
  const fcLo = Math.sqrt(loBand[0] * loBand[1]);
  const fcHi = Math.sqrt(hiBand[0] * hiBand[1]);
  const span = Math.log10(fcHi) - Math.log10(fcLo);

  for (let k = 0; k < nEst; k++) {
    const seg = x.subarray(k * hop, k * hop + win);
    const psd = welch(seg, fs, Math.min(win, 512), Math.min(win, 512) / 2); // @lit-ok Welch segment cap (samples); estimator-internal
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
  if (n < 8) return Number.NaN; // @lit-ok minimum-sample guard
  let mean = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(chi[i]!)) {
      mean += chi[i]!;
      valid++;
    }
  }
  if (valid < 8) return Number.NaN; // @lit-ok minimum-sample guard
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

/**
 * Modulation depth of a BAND'S AMPLITUDE by respiratory phase.
 *
 * This is the quantity the filter demonstration turns on, and it is a different quantity from
 * χ modulation. It reads the envelope of a low-frequency band — which is where a 0.5–1 Hz
 * high-pass actually bites — rather than a spectral slope estimated from 2–40 Hz, which sits
 * entirely above the stopband and survives any clinical filter.
 *
 * Measured against the KNOWN respiration phase rather than one recovered from the signal.
 * Recovering it would inject estimator error into the reference and confound the very loss
 * being demonstrated: the filter would appear to destroy coupling partly by destroying our
 * ability to measure phase, which is a different claim.
 */
export function bandAmplitudeCoupling(
  x: Float64Array,
  respPhase: Float64Array,
  bandLo: number,
  bandHi: number,
  fs = scalarValue('fs'),
): number {
  const n = Math.min(x.length, respPhase.length);

  // EXTRACT THE BAND FIRST. An earlier version took the running RMS of the raw signal and
  // only used the band edges to size the window — so it measured the envelope of everything,
  // including the movement artifact, whose own RMS modulates at TWICE the respiratory rate
  // and diluted the very component being measured. The result moved in the wrong direction
  // with cutoff, which is how the bug surfaced.
  const band = Float64Array.from(x.subarray(0, n));
  filtfilt(band, bandpassSections(bandLo, bandHi, fs, scalarValue('filter_order')));

  const win = Math.round(fs / Math.max(bandHi - bandLo, 1));
  // Running RMS over one beat period of the band: a cheap envelope, adequate because the
  // modulation being measured is far slower than the band itself.
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i]! + band[i]! * band[i]!;
  const half = win >> 1;

  let sumRe = 0;
  let sumIm = 0;
  let sumEnv = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const env = Math.sqrt((cum[hi]! - cum[lo]!) / (hi - lo));
    sumEnv += env;
    sumRe += env * Math.cos(respPhase[i]!);
    sumIm += env * Math.sin(respPhase[i]!);
  }
  const meanEnv = sumEnv / n;
  if (meanEnv <= 0) return Number.NaN;
  // Modulation depth: 2|<env e^{i phi}>| / <env> recovers `d` for env = 1 + d cos(phi).
  return (2 * Math.hypot(sumRe / n, sumIm / n)) / meanEnv;
}

/**
 * DIRECT respiration–EEG coupling: the component of the signal locked to respiratory phase,
 * in microvolts. This is Demo 1's quantity.
 *
 * WHY THIS AND NOT AN ENVELOPE MEASURE, which cost a round of measurement to establish:
 *
 * A high-pass removes a CARRIER below its cutoff. It does NOT remove amplitude modulation of
 * a carrier that passes — modulating delta at 0.5–2 Hz by respiration puts sidebands at
 * 1 ± 0.25 Hz, and a 1 Hz cutoff keeps most of them. Measured, the envelope-coupling of
 * 0.5–4 Hz was retained at 100–101% across the whole clinical range, in both N2 and N3. Nor
 * does it touch χ modulation, which is estimated from 2–40 Hz entirely above the stopband.
 *
 * What a clinical high-pass DOES annihilate is anything sitting AT the respiratory rate —
 * mechanism (a), the movement artifact. Measured: 11.14 µV at a 0.01 Hz cutoff, 0.02 µV at
 * 0.5 Hz. A 99.8% loss.
 *
 * So the demonstration's honest content is sharper than "filtering destroys real coupling":
 * a naive respiration–EEG coupling measure is DOMINATED by the artifact, filtering removes
 * the artifact and therefore the apparent coupling, and the mechanisms that were physiological
 * all along are untouched. That is why §5.1 insists the three be kept separate, and it is a
 * better lesson than the one the demo was originally framed around.
 */
export function respiratoryCoupling(
  x: Float64Array,
  respPhase: Float64Array,
): number {
  const n = Math.min(x.length, respPhase.length);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    re += x[i]! * Math.cos(respPhase[i]!);
    im += x[i]! * Math.sin(respPhase[i]!);
  }
  // 2|<x e^{i phi}>| recovers the amplitude of a component locked to phi.
  return (2 * Math.hypot(re / n, im / n));
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
