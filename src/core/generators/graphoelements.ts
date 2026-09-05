/**
 * Graphoelements: spindles, K-complexes and slow oscillations (Build Plan §4).
 *
 * "This is what separates a credible simulator from plausible-looking noise. N2 without
 * spindles and K-complexes is not N2, and no amount of spectral fidelity substitutes."
 *
 * Each is an injected event carrying a morphology template, rate, jitter, topography and an
 * INCLUSION TAG (seam 1). The event list is the primary output; the waveform is derived
 * from it.
 *
 * POLARITY. Every morphology here is written in STANDARD polarity — positive numbers are
 * positive volts. The clinical "negative up" convention is a DISPLAY transform and is applied
 * exactly once, at render time. Applying it here as well would invert twice and silently
 * restore the wrong sign, which is the fastest way to lose a clinical reader.
 */
import { Rng } from '../rng/xoshiro128pp.ts';
import type { StateId } from '../types/state.ts';
import type { GeneratedEvent, EventType } from '../types/event.ts';
import { scalarValue, uncertainty, provisionalValue, bandEdges, boundValue } from '../registry.ts';
import {
  ALL_CHANNELS,
  ALL_POSITIONS,
  argmaxChannel,
  weightsFor,
  type GeneratorId,
  modesOf,
  type PatchId,
} from './projection.ts';

/** Draw uniformly from an `uncertainty` interval. */
function draw(rng: Rng, key: Parameters<typeof uncertainty>[0]): number {
  const { lo, hi } = uncertainty(key);
  return rng.uniform(lo, hi);
}

/**
 * A scheduled event before its waveform exists: when, how long, how prominent.
 * Kept separate from the waveform so seam 1 holds — the list is primary.
 */
export interface ScheduledEvent {
  type: EventType;
  generator: GeneratorId;
  onset: number;
  duration: number;
  amplitude: number;
  inclusionTag: number;
  params: Record<string, number>;
}

/**
 * Poisson-scheduled event onsets over `durationS`, at `ratePerMin`.
 *
 * Poisson rather than regular spacing: evenly spaced graphoelements read as synthetic
 * immediately, and the inter-event interval is what a detector's false-positive analysis
 * looks at.
 */
function scheduleOnsets(rng: Rng, durationS: number, ratePerMin: number): number[] {
  const meanGap = 60 / ratePerMin; // @lit-ok seconds per minute
  const out: number[] = [];
  let t = rng.exponential(1 / meanGap);
  while (t < durationS) {
    out.push(t);
    t += rng.exponential(1 / meanGap);
  }
  return out;
}

/** Respiratory phase at a continuous event marker time. */
function phaseAt(phase: Float64Array, timeS: number, fs: number): number {
  const i = Math.max(0, Math.min(phase.length - 1, Math.round(timeS * fs)));
  return phase[i] ?? 0;
}

const PHASE_BUCKET_COUNT = 360; // @lit-ok one-degree phase index; numerical resolution, not physiology

interface RespiratoryPhaseIndex {
  readonly buckets: readonly number[][];
}

function phaseBucket(phase: number): number {
  const wrapped = Math.atan2(Math.sin(phase), Math.cos(phase));
  return Math.max(
    0,
    Math.min(
      PHASE_BUCKET_COUNT - 1,
      Math.floor(((wrapped + Math.PI) / (2 * Math.PI)) * PHASE_BUCKET_COUNT),
    ),
  );
}

function indexRespiratoryPhase(phase: Float64Array): RespiratoryPhaseIndex {
  const buckets = Array.from({ length: PHASE_BUCKET_COUNT }, () => [] as number[]);
  for (let i = 0; i < phase.length; i++) buckets[phaseBucket(phase[i]!)!]!.push(i);
  return { buckets };
}

/** Draw a phase from a von Mises density by uniform-envelope rejection sampling. */
function drawVonMisesPhase(rng: Rng, preferredPhase: number, kappa: number): number {
  for (;;) {
    const phase = rng.uniform(-Math.PI, Math.PI);
    const accept = Math.exp(kappa * (Math.cos(phase - preferredPhase) - 1));
    if (rng.nextFloat() <= accept) return phase;
  }
}

