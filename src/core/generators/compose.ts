/**
 * Compose the channel mix for a state (Build Plan 3.1).
 *
 *     x_c(t) = sum_g w_{g,c} * s_g(t) + eta_c(t)
 *
 * Tier 0 sources: the aperiodic background, and the state's oscillations. Graphoelements
 * (spindles, K-complexes, slow oscillations) are WP-E and enter through the same projection
 * path — this function's shape does not change when they arrive.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import type { StateId } from '../types/state.ts';
import { provisionalValue, scalarValue, uncertainty, bandEdges, enumValue } from '../registry.ts';
import { synthesizeAperiodic } from './aperiodic.ts';
import {
  synthesizeOscillation,
  synthesizeDampedOscillator,
  DEFAULT_ENVELOPE_DEPTH,
  DEFAULT_ENVELOPE_RATE_HZ,
  synthesizeStochasticEnvelope,
} from './oscillations.ts';
import {
  ALL_CHANNELS,
  projectInto,
  modesOf,
  patchPowerLoading,
  type GeneratorId,
  type PatchId,
} from './projection.ts';
import { synthesizeGraphoelements } from './graphoelements.ts';
import { synthesizeEcg, type CardiacResult } from './cardiac.ts';
import {
  synthesizeRespiration,
  chiModulation,
  phaseRamp,
  respiratoryArtifact,
  amplitudeModulation,
  respiratoryRateForState,
  type RespirationResult,
} from './respiration.ts';
import { applyTimeVaryingTilt } from '../filters/tilt.ts';
import type { GeneratedEvent } from '../types/event.ts';
import {
  powerPreservingInfraSlowGain,
  rms as infraSlowRms,
  synthesizeInfraSlow,
  type InfraSlowDriverChunk,
  type InfraSlowTemporalConfig,
} from './infraslow.ts';
import {
  synthesizeRecordingDrift,
  type RecordingDriftFixtureOptions,
  type RecordingDriftTruth,
} from './recording_drift.ts';

export type { RecordingDriftFixtureOptions } from './recording_drift.ts';

export type InfraSlowFamily = 'isf_frontomedial' | 'isf_sensorimotor' | 'isf_posterior';
export type InfraSlowModulationTarget = 'background' | 'alpha' | 'beta' | 'theta' | 'delta';

/**
 * Explicit ISF-3 mechanism fixture. There are no defaults because every magnitude below remains
 * absent in the registry. This path is executable for matched tests and future external fitting,
 * but cannot silently change the shipped simulator.
 */
export interface InfraSlowFixtureOptions extends InfraSlowTemporalConfig {
  /** Peak-family source RMS in µV. Omitted families have no additive voltage. */
  readonly additiveRmsUv?: Partial<Record<InfraSlowFamily, number>>;
  /** Source-level positive gains applied to continuous cortical carriers. */
  readonly modulation?: readonly {
    readonly targetSource: InfraSlowModulationTarget;
    readonly driverFamily: InfraSlowFamily;
    readonly logAmplitudeDepth: number;
    /** π-shifted surrogate arm: invert the complete broadband driver without moving carriers. */
    readonly phaseInverted?: boolean;
  }[];
}

const INFRA_SLOW_FAMILIES: readonly InfraSlowFamily[] = [
  'isf_frontomedial',
  'isf_sensorimotor',
  'isf_posterior',
];

/** Registered provisional controller settings used by the released signal path. */
export function releasedInfraSlowTemporalConfig(): InfraSlowTemporalConfig {
  return {
    exponent: provisionalValue('isf_temporal_exponent'),
    poleCount: provisionalValue('isf_temporal_pole_count'),
    isf1VarianceFraction: provisionalValue('isf_band_variance_fraction'),
  };
}

/** Every released ISF source mode, for a streaming controller that must survive buffer rolls. */
export function releasedInfraSlowDriverIds(): GeneratorId[] {
  return INFRA_SLOW_FAMILIES.flatMap((family) => modesOf(family));
}

function infraSlowAmplitudeKey(state: StateId): Parameters<typeof provisionalValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'isf_cortical_rms_wake';
  if (state === 'rem') return 'isf_cortical_rms_rem';
  return 'isf_cortical_rms_nrem';
}

function infraSlowDepthKey(state: StateId): Parameters<typeof provisionalValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'isf_pac_depth_wake';
  if (state === 'rem') return 'isf_pac_depth_rem';
  return 'isf_pac_depth_nrem';
}

const INFRA_SLOW_DRIVER_FOR_TARGET: Readonly<Record<InfraSlowModulationTarget, InfraSlowFamily>> = {
  background: 'isf_frontomedial',
  alpha: 'isf_posterior',
  beta: 'isf_sensorimotor',
  theta: 'isf_sensorimotor',
  delta: 'isf_frontomedial',
};

function releasedInfraSlowSpec(
  state: StateId,
  corticalVoltage: boolean,
  excitabilityModulation: boolean,
  corticalRmsOverride?: number,
  modulationDepthOverride?: number,
): InfraSlowFixtureOptions {
  const aggregateRms = corticalRmsOverride ?? provisionalValue(infraSlowAmplitudeKey(state));
  const isNrem = state === 'n1' || state === 'n2' || state === 'n3';
  // NREM's released prefix is one broad frontomedial family: the external contrast is frontal
  // and aggregate, and equal power in three families diluted the measured local phase away from
  // the controller that modulated NREM fast activity. Wake/REM retain the three-family basis.
  const activeFamilies = isNrem ? ['isf_frontomedial'] as const : INFRA_SLOW_FAMILIES;
  // The registry amplitude is ONE aggregate source budget. Independent active BEM families each
  // receive 1/sqrt(N), so adding anatomy does not silently multiply the requested variance.
  const familyRms = aggregateRms / Math.sqrt(activeFamilies.length);
  const depth = modulationDepthOverride ?? provisionalValue(infraSlowDepthKey(state));
  const targets: InfraSlowModulationTarget[] = [...new Set(STATE_OSCILLATIONS[state].map(
    (spec) => spec.generator as Exclude<InfraSlowModulationTarget, 'background'>,
  ))];
  return {
    ...releasedInfraSlowTemporalConfig(),
    ...(corticalVoltage
      ? { additiveRmsUv: Object.fromEntries(
          activeFamilies.map((family) => [family, familyRms]),
        ) }
      : {}),
    ...(excitabilityModulation
      ? { modulation: targets.map((targetSource) => ({
          targetSource,
          driverFamily: isNrem
            ? 'isf_frontomedial'
            : INFRA_SLOW_DRIVER_FOR_TARGET[targetSource],
          logAmplitudeDepth: depth,
        })) }
      : {}),
  };
}

/** Which oscillations each state carries, and which registry rows describe them. */
interface OscSpec {
  // A band rhythm owns a PATCH, so its modes can be enumerated. `resp_artifact` is not one.
  generator: PatchId;
  bandKey: 'alpha_band' | 'beta_band' | 'theta_band' | 'delta_band';
  ampKey: 'alpha_amp' | 'beta_amp' | 'theta_amp' | 'delta_amp';
}

const STATE_OSCILLATIONS: Record<StateId, OscSpec[]> = {
  wake_eo: [{ generator: 'beta', bandKey: 'beta_band', ampKey: 'beta_amp' }],
  wake_ec: [{ generator: 'alpha', bandKey: 'alpha_band', ampKey: 'alpha_amp' }],
  n1: [{ generator: 'theta', bandKey: 'theta_band', ampKey: 'theta_amp' }],
  n2: [{ generator: 'theta', bandKey: 'theta_band', ampKey: 'theta_amp' }],
  n3: [{ generator: 'delta', bandKey: 'delta_band', ampKey: 'delta_amp' }],
  rem: [
    { generator: 'theta', bandKey: 'theta_band', ampKey: 'theta_amp' },
    { generator: 'alpha', bandKey: 'alpha_band', ampKey: 'alpha_amp' },
  ],
};


