/**
 * Causal infra-slow controller selected by ISF-1 and connected to BEM source families by ISF-3.
 *
 * This module owns FORM, not fitted physiology. Callers must supply the still-absent spectral
 * exponent, approximation order, ISF1 variance share, source amplitude and modulation depth.
 * There are deliberately no fallback values: an omitted empirical quantity cannot become a
 * plausible-looking default merely because the mechanism has now been implemented.
 */
import { bandEdges, scalarValue } from '../registry.ts';
import { Rng } from '../rng/xoshiro128pp.ts';

type RngSnapshot = {
  readonly words: readonly [number, number, number, number];
  readonly spare: number | null;
};

export interface InfraSlowTemporalConfig {
  readonly exponent: number;
  readonly poleCount: number;
  readonly isf1VarianceFraction: number;
}

interface BandState {
  readonly band: 'isf1' | 'isf2';
  readonly ar: readonly number[];
  readonly dc: number;
  readonly fast1: number;
  readonly fast2: number;
  readonly slow1: number;
  readonly slow2: number;
  readonly rng: RngSnapshot;
}

interface DriverState {
  readonly low: BandState;
  readonly high: BandState;
  readonly currentLow: number;
  readonly currentHigh: number;
  readonly nextLow: number;
  readonly nextHigh: number;
}

/** Complete JSON-serializable controller checkpoint. */
export interface InfraSlowControllerState {
  readonly version: 1;
  readonly fs: number;
  readonly controllerRate: number;
  readonly samplesPerTick: number;
  readonly sampleInTick: number;
  readonly absoluteSample: number;
  readonly config: InfraSlowTemporalConfig;
  readonly drivers: Readonly<Record<string, DriverState>>;
}

export interface InfraSlowDriverChunk {
  readonly isf1: Float64Array;
  readonly isf2: Float64Array;
  /** Unit-variance mixture using the caller-supplied ISF1 variance fraction. */
  readonly combined: Float64Array;
}

interface Coefficients {
  readonly poles: Float64Array;
  readonly innovations: Float64Array;
  readonly weights: Float64Array;
  readonly dcPole: number;
  readonly fastPole: number;
  readonly slowPole: number;
  readonly outputScale: number;
  readonly lagOneCorrelation: number;
  readonly settlingSamples: number;
}

interface MutableBandState {
  band: 'isf1' | 'isf2';
  ar: number[];
  dc: number;
  fast1: number;
  fast2: number;
  slow1: number;
  slow2: number;
  rng: RngSnapshot;
}

function saveRng(rng: Rng): RngSnapshot {
  const state = rng.saveState();
  return {
    words: [state[0]!, state[1]!, state[2]!, state[3]!], // @lit-ok four xoshiro state words
    spare: Number.isNaN(state[4]!) ? null : state[4]!, // @lit-ok Box-Muller spare index
  };
}

function restoreRng(snapshot: RngSnapshot): Rng {
  const rng = Rng.fromSeed(1, 'restored-infraslow');
  rng.restoreState(new Float64Array([
    ...snapshot.words,
    snapshot.spare === null ? Number.NaN : snapshot.spare,
  ]));
  return rng;
}

function logSpace(lo: number, hi: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    lo * Math.pow(hi / lo, index / (count - 1)),
  );
}

function rawStep(
  state: MutableBandState,
  coeff: Omit<Coefficients, 'outputScale' | 'lagOneCorrelation' | 'settlingSamples'>,
  innovations: readonly number[],
): number {
  let colored = 0;
  for (let i = 0; i < state.ar.length; i++) {
    state.ar[i] = coeff.poles[i]! * state.ar[i]! + coeff.innovations[i]! * innovations[i]!;
    colored += coeff.weights[i]! * state.ar[i]!;
  }
  state.dc = coeff.dcPole * state.dc + (1 - coeff.dcPole) * colored;
  const highpassed = colored - state.dc;
  state.fast1 = coeff.fastPole * state.fast1 + (1 - coeff.fastPole) * highpassed;
  state.fast2 = coeff.fastPole * state.fast2 + (1 - coeff.fastPole) * state.fast1;
  state.slow1 = coeff.slowPole * state.slow1 + (1 - coeff.slowPole) * highpassed;
  state.slow2 = coeff.slowPole * state.slow2 + (1 - coeff.slowPole) * state.slow1;
  return state.fast2 - state.slow2;
}

const coefficientCache = new Map<string, Coefficients>();

