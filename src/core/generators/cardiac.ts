/**
 * ECG, and the respiratory sinus arrhythmia that ties it to the respiration belt.
 *
 * R2 supplies physiological TIMING: state-dependent mean RR and SDNN, respiratory sinus
 * arrhythmia in RR seconds, independent fast/slow HRV, and resumable live state. Cardiac field
 * artifact, ballistocardiogram and heartbeat-evoked potentials remain T1-M5 work.
 *
 * TRANSCRIBED, NOT INVENTED. The risk register names "rebuilding solved generators" explicitly
 * and prescribes "transcribe, cite, validate against the originals". The form is McSharry,
 * Clifford, Tarassenko & Smith (2003) — five Gaussians (P, Q, R, S, T) placed at fixed angles on
 * the cardiac cycle. Their paper integrates three coupled ODEs to move a point around a limit
 * cycle; evaluating the same Gaussian sum directly on beat phase is the standard reduction and
 * gives the same waveform without the integrator.
 *
 * THE MORPHOLOGY'S THIRD STEP IS NOT DONE. Timing is fitted against HMC ECG and characterized by
 * R2, but PQRST amplitudes and widths have not been validated against `neurokit2.ecg_simulate` or
 * a real beat average; `ecg_wave_shape` says so. TODO(T1-M5).
 *
 * WHY RSA IS IN THE FIRST VERSION rather than deferred with everything else: it is the reason the
 * two new traces belong on one screen. The heart speeds on inspiration and slows on expiration, so
 * the ECG is not independent of the belt above it, and a viewer watching both should be able to
 * see that. It is driven from the SAME respiratory phase the EEG's respiratory mechanisms use, so
 * the three cannot drift apart.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import { provisionalValue, scalarValue, procedureText } from '../registry.ts';
import type { StateId } from '../types/state.ts';
import type { RespirationResult } from './respiration.ts';

type RngSnapshot = {
  readonly words: readonly [number, number, number, number];
  readonly spare: number | null;
};

interface ScheduledBeat {
  readonly sample: number;
  readonly rrBeforeS: number;
  readonly rrAfterS: number;
}

/** Complete JSON-serializable state of cardiac timing and waveform overlap. */
export interface CardiacState {
  readonly version: 1;
  readonly state: StateId;
  readonly fs: number;
  readonly subjectHrMultiplier: number;
  readonly meanHrBpm: number;
  readonly meanRrS: number;
  readonly targetSdnnS: number;
  readonly rsaAmplitudeS: number;
  readonly fastHrv: number;
  readonly slowHrv: number;
  readonly absoluteSample: number;
  readonly nextBeatSample: number;
  readonly intervalBeforeNextS: number;
  readonly lastBeat: ScheduledBeat | null;
  readonly rng: RngSnapshot;
}

export interface CardiacResult {
  /** Surface ECG in microvolts, on a lead-II-like derivation. */
  readonly ecg: Float64Array;
  /** R-peak times in seconds. The event list a HEP analysis would need at T1-M5. */
  readonly rPeaks: readonly number[];
  /** Achieved mean rate, for the sidecar. */
  readonly meanHrBpm: number;
  /** State target for total RR standard deviation. */
  readonly targetSdnnS: number;
  /** RR-domain RSA amplitude before realized breath-depth scaling. */
  readonly rsaAmplitudeS: number;
  /** RR intervals scheduled from beats inside this result. */
  readonly rrIntervalsS: readonly number[];
}

/** One Gaussian of the PQRST complex: phase from R in cycles, relative amplitude, width. */
interface Wave {
  readonly phase: number;
  readonly amp: number;
  readonly width: number;
}

/**
 * The five waves, parsed from `ecg_wave_shape`.
 *
 * READ FROM THE REGISTRY RATHER THAN WRITTEN HERE, because fifteen numbers in source would be
 * fifteen unregistered constants — exactly what the literal linter and seam 6 exist to prevent.
 * They are one row because they are one model: fitting them independently would be meaningless.
 */
function waves(): Wave[] {
  const text = procedureText('ecg_wave_shape');
  // "P (-0.20, +0.12, 0.030), Q (-0.025, -0.16, 0.0060), ..."
  const out: Wave[] = [];
  for (const m of text.matchAll(/\(([-+0-9.]+),\s*([-+0-9.]+),\s*([-+0-9.]+)\)/g)) { // @lit-ok regex character classes; the masker does not parse regex (D15)
    out.push({ phase: Number(m[1]), amp: Number(m[2]), width: Number(m[3]) }); // @lit-ok capture-group indices
  }
  if (out.length !== 5) { // @lit-ok the PQRST complex has five waves, by definition of the model
    throw new Error(
      `ecg_wave_shape must describe five waves, parsed ${out.length}. The row is the source of ` +
        'truth for the morphology and this parser must not silently accept a partial read.',
    );
  }
  return out;
}

function hrKeyFor(state: StateId): Parameters<typeof scalarValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'hr_mean_wake';
  return `hr_mean_${state}` as Parameters<typeof scalarValue>[0];
}

