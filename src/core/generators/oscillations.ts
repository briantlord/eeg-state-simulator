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

  const env = synthesizeEnvelope(rng, nSamples, p, fs);
  for (let i = 0; i < nSamples; i++) carrier[i] = carrier[i]! * env[i]!;

  return normalizeRms(carrier, p.rmsUv);
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
