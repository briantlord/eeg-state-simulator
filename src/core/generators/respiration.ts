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
 *   `phase` — instantaneous phase in [-π, π), with peak inspiration at zero, inspiration
 *             negative and expiration positive; the reference every coupling measure uses.
 * Deriving phase from the belt by Hilbert would inject estimator error into the ground truth,
 * which is exactly what G4 exists to isolate. It is computed analytically instead.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import type { StateId } from '../types/state.ts';
import { scalarValue, uncertainty, provisionalValue } from '../registry.ts';

type RngSnapshot = {
  readonly words: readonly [number, number, number, number];
  readonly spare: number | null;
};

/** One realized breath. Durations are integer samples so a saved state resumes exactly. */
export interface RespiratoryBreath {
  readonly durationSamples: number;
  readonly inhaleSamples: number;
  readonly inhalePauseSamples: number;
  readonly exhaleSamples: number;
  readonly exhalePauseSamples: number;
  /** Trough magnitude inherited from the preceding breath. */
  readonly startDepth: number;
  /** Peak and ending-trough magnitude for this breath. */
  readonly depth: number;
}

/** Feature truth for breaths whose onset occurs inside a returned chunk. */
export interface RespiratoryBreathEvent extends RespiratoryBreath {
  readonly onsetS: number;
}

/**
 * Complete serializable state of the respiratory controller.
 *
 * No typed arrays or NaNs are stored here: `JSON.stringify` followed by `JSON.parse` is an
 * exact checkpoint operation. That is what lets the browser pre-generate chunks without making
 * a display-buffer boundary a physiological boundary.
 */
export interface RespiratoryState {
  readonly version: 1;
  readonly state: StateId;
  readonly fs: number;
  readonly fixedRatePerMin: number | null;
  readonly subjectRateMultiplier: number;
  readonly meanRatePerMin: number;
  readonly periodCv: number;
  readonly depthCv: number;
  readonly fastTiming: number;
  readonly slowTiming: number;
  readonly previousDepth: number;
  readonly sampleInBreath: number;
  readonly absoluteSample: number;
  readonly currentBreath: RespiratoryBreath;
  readonly rng: RngSnapshot;
}

export interface RespirationResult {
  /** Belt displacement, arbitrary units, zero-mean. */
  readonly belt: Float64Array;
  /**
   * Instantaneous phase in [-π, π): peak inspiration is 0, inspiration is -π..0 and
   * expiration is 0..π. This is the convention used by the coupling source studies.
   */
  readonly phase: Float64Array;
  /** Sample-aligned realized breath depth. Cardiac RSA consumes this without re-estimation. */
  readonly depth: Float64Array;
  /** Breath onset times in seconds. */
  readonly onsets: readonly number[];
  /** Mean rate actually realized, breaths per minute. */
  readonly meanRatePerMin: number;
  /** Realized morphology for breaths beginning in this result. */
  readonly breaths: readonly RespiratoryBreathEvent[];
}

function rateKeyFor(state: StateId): Parameters<typeof scalarValue>[0] {
  switch (state) {
    case 'wake_eo':
    case 'wake_ec':
      return 'resp_rate_wake';
    case 'n1':
      return 'resp_rate_n1';
    case 'n2':
      return 'resp_rate_n2';
    case 'n3':
      return 'resp_rate_n3';
    case 'rem':
      return 'resp_rate_rem';
  }
}

/** Registered population mean used by the UI's deliberately regular comparison mode. */
export function respiratoryRateForState(state: StateId): number {
  return scalarValue(rateKeyFor(state));
}

function periodCvKeyFor(state: StateId): Parameters<typeof provisionalValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'resp_period_cv_wake';
  return `resp_period_cv_${state}` as Parameters<typeof provisionalValue>[0];
}

function depthCvKeyFor(state: StateId): Parameters<typeof provisionalValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'resp_depth_cv_wake';
  return `resp_depth_cv_${state}` as Parameters<typeof provisionalValue>[0];
}

function slowFractionKeyFor(state: StateId): Parameters<typeof provisionalValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'resp_slow_fraction_wake';
  if (state === 'rem') return 'resp_slow_fraction_rem';
  if (state === 'n1') return 'resp_slow_fraction_n1';
  return 'resp_slow_fraction_nrem';
}

function saveRng(rng: Rng): RngSnapshot {
  const state = rng.saveState();
  return {
    words: [state[0]!, state[1]!, state[2]!, state[3]!], // @lit-ok four xoshiro state-word indices
    spare: Number.isNaN(state[4]!) ? null : state[4]!, // @lit-ok fifth RNG snapshot word carries Box-Muller spare
  };
}

