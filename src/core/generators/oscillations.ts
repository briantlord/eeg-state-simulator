/**
 * Narrowband oscillations (Build Plan 3.3).
 *
 * "Narrowband-filtered noise, NEVER pure sinusoids. A pure sine reads as synthetic within one
 * second. White noise -> 4th-order Butterworth bandpass -> amplitude envelope."
 *
 * The envelope matters as much as the band. A constant-amplitude narrowband signal still
 * reads as synthetic: real alpha waxes and wanes. The envelope here is itself low-passed
 * noise, so the modulation is aperiodic rather than a second sinusoid -- which would just
 * move the tell from the carrier to the envelope.
 */
import { bandpassSections, filtfilt, lowpass } from '../dsp/biquad.ts';
import type { Rng } from '../rng/xoshiro128pp.ts';
import { scalarValue } from '../registry.ts';
import { normalizeRms } from './aperiodic.ts';

export interface OscillationParams {
  /** Passband edges in Hz. Both endpoints are simultaneously in force. */
  readonly bandLo: number;
  readonly bandHi: number;
  /** Target RMS in microvolts. */
  readonly rmsUv: number;
  /** Envelope modulation depth, 0 (flat) to 1 (full). */
  readonly envelopeDepth: number;
  /** Envelope corner in Hz: how fast the oscillation waxes and wanes. */
  readonly envelopeRateHz: number;
  /**
   * Burst structure. When present the rhythm arrives in discrete runs rather than
   * continuously, which is how posterior alpha actually behaves.
   *
   * Without it the only amplitude modulation is the INTRINSIC Rayleigh envelope of the
   * filtered noise, whose timescale is fixed by the bandwidth at ~1/B — 0.25 s for an 8-12 Hz
   * band. Measured before this existed: median run 0.23 s at 56/min, against a real 0.5-2 s.
   * A smooth envelope cannot fix that, because it is competing with the filter itself.
   */
  readonly burst?: {
    /** Mean run length in seconds. */
    readonly durMeanS: number;
    /** Runs per minute. */
    readonly ratePerMin: number;
    /** Envelope floor between runs, as a fraction of burst peak. Never 0 — see the registry. */
    readonly interburstLevel: number;
  };
}

export const DEFAULT_ENVELOPE_DEPTH = 0.6;
export const DEFAULT_ENVELOPE_RATE_HZ = 0.3;

/**
 * A waxing-and-waning narrowband oscillation of `nSamples`, in microvolts.
 *
 * Zero-phase (`filtfilt`) so the band is placed without phase distortion. That is a
 * legitimate choice HERE because this is generation, not analysis -- the filter demonstration
 * in 5.4 is precisely about what causal filtering does to real signals, and it applies its
 * filters downstream of this.
 */
export function synthesizeOscillation(
  rng: Rng,
  nSamples: number,
  p: OscillationParams,
  fs = scalarValue('fs'),
): Float64Array {
  const order = scalarValue('filter_order');

  const carrier = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) carrier[i] = rng.normal();
  filtfilt(carrier, bandpassSections(p.bandLo, p.bandHi, fs, order));

  // Suppress the carrier's INTRINSIC beat before imposing structure on it. Without this,
  // burst structure cannot be imposed at all — see `osc_carrier_flatten` in the registry.
  if (p.burst) flattenCarrier(carrier, p.bandHi - p.bandLo, fs);

  const env = synthesizeEnvelope(rng, nSamples, p, fs);
  for (let i = 0; i < nSamples; i++) carrier[i] = carrier[i]! * env[i]!;

  if (p.burst) {
    const b = synthesizeBurstEnvelope(rng, nSamples, p.burst, fs);
    for (let i = 0; i < nSamples; i++) carrier[i] = carrier[i]! * b[i]!;
  }

  return normalizeRms(carrier, p.rmsUv);
}

/**
 * Divide the carrier by its own smoothed envelope raised to `osc_carrier_flatten`.
 *
 * The smoothing window is 1/B, the intrinsic beat period — derived from the bandwidth rather
 * than tuned. A shorter window would track the oscillation itself and flatten the waveform;
 * a longer one would leave the beat in place.
 */