/**
 * Optional overrides. Additive artifact and continuous-coupling mechanisms are off by default.
 * Respiratory event timing is part of the shipped NREM state model and defaults on; its explicit
 * false arm exists for matched characterization.
 */
export interface ComposeOptions {
  /** Released provisional cortical ISF and excitability coupling. On unless explicitly disabled. */
  readonly infraSlow?: boolean;
  /** Separately switch the released projected-voltage path; master `infraSlow: false` wins. */
  readonly infraSlowCortical?: boolean;
  /** Separately switch the released source-gain path; master `infraSlow: false` wins. */
  readonly infraSlowModulation?: boolean;
  /** Calibration-only override of the released aggregate cortical source budget. */
  readonly infraSlowCorticalRmsUv?: number;
  /** Calibration-only override of the released source log-amplitude depth. */
  readonly infraSlowModulationDepth?: number;
  /** ISF-3 characterization/fitting path. No UI or default may supply absent values. */
  readonly infraSlowFixture?: InfraSlowFixtureOptions;
  /** Internal streaming seam: continuous drivers produced by SignalStream's persistent state. */
  readonly infraSlowOverride?: Readonly<Record<string, InfraSlowDriverChunk>>;
  /** ISF-5 observation-layer artifact fixture. No UI or default may supply absent values. */
  readonly recordingDriftFixture?: RecordingDriftFixtureOptions;
  /** Natural state-dependent variability, or a fixed-cycle teaching contrast at the same mean. */
  readonly respirationMode?: 'natural' | 'regular';
  /**
   * The three respiratory mechanisms of Build Plan 5.1, switched SEPARATELY.
   *
   * They have "different origins, different topographies, different implications.
   * Conflating them is the standard error in this literature." A single `respiration:
   * true` flag would be that error in an API.
   *
   *   movementArtifact - (a) mechanical, AT the respiratory rate. A high-pass removes it.
   *   amplitudeModulation - (c) periodic-power half. Low and high bands have distinct,
   *                         power-preserving phase courses. A high-pass does not generally
   *                         remove respiratory sidebands around a passed carrier.
   *   chiModulation - (c) exponent half. Lives above the stopband; survives any clinical
   *                   filter, which is why it alone could not drive the filter demo.
   */
  readonly movementArtifact?: boolean;
  readonly amplitudeModulation?: boolean;
  readonly chiModulation?: boolean;
  /** R4 event timing. Defaults on; false preserves counts and disables only the phase hazard. */
  readonly eventRespirationCoupling?: boolean;
  /** Override chi_mod_depth. */
  readonly chiModDepth?: number;
  /**
   * Override `resp_amp_mod_depth`, mechanism (c)'s amplitude half.
   *
   * Exists to FALSIFY G4's null arm. That arm must detect anything respiratory reaching chi-hat
   * at f2, and (c)-amplitude is the mechanism measured to do so -- it moves 0.5-4 Hz power, which
   * overlaps the low edge of `chi_est_band`. At the registered depth the leakage sits at roughly
   * the estimator's detection floor, which is too small to give a paired sign test any power
   * (Finding 16: 6/12, p = 1). Sweeping the depth upward produces a monotone leakage source and
   * so measures the arm's SENSITIVITY rather than merely asserting it has some.
   *
   * Not a tuning knob: raising it makes the generator less realistic, not more.
   */
  readonly respAmpModDepth?: number;
  /** Pin the respiration rate, in breaths per minute. Used by the G4 fixture to fix f2. */
  readonly respRatePerMin?: number;
  /**
   * A sample-aligned respiratory chunk supplied by the live controller.
   *
   * Exports omit this and use the stateless whole-record wrapper. The live stream supplies it
   * so respiratory phase and morphology survive display-buffer boundaries while every existing
   * EEG and ECG mechanism continues to consume the same `RespirationResult` interface.
   */
  readonly respirationOverride?: RespirationResult;
  /** Sample-aligned cardiac chunk supplied by the live controller. */
  readonly cardiacOverride?: CardiacResult;
  /**
   * Drive chi from an INDEPENDENT modulator at this frequency instead of from respiration.
   *
   * Exists solely for G4, which must modulate chi at f1 while respiration runs at f2. Build
   * Plan 5.2 defines chi(t) as driven by respiration, so this capability appears nowhere in
   * the shipped UI -- it is how the gate separates the injected effect from the confound.
   */
  readonly independentChiModFreq?: number;
  /**
   * Omit graphoelements from the channel mix, keeping everything else identical.
   *
   * Exists for G3's matched null: "detector on pure aperiodic background at matched chi;
   * false-positive rate near zero." Matched means the SAME background, so the events are
   * suppressed at the summation rather than at the draw — see the call site.
   *
   * The event list is still returned and still describes what WOULD have been injected. A
   * caller that trusted the list here would be wrong, which is why the exporter's sidecar
   * records the suppression rather than leaving it to be inferred from a silent channel.
   */
  readonly suppressGraphoelements?: boolean;
  /**
   * Mains interference (WP-J). Off by default: at 60 Hz it sits above every band this project
   * measures, so leaving it on would add a conspicuous artifact that changes no observable.
   */
  readonly lineNoise?: boolean;
  /**
   * Inject a known connection: `coupling_src` drives `coupling_dst` at `coupling_lag_ms` with
   * `coupling_strength`. OFF by default, and additive when on, so no existing draw moves.
   *
   * The connectivity panel needs a positive control. Every source here projects instantaneously,
   * so all inter-channel coupling is zero-lag volume conduction and debiased wPLI correctly
   * reports almost nothing -- which leaves a blank map meaning either "the measure is working" or
   * "the measure never shows anything", with no way to tell. This is the difference.
   */
  readonly injectedCoupling?: boolean;
  /** Mains frequency in Hz. Defaults to the first `line_freq` option. */
  readonly lineFreqHz?: number;
  /** Coefficient-update scheme for the tilt filter. See src/core/filters/tilt.ts. */
  readonly tiltScheme?: 'blockwise' | 'filterbank';
  /**
   * Override `tilt_block_s`, the blockwise coefficient-hold length in seconds.
   *
   * Exists so T1-M2 can sweep it: the hold attenuates a chi modulation before any estimator
   * sees it, and the registry's value is DERIVED from that sweep against the filter's settling
   * time. A caller changing this is changing how much of the requested modulation is actually
   * generated, which is why it is an explicit override rather than a tuning knob.
   */
  readonly tiltBlockS?: number;
  /**
   * SNR mix, in dB relative to the registry amplitudes (seam 5).
   *
   * Scales every non-background source -- oscillations and graphoelements -- against the
   * aperiodic background, which is held fixed. 0 dB is the registry as written.
   *
   * `snr_nominal` is the value at which generated N3 satisfies the AASM criterion, SOLVED
   * ONCE on a fixture seed and then held. It is not a knob to be turned until a gate passes:
   * tuning it until G5 passes would make G5 pass by construction, which is the same
   * circularity as setting delta_amp from the 75 uV figure, one level up.
   */
  readonly snrDb?: number;
  /** Override the fitted broadband waxing/waning depth for characterization probes. */
  readonly backgroundEnvelopeDepth?: number;
  /** Characterization-only overrides for alpha's bistable damping model. */
  readonly alphaBandwidthSharpHz?: number;
  readonly alphaBandwidthBroadHz?: number;
  readonly alphaModeDwellS?: number;
  /** Characterization overrides for separating continuous N3 delta from discrete slow waves. */
  readonly deltaAmplitudePpUv?: number;
  readonly slowOscRatePerMin?: number;
  readonly slowOscAmplitudePpUv?: number;
  /** Characterization switch: retain ongoing theta in N3 instead of making it delta-only. */
  readonly n3Theta?: boolean;
  /** Characterization override for state-specific aperiodic background level. */
  readonly backgroundGain?: number;
  /** Characterization override for the fast-timescale variance in N3's background. */
  readonly n3FastBackgroundFraction?: number;
  /** Characterization override for that component's knee frequency. */
  readonly n3FastBackgroundKneeHz?: number;
  readonly spindleFastFraction?: number;
}