function sdnnKeyFor(state: StateId): Parameters<typeof scalarValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'rr_sdnn_wake';
  return `rr_sdnn_${state}` as Parameters<typeof scalarValue>[0];
}

function rsaRelativeKeyFor(state: StateId): Parameters<typeof scalarValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'rsa_relative_wake';
  if (state === 'n1' || state === 'n2') return 'rsa_relative_n1_n2';
  return `rsa_relative_${state}` as Parameters<typeof scalarValue>[0];
}

function saveRng(rng: Rng): RngSnapshot {
  const state = rng.saveState();
  return {
    words: [state[0]!, state[1]!, state[2]!, state[3]!], // @lit-ok four xoshiro state-word indices
    spare: Number.isNaN(state[4]!) ? null : state[4]!, // @lit-ok fifth word carries Box-Muller spare
  };
}

function restoreRng(snapshot: RngSnapshot): Rng {
  const rng = Rng.fromSeed(1, 'restored-cardiac');
  rng.restoreState(new Float64Array([
    ...snapshot.words,
    snapshot.spare === null ? Number.NaN : snapshot.spare,
  ]));
  return rng;
}

function lognormalMeanOne(rng: Rng, cv: number): number {
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  return Math.exp(sigma * rng.normal() - (sigma * sigma) / 2);
}

/** Create a stable cardiac phenotype and an initial beat schedule. */
export function createCardiacState(
  seed: number,
  state: StateId,
  fs = scalarValue('fs'),
): CardiacState {
  const subject = Rng.substream(seed, 'physiology/subject/cardiac');
  const subjectHrMultiplier = lognormalMeanOne(subject, scalarValue('cardiac_subject_hr_cv'));
  const meanHrBpm = scalarValue(hrKeyFor(state)) * subjectHrMultiplier;
  const meanRrS = 60 / meanHrBpm; // @lit-ok seconds per minute
  const rng = Rng.substream(seed, `cardiac/ecg/${state}`);
  return {
    version: 1,
    state,
    fs,
    subjectHrMultiplier,
    meanHrBpm,
    meanRrS,
    targetSdnnS: scalarValue(sdnnKeyFor(state)),
    rsaAmplitudeS:
      provisionalValue('rsa_rr_amp_rem') * scalarValue(rsaRelativeKeyFor(state)),
    fastHrv: rng.normal(),
    slowHrv: rng.normal(),
    absoluteSample: 0,
    nextBeatSample: rng.uniform(0, meanRrS * fs),
    intervalBeforeNextS: meanRrS,
    lastBeat: null,
    rng: saveRng(rng),
  };
}

interface WorkingState {
  version: 1;
  state: StateId;
  fs: number;
  subjectHrMultiplier: number;
  meanHrBpm: number;
  meanRrS: number;
  targetSdnnS: number;
  rsaAmplitudeS: number;
  fastHrv: number;
  slowHrv: number;
  absoluteSample: number;
  nextBeatSample: number;
  intervalBeforeNextS: number;
  lastBeat: ScheduledBeat | null;
  rng: RngSnapshot;
}

function scheduleRr(
  work: WorkingState,
  rng: Rng,
  respiratoryPhase: number,
  breathDepth: number,
): number {
  const fastRho = Math.exp(-1 / provisionalValue('cardiac_fast_tau_beats'));
  const slowRho = Math.exp(-work.meanRrS / provisionalValue('cardiac_slow_tau_s'));
  work.fastHrv = fastRho * work.fastHrv + Math.sqrt(1 - fastRho * fastRho) * rng.normal();
  work.slowHrv = slowRho * work.slowHrv + Math.sqrt(1 - slowRho * slowRho) * rng.normal();

  const fastFraction = provisionalValue('cardiac_fast_variance_fraction');
  const nonRespiratoryDriver =
    Math.sqrt(fastFraction) * work.fastHrv + Math.sqrt(1 - fastFraction) * work.slowHrv;
  // The sinusoid contributes A^2/2 marginal variance at unit depth. The residual receives only
  // the variance left under the independently fitted SDNN target, so strengthening RSA cannot
  // silently increase total HRV and force a compensating state-rate change.
  const nonRespiratorySd = Math.sqrt(Math.max(
    0,
    work.targetSdnnS * work.targetSdnnS -
      (work.rsaAmplitudeS * work.rsaAmplitudeS) / 2,
  ));
  const respiratory = work.rsaAmplitudeS * breathDepth * Math.sin(
    respiratoryPhase - provisionalValue('rsa_phase_offset'),
  );
  return Math.max(
    scalarValue('cardiac_rr_min_s'),
    work.meanRrS + respiratory + nonRespiratorySd * nonRespiratoryDriver,
  );
}

function preSupportSamples(shape: readonly Wave[], rrBeforeS: number, fs: number): number {
  let support = 0;
  for (const wave of shape) {
    if (wave.phase < 0) {
      support = Math.max(support, (-wave.phase + 4 * wave.width) * rrBeforeS * fs); // @lit-ok +/-4 sigma covers each Gaussian
    }
  }
  return support;
}