function coefficients(
  band: 'isf1' | 'isf2',
  config: InfraSlowTemporalConfig,
  sampleRate: number,
): Coefficients {
  const key = `${band}/${config.exponent}/${config.poleCount}/${sampleRate}`;
  const cached = coefficientCache.get(key);
  if (cached) return cached;

  const edges = bandEdges(band === 'isf1' ? 'isf1_band' : 'isf2_band');
  const frequencies = logSpace(edges.lo, edges.hi, config.poleCount);
  const poles = Float64Array.from(frequencies, (frequency) =>
    Math.exp((-2 * Math.PI * frequency) / sampleRate),
  );
  const innovations = Float64Array.from(poles, (pole) => Math.sqrt(1 - pole * pole));
  const unscaled = frequencies.map((frequency) => Math.pow(frequency, -config.exponent / 2));
  const norm = Math.sqrt(unscaled.reduce((sum, value) => sum + value * value, 0));
  const weights = Float64Array.from(unscaled, (value) => value / norm);
  const dcPole = Math.exp((-2 * Math.PI * edges.lo) / sampleRate);
  const fastPole = Math.exp((-2 * Math.PI * edges.hi) / sampleRate);
  const slowPole = dcPole;
  const maxPole = Math.max(...poles, dcPole, fastPole, slowPole);
  const settlingSamples = Math.ceil(Math.log(Number.EPSILON) / Math.log(maxPole)) * 2;
  const base = { poles, innovations, weights, dcPole, fastPole, slowPole };

  // Exact stationary output variance by impulse-energy summation. This depends only on the
  // selected linear system, never on a generated realization, and therefore does not use the
  // simulator's own spread as a calibration target.
  let variance = 0;
  let lagOne = 0;
  for (let source = 0; source < config.poleCount; source++) {
    const impulseState: MutableBandState = {
      band,
      ar: Array.from({ length: config.poleCount }, () => 0),
      dc: 0,
      fast1: 0,
      fast2: 0,
      slow1: 0,
      slow2: 0,
      rng: { words: [0, 0, 0, 0], spare: null },
    };
    let previous = 0;
    for (let sample = 0; sample < settlingSamples; sample++) {
      const impulse = Array.from({ length: config.poleCount }, () => 0);
      if (sample === 0) impulse[source] = 1;
      const output = rawStep(impulseState, base, impulse);
      variance += output * output;
      if (sample > 0) lagOne += previous * output;
      previous = output;
    }
  }
  if (!(variance > 0)) throw new Error('infra-slow controller has zero analytic variance');
  const result: Coefficients = {
    ...base,
    outputScale: 1 / Math.sqrt(variance),
    lagOneCorrelation: lagOne / variance,
    settlingSamples,
  };
  coefficientCache.set(key, result);
  return result;
}

function mutableBand(state: BandState): MutableBandState {
  return {
    ...state,
    ar: [...state.ar],
    rng: { words: [...state.rng.words] as [number, number, number, number], spare: state.rng.spare },
  };
}

function stepBand(state: MutableBandState, coeff: Coefficients): number {
  const rng = restoreRng(state.rng);
  const innovations = Array.from({ length: state.ar.length }, () => rng.normal());
  const output = rawStep(state, coeff, innovations) * coeff.outputScale;
  state.rng = saveRng(rng);
  return output;
}

function createBand(
  seed: number,
  name: string,
  band: 'isf1' | 'isf2',
  config: InfraSlowTemporalConfig,
  sampleRate: number,
): MutableBandState {
  const coeff = coefficients(band, config, sampleRate);
  const state: MutableBandState = {
    band,
    ar: Array.from({ length: config.poleCount }, () => 0),
    dc: 0,
    fast1: 0,
    fast2: 0,
    slow1: 0,
    slow2: 0,
    rng: saveRng(Rng.substream(seed, `infraslow/${name}/${band}`)),
  };
  for (let i = 0; i < coeff.settlingSamples; i++) stepBand(state, coeff);
  return state;
}

function interpolationScale(rho: number, samplesPerTick: number): number {
  let variance = 0;
  for (let sample = 0; sample < samplesPerTick; sample++) {
    const u = sample / samplesPerTick;
    variance += (1 - u) * (1 - u) + u * u + 2 * u * (1 - u) * rho;
  }
  return Math.sqrt(samplesPerTick / variance);
}

function validate(config: InfraSlowTemporalConfig, fs: number, controllerRate: number): number {
  if (!Number.isFinite(config.exponent)) throw new Error('infra-slow exponent must be finite');
  if (!Number.isInteger(config.poleCount) || config.poleCount < 2) {
    throw new Error('infra-slow poleCount must be an integer of at least two');
  }
  if (config.isf1VarianceFraction < 0 || config.isf1VarianceFraction > 1) {
    throw new Error('infra-slow ISF1 variance fraction must be between zero and one');
  }
  const samplesPerTick = fs / controllerRate;
  if (!Number.isInteger(samplesPerTick)) {
    throw new Error('infra-slow controller rate must divide the EEG sample rate exactly');
  }
  return samplesPerTick;
}