/**
 * Draw a marker time from a von Mises PHASE distribution without changing event count.
 *
 * The respiratory phase is not uniform in clock time because inspiration, expiration and their
 * pauses have different durations. Drawing time from a weighted clock-time hazard therefore
 * shifts the circular mean when I:E changes. This index first draws the requested phase, then
 * chooses uniformly among the record samples carrying it. Morphology sets WHEN that phase occurs
 * but cannot silently change WHICH phase the event distribution targets.
 */
function drawRespiratoryMarkerTime(
  rng: Rng,
  phaseIndex: RespiratoryPhaseIndex,
  fs: number,
  earliestS: number,
  preferredPhase: number,
  kappa: number,
): number | null {
  const earliestSample = Math.ceil(earliestS * fs);
  if (!phaseIndex.buckets.some((bucket) => bucket.some((i) => i >= earliestSample))) return null;
  for (let attempt = 0; attempt < 10000; attempt++) { // @lit-ok numerical rejection-sampling safety bound
    const target = drawVonMisesPhase(rng, preferredPhase, kappa);
    const samples = phaseIndex.buckets[phaseBucket(target)]!;
    if (samples.length === 0) continue;
    const sample = samples[Math.floor(rng.nextFloat() * samples.length)]!;
    const time = sample / fs;
    if (time >= earliestS) return time;
  }
  // Sparse phase support in a short record can exhaust rejection sampling. Sample the feasible
  // phase bins directly, weighted by their von Mises density (not their dwell time).
  const candidates = phaseIndex.buckets.map((bucket, index) => ({
    samples: bucket.filter((sample) => sample >= earliestSample),
    weight: Math.exp(kappa * (Math.cos(-Math.PI + (index + 0.5) * 2 * Math.PI /
      PHASE_BUCKET_COUNT - preferredPhase) - 1)),
  })).filter((bucket) => bucket.samples.length > 0);
  let choice = rng.nextFloat() * candidates.reduce((sum, bucket) => sum + bucket.weight, 0);
  for (const bucket of candidates) {
    choice -= bucket.weight;
    if (choice <= 0) return bucket.samples[Math.floor(rng.nextFloat() * bucket.samples.length)]! / fs;
  }
  return candidates[candidates.length - 1]!.samples[0]! / fs;
}

/** Preserve the historical draws without claiming this random tag describes morphology. */
function drawInclusionTag(rng: Rng): number {
  return (rng.nextFloat() + rng.nextFloat()) / 2;
}

// ---------------------------------------------------------------------- spindle

/**
 * A sleep spindle: a waxing-and-waning 11-16 Hz burst.
 *
 * The carrier is a coherent near-sinusoid with a small random-walk phase perturbation, NOT
 * bandpass-filtered noise. That is deliberate and it is the lesson from the alpha work: a
 * filtered-noise carrier in an 11-16 Hz band has an intrinsic beat of ~1/B = 0.2 s, so an
 * injected 0.8 s spindle is fragmented into ~0.2 s runs by any detector that thresholds an
 * envelope. `spindle_dur_min` = 0.5 s is a DEFINITIONAL AASM criterion and G3 runs YASA
 * against this list, so that fragmentation would fail the gate for a reason that has nothing
 * to do with spindle morphology — while looking exactly like a morphology problem.
 *
 * Real spindles are quite sinusoidal within the event; the phase perturbation supplies the
 * cycle-to-cycle irregularity without dissolving the burst.
 */
function spindleWaveform(
  rng: Rng,
  n: number,
  fs: number,
  freqHz: number,
  amplitudeUv: number,
): Float64Array {
  const out = new Float64Array(n);
  let phase = rng.uniform(0, 2 * Math.PI);
  const dPhase = (2 * Math.PI * freqHz) / fs;
  // Small per-sample frequency jitter, integrated: gives cycle-to-cycle irregularity without
  // letting the frequency wander out of band over the event.
  const jitter = 0.004; // @lit-ok invented spindle cycle-to-cycle frequency jitter; TODO(T1-M1) register+fit
  for (let i = 0; i < n; i++) {
    phase += dPhase * (1 + jitter * rng.normal());
    // Symmetric waxing/waning: a raised cosine over the whole event.
    const env = 0.5 * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / n));
    out[i] = amplitudeUv * env * Math.sin(phase);
  }
  return out;
}

