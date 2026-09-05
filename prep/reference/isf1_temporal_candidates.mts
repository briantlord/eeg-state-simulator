/**
 * ISF-1B — compare normalized infra-slow temporal model families outside composeState.
 *
 * No candidate has a physiological voltage amplitude, scalp projection, state gain, or fast-
 * activity coupling. Candidate-only constants are deliberately local to this characterization;
 * only the accepted model family may enter the registry.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf1_temporal_candidates.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { fft } from '../../src/core/dsp/fft.ts';
import { Rng } from '../../src/core/rng/xoshiro128pp.ts';
import { bandEdges, GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';

type CandidateId = 'power_law_state_space' | 'damped_oscillator_bank' | 'hybrid_weak_resonance';

interface PairSample {
  low: number;
  high: number;
}

interface PairController {
  next(): PairSample;
}

/** Common causal band limiter; candidate differences live upstream of this observation model. */
class BandLimiter {
  private fast1 = 0;
  private fast2 = 0;
  private slow1 = 0;
  private slow2 = 0;
  private readonly fastPole: number;
  private readonly slowPole: number;

  constructor(lo: number, hi: number, sampleRate: number) {
    this.fastPole = Math.exp((-2 * Math.PI * hi) / sampleRate);
    this.slowPole = Math.exp((-2 * Math.PI * lo) / sampleRate);
  }

  next(input: number): number {
    this.fast1 = this.fastPole * this.fast1 + (1 - this.fastPole) * input;
    this.fast2 = this.fastPole * this.fast2 + (1 - this.fastPole) * this.fast1;
    this.slow1 = this.slowPole * this.slow1 + (1 - this.slowPole) * input;
    this.slow2 = this.slowPole * this.slow2 + (1 - this.slowPole) * this.slow1;
    return this.fast2 - this.slow2;
  }
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? process.argv[index + 1]!
    : fallback;
}

function logSpace(lo: number, hi: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    lo * Math.pow(hi / lo, index / (count - 1)),
  );
}

class PowerLawBand {
  private readonly rng: Rng;
  private readonly states: Float64Array;
  private readonly poles: Float64Array;
  private readonly innovations: Float64Array;
  private readonly weights: Float64Array;
  private dc = 0;
  private readonly dcPole: number;

  constructor(
    rng: Rng,
    lo: number,
    hi: number,
    sampleRate: number,
    poleCount = 9,
    beta = 1,
  ) {
    this.rng = rng;
    const frequencies = logSpace(lo, hi, poleCount);
    this.states = new Float64Array(poleCount);
    this.poles = Float64Array.from(frequencies, (frequency) =>
      Math.exp((-2 * Math.PI * frequency) / sampleRate),
    );
    this.innovations = Float64Array.from(this.poles, (pole) => Math.sqrt(1 - pole * pole));
    const rawWeights = frequencies.map((frequency) => Math.pow(frequency, -beta / 2));
    const norm = Math.sqrt(rawWeights.reduce((sum, value) => sum + value * value, 0));
    this.weights = Float64Array.from(rawWeights, (value) => value / norm);
    this.dcPole = Math.exp((-2 * Math.PI * lo) / sampleRate);
  }

  next(): number {
    let colored = 0;
    for (let i = 0; i < this.states.length; i++) {
      this.states[i] = this.poles[i]! * this.states[i]! + this.innovations[i]! * this.rng.normal();
      colored += this.weights[i]! * this.states[i]!;
    }
    this.dc = this.dcPole * this.dc + (1 - this.dcPole) * colored;
    return colored - this.dc;
  }
}