function restoreRng(snapshot: RngSnapshot): Rng {
  const rng = Rng.fromSeed(1, 'restored-respiration');
  rng.restoreState(new Float64Array([
    ...snapshot.words,
    snapshot.spare === null ? Number.NaN : snapshot.spare,
  ]));
  return rng;
}

function lognormalMeanOne(rng: Rng, cv: number, driver?: number): number {
  if (cv === 0) return 1;
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  const z = driver ?? rng.normal();
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

interface WorkingState {
  version: 1;
  state: StateId;
  fs: number;
  fixedRatePerMin: number | null;
  subjectRateMultiplier: number;
  meanRatePerMin: number;
  periodCv: number;
  depthCv: number;
  fastTiming: number;
  slowTiming: number;
  previousDepth: number;
  sampleInBreath: number;
  absoluteSample: number;
  currentBreath: RespiratoryBreath;
  rng: RngSnapshot;
}

function nextBreath(work: WorkingState, rng: Rng): RespiratoryBreath {
  const fixed = work.fixedRatePerMin !== null;
  const meanPeriodS = 60 / work.meanRatePerMin; // @lit-ok seconds per minute
  const fastRho = Math.exp(-1 / provisionalValue('resp_fast_tau_breaths'));
  const slowRho = Math.exp(-meanPeriodS / provisionalValue('resp_slow_tau_s'));
  work.fastTiming = fastRho * work.fastTiming + Math.sqrt(1 - fastRho * fastRho) * rng.normal();
  work.slowTiming = slowRho * work.slowTiming + Math.sqrt(1 - slowRho * slowRho) * rng.normal();

  const fastFraction = fixed ? 0 : provisionalValue('resp_fast_variance_fraction');
  const slowFraction = fixed ? 0 : provisionalValue(slowFractionKeyFor(work.state));
  const residualFraction = Math.max(0, 1 - fastFraction - slowFraction);
  const timingDriver =
    Math.sqrt(fastFraction) * work.fastTiming +
    Math.sqrt(slowFraction) * work.slowTiming +
    Math.sqrt(residualFraction) * rng.normal();
  const periodS = meanPeriodS * lognormalMeanOne(rng, work.periodCv, timingDriver);
  const durationSamples = Math.max(2, Math.round(periodS * work.fs));

  const depthCorrelation = provisionalValue('resp_depth_timing_correlation');
  const depthDriver =
    depthCorrelation * work.fastTiming +
    Math.sqrt(1 - depthCorrelation * depthCorrelation) * rng.normal();
  const depth = lognormalMeanOne(rng, work.depthCv, depthDriver);

  const { lo, hi } = uncertainty('resp_ie_ratio');
  const meanIeRatio = (lo + hi) / 2;
  const ieRatio = fixed
    ? meanIeRatio
    : meanIeRatio * lognormalMeanOne(rng, provisionalValue('resp_ie_ratio_cv'));
  const pauseSamples = Math.round(scalarValue('resp_pause_duration_s') * work.fs);
  const inhalePause = fixed || rng.nextFloat() < scalarValue('resp_inhale_pause_probability');
  const exhalePause = fixed || rng.nextFloat() < scalarValue('resp_exhale_pause_probability');
  const inhalePauseSamples = inhalePause ? pauseSamples : 0;
  const exhalePauseSamples = exhalePause ? pauseSamples : 0;
  const activeSamples = Math.max(2, durationSamples - inhalePauseSamples - exhalePauseSamples);
  const inhaleSamples = Math.max(1, Math.round(activeSamples / (1 + ieRatio)));
  const exhaleSamples = Math.max(1, activeSamples - inhaleSamples);

  // Rounding pause durations can make the parts differ by one or two samples from the period.
  // Assign that bookkeeping residue to the end-expiratory pause, where it cannot create a corner.
  const used = inhaleSamples + inhalePauseSamples + exhaleSamples + exhalePauseSamples;
  const adjustedExhalePause = Math.max(0, exhalePauseSamples + durationSamples - used);
  return {
    durationSamples,
    inhaleSamples,
    inhalePauseSamples,
    exhaleSamples,
    exhalePauseSamples: adjustedExhalePause,
    startDepth: work.previousDepth,
    depth,
  };
}

/** Create one seeded phenotype and the first breath of a resumable respiratory run. */
export function createRespiratoryState(
  seed: number,
  state: StateId,
  fs = scalarValue('fs'),
  fixedRatePerMin?: number,
): RespiratoryState {
  const fixed = fixedRatePerMin !== undefined;
  const subjectRng = Rng.substream(seed, 'physiology/subject');
  const subjectRateMultiplier = fixed
    ? 1
    : lognormalMeanOne(subjectRng, provisionalValue('resp_subject_rate_cv'));
  const meanRatePerMin = (fixedRatePerMin ?? scalarValue(rateKeyFor(state))) * subjectRateMultiplier;
  const rng = Rng.substream(seed, `respiration/${state}`);
  const initialDepth = 1;
  const work: WorkingState = {
    version: 1,
    state,
    fs,
    fixedRatePerMin: fixedRatePerMin ?? null,
    subjectRateMultiplier,
    meanRatePerMin,
    periodCv: fixed ? 0 : provisionalValue(periodCvKeyFor(state)),
    depthCv: fixed ? 0 : provisionalValue(depthCvKeyFor(state)),
    fastTiming: fixed ? 0 : rng.normal(),
    slowTiming: fixed ? 0 : rng.normal(),
    previousDepth: initialDepth,
    sampleInBreath: 0,
    absoluteSample: 0,
    currentBreath: {
      durationSamples: 0,
      inhaleSamples: 0,
      inhalePauseSamples: 0,
      exhaleSamples: 0,
      exhalePauseSamples: 0,
      startDepth: initialDepth,
      depth: initialDepth,
    },
    rng: saveRng(rng),
  };
  work.currentBreath = nextBreath(work, rng);
  work.rng = saveRng(rng);
  return work;
}

function smoothBetween(a: number, b: number, position: number, duration: number): number {
  if (duration <= 1) return b;
  const u = position / duration;
  return a + (b - a) * (1 - Math.cos(Math.PI * u)) / 2;
}

function beltSample(breath: RespiratoryBreath, sample: number): number {
  if (sample < breath.inhaleSamples) {
    return smoothBetween(-breath.startDepth, breath.depth, sample, breath.inhaleSamples);
  }
  const afterInhale = sample - breath.inhaleSamples;
  if (afterInhale < breath.inhalePauseSamples) return breath.depth;
  const afterInhalePause = afterInhale - breath.inhalePauseSamples;
  if (afterInhalePause < breath.exhaleSamples) {
    return smoothBetween(breath.depth, -breath.depth, afterInhalePause, breath.exhaleSamples);
  }
  return -breath.depth;
}

/**
 * Two-way interpolated respiratory phase used in the source literature.
 *
 * Peak inspiration is the centre of a possible post-inspiratory pause. Unlike a uniform phase
 * ramp over the whole breath, this keeps -π..0 tied to actual inspiration and 0..π to actual
 * expiration even when I:E ratio and pause morphology vary from breath to breath.
 */
function couplingPhaseSample(breath: RespiratoryBreath, sample: number): number {
  const peak = breath.inhaleSamples + Math.floor(breath.inhalePauseSamples / 2);
  if (sample < peak) return -Math.PI + (Math.PI * sample) / Math.max(1, peak);
  return (Math.PI * (sample - peak)) / Math.max(1, breath.durationSamples - peak);
}

/** Advance a saved controller state by exactly `nSamples`. */
export function synthesizeRespirationChunk(
  state: RespiratoryState,
  nSamples: number,
): { readonly result: RespirationResult; readonly state: RespiratoryState } {
  const work: WorkingState = {
    ...state,
    currentBreath: { ...state.currentBreath },
    rng: { words: [...state.rng.words] as [number, number, number, number], spare: state.rng.spare },
  };
  const rng = restoreRng(work.rng);
  const belt = new Float64Array(nSamples);
  const phase = new Float64Array(nSamples);
  const depth = new Float64Array(nSamples);
  const breaths: RespiratoryBreathEvent[] = [];

  for (let i = 0; i < nSamples; i++) {
    if (work.sampleInBreath >= work.currentBreath.durationSamples) {
      work.previousDepth = work.currentBreath.depth;
      work.currentBreath = nextBreath(work, rng);
      work.sampleInBreath = 0;
    }
    if (work.sampleInBreath === 0) {
      breaths.push({ ...work.currentBreath, onsetS: i / work.fs });
    }
    belt[i] = beltSample(work.currentBreath, work.sampleInBreath);
    phase[i] = couplingPhaseSample(work.currentBreath, work.sampleInBreath);
    depth[i] = work.currentBreath.depth;
    work.sampleInBreath++;
    work.absoluteSample++;
  }
  work.rng = saveRng(rng);
  const onsets = breaths.map((breath) => breath.onsetS);
  const realizedRate = onsets.length > 1
    ? (60 * (onsets.length - 1)) / (onsets[onsets.length - 1]! - onsets[0]!) // @lit-ok seconds per minute
    : work.meanRatePerMin;
  return {
    result: { belt, phase, depth, onsets, meanRatePerMin: realizedRate, breaths },
    state: work,
  };
}

/** Stateless whole-record wrapper used by exports and characterization fixtures. */
export function synthesizeRespiration(
  seed: number,
  nSamples: number,
  state: StateId,
  fs = scalarValue('fs'),
  fixedRatePerMin?: number,
): RespirationResult {
  return synthesizeRespirationChunk(
    createRespiratoryState(seed, state, fs, fixedRatePerMin),
    nSamples,
  ).result;
}

/**
 * χ(t) = χ_state + A_χ · depth_breath(t) · cos(φ_resp(t) − φ₀(state))
 *
 * Sánchez Corzo et al. report the actual group mean direction for each sleep stage under this
 * file's peak-inspiration-centred phase convention. N1 remains wake-like; N2, N3 and REM reverse.
 * Breath depth changes the modulation magnitude because deep breathing strengthened the effect
 * in Kluger et al. 2023. It does not change the mean exponent because the cosine is zero-mean.
 */
export function chiModulation(
  phase: Float64Array,
  chiState: number,
  state: StateId,
  depthOverride?: number,
  independentPhase?: Float64Array,
  breathDepth?: Float64Array,
): Float64Array {
  const depth = depthOverride ?? provisionalValue('chi_mod_depth');
  const phi0 = scalarValue(
    state === 'wake_eo' || state === 'wake_ec' ? 'chi_mod_phi0_wake' : `chi_mod_phi0_${state}`,
  );

  // The G4 fixture drives chi from an INDEPENDENT modulator at f1 while respiration runs at
  // f2. Build Plan §5.2 defines chi(t) as driven by respiration, so this capability exists
  // nowhere in the shipped UI — it exists so the gate can separate the two.
  const driver = independentPhase ?? phase;

  const out = new Float64Array(driver.length);
  for (let i = 0; i < driver.length; i++) {
    // The independent G4 fixture is a pure sinusoid at f1. Respiratory depth belongs only to the
    // physiological arm; letting it leak into the fixture would add breath-rate sidebands to the
    // known positive control and make the gate test two effects at once.
    const realizedDepth = independentPhase === undefined ? (breathDepth?.[i] ?? 1) : 1;
    out[i] = chiState + depth * realizedDepth * Math.cos(driver[i]! - phi0);
  }
  return out;
}

/**
 * Mechanism (a) — the respiratory movement artifact.
 *
 * "Mechanical, at the respiratory rate. GENUINE ARTIFACT; high-passing it out is correct."
 *
 * It is the belt waveform itself appearing in the EEG, because that is what mechanical
 * coupling produces: the electrode moves with the chest. It therefore sits AT the respiratory
 * rate — below every clinical high-pass cutoff — and a 0.5–1 Hz filter removes it essentially
 * completely. That is the filter doing its job, and it is the half of the lesson that says
 * filtering is not a mistake.
 *
 * Kept as its own generator with its own topography because §5.1 is emphatic that the three
 * mechanisms must stay separate: "different origins, different topographies, different
 * implications. Conflating them is the standard error in this literature."
 */
export function respiratoryArtifact(belt: Float64Array, amplitudeUv: number): Float64Array {
  const out = new Float64Array(belt.length);
  for (let i = 0; i < belt.length; i++) out[i] = belt[i]! * amplitudeUv;
  return out;
}

/**
 * Mechanism (c), amplitude half — respiratory-phase modulation of band amplitude.
 *
 * Distinct from the exponent half, and distinct in a way that decides whether the filter
 * demonstration works at all. This modulates the envelope of whatever it is applied to; when
 * applied to LOW-FREQUENCY content, a 0.5–1 Hz high-pass removes most of that band and the
 * measurable coupling collapses with cutoff. The exponent half survives any clinical filter,
 * because χ is estimated from 2–40 Hz — entirely above the stopband.
 *
 * Returns a strictly positive, power-preserving multiplier. For a fixed breath depth,
 * E[g²] = 1 exactly over respiratory phase because E[exp(2m cos φ)] = I0(2m). This prevents a
 * respiratory coupling knob from becoming a hidden band-power knob.
 */
export function amplitudeModulation(
  phase: Float64Array,
  breathDepth: Float64Array,
  logAmplitudeDepth: number,
  phi0: number,
): Float64Array {
  const out = new Float64Array(phase.length);
  for (let i = 0; i < phase.length; i++) {
    const m = logAmplitudeDepth * breathDepth[i]!;
    out[i] = Math.exp(m * Math.cos(phase[i]! - phi0)) / Math.sqrt(besselI0(2 * m));
  }
  return out;
}

/** Modified Bessel I0 from its everywhere-convergent power series. */
function besselI0(x: number): number {
  const q = (x * x) / (2 * 2);
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 100; k++) {
    term *= q / (k * k);
    sum += term;
    if (Math.abs(term) <= Number.EPSILON * Math.abs(sum)) break;
  }
  return sum;
}

/** A clean phase ramp at a fixed frequency, for the G4 independent modulator. */
export function phaseRamp(nSamples: number, freqHz: number, fs: number): Float64Array {
  const out = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    out[i] = (2 * Math.PI * freqHz * i) / fs;
  }
  return out;
}