export interface ComposeResult {
  /** [channel][sample], microvolts. */
  readonly channels: Float64Array[];
  /** The event list -- seam 1's primary output. The waveform above is derived from it. */
  readonly events: readonly GeneratedEvent[];
  /** Respiration belt, an exported channel. */
  readonly respirationBelt: Float64Array;
  /** Respiration phase. Ground truth for every coupling measure; NOT derived by Hilbert. */
  readonly respirationPhase: Float64Array;
  /**
   * Surface ECG in microvolts, and the R-peak times a HEP analysis would need.
   *
   * NOT a scalp channel and deliberately not in `channels`: it is a different physical quantity
   * on a different derivation, and putting it in the montage array would let it be referenced,
   * ranked and band-analysed as though it were EEG.
   */
  readonly ecg: Float64Array;
  readonly rPeaks: readonly number[];
  /** Ground truth actually injected, for the epoch sidecar. */
  readonly truth: {
    chi: number;
    knee: number;
    /** Aperiodic components actually synthesized; rmsFraction values sum to one. */
    aperiodicComponents: readonly {
      chi: number;
      knee: number;
      rmsFraction: number;
    }[];
    backgroundRmsUv: number;
    oscillations: {
      generator: string;
      band: [number, number];
      rmsUv: number;
      respModDepth: number;
      respModPhi0: number;
    }[];
    sensorNoiseRmsUv: number;
    snrDb: number;
    chiModDepth: number;
    chiModPhi0: number;
    /** Non-negative lead-field-derived modulation-depth loading, in channel order. */
    chiSpatialLoading: readonly number[];
    respArtifactAmpUv: number;
    respAmpModDepth: number;
    respAmpModDepthHigh: number;
    respFreqHz: number;
    respEventCoupling: {
      enabled: boolean;
      soPreferredPhase: number;
      soHazardKappa: number;
      fastSpindlePreferredPhase: number;
      fastSpindleHazardKappa: number;
      slowSpindleHazardKappa: number;
    };
    independentChiModFreq: number | null;
    /**
     * Projection generators the graphoelement synthesizer used, for the epoch sidecar.
     *
     * Passed through from `synthesizeGraphoelements` rather than reconstructed, because event
     * type and generator id are different vocabularies — a `kcomplex` event projects through
     * `kc`. Populated even under `suppressGraphoelements`: the events still describe what would
     * have been injected, and the sidecar's `graphoelementsSuppressed` says they did not reach
     * the signal.
     */
    graphoelementGenerators: readonly string[];
    /** Achieved mean heart rate, for the sidecar. */
    meanHrBpm: number;
    /** HMC-fitted total RR standard-deviation target. */
    rrSdnnTargetMs: number;
    /** RR-domain RSA amplitude before realized breath-depth scaling. */
    rsaAmplitudeMs: number;
    /** Realized controller output. These are generator truth, not recovered EEG estimates. */
    respiration: {
      mode: 'natural' | 'regular';
      meanRatePerMin: number;
      periodCv: number | null;
      periodLag1: number | null;
      depthCv: number | null;
      meanIeRatio: number | null;
      inhalePauseFraction: number | null;
      exhalePauseFraction: number | null;
      breaths: readonly {
        onsetS: number;
        durationS: number;
        inhaleS: number;
        inhalePauseS: number;
        exhaleS: number;
        exhalePauseS: number;
        startDepth: number;
        depth: number;
      }[];
    };
    cardiac: {
      rPeaksS: readonly number[];
      rrIntervalsS: readonly number[];
      meanHrBpm: number;
      sdnnMs: number | null;
      rmssdMs: number | null;
      requestedRsaAmplitudeMs: number;
      recoveredRsaAmplitudeMs: number | null;
      recoveredRsaR2: number | null;
    };
    eventPhaseSummaries: readonly {
      type: 'slow_oscillation' | 'spindle_fast' | 'spindle_slow';
      n: number;
      coupledCount: number;
      meanPhase: number | null;
      resultantLength: number | null;
    }[];
    /** Present only when an explicit ISF cortical or recording-drift fixture is requested. */
    infraSlow?: {
      readonly fixture: boolean;
      readonly profile: 'explicit_fixture' | 'provisional_release';
      readonly extrapolated: boolean;
      readonly temporalModel: 'band_limited_power_law_state_space';
      readonly bandsHz: {
        readonly isf1: readonly [number, number];
        readonly isf2: readonly [number, number];
      };
      readonly sourceModes: readonly {
        readonly sourceId: string;
        readonly family: InfraSlowFamily;
        readonly sharedFraction: null;
        readonly delayS: null;
        readonly requestedAdditiveRmsUv: number;
        readonly realizedAdditiveRmsUv: number;
        readonly realizedBandPowerUv2: readonly [number, number];
      }[];
      readonly modulation: readonly {
        readonly targetSource: InfraSlowModulationTarget;
        readonly driverFamily: InfraSlowFamily;
        readonly requestedDepth: number;
        readonly realizedGainRms: number;
        readonly preferredPhase: null;
        readonly phaseInverted: boolean;
      }[];
      readonly electrodeDrift: { readonly enabled: false } | RecordingDriftTruth;
    };
  };
}

/**
 * Midpoint of an `uncertainty` interval.
 *
 * The registry's grammar says an uncertainty interval is "a spread the generator must reduce
 * to a point plus Dv". The registry currently holds ZERO Dv rows, so this reduces to the
 * midpoint and the spread is discarded.
 *
 * TODO(T1-M1): this is the unregistered degree of freedom noted against `delta_amp` — whoever
 * picks the point holds it. Register Dv rows and draw per-event instead of taking a midpoint.
 */
function pointFromUncertainty(key: Parameters<typeof uncertainty>[0]): number {
  const { lo, hi } = uncertainty(key);
  return (lo + hi) / 2;
}

/**
 * Peak-to-peak amplitude to RMS.
 *
 * The oscillation rows hold textbook figures for a VISIBLE RHYTHM, which are peak-to-peak.
 * Handing them to the generator as RMS put wake_ec's alpha at 35 uV RMS against a 20 uV
 * background and pushed G1a's recovered chi +1.22 off the injected value. See the
 * `amp_pp_to_rms` note in the registry.
 */
function rmsFromPeakToPeak(key: Parameters<typeof uncertainty>[0]): number {
  return pointFromUncertainty(key) / scalarValue('amp_pp_to_rms');
}

function signalRms(x: Float64Array): number {
  let power = 0;
  for (let i = 0; i < x.length; i++) power += x[i]! * x[i]!;
  return x.length > 0 ? Math.sqrt(power / x.length) : 0;
}

/** Match total RMS after a tilt so slope coupling cannot become a hidden background-gain knob. */
function matchRms(x: Float64Array, target: number): void {
  const current = signalRms(x);
  if (current <= 0 || target <= 0) return;
  const gain = target / current;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * gain;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationSd(values: readonly number[]): number | null {
  const center = mean(values);
  if (center === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length);
}

function coefficientOfVariation(values: readonly number[]): number | null {
  const center = mean(values);
  const spread = populationSd(values);
  return center === null || spread === null || center === 0 ? null : spread / Math.abs(center);
}

function lagOneCorrelation(values: readonly number[]): number | null {
  if (values.length < 3) return null; // @lit-ok three points are the structural minimum for two adjacent pairs
  const a = values.slice(0, -1);
  const b = values.slice(1);
  const ma = mean(a)!;
  const mb = mean(b)!;
  let covariance = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    covariance += da * db;
    va += da * da;
    vb += db * db;
  }
  return va === 0 || vb === 0 ? null : covariance / Math.sqrt(va * vb);
}