class OscillatorBankBand {
  private readonly rng: Rng;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly decay: Float64Array;
  private readonly innovation: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(
    rng: Rng,
    lo: number,
    hi: number,
    sampleRate: number,
    count = 7,
  ) {
    this.rng = rng;
    const frequencies = logSpace(lo, hi, count);
    this.re = new Float64Array(count);
    this.im = new Float64Array(count);
    this.decay = Float64Array.from(frequencies, (frequency) =>
      Math.exp((-Math.PI * 0.7 * frequency) / sampleRate),
    );
    this.innovation = Float64Array.from(this.decay, (value) => Math.sqrt(1 - value * value));
    this.cos = Float64Array.from(frequencies, (frequency) =>
      Math.cos((2 * Math.PI * frequency) / sampleRate),
    );
    this.sin = Float64Array.from(frequencies, (frequency) =>
      Math.sin((2 * Math.PI * frequency) / sampleRate),
    );
  }

  next(): number {
    let output = 0;
    for (let i = 0; i < this.re.length; i++) {
      const oldRe = this.re[i]!;
      const oldIm = this.im[i]!;
      const a = this.decay[i]!;
      this.re[i] = a * (this.cos[i]! * oldRe - this.sin[i]! * oldIm) +
        this.innovation[i]! * this.rng.normal();
      this.im[i] = a * (this.sin[i]! * oldRe + this.cos[i]! * oldIm) +
        this.innovation[i]! * this.rng.normal();
      output += this.re[i]!;
    }
    return output / Math.sqrt(this.re.length);
  }
}

class SingleOscillator {
  private readonly rng: Rng;
  private re = 0;
  private im = 0;
  private readonly decay: number;
  private readonly innovation: number;
  private readonly cos: number;
  private readonly sin: number;

  constructor(
    rng: Rng,
    frequency: number,
    bandwidth: number,
    sampleRate: number,
  ) {
    this.rng = rng;
    this.decay = Math.exp((-Math.PI * bandwidth) / sampleRate);
    this.innovation = Math.sqrt(1 - this.decay * this.decay);
    this.cos = Math.cos((2 * Math.PI * frequency) / sampleRate);
    this.sin = Math.sin((2 * Math.PI * frequency) / sampleRate);
  }

  next(): number {
    const oldRe = this.re;
    const oldIm = this.im;
    this.re = this.decay * (this.cos * oldRe - this.sin * oldIm) +
      this.innovation * this.rng.normal();
    this.im = this.decay * (this.sin * oldRe + this.cos * oldIm) +
      this.innovation * this.rng.normal();
    return this.re;
  }
}

function makeController(id: CandidateId, seed: number, sampleRate: number): PairController {
  const lowBand = bandEdges('isf1_band');
  const highBand = bandEdges('isf2_band');
  const stream = (name: string) => Rng.substream(seed, `isf1/${id}/${name}`);

  if (id === 'power_law_state_space') {
    const low = new PowerLawBand(stream('low'), lowBand.lo, lowBand.hi, sampleRate);
    const high = new PowerLawBand(stream('high'), highBand.lo, highBand.hi, sampleRate);
    const lowLimiter = new BandLimiter(lowBand.lo, lowBand.hi, sampleRate);
    const highLimiter = new BandLimiter(highBand.lo, highBand.hi, sampleRate);
    return { next: () => ({
      low: lowLimiter.next(low.next()),
      high: highLimiter.next(high.next()),
    }) };
  }

  if (id === 'damped_oscillator_bank') {
    const low = new OscillatorBankBand(stream('low'), lowBand.lo, lowBand.hi, sampleRate);
    const high = new OscillatorBankBand(stream('high'), highBand.lo, highBand.hi, sampleRate);
    const lowLimiter = new BandLimiter(lowBand.lo, lowBand.hi, sampleRate);
    const highLimiter = new BandLimiter(highBand.lo, highBand.hi, sampleRate);
    return { next: () => ({
      low: lowLimiter.next(low.next()),
      high: highLimiter.next(high.next()),
    }) };
  }

  const lowBroad = new PowerLawBand(stream('low_broad'), lowBand.lo, lowBand.hi, sampleRate);
  const highBroad = new PowerLawBand(stream('high_broad'), highBand.lo, highBand.hi, sampleRate);
  const lowResonance = new SingleOscillator(stream('low_resonance'), 0.02, 0.008, sampleRate);
  const highResonance = new SingleOscillator(stream('high_resonance'), 0.075, 0.025, sampleRate);
  const resonantVariance = 0.2;
  const broadGain = Math.sqrt(1 - resonantVariance);
  const resonantGain = Math.sqrt(resonantVariance);
  const lowLimiter = new BandLimiter(lowBand.lo, lowBand.hi, sampleRate);
  const highLimiter = new BandLimiter(highBand.lo, highBand.hi, sampleRate);
  return {
    next: () => ({
      low: lowLimiter.next(broadGain * lowBroad.next() + resonantGain * lowResonance.next()),
      high: highLimiter.next(broadGain * highBroad.next() + resonantGain * highResonance.next()),
    }),
  };
}

