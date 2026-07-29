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
import { CHANNELS, projectInto, type GeneratorId } from './projection.ts';

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


export interface ComposeResult {
  /** [channel][sample], microvolts. */
  readonly channels: Float64Array[];
  /** Ground truth actually injected, for the epoch sidecar. */
  readonly truth: {
    chi: number;
    knee: number;
    backgroundRmsUv: number;
    oscillations: { generator: string; band: [number, number]; rmsUv: number }[];
    sensorNoiseRmsUv: number;
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
): ComposeResult {
  const nCh = CHANNELS.length;
  const out: Float64Array[] = Array.from({ length: nCh }, () => new Float64Array(nSamples));

  const backgroundRms = pointFromUncertainty('background_rms_uv');
  const chi = provisionalValue(`chi_${state}` as Parameters<typeof provisionalValue>[0]);
  const knee = provisionalValue(`k_${state}` as Parameters<typeof provisionalValue>[0]);

  // Aperiodic background: one shared source, uniform scalp weighting.
  const background = synthesizeAperiodic(
    Rng.substream(seed, `background/${state}`),
    nSamples,
    { chi, k: knee, rmsUv: backgroundRms },
    fs,
  );
  projectInto(out, background, 'background');

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
    projectInto(out, s, spec.generator);
    oscTruth.push({ generator: spec.generator, band: [lo, hi], rmsUv });
  }

  // eta_c: small INDEPENDENT sensor noise. The only per-channel term in the model.
  const sensorRms = pointFromUncertainty('sensor_noise_rms');
  for (let c = 0; c < nCh; c++) {
    const rng = Rng.substream(seed, `sensor_noise/${CHANNELS[c]}`);
    const dst = out[c]!;
    for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + rng.normal() * sensorRms;
  }

  return {
    channels: out,
    truth: {
      chi,
      knee,
      backgroundRmsUv: backgroundRms,
      oscillations: oscTruth,
      sensorNoiseRmsUv: sensorRms,
    },
  };
}
