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
import {
  synthesizeRespiration,
  chiModulation,
  phaseRamp,
  respiratoryArtifact,
  amplitudeModulation,
} from './respiration.ts';
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
  /**
   * The three respiratory mechanisms of Build Plan 5.1, switched SEPARATELY.
   *
   * They have "different origins, different topographies, different implications.
   * Conflating them is the standard error in this literature." A single `respiration:
   * true` flag would be that error in an API.
   *
   *   movementArtifact - (a) mechanical, AT the respiratory rate. A high-pass removes it.
   *   amplitudeModulation - (c) amplitude half. Modulates low-frequency envelope, so a
   *                         high-pass attenuates the measurable coupling with cutoff.
   *   chiModulation - (c) exponent half. Lives above the stopband; survives any clinical
   *                   filter, which is why it alone could not drive the filter demo.
   */
  readonly movementArtifact?: boolean;
  readonly amplitudeModulation?: boolean;
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
    respArtifactAmpUv: number;
    respAmpModDepth: number;
    respFreqHz: number;
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

  // Mechanism (a): the movement artifact. Its own generator, its own topography.
  let respArtifactAmpUv = 0;
  if (opts.movementArtifact) {
    respArtifactAmpUv = pointFromUncertainty('resp_artifact_amp');
    projectInto(out, respiratoryArtifact(resp.belt, respArtifactAmpUv), 'resp_artifact');
  }

  // Mechanism (c), amplitude half: the multiplier applied to low-frequency oscillations.
  let respAmpModDepth = 0;
  let ampMod: Float64Array | null = null;
  if (opts.amplitudeModulation) {
    respAmpModDepth = provisionalValue('resp_amp_mod_depth');
    const wakeLikeAmp = state === 'wake_eo' || state === 'wake_ec' || state === 'n1';
    ampMod = amplitudeModulation(
      resp.phase,
      respAmpModDepth,
      provisionalValue(wakeLikeAmp ? 'chi_mod_phi0_wake' : 'chi_mod_phi0_sleep'),
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
  const nBg = scalarValue('background_n_sources');
  const bgSources: Float64Array[] = [];
  for (let i = 0; i < nBg; i++) {
    bgSources.push(
      synthesizeAperiodic(
        Rng.substream(seed, `background_${i}/${state}`),
        nSamples,
        { chi, k: knee, rmsUv: backgroundRms / Math.sqrt(nBg) },
        fs,
      ),
    );
  }

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
    for (let i = 0; i < bgSources.length; i++) {
      bgSources[i] = applyTimeVaryingTilt(bgSources[i]!, deltaChi, fs, {
        ...(opts.tiltScheme ? { scheme: opts.tiltScheme } : {}),
        // The block length is a REGISTRY VALUE, not the filter's own default. It sets how much
        // of a chi modulation survives generation at all (Finding 15): a block holds chi
        // constant, so a hold of length B attenuates a modulation at f by roughly |sinc(fB)|
        // BEFORE any estimator sees it. `tilt_block_s` carries the derivation.
        blockSamples: Math.round((opts.tiltBlockS ?? scalarValue('tilt_block_s')) * fs),
      });
    }
    chiModDepth = opts.chiModDepth ?? provisionalValue('chi_mod_depth');
    const wakeLike = state === 'wake_eo' || state === 'wake_ec' || state === 'n1';
    chiModPhi0 = provisionalValue(wakeLike ? 'chi_mod_phi0_wake' : 'chi_mod_phi0_sleep');
  }

  for (let i = 0; i < bgSources.length; i++) {
    projectInto(out, bgSources[i]!, `background_${i}` as GeneratorId);
  }

  // Seam 5: the mix is explicit. Background is the reference and is never scaled.
  const snrDb = opts.snrDb ?? 0;
  const sourceGain = Math.pow(10, snrDb / 20); // @lit-ok dB-to-linear: 10^(dB/20) is the definition of decibels

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
    // Applied only to bands the high-pass can reach. Modulating alpha's envelope would
    // put sidebands at 10 +/- 0.25 Hz, which no clinical high-pass removes -- so it would
    // reproduce exactly the flatness Finding 10 diagnosed.
    if (ampMod && hi <= 8) { // @lit-ok 8 Hz = alpha floor; amplitude modulation applies only to sub-alpha bands a clinical high-pass reaches (Finding 10)
      for (let i = 0; i < nSamples; i++) s[i] = s[i]! * ampMod[i]!;
    }
    projectInto(out, s, spec.generator);
    oscTruth.push({ generator: spec.generator, band: [lo, hi], rmsUv });
  }

  // Graphoelements. Injected as events; the waveform is derived from the list (seam 1).
  //
  // SYNTHESISED EVEN WHEN SUPPRESSED, and the draws are not skipped. G3's null needs the same
  // background with no spindles in it, and skipping the synthesis would also skip every RNG
  // draw it makes — so the background would differ from the gate's by more than the absence of
  // graphoelements, and the null would no longer be matched. Seam 4's substreams make the
  // suppression free: the cost is one wasted synthesis on a path only a gate takes.
  const grapho = synthesizeGraphoelements(seed, state, nSamples, fs);
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
      respArtifactAmpUv,
      respAmpModDepth,
      respFreqHz: resp.meanRatePerMin / 60, // @lit-ok seconds per minute
      independentChiModFreq: opts.independentChiModFreq ?? null,
      graphoelementGenerators: grapho.generators,
    },
  };
}