// -------------------------------------------------------------------- K-complex

/**
 * A K-complex: a sharp negative deflection followed by a slower positive component.
 *
 * Modelled as a difference of Gaussians — the standard parametric form. The negative
 * component is earlier, larger and narrower; the positive one is later, smaller and broader.
 * Standard polarity, so the sharp component is NEGATIVE here and will render upward.
 */
function kComplexWaveform(
  n: number,
  fs: number,
  amplitudePp: number,
  sharpWidthS: number,
  slowWidthS: number,
  slowRatio: number,
): Float64Array {
  const out = new Float64Array(n);
  const tSharp = 0.3 * (n / fs); // @lit-ok invented KC sharp-peak position (fraction of window); TODO(T1-M1) register+fit
  const tSlow = 0.55 * (n / fs); // @lit-ok invented KC slow-peak position (fraction of window); TODO(T1-M1) register+fit
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const neg = -Math.exp(-(((t - tSharp) / sharpWidthS) ** 2));
    const pos = slowRatio * Math.exp(-(((t - tSlow) / slowWidthS) ** 2));
    out[i] = amplitudePp * (neg + pos);
  }
  return out;
}

// ------------------------------------------------------------- slow oscillation

/**
 * A slow oscillation: one cycle below 1 Hz, large amplitude.
 *
 * Non-sinusoidal by construction — real slow oscillations have a sharper down-state than
 * up-state, and PAC estimation is emphatically sensitive to that (Build Plan §4.1 notes the
 * slow oscillation "is emphatically non-sinusoidal"). The same rise-decay warp used for alpha
 * is applied here.
 */
function slowOscWaveform(
  n: number,
  amplitudePp: number,
  riseDecaySymmetry: number,
): Float64Array {
  const out = new Float64Array(n);
  const r = Math.max(0.05, Math.min(0.95, riseDecaySymmetry)); // @lit-ok clamp keeping the rise-decay symmetry off its degenerate endpoints
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const w = u <= r ? u / (2 * r) : 0.5 + (u - r) / (2 * (1 - r));
    // STARTS AND ENDS AT A ZERO CROSSING. This was `cos(2*PI*(w - 0.5))`, which is -cos(2*PI*w)
    // and therefore -1 at BOTH ends: every slow oscillation began and ended with a
    // full-amplitude step, 50-100 uV at so_amp, injected into every channel simultaneously
    // through the projection. On screen that is a hard vertical jump at each event boundary in
    // all 19 traces at once, which is what it looked like.
    //
    // -sin keeps standard polarity (the down-state comes first, negative) and keeps the
    // rise-decay warp, which acts through `w`. The endpoints now have a slope discontinuity
    // rather than a step -- a kink of order amplitude*2*PI/duration, ~2.5 uV per sample for a
    // 100 uV cycle over 1 s, which sits under the background's own sample-to-sample variation.
    out[i] = -amplitudePp * Math.sin(2 * Math.PI * w);
  }
  return out;
}

// ------------------------------------------------------------------- scheduling

export interface GraphoelementResult {
  /** [channel][sample], microvolts — graphoelements only, to be added to the mix. */
  channels: Float64Array[];
  /** The event list. Primary output; the waveform above is derived from it. */
  events: GeneratedEvent[];
  /**
   * The projection generators this run actually used.
   *
   * REPORTED RATHER THAN DERIVABLE FROM `events`, because event type and generator id are not
   * the same vocabulary and only this module knows the mapping: a `kcomplex` event projects
   * through `kc`, and a `slow_oscillation` through `delta`. The epoch sidecar records the
   * weights actually applied, and reconstructing that list from event types outside this file
   * would be a second copy of a mapping that is free to change here.
   */
  generators: GeneratorId[];
}