function flattenCarrier(x: Float64Array, bandwidthHz: number, fs: number): void {
  const alpha = scalarValue('osc_carrier_flatten');
  if (alpha <= 0) return;
  const win = Math.max(2, Math.round(fs / Math.max(bandwidthHz, 0.5)));

  // Envelope estimate: CENTRED running RMS over one beat period.
  //
  // Centred, not causal. A trailing window lags the signal by half its length, so dividing by
  // it corrects the envelope at the wrong moment: measured, a causal estimator cut the
  // carrier's envelope CV only from 0.353 to 0.239, where a centred one at the same exponent
  // reaches much further. The misalignment is half a beat period — invisible in the code and
  // decisive in the result.
  const half = win >> 1;
  const cumsum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cumsum[i + 1] = cumsum[i]! + x[i]! * x[i]!;
  const env = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(x.length, i + half + 1);
    env[i] = Math.sqrt((cumsum[hi]! - cumsum[lo]!) / (hi - lo));
  }

  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i]!;
  mean /= env.length;
  if (mean === 0) return;

  // Floor at a fraction of the mean so a near-zero envelope cannot blow the division up.
  const floor = 0.1 * mean;
  for (let i = 0; i < x.length; i++) {
    const e = Math.max(env[i]!, floor);
    x[i] = x[i]! / Math.pow(e / mean, alpha);
  }
}

/**
 * Burst envelope: runs of activity separated by a low floor.
 *
 * Onsets are a Poisson process; durations are lognormal about `durMeanS`. Each run is shaped
 * by a raised cosine rather than a rectangle. That matters more than it looks: a hard-edged
 * gate is a multiplication by a step, which convolves the alpha band with a sinc and smears
 * energy right across the spectrum — a spectral artefact manufactured by the realism fix.
 */
function synthesizeBurstEnvelope(
  rng: Rng,
  nSamples: number,
  b: NonNullable<OscillationParams['burst']>,
  fs: number,
): Float64Array {
  const env = new Float64Array(nSamples).fill(b.interburstLevel);
  const meanGapS = 60 / b.ratePerMin;
  // Lognormal sigma giving a spread roughly matching a 0.5-2 s range about the mean.
  const sigma = 0.4;

  let t = rng.exponential(1 / meanGapS);
  while (t < nSamples / fs) {
    const dur = b.durMeanS * Math.exp(rng.gaussian(0, sigma) - (sigma * sigma) / 2);
    const start = Math.floor(t * fs);
    const len = Math.max(2, Math.floor(dur * fs));
    for (let i = 0; i < len && start + i < nSamples; i++) {
      // Raised cosine over the whole run: 0 at the edges, 1 at the centre.
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / len));
      const idx = start + i;
      const contribution = b.interburstLevel + (1 - b.interburstLevel) * w;
      // Overlapping runs take the louder of the two rather than summing, so a coincidence
      // does not produce an amplitude no single burst could reach.
      if (contribution > env[idx]!) env[idx] = contribution;
    }
    t += dur + rng.exponential(1 / meanGapS);
  }
  return env;
}

/** Envelope in [1 - depth, 1 + depth], from low-passed noise. */
function synthesizeEnvelope(
  rng: Rng,
  nSamples: number,
  p: OscillationParams,
  fs: number,
): Float64Array {
  const env = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) env[i] = rng.normal();
  // Two cascaded first-order-ish sections give a gentle roll-off; a sharp envelope filter
  // would ring and put a periodicity back into the modulation.
  filtfilt(env, [lowpass(p.envelopeRateHz, fs, 0.707), lowpass(p.envelopeRateHz, fs, 0.707)]);

  let mean = 0;
  for (let i = 0; i < nSamples; i++) mean += env[i]!;
  mean /= nSamples;
  let sd = 0;
  for (let i = 0; i < nSamples; i++) sd += (env[i]! - mean) ** 2;
  sd = Math.sqrt(sd / nSamples) || 1;

  for (let i = 0; i < nSamples; i++) {
    // Standardize, then map to a strictly positive multiplier. tanh keeps the envelope
    // bounded so a rare excursion cannot produce a negative amplitude, which would invert
    // the waveform rather than quieten it.
    const z = (env[i]! - mean) / sd;
    env[i] = 1 + p.envelopeDepth * Math.tanh(z);
  }
  return env;
}