function generate(
  id: CandidateId,
  seed: number,
  count: number,
  sampleRate: number,
  chunks?: readonly number[],
): { low: Float64Array; high: Float64Array } {
  const controller = makeController(id, seed, sampleRate);
  const burn = Math.ceil((8 / bandEdges('isf_band').lo) * sampleRate);
  for (let i = 0; i < burn; i++) controller.next();

  const low = new Float64Array(count);
  const high = new Float64Array(count);
  let offset = 0;
  let chunkIndex = 0;
  while (offset < count) {
    const requested = chunks?.[chunkIndex % chunks.length] ?? count;
    const take = Math.min(requested, count - offset);
    for (let i = 0; i < take; i++) {
      const sample = controller.next();
      low[offset + i] = sample.low;
      high[offset + i] = sample.high;
    }
    offset += take;
    chunkIndex++;
  }
  return { low, high };
}

function normalize(values: Float64Array): Float64Array {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let power = 0;
  for (const value of values) power += (value - mean) ** 2;
  const rms = Math.sqrt(power / values.length);
  return Float64Array.from(values, (value) => (value - mean) / rms);
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function spectrum(values: Float64Array, sampleRate: number): {
  freqs: Float64Array;
  power: Float64Array;
} {
  const nfft = nextPowerOfTwo(values.length);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let windowPower = 0;
  for (let i = 0; i < values.length; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (values.length - 1)));
    re[i] = values[i]! * window;
    windowPower += window * window;
  }
  fft(re, im, false);
  const bins = nfft / 2 + 1;
  const freqs = new Float64Array(bins);
  const power = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * sampleRate) / nfft;
    const factor = k === 0 || k === bins - 1 ? 1 : 2;
    power[k] = factor * (re[k]! * re[k]! + im[k]! * im[k]!) /
      (sampleRate * windowPower);
  }
  return { freqs, power };
}

function spectralMetrics(
  values: Float64Array,
  sampleRate: number,
  lo: number,
  hi: number,
): { targetShare: number; peakHz: number; lineShare: number; entropy: number } {
  const spec = spectrum(values, sampleRate);
  let target = 0;
  let total = 0;
  let max = -Infinity;
  let peakHz = Number.NaN;
  const selected: number[] = [];
  for (let i = 1; i < spec.freqs.length; i++) {
    const frequency = spec.freqs[i]!;
    if (frequency >= 0.002 && frequency <= 0.25) total += spec.power[i]!;
    if (frequency >= lo && frequency <= hi) {
      const power = spec.power[i]!;
      target += power;
      selected.push(power);
      if (power > max) {
        max = power;
        peakHz = frequency;
      }
    }
  }
  let entropy = 0;
  for (const power of selected) {
    const probability = power / target;
    if (probability > 0) entropy -= probability * Math.log(probability);
  }
  entropy /= Math.log(selected.length);
  return { targetShare: target / total, peakHz, lineShare: max / target, entropy };
}

function upwardPeriods(values: Float64Array, sampleRate: number): number[] {
  const crossings: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1]! < 0 && values[i]! >= 0) {
      const fraction = -values[i - 1]! / (values[i]! - values[i - 1]!);
      crossings.push((i - 1 + fraction) / sampleRate);
    }
  }
  return crossings.slice(1).map((value, index) => value - crossings[index]!);
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = probability * (sorted.length - 1);
  const lo = Math.floor(position);
  const fraction = position - lo;
  return sorted[lo]! * (1 - fraction) + sorted[Math.min(lo + 1, sorted.length - 1)]! * fraction;
}

