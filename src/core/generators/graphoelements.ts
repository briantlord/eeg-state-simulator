/**
 * Graphoelements: spindles, K-complexes and slow oscillations (Build Plan §4).
 *
 * "This is what separates a credible simulator from plausible-looking noise. N2 without
 * spindles and K-complexes is not N2, and no amount of spectral fidelity substitutes."
 *
 * Each is an injected event carrying a morphology template, rate, jitter, topography and a
 * GRADED PROMINENCE (seam 1). The event list is the primary output; the waveform is derived
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
  prominence: number;
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
  const meanGap = 60 / ratePerMin;
  const out: number[] = [];
  let t = rng.exponential(1 / meanGap);
  while (t < durationS) {
    out.push(t);
    t += rng.exponential(1 / meanGap);
  }
  return out;
}

/**
 * Graded prominence in [0, 1]: how canonical an exemplar this event is.
 *
 * NOT a detection confidence and NOT a probability. It is the field G3's F1-versus-inclusion
 * -threshold curve sweeps, so its distribution matters: a generator that emits only textbook
 * events gives a flat curve and no information about marginal cases. Beta(2,2) puts most
 * events mid-range with tails at both ends, which is the shape that makes the curve
 * informative.
 */
function drawProminence(rng: Rng): number {
  // Beta(2,2) via the sum of two uniforms' order statistics is fiddly; a simple accept-free
  // approximation is the mean of two uniforms, which is triangular on [0,1] — close enough
  // for a graded field whose absolute scale is arbitrary, and monotone in "how canonical".
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
  const jitter = 0.004;
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
  const tSharp = 0.3 * (n / fs);
  const tSlow = 0.55 * (n / fs);
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
  const r = Math.max(0.05, Math.min(0.95, riseDecaySymmetry));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const w = u <= r ? u / (2 * r) : 0.5 + (u - r) / (2 * (1 - r));
    out[i] = amplitudePp * Math.cos(2 * Math.PI * (w - 0.5));
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

/**
 * Generate every graphoelement for a state and project it to channels.
 *
 * SO–SPINDLE COUPLING is injected here: in N3 spindle onsets are restricted to slow
 * oscillations and placed at a preferred SO phase. §4.1 requires that restriction because
 * "sparse co-occurrence is a documented source of spurious coupling estimates".
 */
export function synthesizeGraphoelements(
  seed: number,
  state: StateId,
  nSamples: number,
  fs: number,
): GraphoelementResult {
  const durationS = nSamples / fs;
  const nCh = ALL_CHANNELS.length;
  const channels: Float64Array[] = Array.from({ length: nCh }, () => new Float64Array(nSamples));
  const events: GeneratedEvent[] = [];
  const used = new Set<GeneratorId>();

  const add = (
    wave: Float64Array,
    startSample: number,
    generator: GeneratorId,
    perChannelDelay?: Float64Array,
  ) => {
    used.add(generator);
    const weights = weightsFor(generator);
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
  const soTimes: number[] = [];
  if (state === 'n3') {
    const rng = Rng.substream(seed, `slow_osc/${state}`);
    const soFreq = boundOf('so_freq');
    const travel = travelDelaySamples(fs);
    for (const onset of scheduleOnsets(rng, durationS, 60 * soFreq * 0.55)) {
      const period = 1 / rng.uniform(soFreq * 0.6, soFreq);
      const nEv = Math.round(period * fs);
      const amp = draw(rng, 'so_amp') / 2; // p-p to peak
      const wave = slowOscWaveform(nEv, amp, scalarValue('so_rdsym'));
      const start = Math.round(onset * fs);
      add(wave, start, 'delta', travel);
      soTimes.push(onset);
      events.push(
        makeEvent('slow_oscillation', 'slow_osc', onset, period, amp, rng, state, seed, {
          periodS: period,
          travelVelocityMps: scalarValue('so_travel_v_used'),
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
      const dur = Math.max(scalarValue('kc_dur_min'), rng.uniform(0.5, 0.9));
      const nEv = Math.round(dur * fs);
      const amp = draw(rng, 'kc_amp') / 2;
      const wave = kComplexWaveform(nEv, fs, amp, sharpW, slowW, ratio);
      add(wave, Math.round(onset * fs), 'kc');
      events.push(
        makeEvent('kcomplex', 'kcomplex', onset, dur, amp, rng, state, seed, {}, 'kc'),
      );
    }
  }

  // ---- spindles (N2 and N3) ----------------------------------------------------
  if (state === 'n2' || state === 'n3') {
    const rng = Rng.substream(seed, `spindle/${state}`);
    const { lo: bandLo, hi: bandHi } = bandEdges('spindle_band');
    const rate = draw(rng, 'spindle_rate');

    let onsets = scheduleOnsets(rng, durationS, rate);

    // SO-spindle coupling: in N3, restrict spindles to slow oscillations and place them at a
    // preferred SO phase rather than uniformly.
    if (state === 'n3' && soTimes.length) {
      const prefPhase = provisionalValue('so_spindle_pref_phase');
      const strength = provisionalValue('so_spindle_strength');
      onsets = onsets.map(() => {
        const so = soTimes[Math.floor(rng.nextFloat() * soTimes.length)]!;
        const period = 1 / boundOf('so_freq');
        // Preferred phase, blurred by (1 - strength): strength 1 pins every spindle to the
        // preferred phase, 0 scatters them uniformly across the cycle.
        const jitter = (1 - strength) * rng.uniform(-Math.PI, Math.PI);
        return so + (period * (prefPhase + jitter)) / (2 * Math.PI);
      }).filter((t) => t >= 0 && t < durationS);
    }

    for (const onset of onsets) {
      const fast = rng.nextFloat() < 0.5;
      const gen: GeneratorId = fast ? 'spindle_fast' : 'spindle_slow';
      const fRange = fast ? 'spindle_fast_freq' : 'spindle_slow_freq';
      const freq = Math.max(bandLo, Math.min(bandHi, draw(rng, fRange)));
      const dur = Math.max(scalarValue('spindle_dur_min'), rng.uniform(0.5, 1.5));
      const nEv = Math.round(dur * fs);
      const amp = draw(rng, 'spindle_amp') / 2;
      const wave = spindleWaveform(rng, nEv, fs, freq, amp);
      add(wave, Math.round(onset * fs), gen);
      events.push(
        makeEvent(
          fast ? 'spindle_fast' : 'spindle_slow',
          `spindle/${state}`,
          onset, dur, amp, rng, state, seed,
          { centreFreqHz: freq },
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
    prominence: drawProminence(rng),
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
    .filter((c) => c.w > 0.25)
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
    const metres = (fracFromFront * spanMm) / 1000;
    out[c] = (metres / v) * fs;
  }
  return out;
}

/** `so_freq` is registered as a bound (<1 Hz); the bound value is the ceiling. */
function boundOf(key: 'so_freq'): number {
  return boundValue(key).v;
}

export { argmaxChannel };