/** Create independently seeded temporal drivers and their first interpolation knots. */
export function createInfraSlowController(
  seed: number,
  driverIds: readonly string[],
  config: InfraSlowTemporalConfig,
  fs = scalarValue('fs'),
): InfraSlowControllerState {
  const controllerRate = scalarValue('isf_controller_rate');
  const samplesPerTick = validate(config, fs, controllerRate);
  if (new Set(driverIds).size !== driverIds.length) {
    throw new Error('infra-slow driver IDs must be unique');
  }
  const drivers: Record<string, DriverState> = {};
  for (const id of driverIds) {
    const low = createBand(seed, id, 'isf1', config, controllerRate);
    const high = createBand(seed, id, 'isf2', config, controllerRate);
    const lowCoeff = coefficients('isf1', config, controllerRate);
    const highCoeff = coefficients('isf2', config, controllerRate);
    const currentLow = stepBand(low, lowCoeff);
    const currentHigh = stepBand(high, highCoeff);
    const nextLow = stepBand(low, lowCoeff);
    const nextHigh = stepBand(high, highCoeff);
    drivers[id] = { low, high, currentLow, currentHigh, nextLow, nextHigh };
  }
  return {
    version: 1,
    fs,
    controllerRate,
    samplesPerTick,
    sampleInTick: 0,
    absoluteSample: 0,
    config: { ...config },
    drivers,
  };
}

/** Advance a checkpoint by exactly `nSamples`; arbitrary chunking is sample-identical. */
export function synthesizeInfraSlowChunk(
  state: InfraSlowControllerState,
  nSamples: number,
): {
  readonly drivers: Readonly<Record<string, InfraSlowDriverChunk>>;
  readonly state: InfraSlowControllerState;
} {
  const work = {
    ...state,
    config: { ...state.config },
    drivers: Object.fromEntries(Object.entries(state.drivers).map(([id, driver]) => [id, {
      ...driver,
      low: mutableBand(driver.low),
      high: mutableBand(driver.high),
    }])) as Record<string, DriverState>,
  };
  const output: Record<string, InfraSlowDriverChunk> = Object.fromEntries(
    Object.keys(work.drivers).map((id) => [id, {
      isf1: new Float64Array(nSamples),
      isf2: new Float64Array(nSamples),
      combined: new Float64Array(nSamples),
    }]),
  );
  const lowCoeff = coefficients('isf1', work.config, work.controllerRate);
  const highCoeff = coefficients('isf2', work.config, work.controllerRate);
  const lowScale = interpolationScale(lowCoeff.lagOneCorrelation, work.samplesPerTick);
  const highScale = interpolationScale(highCoeff.lagOneCorrelation, work.samplesPerTick);
  const lowMix = Math.sqrt(work.config.isf1VarianceFraction);
  const highMix = Math.sqrt(1 - work.config.isf1VarianceFraction);

  for (let sample = 0; sample < nSamples; sample++) {
    const u = work.sampleInTick / work.samplesPerTick;
    for (const [id, immutable] of Object.entries(work.drivers)) {
      const driver = immutable as DriverState;
      const low = ((1 - u) * driver.currentLow + u * driver.nextLow) * lowScale;
      const high = ((1 - u) * driver.currentHigh + u * driver.nextHigh) * highScale;
      output[id]!.isf1[sample] = low;
      output[id]!.isf2[sample] = high;
      output[id]!.combined[sample] = lowMix * low + highMix * high;
    }

    work.sampleInTick++;
    work.absoluteSample++;
    if (work.sampleInTick === work.samplesPerTick) {
      work.sampleInTick = 0;
      for (const [id, immutable] of Object.entries(work.drivers)) {
        const driver = immutable as DriverState;
        const low = mutableBand(driver.low);
        const high = mutableBand(driver.high);
        work.drivers[id] = {
          low,
          high,
          currentLow: driver.nextLow,
          currentHigh: driver.nextHigh,
          nextLow: stepBand(low, lowCoeff),
          nextHigh: stepBand(high, highCoeff),
        };
      }
    }
  }
  return { drivers: output, state: work };
}

/** Stateless whole-record wrapper used by compose fixtures and characterization probes. */
export function synthesizeInfraSlow(
  seed: number,
  driverIds: readonly string[],
  nSamples: number,
  config: InfraSlowTemporalConfig,
  fs = scalarValue('fs'),
): Readonly<Record<string, InfraSlowDriverChunk>> {
  return synthesizeInfraSlowChunk(
    createInfraSlowController(seed, driverIds, config, fs),
    nSamples,
  ).drivers;
}

/** Positive log-amplitude gain with analytic E[g²] = 1 for a unit Gaussian driver. */
export function powerPreservingInfraSlowGain(
  driver: Float64Array,
  logAmplitudeDepth: number,
): Float64Array {
  if (!Number.isFinite(logAmplitudeDepth)) {
    throw new Error('infra-slow modulation depth must be finite');
  }
  const out = new Float64Array(driver.length);
  const normalization = logAmplitudeDepth * logAmplitudeDepth;
  for (let i = 0; i < driver.length; i++) {
    out[i] = Math.exp(logAmplitudeDepth * driver[i]! - normalization);
  }
  return out;
}

export function rms(values: Float64Array): number {
  let power = 0;
  for (let i = 0; i < values.length; i++) power += values[i]! * values[i]!;
  return values.length > 0 ? Math.sqrt(power / values.length) : 0;
}