function correlationAt(values: Float64Array, lag: number): number {
  if (lag >= values.length) return Number.NaN;
  let numerator = 0;
  let left = 0;
  let right = 0;
  for (let i = lag; i < values.length; i++) {
    numerator += values[i]! * values[i - lag]!;
    left += values[i]! * values[i]!;
    right += values[i - lag]! * values[i - lag]!;
  }
  return numerator / Math.sqrt(left * right);
}

function correlation(a: Float64Array, b: Float64Array): number {
  let cross = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    cross += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return cross / Math.sqrt(aa * bb);
}

function halfRmsRatio(values: Float64Array): number {
  const midpoint = Math.floor(values.length / 2);
  let first = 0;
  let second = 0;
  for (let i = 0; i < midpoint; i++) first += values[i]! * values[i]!;
  for (let i = midpoint; i < values.length; i++) second += values[i]! * values[i]!;
  return Math.sqrt((second / (values.length - midpoint)) / (first / midpoint));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(values: readonly number[]): { median: number; lo: number; hi: number } {
  return { median: quantile(values, 0.5), lo: quantile(values, 0.25), hi: quantile(values, 0.75) };
}

const candidateIds: readonly CandidateId[] = [
  'power_law_state_space',
  'damped_oscillator_bank',
  'hybrid_weak_resonance',
];
const sampleRate = Number(arg('--sample-rate', '2'));
const durationS = Number(arg('--duration', String(scalarValue('isf_probe_record_length'))));
const nSeeds = Number(arg('--seeds', '20'));
const output = resolve(arg('--output', 'prep/out/isf1_temporal_candidates.json'));
const count = Math.round(sampleRate * durationS);
const lowBand = bandEdges('isf1_band');
const highBand = bandEdges('isf2_band');
const rows: any[] = [];

for (const candidate of candidateIds) {
  for (let index = 0; index < nSeeds; index++) {
    const seed = 731001 + 977 * index;
    const wholeRaw = generate(candidate, seed, count, sampleRate);
    const chunkedRaw = generate(candidate, seed, count, sampleRate, [1, 7, 31, 2, 113, 19]);
    let maxChunkError = 0;
    for (let i = 0; i < count; i++) {
      maxChunkError = Math.max(maxChunkError, Math.abs(wholeRaw.low[i]! - chunkedRaw.low[i]!));
      maxChunkError = Math.max(maxChunkError, Math.abs(wholeRaw.high[i]! - chunkedRaw.high[i]!));
    }
    const low = normalize(wholeRaw.low);
    const high = normalize(wholeRaw.high);
    const lowPeriods = upwardPeriods(low, sampleRate);
    const highPeriods = upwardPeriods(high, sampleRate);
    const lowSpectral = spectralMetrics(low, sampleRate, lowBand.lo, lowBand.hi);
    const highSpectral = spectralMetrics(high, sampleRate, highBand.lo, highBand.hi);
    rows.push({
      candidate,
      seed,
      maxChunkError,
      low: {
        ...lowSpectral,
        periodP10S: quantile(lowPeriods, 0.10),
        periodMedianS: quantile(lowPeriods, 0.50),
        periodP90S: quantile(lowPeriods, 0.90),
        periodCv: Math.sqrt(mean(lowPeriods.map((value) => (value - mean(lowPeriods)) ** 2))) /
          mean(lowPeriods),
        ac10S: correlationAt(low, Math.round(10 * sampleRate)),
        ac50S: correlationAt(low, Math.round(50 * sampleRate)),
        ac100S: correlationAt(low, Math.round(100 * sampleRate)),
        halfRmsRatio: halfRmsRatio(low),
      },
      high: {
        ...highSpectral,
        periodP10S: quantile(highPeriods, 0.10),
        periodMedianS: quantile(highPeriods, 0.50),
        periodP90S: quantile(highPeriods, 0.90),
        periodCv: Math.sqrt(mean(highPeriods.map((value) => (value - mean(highPeriods)) ** 2))) /
          mean(highPeriods),
        ac10S: correlationAt(high, Math.round(10 * sampleRate)),
        ac50S: correlationAt(high, Math.round(50 * sampleRate)),
        ac100S: correlationAt(high, Math.round(100 * sampleRate)),
        halfRmsRatio: halfRmsRatio(high),
      },
      lowHighCorrelation: correlation(low, high),
    });
  }
  console.log(`${candidate}: complete`);
}

const fields = [
  'maxChunkError',
  'low.targetShare', 'low.peakHz', 'low.lineShare', 'low.entropy',
  'low.periodP10S', 'low.periodMedianS', 'low.periodP90S', 'low.periodCv',
  'low.ac10S', 'low.ac50S', 'low.ac100S', 'low.halfRmsRatio',
  'high.targetShare', 'high.peakHz', 'high.lineShare', 'high.entropy',
  'high.periodP10S', 'high.periodMedianS', 'high.periodP90S', 'high.periodCv',
  'high.ac10S', 'high.ac50S', 'high.ac100S', 'high.halfRmsRatio',
  'lowHighCorrelation',
] as const;
const read = (row: any, path: string): number =>
  path.split('.').reduce((value, key) => value[key], row);
const summaries = Object.fromEntries(candidateIds.map((candidate) => {
  const selected = rows.filter((row) => row.candidate === candidate);
  return [candidate, Object.fromEntries(fields.map((field) => [
    field,
    summarize(selected.map((row) => read(row, field))),
  ]))];
}));

const result = {
  probe: 'ISF-1 normalized temporal candidate comparison',
  generatedAt: new Date().toISOString(),
  generatorVersion: GENERATOR_VERSION,
  sampleRate,
  durationS,
  nSeeds,
  bandsHz: { low: lowBand, high: highBand },
  amplitudeBoundary: 'Every realization is normalized for shape comparison; no uV amplitude is represented or inferred.',
  candidateOnlyValues: {
    powerLawExponent: 1,
    powerLawPolesPerBand: 9,
    oscillatorCountPerBand: 7,
    oscillatorFractionInHybrid: 0.2,
    note: 'Characterization fixtures only. They are not registry values and cannot reach composeState.',
  },
  decision: {
    selected: 'power_law_state_space',
    basis:
      'All three families are exactly chunk-continuous and produce broad irregular periods. The power-law state-space family achieves comparable spectral entropy and line concentration with no resonance location, resonance fraction, or oscillator-Q parameter. The hybrid 0.02 Hz peak is not promoted because the literature reports it as common rather than universal and supplies no mixture weight.',
    amplitudeSelected: false,
  },
  summaries,
  rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);

console.log('\ncandidate                  chunk err  low target  low line  low H  low periods p10/50/p90  high target  high line');
for (const candidate of candidateIds) {
  const summary = (summaries as any)[candidate];
  console.log(
    `${candidate.padEnd(27)} ${summary.maxChunkError.median.toExponential(1).padStart(9)}  ` +
    `${summary['low.targetShare'].median.toFixed(3).padStart(10)}  ` +
    `${summary['low.lineShare'].median.toFixed(3).padStart(8)}  ` +
    `${summary['low.entropy'].median.toFixed(3).padStart(5)}  ` +
    `${summary['low.periodP10S'].median.toFixed(1).padStart(5)}/` +
    `${summary['low.periodMedianS'].median.toFixed(1).padStart(4)}/` +
    `${summary['low.periodP90S'].median.toFixed(1).padStart(5)}  ` +
    `${summary['high.targetShare'].median.toFixed(3).padStart(11)}  ` +
    `${summary['high.lineShare'].median.toFixed(3).padStart(9)}`,
  );
}
console.log(`wrote ${output}`);