export interface GraphoelementOptions {
  /** Characterization override for the N3 slow-oscillation scheduler. */
  readonly slowOscRatePerMin?: number;
  /** Characterization override for slow-oscillation peak-to-peak amplitude. */
  readonly slowOscAmplitudePpUv?: number;
  /** Characterization override for the fraction drawn from the fast spindle system. */
  readonly spindleFastFraction?: number;
  /** Sample-aligned analytic respiratory phase; never estimated from the belt. */
  readonly respirationPhase?: Float64Array;
  /** Apply the R4 event hazards. False supplies the matched mechanism-off arm. */
  readonly respiratoryEventCoupling?: boolean;
}

/**
 * Generate every graphoelement for a state and project it to channels.
 *
 * SO–SPINDLE COUPLING is injected here: in N3 FAST-spindle envelope peaks are placed around
 * actual slow-oscillation up-states. Slow spindles remain independent because they are R4's
 * registered respiratory negative-control path. §4.1 requires explicit co-occurrence because
 * "sparse co-occurrence is a documented source of spurious coupling estimates".
 */
export function synthesizeGraphoelements(
  seed: number,
  state: StateId,
  nSamples: number,
  fs: number,
  opts: GraphoelementOptions = {},
): GraphoelementResult {
  const durationS = nSamples / fs;
  const nCh = ALL_CHANNELS.length;
  const channels: Float64Array[] = Array.from({ length: nCh }, () => new Float64Array(nSamples));
  const events: GeneratedEvent[] = [];
  const used = new Set<GeneratorId>();
  const respiratoryPhase = opts.respirationPhase;
  if (respiratoryPhase && respiratoryPhase.length !== nSamples) {
    throw new Error('graphoelements: respirationPhase must match nSamples');
  }
  const respiratoryEventCoupling = opts.respiratoryEventCoupling === true && respiratoryPhase !== undefined;
  const respiratoryPhaseIndex = respiratoryPhase ? indexRespiratoryPhase(respiratoryPhase) : null;

  /**
   * A per-event topography, drawn from its patch's spatial distribution.
   *
   * EVERY SLOW WAVE USED TO HAVE THE SAME TOPOGRAPHY, and in N3 that is most of the signal --
   * visible at a 5 s window as one large wave repeated in all 19 lanes, and worth 0.21 of
   * effective rank. The first fix picked one of six invented ring positions per event.
   *
   * With the patch model it needs no invented positions at all. A patch's channel covariance is
   * sum_m w_m w_m^T over its eigenmodes, so drawing c_m ~ N(0,1) and forming sum_m c_m w_m is a
   * sample FROM THAT COVARIANCE: an anatomically admissible field for that patch, different every
   * time. "Slow waves have variable origins" stops being a parameter and becomes a consequence of
   * the patch having spatial extent.
   *
   * Normalised to unit peak so `<event>_amp` keeps meaning as peak-to-peak at the event's
   * strongest electrode, and SIGN-PINNED at the patch's dominant channel -- a K-complex has a
   * defined polarity, and an unpinned Gaussian draw would invert half of them.
   */
  const eventSpread = provisionalValue('event_topography_spread');
  const drawTopography = (rng: Rng, patch: PatchId): number[] => {
    const ids = modesOf(patch);
    const w = new Array<number>(nCh).fill(0);
    for (let m = 0; m < ids.length; m++) {
      // MODE 0 AT FULL STRENGTH, higher modes admixed. A full N(0,1) draw over every mode is the
      // exact sample from the patch covariance and was tried first: it varies each event's
      // amplitude at any fixed electrode so much that G5's positive arm fell from 0.75 to 0.33 of
      // held-out epochs. Real N3 meets the AASM criterion by definition, so that draw made N3
      // less like N3. Keeping the dominant mode fixed means every event is recognisably the
      // patch's field and they still differ.
      const c = m === 0 ? 1 : eventSpread * rng.normal();
      const wm = weightsFor(ids[m]!);
      for (let i = 0; i < nCh; i++) w[i] = w[i]! + c * wm[i]!;
    }
    const anchor = weightsFor(patch).reduce(
      (bi, v, i, a) => (Math.abs(v) > Math.abs(a[bi]!) ? i : bi), 0,
    );
    const sign = w[anchor]! < 0 ? -1 : 1;
    let peak = 0;
    for (let i = 0; i < nCh; i++) peak = Math.max(peak, Math.abs(w[i]!));
    if (peak === 0) return weightsFor(patch).slice();
    return w.map((v) => (sign * v) / peak);
  };

  const add = (
    wave: Float64Array,
    startSample: number,
    generator: PatchId,
    weights: readonly number[],
    perChannelDelay?: Float64Array,
  ) => {
    used.add(generator);
    for (let c = 0; c < nCh; c++) {
      const w = weights[c]!;
      if (w === 0) continue;
      const delay = perChannelDelay ? Math.round(perChannelDelay[c]!) : 0;
      const dst = channels[c]!;
      for (let i = 0; i < wave.length; i++) {
        const j = startSample + i + delay;
        if (j >= 0 && j < nSamples) dst[j] = dst[j]! + w * wave[i]!;
      }
    }
  };

  // ---- slow oscillations (N3) --------------------------------------------------
  interface SlowOscillationAnchor {
    onset: number;
    period: number;
    downstate: number;
  }
  const soAnchors: SlowOscillationAnchor[] = [];
  if (state === 'n3') {
    const rng = Rng.substream(seed, `slow_osc/${state}`);
    const couplingRng = Rng.substream(seed, `resp_event/slow_osc/${state}`);
    const soFreq = boundOf('so_freq');
    const travel = travelDelaySamples(fs);
    const preferredPhase = scalarValue('resp_so_pref_phase');
    const kappa = scalarValue('resp_so_hazard_kappa');

    const ratePerMin = opts.slowOscRatePerMin ?? provisionalValue('so_rate');
    for (const baseOnset of scheduleOnsets(rng, durationS, ratePerMin)) {
      const period = 1 / rng.uniform(soFreq * 0.6, soFreq); // @lit-ok invented SO period lower-draw factor; TODO(T1-M1) register+fit
      // The source study phases the DOWNSTATE, not the beginning of the waveform. For the
      // registered rise-decay warp the negative trough occurs at u = r/2 of the event.
      const markerOffset = period * scalarValue('so_rdsym') / 2;
      const coupledDownstate = respiratoryEventCoupling
        ? drawRespiratoryMarkerTime(
            couplingRng,
            respiratoryPhaseIndex!,
            fs,
            markerOffset,
            preferredPhase,
            kappa,
          )
        : null;
      const downstate = coupledDownstate ?? baseOnset + markerOffset;
      const onset = downstate - markerOffset;
      const nEv = Math.round(period * fs);
      const amp = (opts.slowOscAmplitudePpUv ?? draw(rng, 'so_amp')) / 2; // p-p to peak
      const wave = slowOscWaveform(nEv, amp, scalarValue('so_rdsym'));
      const start = Math.round(onset * fs);
      add(wave, start, 'delta', drawTopography(rng, 'delta'), travel);
      soAnchors.push({ onset, period, downstate });
      events.push(
        makeEvent('slow_oscillation', 'slow_osc', onset, period, amp, rng, state, seed, {
          periodS: period,
          travelVelocityMps: scalarValue('so_travel_v_used'),
          respMarkerOffsetS: markerOffset,
          respPhase: respiratoryPhase ? phaseAt(respiratoryPhase, downstate, fs) : 0,
          respCoupled: coupledDownstate !== null ? 1 : 0,
          respPreferredPhase: preferredPhase,
          respHazardKappa: coupledDownstate !== null ? kappa : 0,
        }, 'delta'),
      );
    }
  }

  // ---- K-complexes (N2) --------------------------------------------------------
  if (state === 'n2') {
    const rng = Rng.substream(seed, `kcomplex/${state}`);
    const sharpW = scalarValue('kc_sharp_width');
    const slowW = scalarValue('kc_slow_width');
    const ratio = scalarValue('kc_slow_ratio');
    for (const onset of scheduleOnsets(rng, durationS, draw(rng, 'kc_rate'))) {
      const dur = Math.max(scalarValue('kc_dur_min'), rng.uniform(0.5, 0.9)); // @lit-ok invented KC duration draw upper bound (s); kc_dur_min sets the floor; TODO(T1) fold into a kc_dur interval
      const nEv = Math.round(dur * fs);
      const amp = draw(rng, 'kc_amp') / 2;
      const wave = kComplexWaveform(nEv, fs, amp, sharpW, slowW, ratio);
      add(wave, Math.round(onset * fs), 'kc', drawTopography(rng, 'kc'));
      events.push(
        makeEvent('kcomplex', 'kcomplex', onset, dur, amp, rng, state, seed, {}, 'kc'),
      );
    }
  }

  // ---- spindles (N2 and N3) ----------------------------------------------------
  if (state === 'n2' || state === 'n3') {
    const rng = Rng.substream(seed, `spindle/${state}`);
    const couplingRng = Rng.substream(seed, `resp_event/spindle_fast/${state}`);
    const { lo: bandLo, hi: bandHi } = bandEdges('spindle_band');
    const rate = draw(rng, 'spindle_rate');
    const baseOnsets = scheduleOnsets(rng, durationS, rate);
    const respiratoryPreferredPhase = scalarValue('resp_spindle_fast_pref_phase');
    const respiratoryKappa = scalarValue('resp_spindle_fast_hazard_kappa');
    const soPrefPhase = provisionalValue('so_spindle_pref_phase');
    const soStrength = provisionalValue('so_spindle_strength');

    for (const baseOnset of baseOnsets) {
      const fast = rng.nextFloat() < (opts.spindleFastFraction ?? provisionalValue('spindle_fast_fraction'));
      const gen: GeneratorId = fast ? 'spindle_fast' : 'spindle_slow';
      const fRange = fast ? 'spindle_fast_freq' : 'spindle_slow_freq';
      const freq = Math.max(bandLo, Math.min(bandHi, draw(rng, fRange)));
      const dur = Math.max(scalarValue('spindle_dur_min'), rng.uniform(0.5, 1.5)); // @lit-ok invented spindle duration draw upper bound (s); spindle_dur_min sets the floor; TODO(T1)
      let onset = baseOnset;

      if (fast && state === 'n3' && soAnchors.length > 0) {
        // Draw the respiratory marginal first, then choose the closest event from the existing
        // SO-coupled candidate process. This is a constructive joint sampler: the event remains
        // nested around an actual SO up-state, while unequal respiratory I:E timing cannot pull
        // its circular marginal away from the registered phase.
        const targetRespiratoryPhase = respiratoryEventCoupling
          ? drawVonMisesPhase(couplingRng, respiratoryPreferredPhase, respiratoryKappa)
          : null;
        let bestCandidate = Number.NaN;
        let bestDistance = Number.POSITIVE_INFINITY;
        // Four candidate jitters per realized SO give the joint sampler enough phase support in
        // a 90-second live segment without creating another physiological parameter.
        for (let round = 0; round < 4; round++) { // @lit-ok joint-sampler numerical candidate multiplicity
          // Randomize the traversal origin. In the mechanism-off arm the first admissible
          // candidate is accepted, so a fixed origin would attach every fast spindle to the
          // first SO in the record and manufacture a strong phase concentration of its own.
          const firstAnchor = Math.floor(couplingRng.nextFloat() * soAnchors.length);
          for (let anchorOffset = 0; anchorOffset < soAnchors.length; anchorOffset++) {
            const so = soAnchors[(firstAnchor + anchorOffset) % soAnchors.length]!;
            const jitter = (1 - soStrength) * couplingRng.uniform(-Math.PI, Math.PI);
            // `so_spindle_pref_phase = 0` means the SPINDLE ENVELOPE PEAK sits at the SO up-state.
            // The former code added that phase to the event-array boundary, silently treating the
            // start of a negative-first waveform as its up-state. For the rise-decay warp, the
            // positive maximum is at u = (1 + r)/2. Subtract half the spindle duration because
            // this event field records onset while the physiological coupling refers to its peak.
            const upstateOffset = so.period * (1 + scalarValue('so_rdsym')) / 2;
            const candidate = so.onset + upstateOffset - dur / 2
              + (so.period * (soPrefPhase + jitter)) / (2 * Math.PI);
            if (candidate < 0 || candidate >= durationS) continue;
            if (targetRespiratoryPhase === null) {
              // One candidate is enough when the respiratory mechanism is off.
              bestCandidate = candidate;
              break;
            }
            const candidatePhase = phaseAt(respiratoryPhase!, candidate, fs);
            const distance = Math.abs(Math.atan2(
              Math.sin(candidatePhase - targetRespiratoryPhase),
              Math.cos(candidatePhase - targetRespiratoryPhase),
            ));
            if (distance < bestDistance) {
              bestDistance = distance;
              bestCandidate = candidate;
            }
          }
          if (targetRespiratoryPhase === null && Number.isFinite(bestCandidate)) break;
        }
        onset = Number.isFinite(bestCandidate) ? bestCandidate : baseOnset;
      } else if (fast && respiratoryEventCoupling) {
        onset = drawRespiratoryMarkerTime(
          couplingRng,
          respiratoryPhaseIndex!,
          fs,
          0,
          respiratoryPreferredPhase,
          respiratoryKappa,
        ) ?? baseOnset;
      }

      const nEv = Math.round(dur * fs);
      const amp = draw(rng, 'spindle_amp') / 2;
      const wave = spindleWaveform(rng, nEv, fs, freq, amp);
      add(wave, Math.round(onset * fs), gen, drawTopography(rng, gen));
      events.push(
        makeEvent(
          fast ? 'spindle_fast' : 'spindle_slow',
          `spindle/${state}`,
          onset, dur, amp, rng, state, seed,
          {
            centreFreqHz: freq,
            respMarkerOffsetS: 0,
            respPhase: respiratoryPhase ? phaseAt(respiratoryPhase, onset, fs) : 0,
            respCoupled: fast && respiratoryEventCoupling ? 1 : 0,
            ...(fast
              ? {
                  respPreferredPhase: respiratoryPreferredPhase,
                  respHazardKappa: respiratoryEventCoupling ? respiratoryKappa : 0,
                }
              : {}),
          },
          gen,
        ),
      );
    }
  }

  return { channels, events, generators: [...used] };
}

