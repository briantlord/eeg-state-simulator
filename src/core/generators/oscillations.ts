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
import { envelopeAndPhase, floorPow2 } from '../dsp/fft.ts';
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

export const DEFAULT_ENVELOPE_DEPTH = 0.6; // @lit-ok invented alpha burst-envelope depth default; TODO(T1-M1) register+fit
export const DEFAULT_ENVELOPE_RATE_HZ = 0.3; // @lit-ok invented alpha burst-envelope rate default (Hz); TODO(T1-M1) register+fit

export interface DampedOscillatorParams {
  /** Resonant frequency in Hz. */
  readonly f0: number;
  /** -3 dB bandwidth in Hz of the weakly damped (high-amplitude) mode. */
  readonly bandwidthSharpHz: number;
  /**
   * -3 dB bandwidth of the strongly damped (low-amplitude) mode. Omit for a single mode.
   *
   * Two modes rather than one because alpha amplitude is BISTABLE: it bursts between high-
   * and low-amplitude states rather than diffusing about a single mean (Freyer et al.,
   * J Neurosci 2009/2011, subcritical Hopf). A single linear mode has a Rayleigh envelope —
   * measured CV 0.521 against Rayleigh's exact 0.523 — which is the distribution that finding
   * contradicts.
   */
  readonly bandwidthBroadHz?: number;
  /** Mean dwell time in each mode, seconds. */
  readonly dwellS?: number;
  readonly rmsUv: number;
  /** Non-sinusoidal waveform shaping. Omit for a symmetric (linear-oscillator) waveform. */
  readonly shape?: WaveformShape;
}

/**
 * Alpha as a stochastically driven DAMPED OSCILLATOR, discretized as AR(2).
 *
 *     x'' + 2*gamma*x' + w0^2 * x = xi(t)      ->      x[n] = 2r*cos(w0)*x[n-1] - r^2*x[n-2] + xi[n]
 *
 * with pole radius r = exp(-pi*B/fs) for a -3 dB bandwidth B.
 *
 * WHY THIS RATHER THAN BANDPASS-FILTERED NOISE. Measured over 600 s, peak shape as the ratio
 * of the -10 dB width to the -3 dB width — about 3 for a Lorentzian, tending to 1 for a box:
 *
 *     4th-order Butterworth bandpass noise   1.26   <- a rectangle of power, not a peak
 *     AR(2) damped oscillator                3.20   <- Lorentzian, as theory requires
 *
 * A damped linear oscillator has a Lorentzian peak; a Butterworth bandpass has a flat
 * passband and steep skirts, which is not the shape of any resonance. Resting EEG is well
 * described as a sum of stochastically driven damped alpha-band processes with a distribution
 * of dampings (Liley/Zhao, PLOS Comput Biol 2022) — that account reproduces both the alpha
 * peak and the 1/f background from one mechanism.
 *
 * It is also fewer moving parts: one recursion and two coefficients replace a bandpass
 * cascade, an imposed burst envelope and a carrier-flattening step, and the burst structure
 * now EMERGES from the damping rather than being multiplied on afterwards.
 *
 * KNOWN GAP: AR(2) is linear, so its output is symmetric. Real alpha is non-sinusoidal, with
 * peak/trough asymmetry that manufactures spurious phase-amplitude coupling (Cole & Voytek,
 * TiCS 2017). This project measures PAC, so that omission is load-bearing.
 * TODO(T1-M2): characterize how much spurious PAC a symmetric alpha suppresses relative to a
 * realistic one, before any PAC recovery gate is trusted.
 */
export function synthesizeDampedOscillator(
  rng: Rng,
  nSamples: number,
  p: DampedOscillatorParams,
  fs = scalarValue('fs'),
): Float64Array {
  const w0 = (2 * Math.PI * p.f0) / fs;
  const cosW0 = Math.cos(w0);
  const rSharp = Math.exp((-Math.PI * p.bandwidthSharpHz) / fs);
  const rBroad =
    p.bandwidthBroadHz !== undefined
      ? Math.exp((-Math.PI * p.bandwidthBroadHz) / fs)
      : rSharp;
  const dwellSamples = (p.dwellS ?? 1) * fs;

  const x = new Float64Array(nSamples);
  let r = rSharp;
  let sharp = true;
  let switchAt = dwellSamples > 0 ? rng.exponential(1 / dwellSamples) : Infinity;

  for (let i = 2; i < nSamples; i++) {
    if (i >= switchAt && p.bandwidthBroadHz !== undefined) {
      sharp = !sharp;
      r = sharp ? rSharp : rBroad;
      switchAt = i + rng.exponential(1 / dwellSamples);
    }
    x[i] = 2 * r * cosW0 * x[i - 1]! - r * r * x[i - 2]! + rng.normal();
  }

  if (p.shape) applyWaveformShape(x, p.shape);

  return normalizeRms(x, p.rmsUv);
}

export interface WaveformShape {
  /**
   * Blend from sinusoid (0) toward triangle (1). Occipital alpha reads as TRIANGULAR in raw
   * traces — its extrema are sharper than a sinusoid's rounded ones.
   */
  readonly triangularity: number;
  /**
   * Rise-decay symmetry in `bycycle`'s own convention: the fraction of the trough-to-trough
   * cycle spent rising. 0.5 is symmetric, below 0.5 is a steeper rise, above is a steeper
   * decay.
   *
   * Stated as the target quantity rather than as a deviation with a sign. An earlier version
   * took a signed "asymmetry" and both the registry note and the implementation got the
   * direction wrong, in opposite ways. A parameter that IS the measured quantity cannot be
   * misread.
   */
  readonly riseDecaySymmetry: number;
}

