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
import { provisionalValue, scalarValue, uncertainty, bandEdges } from '../registry.ts';
import { synthesizeAperiodic } from './aperiodic.ts';
import {
  synthesizeOscillation,
  synthesizeDampedOscillator,
  DEFAULT_ENVELOPE_DEPTH,
  DEFAULT_ENVELOPE_RATE_HZ,
} from './oscillations.ts';
import { ALL_CHANNELS, projectInto, type GeneratorId } from './projection.ts';
import { synthesizeGraphoelements } from './graphoelements.ts';
import { synthesizeRespiration, chiModulation, phaseRamp } from './respiration.ts';
import { applyTimeVaryingTilt } from '../filters/tilt.ts';
import type { GeneratedEvent } from '../types/event.ts';

/** Which oscillations each state carries, and which registry rows describe them. */
interface OscSpec {
  generator: GeneratorId;
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
 * Optional overrides. Every field is off or absent by default, so the shipped generator
 * behaves identically whether or not a caller passes this.
 */
export interface ComposeOptions {
  /** Enable respiration-phase modulation of the aperiodic exponent (Build Plan 5.1c). */
  readonly chiModulation?: boolean;
  /** Override chi_mod_depth. */
  readonly chiModDepth?: number;
  /** Pin the respiration rate, in breaths per minute. Used by the G4 fixture to fix f2. */
  readonly respRatePerMin?: number;
  /**
   * Drive chi from an INDEPENDENT modulator at this frequency instead of from respiration.
   *
   * Exists solely for G4, which must modulate chi at f1 while respiration runs at f2. Build
   * Plan 5.2 defines chi(t) as driven by respiration, so this capability appears nowhere in
   * the shipped UI -- it is how the gate separates the injected effect from the confound.
   */
  readonly independentChiModFreq?: number;
  /** Coefficient-update scheme for the tilt filter. See src/core/filters/tilt.ts. */
  readonly tiltScheme?: 'blockwise' | 'filterbank';
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
  /** Ground truth actually injected, for the epoch sidecar. */
  readonly truth: {
    chi: number;
    knee: number;
    backgroundRmsUv: number;
    oscillations: { generator: string; band: [number, number]; rmsUv: number }[];
    sensorNoiseRmsUv: number;
    snrDb: number;
    chiModDepth: number;
    chiModPhi0: number;
    respFreqHz: number;
    independentChiModFreq: number | null;
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

export function composeState(
  seed: number,
  state: StateId,
  nSamples: number,
  fs = scalarValue('fs'),
  opts: ComposeOptions = {},
): ComposeResult {
  const nCh = ALL_CHANNELS.length;
  const out: Float64Array[] = Array.from({ length: nCh }, () => new Float64Array(nSamples));

  const backgroundRms = pointFromUncertainty('background_rms_uv');
  const chi = provisionalValue(`chi_${state}` as Parameters<typeof provisionalValue>[0]);
  const knee = provisionalValue(`k_${state}` as Parameters<typeof provisionalValue>[0]);

  // Respiration. Generated even when the coupling is off, because the belt is an exported
  // channel in its own right and G4 needs its phase as ground truth.
  const resp = synthesizeRespiration(
    Rng.substream(seed, `respiration/${state}`),
    nSamples,
    state,
    fs,
    opts.respRatePerMin,
  );

  // Aperiodic background: one shared source, uniform scalp weighting.
  let background = synthesizeAperiodic(
    Rng.substream(seed, `background/${state}`),
    nSamples,
    { chi, k: knee, rmsUv: backgroundRms },
    fs,
  );

  // Respiration-phase modulation of the aperiodic exponent (§5.2 mechanism c) — "the
  // best-supported scalp-visible effect and the one the filter demo depends on".
  //
  // Generated at constant chi and then tilted, rather than by regenerating per sample: the
  // tilt filter is the mechanism the demonstration is about, and synthesizing chi(t) directly
  // would produce coupling that no filter could then lose.
  let chiModDepth = 0;
  let chiModPhi0 = 0;
  if (opts.chiModulation) {
    const independent =
      opts.independentChiModFreq !== undefined
        ? phaseRamp(nSamples, opts.independentChiModFreq, fs)
        : undefined;
    const chiT = chiModulation(resp.phase, chi, state, opts.chiModDepth, independent);
    const deltaChi = new Float64Array(nSamples);
    // The filter applies the DEVIATION from the generated exponent.
    for (let i = 0; i < nSamples; i++) deltaChi[i] = chi - chiT[i]!;
    background = applyTimeVaryingTilt(background, deltaChi, fs,
      opts.tiltScheme ? { scheme: opts.tiltScheme } : {});
    chiModDepth = opts.chiModDepth ?? provisionalValue('chi_mod_depth');
    const wakeLike = state === 'wake_eo' || state === 'wake_ec' || state === 'n1';
    chiModPhi0 = provisionalValue(wakeLike ? 'chi_mod_phi0_wake' : 'chi_mod_phi0_sleep');
  }

  projectInto(out, background, 'background');

  // Seam 5: the mix is explicit. Background is the reference and is never scaled.
  const snrDb = opts.snrDb ?? 0;
  const sourceGain = Math.pow(10, snrDb / 20);

  const oscTruth: ComposeResult['truth']['oscillations'] = [];
  for (const spec of STATE_OSCILLATIONS[state]) {
    const { lo, hi } = bandEdges(spec.bandKey);
    const rmsUv = rmsFromPeakToPeak(spec.ampKey);
    // ALPHA IS MODELLED DIFFERENTLY FROM THE OTHERS, deliberately.
    //
    // Alpha is a genuine resonance — it stands out as a peak above the aperiodic background
    // in a way most band-limited EEG activity does not — so it is generated as a damped
    // stochastic oscillator with bistable damping (DECISIONS D13). Beta and theta keep the
    // filtered-noise form: they are broader, weaker and far less clearly resonant, and there
    // is no fitted damping for them. Giving them alpha's mechanism would assert a resonance
    // nobody has measured.
    // TODO(T1-M1): fit damping per rhythm and decide which, if any, of the others resonate.
    const s =
      spec.generator === 'alpha'
        ? synthesizeDampedOscillator(
            Rng.substream(seed, `${spec.generator}/${state}`),
            nSamples,
            {
              f0: scalarValue('alpha_peak'),
              bandwidthSharpHz: scalarValue('alpha_bandwidth_sharp'),
              bandwidthBroadHz: scalarValue('alpha_bandwidth_broad'),
              dwellS: scalarValue('alpha_mode_dwell'),
              shape: {
                triangularity: scalarValue('alpha_shape_triangularity'),
                riseDecaySymmetry: scalarValue('alpha_shape_rdsym'),
              },
              rmsUv,
            },
            fs,
          )
        : synthesizeOscillation(
            Rng.substream(seed, `${spec.generator}/${state}`),
            nSamples,
            {
              bandLo: lo,
              bandHi: hi,
              rmsUv,
              envelopeDepth: DEFAULT_ENVELOPE_DEPTH,
              envelopeRateHz: DEFAULT_ENVELOPE_RATE_HZ,
            },
            fs,
          );
    if (sourceGain !== 1) for (let i = 0; i < nSamples; i++) s[i] = s[i]! * sourceGain;
    projectInto(out, s, spec.generator);
    oscTruth.push({ generator: spec.generator, band: [lo, hi], rmsUv });
  }

  // Graphoelements. Injected as events; the waveform is derived from the list (seam 1).
  const grapho = synthesizeGraphoelements(seed, state, nSamples, fs);
  for (let c = 0; c < nCh; c++) {
    const dst = out[c]!;
    const src = grapho.channels[c]!;
    for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + sourceGain * src[i]!;
  }

  // eta_c: small INDEPENDENT sensor noise. The only per-channel term in the model.
  const sensorRms = pointFromUncertainty('sensor_noise_rms');
  for (let c = 0; c < nCh; c++) {
    const rng = Rng.substream(seed, `sensor_noise/${ALL_CHANNELS[c]}`);
    const dst = out[c]!;
    for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + rng.normal() * sensorRms;
  }

  return {
    channels: out,
    events: grapho.events,
    respirationBelt: resp.belt,
    respirationPhase: resp.phase,
    truth: {
      chi,
      knee,
      backgroundRmsUv: backgroundRms,
      oscillations: oscTruth,
      sensorNoiseRmsUv: sensorRms,
      snrDb,
      chiModDepth,
      chiModPhi0,
      respFreqHz: resp.meanRatePerMin / 60,
      independentChiModFreq: opts.independentChiModFreq ?? null,
    },
  };
}