// ---------------------------------------------------------------------- helpers

function makeEvent(
  type: EventType,
  substream: string,
  onset: number,
  duration: number,
  amplitude: number,
  rng: Rng,
  state: StateId,
  seed: number,
  params: Record<string, number>,
  generator: GeneratorId,
): GeneratedEvent {
  return {
    type,
    onset,
    duration,
    amplitude,
    inclusionTag: drawInclusionTag(rng),
    state,
    channels: topChannels(generator),
    provenance: { seed, substream, generator },
    params,
  };
}

/** Channels an event projects to with non-negligible weight, strongest first. */
function topChannels(generator: GeneratorId): string[] {
  const w = weightsFor(generator);
  return ALL_CHANNELS.map((label, i) => ({ label, w: w[i]! }))
    .filter((c) => c.w > 0.25) // @lit-ok event channel-membership threshold: lists channels carrying >25% of peak weight -- a reporting cutoff, not a signal parameter
    .sort((a, b) => b.w - a.w)
    .map((c) => c.label);
}

/**
 * Per-channel delay in samples for a travelling slow wave: delay = (AP position) / v.
 *
 * "One line, empirically correct, and the most visually distinctive thing in the build — the
 * slow wave visibly sweeps frontal to posterior."
 */
function travelDelaySamples(fs: number): Float64Array {
  const spanMm = scalarValue('ap_axis_span');
  const v = scalarValue('so_travel_v_used');
  const ys = ALL_POSITIONS.map((c) => c.y);
  const yMax = Math.max(...ys);
  const yMin = Math.min(...ys);
  const out = new Float64Array(ALL_CHANNELS.length);
  for (let c = 0; c < ALL_CHANNELS.length; c++) {
    // Anterior first: distance travelled is measured from the frontal end.
    const fracFromFront = (yMax - ALL_POSITIONS[c]!.y) / (yMax - yMin);
    const metres = (fracFromFront * spanMm) / 1000; // @lit-ok millimetres per metre
    out[c] = (metres / v) * fs;
  }
  return out;
}

/** `so_freq` is registered as a bound (<1 Hz); the bound value is the ceiling. */
function boundOf(key: 'so_freq'): number {
  return boundValue(key).v;
}

export { argmaxChannel };