function renderBeat(
  out: Float64Array,
  chunkStart: number,
  beat: ScheduledBeat,
  shape: readonly Wave[],
  fs: number,
  rAmp: number,
): void {
  const chunkEnd = chunkStart + out.length;
  for (const wave of shape) {
    // The R wave is scaled by the interval that led into it. Pre-R waves are clipped at R and
    // post-R waves begin at R, making morphology causal at the beat boundary: a future beat's
    // P/Q/R leading edge can be rendered without knowing the respiratory phase that will set its
    // following interval. The discarded opposite-side Gaussian tails are below four-sigma
    // support and were the only source of chunk-dependent ECG samples.
    const rr = wave.phase <= 0 ? beat.rrBeforeS : beat.rrAfterS;
    const centre = beat.sample + wave.phase * rr * fs;
    const sigma = wave.width * rr * fs;
    const sideLo = wave.phase > 0 ? Math.ceil(beat.sample) : chunkStart;
    const sideHi = wave.phase < 0 ? Math.floor(beat.sample) : chunkEnd - 1;
    const lo = Math.max(chunkStart, sideLo, Math.round(centre - 4 * sigma)); // @lit-ok +/-4 sigma covers the Gaussian
    const hi = Math.min(chunkEnd - 1, sideHi, Math.round(centre + 4 * sigma)); // @lit-ok as above
    for (let absolute = lo; absolute <= hi; absolute++) {
      const dt = (absolute - centre) / sigma;
      const i = absolute - chunkStart;
      out[i] = out[i]! + rAmp * wave.amp * Math.exp(-0.5 * dt * dt);
    }
  }
}

/** Advance cardiac timing and ECG morphology through one sample-aligned respiratory chunk. */
export function synthesizeEcgChunk(
  state: CardiacState,
  respiration: RespirationResult,
): { readonly result: CardiacResult; readonly state: CardiacState } {
  if (respiration.phase.length !== respiration.depth.length) {
    throw new Error('cardiac: respiratory phase and depth must be sample-aligned');
  }
  const nSamples = respiration.phase.length;
  const work: WorkingState = {
    ...state,
    lastBeat: state.lastBeat === null ? null : { ...state.lastBeat },
    rng: { words: [...state.rng.words] as [number, number, number, number], spare: state.rng.spare },
  };
  const rng = restoreRng(work.rng);
  const shape = waves();
  const rAmp = provisionalValue('ecg_r_amp');
  const out = new Float64Array(nSamples);
  const rPeaks: number[] = [];
  const rrIntervalsS: number[] = [];
  const chunkStart = work.absoluteSample;
  const chunkEnd = chunkStart + nSamples;

  // Re-render only the portion of the preceding beat whose T wave reaches this chunk.
  if (work.lastBeat !== null) renderBeat(out, chunkStart, work.lastBeat, shape, work.fs, rAmp);

  while (true) {
    const lead = preSupportSamples(shape, work.intervalBeforeNextS, work.fs);
    if (work.nextBeatSample - lead >= chunkEnd) break;

    // The next R peak lies beyond this chunk, but its P wave begins inside it. Render that
    // leading morphology without consuming the beat; the next chunk will schedule its RR using
    // the respiratory phase at the R peak itself.
    if (work.nextBeatSample >= chunkEnd) {
      renderBeat(out, chunkStart, {
        sample: work.nextBeatSample,
        rrBeforeS: work.intervalBeforeNextS,
        rrAfterS: work.meanRrS,
      }, shape, work.fs, rAmp);
      break;
    }

    const local = Math.max(0, Math.min(nSamples - 1, Math.round(work.nextBeatSample - chunkStart)));
    const rrAfterS = scheduleRr(
      work,
      rng,
      respiration.phase[local]!,
      respiration.depth[local]!,
    );
    const beat: ScheduledBeat = {
      sample: work.nextBeatSample,
      rrBeforeS: work.intervalBeforeNextS,
      rrAfterS,
    };
    renderBeat(out, chunkStart, beat, shape, work.fs, rAmp);
    if (work.nextBeatSample >= chunkStart) {
      rPeaks.push((work.nextBeatSample - chunkStart) / work.fs);
      rrIntervalsS.push(rrAfterS);
    }
    work.lastBeat = beat;
    work.intervalBeforeNextS = rrAfterS;
    work.nextBeatSample += rrAfterS * work.fs;
  }

  work.absoluteSample = chunkEnd;
  work.rng = saveRng(rng);
  const meanHrBpm = rrIntervalsS.length > 0
    ? 60 / (rrIntervalsS.reduce((sum, rr) => sum + rr, 0) / rrIntervalsS.length) // @lit-ok seconds per minute
    : work.meanHrBpm;
  return {
    result: {
      ecg: out,
      rPeaks,
      meanHrBpm,
      targetSdnnS: work.targetSdnnS,
      rsaAmplitudeS: work.rsaAmplitudeS,
      rrIntervalsS,
    },
    state: work,
  };
}

/** Stateless whole-record wrapper used by exports and ordinary compose calls. */
export function synthesizeEcg(
  seed: number,
  state: StateId,
  respiration: RespirationResult,
  fs = scalarValue('fs'),
): CardiacResult {
  return synthesizeEcgChunk(createCardiacState(seed, state, fs), respiration).result;
}