function harmonicFit(
  values: readonly number[],
  phases: readonly number[],
): { amplitude: number | null; r2: number | null } {
  if (values.length < 3 || values.length !== phases.length) { // @lit-ok intercept plus sine and cosine require three observations
    return { amplitude: null, r2: null };
  }
  const center = mean(values)!;
  let cc = 0, ss = 0, cs = 0, cy = 0, sy = 0;
  for (let i = 0; i < values.length; i++) {
    const c = Math.cos(phases[i]!);
    const s = Math.sin(phases[i]!);
    const y = values[i]! - center;
    cc += c * c;
    ss += s * s;
    cs += c * s;
    cy += c * y;
    sy += s * y;
  }
  const determinant = cc * ss - cs * cs;
  if (Math.abs(determinant) < Number.EPSILON) return { amplitude: null, r2: null };
  const betaC = (cy * ss - sy * cs) / determinant;
  const betaS = (sy * cc - cy * cs) / determinant;
  let residual = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const centered = values[i]! - center;
    const predicted = betaC * Math.cos(phases[i]!) + betaS * Math.sin(phases[i]!);
    residual += (centered - predicted) ** 2;
    total += centered * centered;
  }
  return {
    amplitude: Math.hypot(betaC, betaS),
    r2: total === 0 ? null : 1 - residual / total,
  };
}

function circularSummary(
  events: readonly GeneratedEvent[],
  type: 'slow_oscillation' | 'spindle_fast' | 'spindle_slow',
) {
  const selected = events.filter((event) => event.type === type);
  const phases = selected
    .map((event) => event.params['respPhase'])
    .filter((phase): phase is number => phase !== undefined && Number.isFinite(phase));
  if (phases.length === 0) {
    return { type, n: 0, coupledCount: 0, meanPhase: null, resultantLength: null };
  }
  const x = phases.reduce((sum, phase) => sum + Math.cos(phase), 0);
  const y = phases.reduce((sum, phase) => sum + Math.sin(phase), 0);
  return {
    type,
    n: phases.length,
    coupledCount: selected.filter((event) => event.params['respCoupled'] === 1).length,
    meanPhase: Math.atan2(y, x),
    resultantLength: Math.hypot(x, y) / phases.length,
  };
}

function chiPhaseKey(state: StateId): Parameters<typeof scalarValue>[0] {
  if (state === 'wake_eo' || state === 'wake_ec') return 'chi_mod_phi0_wake';
  return `chi_mod_phi0_${state}` as Parameters<typeof scalarValue>[0];
}

