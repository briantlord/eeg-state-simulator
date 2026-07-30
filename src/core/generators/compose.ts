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
} from './oscillations.ts';
import {
  ALL_CHANNELS,
  projectInto,
  modesOf,
  type GeneratorId,
  type PatchId,
} from './projection.ts';
import { synthesizeGraphoelements } from './graphoelements.ts';
import { synthesizeEcg } from './cardiac.ts';
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
    /** Achieved mean heart rate, for the sidecar. */
    meanHrBpm: number;
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
    respAmpModDepth = opts.respAmpModDepth ?? provisionalValue('resp_amp_mod_depth');
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
    synthesizeAperiodic(
      Rng.substream(seed, `background_${i}/${state}`),
      nSamples,
      { chi, k: knee, rmsUv: backgroundRms },
      fs,
    ),
  );

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
    projectInto(out, bgSources[i]!, bgModes[i]!);
  }

  // Added AFTER the tilt so it is not itself tilted: it is not cortical activity and has no
  // reason to follow a respiration-driven exponent.
  if (localShare > 0) {
    for (let c = 0; c < nCh; c++) {
      const local = synthesizeAperiodic(
        Rng.substream(seed, `channel_local/${state}/${ALL_CHANNELS[c]!}`),
        nSamples,
        { chi, k: knee, rmsUv: localRms },
        fs,
      );
      const dst = out[c]!;
      for (let i = 0; i < nSamples; i++) dst[i] = dst[i]! + local[i]!;
    }
  }

  // Seam 5: the mix is explicit. Background is the reference and is never scaled.
  const snrDb = opts.snrDb ?? 0;
  const sourceGain = Math.pow(10, snrDb / 20); // @lit-ok dB-to-linear: 10^(dB/20) is the definition of decibels

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
    const makeSource = (streamName: string, componentRms: number): Float64Array =>
      spec.generator === 'alpha'
        ? synthesizeDampedOscillator(
            Rng.substream(seed, streamName),
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
    for (const { gen, signal } of components) {
      if (sourceGain !== 1) {
        for (let i = 0; i < nSamples; i++) signal[i] = signal[i]! * sourceGain;
      }
      // Applied only to bands the high-pass can reach. Modulating alpha's envelope would
      // put sidebands at 10 +/- 0.25 Hz, which no clinical high-pass removes -- so it would
      // reproduce exactly the flatness Finding 10 diagnosed.
      if (ampMod && hi <= 8) { // @lit-ok 8 Hz = alpha floor; amplitude modulation applies only to sub-alpha bands a clinical high-pass reaches (Finding 10)
        for (let i = 0; i < nSamples; i++) signal[i] = signal[i]! * ampMod[i]!;
      }
      projectInto(out, signal, gen);
    }
    // Truth records the BAND's total rms, not each component's: the split is an internal
    // spatial model, and a sidecar reader wants to know how much rhythm was injected.
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
  const cardiac = synthesizeEcg(seed, nSamples, resp.phase, fs);

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
      meanHrBpm: cardiac.meanHrBpm,
    },
  };
}
