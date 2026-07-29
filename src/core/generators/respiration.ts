/**
 * Respiration (Build Plan §5.2).
 *
 * "NOT a sinusoid — inspiration shorter and steeper than expiration. Transcribe NeuroKit2's
 * `rsp_simulate` breathmetrics model, which interpolates inhalation and exhalation pauses; do
 * not reinvent it."
 *
 * NeuroKit2 is not installed here, so this implements the model from its published
 * description rather than transcribing source: each breath is inhale → inhale pause → exhale
 * → exhale pause, with the inhale shorter than the exhale by `resp_ie_ratio`, and each
 * segment shaped by a half-cosine so the belt trace has no corners.
 *
 * TODO(T1): validate against `neurokit2.rsp_simulate` directly once it is a dependency. The
 * risk register lists "rebuilding solved generators" at medium-high, and the mitigation is
 * "transcribe, cite, validate against the originals" — the third step is not done.
 *
 * Two outputs, and they are not interchangeable:
 *   `belt`  — the respiratory signal itself, an exported channel.
 *   `phase` — instantaneous phase in [0, 2π), the reference every coupling measure uses.
 * Deriving phase from the belt by Hilbert would inject estimator error into the ground truth,
 * which is exactly what G4 exists to isolate. It is computed analytically instead.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import type { StateId } from '../types/state.ts';
import { scalarValue, uncertainty, provisionalValue } from '../registry.ts';

export interface RespirationResult {
  /** Belt displacement, arbitrary units, zero-mean. */
  readonly belt: Float64Array;
  /** Instantaneous phase in [0, 2π). 0 is the start of inhalation. */
  readonly phase: Float64Array;
  /** Breath onset times in seconds. */
  readonly onsets: readonly number[];
  /** Mean rate actually realized, breaths per minute. */
  readonly meanRatePerMin: number;
}

function rateKeyFor(state: StateId): Parameters<typeof uncertainty>[0] {
  switch (state) {
    case 'wake_eo':
    case 'wake_ec':
    case 'n1':
      return 'resp_rate_wake';
    case 'n2':
      return 'resp_rate_n2';
    case 'n3':
      return 'resp_rate_n3';
    case 'rem':
      return 'resp_rate_rem';
  }
}

/**
 * Generate respiration for a state.
 *
 * State-dependent rate AND regularity. "REM's marked irregularity is diagnostic and nearly
 * free" — it falls out of `resp_period_cv`, which is currently one row for every state even
 * though §5.2 and `resp_rate_n3` both say N3 is the most regular.
 * TODO(T1-M1): make resp_period_cv state-conditional. G4's per-seed false-exceedance rate is
 * a strong function of it — measured 0.32 at cv = 0.02 against 0.05 at cv = 0.25 — so a
 * single value across states is not merely imprecise, it changes whether a gate can pass.
 */
export function synthesizeRespiration(
  rng: Rng,
  nSamples: number,
  state: StateId,
  fs = scalarValue('fs'),
  /** Override the rate, in breaths per minute. Used by the G4 fixture to pin f2. */
  fixedRatePerMin?: number,
): RespirationResult {
  const { lo, hi } = uncertainty(rateKeyFor(state));
  const meanRate = fixedRatePerMin ?? (lo + hi) / 2;
  const cv = fixedRatePerMin !== undefined ? 0 : provisionalValue('resp_period_cv');
  const ieRatio = (uncertainty('resp_ie_ratio').lo + uncertainty('resp_ie_ratio').hi) / 2;
  const pauseFrac = scalarValue('resp_pause_fraction');

  const belt = new Float64Array(nSamples);
  const phase = new Float64Array(nSamples);
  const onsets: number[] = [];

  let t = 0;
  const durationS = nSamples / fs;
  while (t < durationS) {
    const period =
      (60 / meanRate) * (cv > 0 ? Math.exp(rng.gaussian(0, cv) - (cv * cv) / 2) : 1);
    onsets.push(t);

    // inhale : inhale-pause : exhale : exhale-pause
    const active = period * (1 - pauseFrac);
    const inhale = active / (1 + ieRatio);
    const exhale = active - inhale;
    const pause = (period * pauseFrac) / 2;

    const start = Math.round(t * fs);
    const nEv = Math.round(period * fs);
    for (let i = 0; i < nEv; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= nSamples) continue;
      const tau = i / fs;

      let value: number;
      if (tau < inhale) {
        // Rising, steeper because it is the shorter segment.
        value = -Math.cos((Math.PI * tau) / inhale);
      } else if (tau < inhale + pause) {
        value = 1;
      } else if (tau < inhale + pause + exhale) {
        value = Math.cos((Math.PI * (tau - inhale - pause)) / exhale);
      } else {
        value = -1;
      }
      belt[idx] = value;
      // Phase advances linearly across the whole breath, so 0 is always inhalation onset.
      phase[idx] = (2 * Math.PI * i) / nEv;
    }
    t += period;
  }

  return {
    belt,
    phase,
    onsets,
    meanRatePerMin: onsets.length > 1 ? (60 * (onsets.length - 1)) / (onsets[onsets.length - 1]! - onsets[0]!) : meanRate,
  };
}

/**
 * χ(t) = χ_state + A_χ · cos(φ_resp(t) − φ₀(state))
 *
 * "φ₀ is state-dependent and REVERSES SIGN between wake and sleep." A full-night study found
 * wake characterised by a decreased 1/f slope during late inspiration and increased during
 * late expiration, with the pattern reversing for all stages from N2 onward and N1 resembling
 * wake. "A single global offset is wrong, and getting it right gives the artifact a striking
 * behaviour: drag from wake to N2 and the coupling flips polarity."
 */
export function chiModulation(
  phase: Float64Array,
  chiState: number,
  state: StateId,
  depthOverride?: number,
  independentPhase?: Float64Array,
): Float64Array {
  const depth = depthOverride ?? provisionalValue('chi_mod_depth');
  const isWakeLike = state === 'wake_eo' || state === 'wake_ec' || state === 'n1';
  const phi0 = provisionalValue(isWakeLike ? 'chi_mod_phi0_wake' : 'chi_mod_phi0_sleep');

  // The G4 fixture drives chi from an INDEPENDENT modulator at f1 while respiration runs at
  // f2. Build Plan §5.2 defines chi(t) as driven by respiration, so this capability exists
  // nowhere in the shipped UI — it exists so the gate can separate the two.
  const driver = independentPhase ?? phase;

  const out = new Float64Array(driver.length);
  for (let i = 0; i < driver.length; i++) {
    out[i] = chiState + depth * Math.cos(driver[i]! - phi0);
  }
  return out;
}

/** A clean phase ramp at a fixed frequency, for the G4 independent modulator. */
export function phaseRamp(nSamples: number, freqHz: number, fs: number): Float64Array {
  const out = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    out[i] = (2 * Math.PI * freqHz * i) / fs;
  }
  return out;
}