export function composeState(
  seed: number,
  state: StateId,
  nSamples: number,
  fs = scalarValue('fs'),
  opts: ComposeOptions = {},
): ComposeResult {
  const nCh = ALL_CHANNELS.length;
  const out: Float64Array[] = Array.from({ length: nCh }, () => new Float64Array(nSamples));

  const requestedBackgroundRms = pointFromUncertainty('background_rms_uv');
  const releasedInfraSlowCortical = opts.infraSlow !== false &&
    opts.infraSlowCortical !== false && opts.infraSlowFixture === undefined;
  const releasedInfraSlowModulation = opts.infraSlow !== false &&
    opts.infraSlowModulation !== false && opts.infraSlowFixture === undefined;
  const releasedInfraSlowEnabled = releasedInfraSlowCortical || releasedInfraSlowModulation;
  const releasedInfraSlowRms = releasedInfraSlowCortical
    ? (opts.infraSlowCorticalRmsUv ?? provisionalValue(infraSlowAmplitudeKey(state)))
    : 0;
  if (!Number.isFinite(releasedInfraSlowRms) || releasedInfraSlowRms < 0) {
    throw new Error('compose: released infra-slow cortical RMS must be finite and non-negative');
  }
  if (opts.infraSlowModulationDepth !== undefined &&
      (!Number.isFinite(opts.infraSlowModulationDepth) || opts.infraSlowModulationDepth < 0)) {
    throw new Error('compose: released infra-slow modulation depth must be finite and non-negative');
  }
  // A named ISF source consumes variance from the existing cortical-background allocation. This
  // is the power budget that prevents a new low-frequency mechanism from simply inflating every
  // state's RMS. The two paths are independent, so variances -- not amplitudes -- subtract.
  const backgroundRms = Math.sqrt(Math.max(
    0,
    requestedBackgroundRms * requestedBackgroundRms - releasedInfraSlowRms * releasedInfraSlowRms,
  ));
  const chi = provisionalValue(`chi_${state}` as Parameters<typeof provisionalValue>[0]);
  const knee = provisionalValue(`k_${state}` as Parameters<typeof provisionalValue>[0]);
  const n3FastShare = state === 'n3'
    ? (opts.n3FastBackgroundFraction ?? provisionalValue('background_fast_fraction_n3'))
    : 0;
  if (n3FastShare < 0 || n3FastShare > 1) {
    throw new Error('compose: n3FastBackgroundFraction must be between 0 and 1');
  }
  const fastChi = chi;
  const fastKneeHz = opts.n3FastBackgroundKneeHz ??
    provisionalValue('background_fast_knee_n3');
  const fastKnee = Math.pow(fastKneeHz, fastChi);

  /**
   * Synthesize one background drive as a mixture of slow- and fast-timescale populations.
   * Both have the fitted N3 asymptotic exponent, so adding the tail cannot silently flatten the
   * quantity `chi_n3` denotes.  Their different knees model different correlation times.
   * Square-root splitting preserves the requested variance when the components are independent.
   */
  const makeBackground = (streamName: string, rmsUv: number): Float64Array => {
    if (n3FastShare === 0) {
      return synthesizeAperiodic(
        Rng.substream(seed, streamName),
        nSamples,
        { chi, k: knee, rmsUv },
        fs,
      );
    }
    const slow = synthesizeAperiodic(
      Rng.substream(seed, streamName),
      nSamples,
      { chi, k: knee, rmsUv: rmsUv * Math.sqrt(1 - n3FastShare) },
      fs,
    );
    const fast = synthesizeAperiodic(
      Rng.substream(seed, `${streamName}/fast_timescale`),
      nSamples,
      { chi: fastChi, k: fastKnee, rmsUv: rmsUv * Math.sqrt(n3FastShare) },
      fs,
    );
    for (let i = 0; i < nSamples; i++) slow[i] = slow[i]! + fast[i]!;
    return slow;
  };

  // Respiration. Generated even when the coupling is off, because the belt is an exported
  // channel in its own right and G4 needs its phase as ground truth.
  const fixedRespRate = opts.respRatePerMin ?? (
    opts.respirationMode === 'regular' ? respiratoryRateForState(state) : undefined
  );
  const resp = opts.respirationOverride ?? synthesizeRespiration(
    seed,
    nSamples,
    state,
    fs,
    fixedRespRate,
  );
  if (resp.belt.length !== nSamples || resp.phase.length !== nSamples || resp.depth.length !== nSamples) {
    throw new Error('compose: respirationOverride must be sample-aligned to the requested record');
  }

  // An explicit fixture always wins for matched characterization. Otherwise the released path
  // uses the registry's conspicuously provisional values. Keeping the two paths distinct means a
  // fixture can never inherit or validate the shipped values by accident.
  const infraSpec = opts.infraSlowFixture ?? (
    releasedInfraSlowEnabled
      ? releasedInfraSlowSpec(
          state,
          releasedInfraSlowCortical,
          releasedInfraSlowModulation,
          opts.infraSlowCorticalRmsUv,
          opts.infraSlowModulationDepth,
        )
      : undefined
  );
  const infraProfile = opts.infraSlowFixture
    ? 'explicit_fixture' as const
    : 'provisional_release' as const;
  const infraAdditive: {
    generator: GeneratorId;
    family: InfraSlowFamily;
    signal: Float64Array;
    requestedRmsUv: number;
    realizedRmsUv: number;
    bandPowerUv2: [number, number];
  }[] = [];
  const infraGains = new Map<InfraSlowModulationTarget, {
    driverFamily: InfraSlowFamily;
    gains: Float64Array[];
  }>();
  const infraModTruth: NonNullable<ComposeResult['truth']['infraSlow']>['modulation'][number][] = [];
  let infraTruth: ComposeResult['truth']['infraSlow'] | null = null;
  if (infraSpec) {
    const additiveEntries = Object.entries(infraSpec.additiveRmsUv ?? {}) as
      [InfraSlowFamily, number][];
    for (const [family, amplitude] of additiveEntries) {
      if (!Number.isFinite(amplitude) || amplitude < 0) {
        throw new Error(`compose: infra-slow additive RMS for ${family} must be finite and non-negative`);
      }
    }
    const modulation = infraSpec.modulation ?? [];
    const targets = new Set<InfraSlowModulationTarget>();
    for (const item of modulation) {
      if (targets.has(item.targetSource)) {
        throw new Error(`compose: duplicate infra-slow modulation target ${item.targetSource}`);
      }
      targets.add(item.targetSource);
    }

    const families = new Set<InfraSlowFamily>([
      ...additiveEntries.map(([family]) => family),
      ...modulation.map((item) => item.driverFamily),
    ]);
    const driverIds = [...families].flatMap((family) => modesOf(family));
    const drivers = opts.infraSlowOverride ?? synthesizeInfraSlow(
      seed,
      driverIds,
      nSamples,
      {
        exponent: infraSpec.exponent,
        poleCount: infraSpec.poleCount,
        isf1VarianceFraction: infraSpec.isf1VarianceFraction,
      },
      fs,
    );
    for (const driverId of driverIds) {
      const driver = drivers[driverId];
      if (!driver || driver.combined.length !== nSamples || driver.isf1.length !== nSamples ||
          driver.isf2.length !== nSamples) {
        throw new Error(`compose: infraSlowOverride is missing a sample-aligned '${driverId}' driver`);
      }
    }

    for (const [family, amplitude] of additiveEntries) {
      for (const generator of modesOf(family)) {
        const driver = drivers[generator]!;
        const combined = driver.combined;
        const low = driver.isf1;
        const high = driver.isf2;
        const signal = Float64Array.from(combined, (value) => value * amplitude);
        const lowRms = infraSlowRms(low) * amplitude;
        const highRms = infraSlowRms(high) * amplitude;
        infraAdditive.push({
          generator,
          family,
          signal,
          requestedRmsUv: amplitude,
          realizedRmsUv: infraSlowRms(signal),
          bandPowerUv2: [lowRms * lowRms, highRms * highRms],
        });
      }
    }

    for (const item of modulation) {
      const gains = modesOf(item.driverFamily).map((driverId) => {
        const sourceDriver = drivers[driverId]!.combined;
        const driver = item.phaseInverted
          ? Float64Array.from(sourceDriver, (value) => -value)
          : sourceDriver;
        return powerPreservingInfraSlowGain(driver, item.logAmplitudeDepth);
      });
      infraGains.set(item.targetSource, { driverFamily: item.driverFamily, gains });
      const realizedGainRms = Math.sqrt(
        gains.reduce((sum, gain) => sum + infraSlowRms(gain) ** 2, 0) / gains.length,
      );
      infraModTruth.push({
        targetSource: item.targetSource,
        driverFamily: item.driverFamily,
        requestedDepth: item.logAmplitudeDepth,
        realizedGainRms,
        preferredPhase: null,
        phaseInverted: item.phaseInverted ?? false,
      });
    }

    const isf1 = bandEdges('isf1_band');
    const isf2 = bandEdges('isf2_band');
    infraTruth = {
      fixture: infraProfile === 'explicit_fixture',
      profile: infraProfile,
      extrapolated: infraProfile === 'provisional_release' && state === 'rem',
      temporalModel: 'band_limited_power_law_state_space',
      bandsHz: { isf1: [isf1.lo, isf1.hi], isf2: [isf2.lo, isf2.hi] },
      sourceModes: infraAdditive.map((source) => ({
        sourceId: source.generator,
        family: source.family,
        sharedFraction: null,
        delayS: null,
        requestedAdditiveRmsUv: source.requestedRmsUv,
        realizedAdditiveRmsUv: source.realizedRmsUv,
        realizedBandPowerUv2: source.bandPowerUv2,
      })),
      modulation: infraModTruth,
      electrodeDrift: { enabled: false },
    };
  }

  // Mechanism (a): the movement artifact. Its own generator, its own topography. It is held
  // until AFTER the background's stochastic/state gain below: a mechanical electrode artifact
  // is not aperiodic brain activity and must not inherit N3's background_gain_n3 (Finding 36).
  let respArtifactAmpUv = 0;
  let respArtifact: Float64Array | null = null;
  if (opts.movementArtifact) {
    respArtifactAmpUv = pointFromUncertainty('resp_artifact_amp');
    respArtifact = respiratoryArtifact(resp.belt, respArtifactAmpUv);
  }

  // Mechanism (c), periodic half. Low and high bands have distinct temporal profiles in the
  // source data, and both are kept separate from the aperiodic phase course.
  let respAmpModDepth = 0;
  let respAmpModDepthHigh = 0;
  let ampModLow: Float64Array | null = null;
  let ampModHigh: Float64Array | null = null;
  if (opts.amplitudeModulation) {
    respAmpModDepth = opts.respAmpModDepth ?? provisionalValue('resp_amp_mod_depth');
    respAmpModDepthHigh = provisionalValue('periodic_mod_depth_high');
    ampModLow = amplitudeModulation(
      resp.phase,
      resp.depth,
      respAmpModDepth,
      scalarValue('periodic_mod_phi0_low'),
    );
    ampModHigh = amplitudeModulation(
      resp.phase,
      resp.depth,
      respAmpModDepthHigh,
      scalarValue('periodic_mod_phi0_high'),
    );
  }

  // Aperiodic background: SEVERAL shared sources with distinct topographies.
  //
  // One uniformly-weighted source gave a measured effective rank of 1.14 — PC1 carrying 93%
  // of variance, median inter-channel correlation 0.988, every channel the same trace scaled.
  // Build Plan 3.1 forbids per-channel independent signals; a single shared source is the
  // opposite error and just as visible in a covariance matrix.
  //
  // Independent realizations at overlapping scalp locations give correlation that falls off
  // with distance, which is what volume conduction produces. Each carries 1/sqrt(N) of the
  // amplitude so the total background variance is unchanged.
  //
  // THE SOURCES ARE NOW SPATIAL EIGENMODES OF THE WHOLE CORTEX, projected through an fsaverage
  // forward model (D19). Six invented centres and a chosen count are gone; the number of modes is
  // whatever the head model and `patch_mode_variance` produce, read from the projection file.
  //
  // Each mode is driven at the SAME rms and the weights carry the variance split, because the
  // producer normalised each family so the root-sum-square across its modes peaks at 1. Total
  // variance at the peak electrode is therefore backgroundRms^2, exactly as when a single
  // peak-1 Gaussian carried it -- `background_rms_uv` keeps its meaning across the change.
  const bgModes = modesOf('background');
  const bgSources: Float64Array[] = bgModes.map((_, i) =>
    makeBackground(`background_${i}/${state}`, backgroundRms),
  );
  const backgroundInfraGains = infraGains.get('background')?.gains;
  if (backgroundInfraGains) {
    for (let mode = 0; mode < bgSources.length; mode++) {
      const source = bgSources[mode]!;
      const gain = backgroundInfraGains[mode % backgroundInfraGains.length]!;
      for (let i = 0; i < nSamples; i++) source[i] = source[i]! * gain[i]!;
    }
  }

  // WHAT A LEAD FIELD CANNOT PRODUCE, and the reason it needed measuring separately.
  //
  // Real EEG is LESS spatially correlated than any forward model predicts: under average
  // reference the parameter-free lead field gives near-pair 0.553 against a real 0.413. No source
  // model closes that, because coherence between sources only ever RAISES inter-channel
  // correlation. Only signal independent per electrode lowers it, and `sensor_noise_rms` supplies
  // 0.56% of variance where the fit wants ~28% (Finding 20).
  //
  // It carries the background's OWN aperiodic exponent rather than being white: 28% of variance
  // as white noise would flatten the measured spectrum and move chi, turning a spatial correction
  // into a spectral defect.
  const localShare = provisionalValue('channel_local_share');
  // `localShare` is a share of TOTAL channel variance, so the independent part stands in ratio
  // share/(1 - share) to the cortical part. The guard is a division-by-zero floor, not a
  // parameter: at share = 1 there is no cortical signal left to scale against.
  const localRms =
    backgroundRms * Math.sqrt(localShare / Math.max(1e-9, 1 - localShare)); // @lit-ok 1e-9 is a divide-by-zero floor for share -> 1, not a scientific quantity

  // Assemble the complete aperiodic background BEFORE respiratory tilt. This includes the
  // empirically required channel-local cortical equivalent: it has the same exponent and should
  // participate in an observed channel's slope modulation rather than dilute it by construction.
  const backgroundOut: Float64Array[] = Array.from(
    { length: nCh },
    () => new Float64Array(nSamples),
  );
  for (let i = 0; i < bgSources.length; i++) {
    projectInto(backgroundOut, bgSources[i]!, bgModes[i]!);
  }
  if (localShare > 0) {
    for (let c = 0; c < nCh; c++) {
      const local = makeBackground(`channel_local/${state}/${ALL_CHANNELS[c]!}`, localRms);
      const dst = backgroundOut[c]!;
      for (let i = 0; i < nSamples; i++) {
        // Channel-local residuals repair measured scalp covariance; they are not a named cortical
        // source and therefore cannot inherit a BEM-source controller by channel index.
        dst[i] = dst[i]! + local[i]!;
      }
    }
  }

  // Respiration-phase modulation of the aperiodic exponent (§5.2 mechanism c).
  //
  // The measured effect is widespread but strongest posteriorly. `resp_aperiodic` is a named
  // parieto-occipital cortical patch in the same BEM as every rhythm; root-sum-square over its
  // spatial modes gives a non-negative modulation-depth loading with volume-conducted tails.
  // This changes HOW STRONGLY each scalp channel is tilted, not its baseline voltage topography.
  //
  // Generated at constant chi and then tilted, rather than by regenerating per sample: the tilt
  // filter is the mechanism the demonstration is about. Each channel is restored to its pre-tilt
  // RMS so exponent coupling cannot quietly retune fitted state amplitude or `snr_nominal`.
  let chiModDepth = 0;
  let chiModPhi0 = 0;
  let chiSpatialLoading: readonly number[] = Array.from({ length: nCh }, () => 0);
  if (opts.chiModulation) {
    const independent =
      opts.independentChiModFreq !== undefined
        ? phaseRamp(nSamples, opts.independentChiModFreq, fs)
        : undefined;
    const chiT = chiModulation(
      resp.phase,
      chi,
      state,
      opts.chiModDepth,
      independent,
      resp.depth,
    );
    const deltaChiPeak = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) deltaChiPeak[i] = chi - chiT[i]!;
    chiSpatialLoading = [...patchPowerLoading('resp_aperiodic')];
    for (let c = 0; c < nCh; c++) {
      const beforeRms = signalRms(backgroundOut[c]!);
      const deltaChi = new Float64Array(nSamples);
      for (let i = 0; i < nSamples; i++) {
        deltaChi[i] = deltaChiPeak[i]! * chiSpatialLoading[c]!;
      }
      backgroundOut[c] = applyTimeVaryingTilt(backgroundOut[c]!, deltaChi, fs, {
        ...(opts.tiltScheme ? { scheme: opts.tiltScheme } : {}),
        // The block length is a REGISTRY VALUE, not the filter's own default. It sets how much
        // of a chi modulation survives generation at all (Finding 15): a block holds chi
        // constant, so a hold of length B attenuates a modulation at f by roughly |sinc(fB)|
        // BEFORE any estimator sees it. `tilt_block_s` carries the derivation.
        blockSamples: Math.round((opts.tiltBlockS ?? scalarValue('tilt_block_s')) * fs),
      });
      matchRms(backgroundOut[c]!, beforeRms);
    }
    chiModDepth = opts.chiModDepth ?? provisionalValue('chi_mod_depth');
    chiModPhi0 = scalarValue(chiPhaseKey(state));
  }

  // REAL BACKGROUND ACTIVITY IS NOT STATIONARY. HMC two-second band-power estimates vary much
  // more than the original stationary aperiodic process (Finding 32). One common, slow envelope
  // changes the strength of the distributed cortical state without changing its lead-field
  // topography, relative mode weights, or average RMS. Applying it after the local equivalent
  // component is deliberate: the fitted `channel_local_share` remains a variance share instead
  // of drifting with envelope phase.
  const bgEnvelope = synthesizeStochasticEnvelope(
    Rng.substream(seed, `background_envelope/${state}`),
    nSamples,
    opts.backgroundEnvelopeDepth ?? provisionalValue('background_envelope_depth'),
    scalarValue('background_envelope_rate'),
    fs,
  );
  for (let c = 0; c < nCh; c++) {
    const dst = out[c]!;
    const src = backgroundOut[c]!;
    const gain = opts.backgroundGain ?? (state === 'n3' ? provisionalValue('background_gain_n3') : 1);
    for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + src[i]! * bgEnvelope[i]! * gain;
  }

  if (respArtifact !== null) {
    projectInto(out, respArtifact, 'resp_artifact');
  }

  // Additive cortical infra-slow voltage uses the same projection seam as every neural source.
  // It is deliberately independent of SNR and respiratory/background gains: those parameters
  // describe different causes and may not borrow one another's scale.
  for (const source of infraAdditive) projectInto(out, source.signal, source.generator);

  // Seam 5: the mix is explicit. Background is the reference and is never scaled.
  const snrDb = opts.snrDb ?? 0;
  const sourceGain = Math.pow(10, snrDb / 20); // @lit-ok dB-to-linear: 10^(dB/20) is the definition of decibels

  // AN INJECTED CONNECTION WITH A KNOWN LAG, off unless asked for.
  //
  // Every source in this generator projects INSTANTANEOUSLY, so all inter-channel coupling is
  // zero-lag volume conduction, and debiased wPLI -- built to reject exactly that -- correctly
  // reports almost nothing: 0.004 against a real 0.068 (Findings 25, 26). A blank connectivity map
  // is then unfalsifiable. It could mean the measure is doing its job, or that it never shows
  // anything at all, and a reader has no way to tell the two apart.
  //
  // So one patch drives another at a known lag:
  //
  //     dst(t) = c * src(t - lag) + sqrt(1 - c^2) * independent(t)
  //
  // which leaves the target's TOTAL variance unchanged and moves only its shared fraction, so
  // `coupling_strength` = 0 is genuinely the null rather than merely a quiet setting.
  //
  // A two-source model with a time-delayed linear influence of one on the other is the standard
  // design in the connectivity-benchmarking literature, adopted here rather than invented so that
  // results are comparable with published method comparisons.
  //
  // The delay is padded with zeros at the segment start. At 20 ms that is 5 samples, well inside
  // the 0.25 s taper `crossfadeIn` already applies, so the pad is never visible.
  if (opts.injectedCoupling) {
    const lagSamples = Math.round((scalarValue('coupling_lag_ms') / 1000) * fs); // @lit-ok ms per second
    const c = scalarValue('coupling_strength');
    const rms = rmsFromPeakToPeak('coupling_amp');
    const { lo, hi } = bandEdges('alpha_band');
    const mk = (name: string): Float64Array =>
      synthesizeOscillation(
        Rng.substream(seed, name),
        nSamples,
        {
          bandLo: lo,
          bandHi: hi,
          rmsUv: rms,
          envelopeDepth: DEFAULT_ENVELOPE_DEPTH,
          envelopeRateHz: DEFAULT_ENVELOPE_RATE_HZ,
        },
        fs,
      );

    const srcModes = modesOf('coupling_src');
    const dstModes = modesOf('coupling_dst');
    for (let m = 0; m < srcModes.length; m++) {
      const driver = mk(`coupling/${state}/src${m}`);
      projectInto(out, driver, srcModes[m]!);
    }
    // Each destination mode is driven by its OWN delayed copy of a driver, so the connection is
    // between the two patches rather than between one pair of modes.
    for (let m = 0; m < dstModes.length; m++) {
      const driver = mk(`coupling/${state}/src${m % srcModes.length}`);
      const indep = mk(`coupling/${state}/dst${m}`);
      const mixed = new Float64Array(nSamples);
      const w = Math.sqrt(Math.max(0, 1 - c * c));
      for (let i = 0; i < nSamples; i++) {
        const j = i - lagSamples;
        mixed[i] = (j >= 0 ? c * driver[j]! : 0) + w * indep[i]!;
      }
      projectInto(out, mixed, dstModes[m]!);
    }
  }

  const oscTruth: ComposeResult['truth']['oscillations'] = [];
  // A BAND RHYTHM OCCUPIES A CORTICAL PATCH, and a patch has more than one spatial mode.
  //
  // Modelling a rhythm as one source made every channel carrying it the same trace: N3 measured
  // effective rank 1.07 against a real 3.09, PC1 0.967, median |corr| 0.950, while the background
  // alone measured 3.44. Two fixes were built and refuted before this one -- a ring of sub-sources
  // (rank capped at 1.26 at ANY radius) and the background's regional centres (1.10 -> 1.18) --
  // because both shared a near-flat far-field pedestal that no arrangement of sources can break
  // up. See Findings 19 and 20.
  //
  // Now each rhythm is an anatomical patch in the Desikan-Killiany atlas, projected through an
  // fsaverage forward model, and the projection file carries the leading eigenmodes of that
  // patch's channel covariance. Each mode gets an INDEPENDENT realisation at the SAME rms; the
  // weights carry the variance split, because the producer normalised each family so the
  // root-sum-square across its modes peaks at 1. `<band>_amp` therefore still means peak-to-peak
  // at the band's strongest electrode, which is what keeps snr_nominal and G5 interpretable.
  //
  // No coherent/spread fraction survives: `osc_coherent_fraction`, `osc_n_sources` and
  // `osc_source_spread` were all consequences of having to invent a spatial basis.
  const oscillationSpecs = state === 'n3' && (opts.n3Theta ?? true)
    ? [...STATE_OSCILLATIONS[state],
       { generator: 'theta', bandKey: 'theta_band', ampKey: 'theta_amp' } as OscSpec]
    : STATE_OSCILLATIONS[state];
  for (const spec of oscillationSpecs) {
    const { lo, hi } = bandEdges(spec.bandKey);
    const rmsUv = spec.generator === 'delta'
      ? (opts.deltaAmplitudePpUv ?? provisionalValue('delta_amp')) /
        scalarValue('amp_pp_to_rms')
      : rmsFromPeakToPeak(spec.ampKey);
    // ALPHA IS MODELLED DIFFERENTLY FROM THE OTHERS, deliberately.
    //
    // Alpha is a genuine resonance — it stands out as a peak above the aperiodic background
    // in a way most band-limited EEG activity does not — so it is generated as a damped
    // stochastic oscillator with bistable damping (DECISIONS D13). Beta and theta keep the
    // filtered-noise form: they are broader, weaker and far less clearly resonant, and there
    // is no fitted damping for them. Giving them alpha's mechanism would assert a resonance
    // nobody has measured.
    // TODO(T1-M1): fit damping per rhythm and decide which, if any, of the others resonate.
    const makeSource = (streamName: string, componentRms: number): Float64Array =>
      spec.generator === 'alpha'
        ? synthesizeDampedOscillator(
            Rng.substream(seed, streamName),
            nSamples,
            {
              f0: scalarValue('alpha_peak'),
              bandwidthSharpHz:
                opts.alphaBandwidthSharpHz ?? provisionalValue('alpha_bandwidth_sharp'),
              bandwidthBroadHz:
                opts.alphaBandwidthBroadHz ?? provisionalValue('alpha_bandwidth_broad'),
              dwellS: opts.alphaModeDwellS ?? provisionalValue('alpha_mode_dwell'),
              shape: {
                triangularity: scalarValue('alpha_shape_triangularity'),
                riseDecaySymmetry: scalarValue('alpha_shape_rdsym'),
              },
              rmsUv: componentRms,
            },
            fs,
          )
        : synthesizeOscillation(
            Rng.substream(seed, streamName),
            nSamples,
            {
              bandLo: lo,
              bandHi: hi,
              rmsUv: componentRms,
              envelopeDepth: DEFAULT_ENVELOPE_DEPTH,
              envelopeRateHz: DEFAULT_ENVELOPE_RATE_HZ,
            },
            fs,
          );

    // Mode 0 keeps the ORIGINAL substream name, so seam 4 holds: the modes added beside it do
    // not perturb the draws of anything that existed before them.
    const components = modesOf(spec.generator).map((gen, k) => ({
      gen,
      signal: makeSource(k === 0 ? `${spec.generator}/${state}`
                                 : `${spec.generator}/${state}/m${k}`, rmsUv),
    }));
    const lowBand = hi <= 8; // @lit-ok 8 Hz is the registered alpha-band lower edge
    const ampMod = lowBand ? ampModLow : ampModHigh;
    const bandRespDepth = lowBand ? respAmpModDepth : respAmpModDepthHigh;
    const bandRespPhi0 = lowBand
      ? scalarValue('periodic_mod_phi0_low')
      : scalarValue('periodic_mod_phi0_high');
    const targetInfraGains = infraGains.get(spec.generator as InfraSlowModulationTarget)?.gains;
    for (let component = 0; component < components.length; component++) {
      const { gen, signal } = components[component]!;
      if (sourceGain !== 1) {
        for (let i = 0; i < nSamples; i++) signal[i] = signal[i]! * sourceGain;
      }
      // Every represented canonical rhythm may be respiration-modulated. The old <=8 Hz
      // restriction was a filter-demo heuristic, not physiology: alpha and beta modulation are
      // both reported, and a high-pass correctly does not remove their sidebands.
      if (ampMod) {
        for (let i = 0; i < nSamples; i++) signal[i] = signal[i]! * ampMod[i]!;
      }
      const infraGain = targetInfraGains?.[component % targetInfraGains.length];
      if (infraGain) {
        for (let i = 0; i < nSamples; i++) signal[i] = signal[i]! * infraGain[i]!;
      }
      projectInto(out, signal, gen);
    }
    // Truth records the BAND's total rms, not each component's: the split is an internal
    // spatial model, and a sidecar reader wants to know how much rhythm was injected.
    oscTruth.push({
      generator: spec.generator,
      band: [lo, hi],
      rmsUv,
      respModDepth: ampMod ? bandRespDepth : 0,
      respModPhi0: ampMod ? bandRespPhi0 : 0,
    });
  }

  // Graphoelements. Injected as events; the waveform is derived from the list (seam 1).
  //
  // SYNTHESISED EVEN WHEN SUPPRESSED, and the draws are not skipped. G3's null needs the same
  // background with no spindles in it, and skipping the synthesis would also skip every RNG
  // draw it makes — so the background would differ from the gate's by more than the absence of
  // graphoelements, and the null would no longer be matched. Seam 4's substreams make the
  // suppression free: the cost is one wasted synthesis on a path only a gate takes.
  const grapho = synthesizeGraphoelements(seed, state, nSamples, fs, {
    ...(opts.slowOscRatePerMin !== undefined
      ? { slowOscRatePerMin: opts.slowOscRatePerMin }
      : {}),
    ...(opts.slowOscAmplitudePpUv !== undefined
      ? { slowOscAmplitudePpUv: opts.slowOscAmplitudePpUv }
      : {}),
    ...(opts.spindleFastFraction !== undefined
      ? { spindleFastFraction: opts.spindleFastFraction }
      : {}),
    respirationPhase: resp.phase,
    respiratoryEventCoupling: opts.eventRespirationCoupling !== false,
  });
  if (opts.suppressGraphoelements !== true) {
    for (let c = 0; c < nCh; c++) {
      const dst = out[c]!;
      const src = grapho.channels[c]!;
      for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + sourceGain * src[i]!;
    }
  }

  // eta_c: small INDEPENDENT sensor noise. The only per-channel term in the model.
  const sensorRms = pointFromUncertainty('sensor_noise_rms');
  for (let c = 0; c < nCh; c++) {
    const rng = Rng.substream(seed, `sensor_noise/${ALL_CHANNELS[c]}`);
    const dst = out[c]!;
    for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + rng.normal() * sensorRms;
  }

  // Mains interference (WP-J), off unless asked for.
  //
  // PER-CHANNEL PHASE AND GAIN, not one shared sine. Real pickup varies with electrode
  // impedance and lead routing, and a single identical sine on every channel would be removable
  // by any spatial filter -- which teaches the opposite of why line noise is a nuisance. Each
  // channel gets its own substream, so enabling this perturbs nothing else (seam 4).
  if (opts.lineNoise) {
    const lineHz = opts.lineFreqHz ?? (enumValue('line_freq')[0] as number);
    const amp = provisionalValue('line_noise_amp');
    const cv = provisionalValue('line_noise_gain_cv');
    const w = (2 * Math.PI * lineHz) / fs;
    for (let c = 0; c < nCh; c++) {
      const rng = Rng.substream(seed, `line_noise/${ALL_CHANNELS[c]}`);
      const phase = rng.uniform(0, 2 * Math.PI);
      const gain = Math.max(0, amp * (1 + cv * rng.normal()));
      const dst = out[c]!;
      for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + gain * Math.sin(w * i + phase);
    }
  }

  // Cardiac, driven by the SAME respiration phase the EEG mechanisms use, so respiratory sinus
  // arrhythmia in the ECG lines up with the belt above it rather than being an independent
  // rhythm that happens to have a similar rate.
  const cardiac = opts.cardiacOverride ?? synthesizeEcg(seed, state, resp, fs);
  if (cardiac.ecg.length !== nSamples) {
    throw new Error('compose: cardiacOverride must be sample-aligned to the requested record');
  }

  // ISF-5 recording drift is an OBSERVATION-LAYER term. It is added after every cortical source
  // and independent sensor noise, directly in channel space, and never enters `projectInto`.
  // The shared reference waveform is already present only on A1/A2 in the returned additions;
  // the ordinary reference operator later decides whether and how it reaches scalp derivations.
  const driftSpec = opts.recordingDriftFixture;
  if (driftSpec) {
    const drift = synthesizeRecordingDrift(seed, nSamples, driftSpec, fs);
    for (let c = 0; c < nCh; c++) {
      const dst = out[c]!;
      const artifact = drift.channels[c]!;
      for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + artifact[i]!;
    }
    if (infraTruth) {
      infraTruth = { ...infraTruth, electrodeDrift: drift.truth };
    } else {
      const isf1 = bandEdges('isf1_band');
      const isf2 = bandEdges('isf2_band');
      infraTruth = {
        fixture: true,
        profile: 'explicit_fixture',
        extrapolated: false,
        temporalModel: 'band_limited_power_law_state_space',
        bandsHz: { isf1: [isf1.lo, isf1.hi], isf2: [isf2.lo, isf2.hi] },
        sourceModes: [],
        modulation: [],
        electrodeDrift: drift.truth,
      };
    }
  }

  const breathDurations = resp.breaths.map((breath) => breath.durationSamples / fs);
  const breathDepths = resp.breaths.map((breath) => breath.depth);
  const ieRatios = resp.breaths.map((breath) => breath.exhaleSamples / breath.inhaleSamples);
  const inhalePauseFractions = resp.breaths.map(
    (breath) => breath.inhalePauseSamples / breath.durationSamples,
  );
  const exhalePauseFractions = resp.breaths.map(
    (breath) => breath.exhalePauseSamples / breath.durationSamples,
  );
  const rrPhases = cardiac.rPeaks.map((peak) =>
    resp.phase[Math.max(0, Math.min(nSamples - 1, Math.round(peak * fs)))]!,
  );
  const rsa = harmonicFit(cardiac.rrIntervalsS, rrPhases);
  const rrDifferences = cardiac.rrIntervalsS.slice(1).map(
    (value, i) => value - cardiac.rrIntervalsS[i]!,
  );

  return {
    channels: out,
    events: grapho.events,
    respirationBelt: resp.belt,
    respirationPhase: resp.phase,
    ecg: cardiac.ecg,
    rPeaks: cardiac.rPeaks,
    truth: {
      chi,
      knee,
      aperiodicComponents: n3FastShare > 0
        ? [
            { chi, knee, rmsFraction: 1 - n3FastShare },
            { chi: fastChi, knee: fastKnee, rmsFraction: n3FastShare },
          ]
        : [{ chi, knee, rmsFraction: 1 }],
      backgroundRmsUv: backgroundRms,
      oscillations: oscTruth,
      sensorNoiseRmsUv: sensorRms,
      snrDb,
      chiModDepth,
      chiModPhi0,
      chiSpatialLoading,
      respArtifactAmpUv,
      respAmpModDepth,
      respAmpModDepthHigh,
      respFreqHz: resp.meanRatePerMin / 60, // @lit-ok seconds per minute
      respEventCoupling: {
        enabled: opts.eventRespirationCoupling !== false && (state === 'n2' || state === 'n3'),
        soPreferredPhase: scalarValue('resp_so_pref_phase'),
        soHazardKappa: scalarValue('resp_so_hazard_kappa'),
        fastSpindlePreferredPhase: scalarValue('resp_spindle_fast_pref_phase'),
        fastSpindleHazardKappa: scalarValue('resp_spindle_fast_hazard_kappa'),
        // The registered negative result is represented by absence, not a hidden near-zero row.
        slowSpindleHazardKappa: 0,
      },
      independentChiModFreq: opts.independentChiModFreq ?? null,
      graphoelementGenerators: grapho.generators,
      meanHrBpm: cardiac.meanHrBpm,
      rrSdnnTargetMs: cardiac.targetSdnnS * 1000, // @lit-ok milliseconds per second
      rsaAmplitudeMs: cardiac.rsaAmplitudeS * 1000, // @lit-ok milliseconds per second
      respiration: {
        mode: opts.respirationMode === 'regular' || fixedRespRate !== undefined ? 'regular' : 'natural',
        meanRatePerMin: resp.meanRatePerMin,
        periodCv: coefficientOfVariation(breathDurations),
        periodLag1: lagOneCorrelation(breathDurations),
        depthCv: coefficientOfVariation(breathDepths),
        meanIeRatio: mean(ieRatios),
        inhalePauseFraction: mean(inhalePauseFractions),
        exhalePauseFraction: mean(exhalePauseFractions),
        breaths: resp.breaths.map((breath) => ({
          onsetS: breath.onsetS,
          durationS: breath.durationSamples / fs,
          inhaleS: breath.inhaleSamples / fs,
          inhalePauseS: breath.inhalePauseSamples / fs,
          exhaleS: breath.exhaleSamples / fs,
          exhalePauseS: breath.exhalePauseSamples / fs,
          startDepth: breath.startDepth,
          depth: breath.depth,
        })),
      },
      cardiac: {
        rPeaksS: cardiac.rPeaks,
        rrIntervalsS: cardiac.rrIntervalsS,
        meanHrBpm: cardiac.meanHrBpm,
        sdnnMs: populationSd(cardiac.rrIntervalsS) === null
          ? null
          : populationSd(cardiac.rrIntervalsS)! * 1000, // @lit-ok milliseconds per second
        rmssdMs: rrDifferences.length === 0
          ? null
          : Math.sqrt(rrDifferences.reduce((sum, value) => sum + value * value, 0) / rrDifferences.length) * 1000, // @lit-ok milliseconds per second
        requestedRsaAmplitudeMs: cardiac.rsaAmplitudeS * 1000, // @lit-ok milliseconds per second
        recoveredRsaAmplitudeMs: rsa.amplitude === null ? null : rsa.amplitude * 1000, // @lit-ok milliseconds per second
        recoveredRsaR2: rsa.r2,
      },
      eventPhaseSummaries: (['slow_oscillation', 'spindle_fast', 'spindle_slow'] as const)
        .map((type) => circularSummary(grapho.events, type)),
      ...(infraTruth ? { infraSlow: infraTruth } : {}),
    },
  };
}