/**
 * Re-render a rhythm from its own instantaneous phase and envelope with a non-sinusoidal
 * waveform, in place.
 *
 * WHY THIS IS NOT COSMETIC. A linear oscillator is exactly symmetric — measured peak/trough
 * ratio 1.000 — and real alpha is not. Non-sinusoidal morphology **manufactures spurious
 * phase-amplitude coupling** (Cole & Voytek 2017; Gerber et al. 2016): Fourier methods
 * decompose an asymmetric waveform into harmonics, and a coupling estimator reads the
 * harmonic relationship as cross-frequency coupling that no mechanism produced. This project
 * measures PAC — SO-spindle at Tier 0, respiration-chi throughout — so a symmetric alpha
 * would understate a confound the artifact exists partly to demonstrate.
 *
 * Shaping is applied to the PHASE, not to the amplitude: the envelope (and therefore the
 * bistable burst structure from the damping) is preserved exactly, and only the shape within
 * each cycle changes.
 */
export function applyWaveformShape(x: Float64Array, s: WaveformShape): void {
  // The analytic signal needs a power-of-two length; shape the largest such prefix and leave
  // the remainder, rather than zero-padding (which would ring at the join).
  const n = floorPow2(x.length);
  const { envelope, phase } = envelopeAndPhase(x.subarray(0, n));

  // Clamp away from the degenerate ends, where the warp would divide by zero.
  const r = Math.max(0.05, Math.min(0.95, s.riseDecaySymmetry)); // @lit-ok clamp keeping the rise-decay symmetry off its degenerate endpoints

  for (let i = 0; i < n; i++) {
    // Cycle position, 0 at the trough, rising through the peak, back to 1 at the next trough.
    const u = (phase[i]! + Math.PI) / (2 * Math.PI);

    // Piecewise-linear time warp placing the PEAK at u = r instead of u = 0.5. This is what
    // makes the rise and decay take different fractions of the cycle.
    //
    // A phase warp of the form phi + a*sin(phi) does NOT do this: it is antisymmetric about
    // both extrema, so it compresses rise and decay by equal amounts and leaves rdsym at
    // exactly 0.5. Measured, that is precisely what it did.
    const w = u <= r ? u / (2 * r) : 0.5 + (u - r) / (2 * (1 - r));

    const c = Math.cos(2 * Math.PI * (w - 0.5));
    // Triangle wave via arcsine: sharper extrema than a cosine at the same amplitude.
    const tri = (2 / Math.PI) * Math.asin(Math.max(-1, Math.min(1, c)));
    x[i] = envelope[i]! * ((1 - s.triangularity) * c + s.triangularity * tri);
  }
}

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
  const floor = 0.1 * mean; // @lit-ok numerical floor at 10% of mean, guarding the envelope division
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
  const meanGapS = 60 / b.ratePerMin; // @lit-ok seconds per minute
  // Lognormal sigma giving a spread roughly matching a 0.5-2 s range about the mean.
  const sigma = 0.4; // @lit-ok invented lognormal sigma for burst-duration spread; TODO(T1-M1) register+fit

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
  filtfilt(env, [lowpass(p.envelopeRateHz, fs, 0.707), lowpass(p.envelopeRateHz, fs, 0.707)]); // @lit-ok Butterworth Q = 1/sqrt(2)

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

/**
 * Unit-mean, bounded stochastic amplitude envelope for broadband source activity.
 *
 * This is intentionally the same low-passed-noise mechanism used for narrowband rhythms, but
 * exposed without an OscillationParams wrapper.  Multiplying every distributed background mode
 * by one envelope models slow changes in overall cortical activation while leaving their lead-
 * field topographies and relative weights untouched.
 */
export function synthesizeStochasticEnvelope(
  rng: Rng,
  nSamples: number,
  depth: number,
  rateHz: number,
  fs = scalarValue('fs'),
): Float64Array {
  const env = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) env[i] = rng.normal();
  filtfilt(env, [lowpass(rateHz, fs, 0.707), lowpass(rateHz, fs, 0.707)]); // @lit-ok Butterworth Q = 1/sqrt(2)

  let mean = 0;
  for (let i = 0; i < nSamples; i++) mean += env[i]!;
  mean /= nSamples;
  let variance = 0;
  for (let i = 0; i < nSamples; i++) variance += (env[i]! - mean) ** 2;
  const sd = Math.sqrt(variance / nSamples) || 1;

  // Normalize mean-square to one, so adding temporal texture does not silently change the
  // meaning of background_rms_uv or invalidate the amplitude calibration.
  let sumSq = 0;
  for (let i = 0; i < nSamples; i++) {
    env[i] = 1 + depth * Math.tanh((env[i]! - mean) / sd);
    sumSq += env[i]! * env[i]!;
  }
  const rms = Math.sqrt(sumSq / nSamples) || 1;
  for (let i = 0; i < nSamples; i++) env[i] = env[i]! / rms;
  return env;
}
