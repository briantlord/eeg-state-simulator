/**
 * ISF-1A — quantify the continuous generator's incidental sub-0.1 Hz voltage.
 *
 * This is characterization only. It suppresses discrete graphoelements and leaves every
 * optional respiratory EEG mechanism off, isolating the continuous state background and
 * rhythms that already ship. The result must not be used to choose a future ISF amplitude.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf1_current_baseline.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { applyReference } from '../../src/analysis/referencing.ts';
import { fft } from '../../src/core/dsp/fft.ts';
import { composeState } from '../../src/core/generators/compose.ts';
import { bandEdges, GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';
import type { StateId } from '../../src/core/types/state.ts';

const FS = scalarValue('fs');
const ALL_STATES: readonly StateId[] = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem'];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? process.argv[index + 1]!
    : fallback;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

interface Spectrum {
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly psd: Float64Array;
  readonly df: number;
}

/** Linear detrend, Hann window, then a one-sided periodogram. */
function spectrum(signal: Float64Array, nfft: number): Spectrum {
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const n = signal.length;
  const meanX = (n - 1) / 2;
  let meanY = 0;
  for (const value of signal) meanY += value;
  meanY /= n;
  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    covariance += dx * (signal[i]! - meanY);
    varianceX += dx * dx;
  }
  const slope = covariance / varianceX;
  let windowPower = 0;
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    re[i] = (signal[i]! - meanY - slope * (i - meanX)) * window;
    windowPower += window * window;
  }
  fft(re, im, false);

  const bins = nfft / 2 + 1;
  const psd = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const factor = k === 0 || k === bins - 1 ? 1 : 2;
    psd[k] = factor * (re[k]! * re[k]! + im[k]! * im[k]!) / (FS * windowPower);
  }
  return { re, im, psd, df: FS / nfft };
}

function bandPower(spec: Spectrum, lo: number, hi: number): number {
  const first = Math.max(1, Math.ceil(lo / spec.df));
  const last = Math.min(spec.psd.length - 1, Math.floor(hi / spec.df));
  let power = 0;
  for (let k = first; k <= last; k++) power += spec.psd[k]! * spec.df;
  return power;
}

function spatialSummary(spectra: readonly Spectrum[], lo: number, hi: number): {
  effectiveRank: number;
  medianAbsCorrelation: number;
} {
  const first = Math.max(1, Math.ceil(lo / spectra[0]!.df));
  const last = Math.min(spectra[0]!.psd.length - 1, Math.floor(hi / spectra[0]!.df));
  const n = spectra.length;
  const covariance = Array.from({ length: n }, () => new Float64Array(n));
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      let value = 0;
      for (let k = first; k <= last; k++) {
        value += spectra[a]!.re[k]! * spectra[b]!.re[k]!;
        value += spectra[a]!.im[k]! * spectra[b]!.im[k]!;
      }
      covariance[a]![b] = value;
      covariance[b]![a] = value;
    }
  }

  let trace = 0;
  let frobeniusSquared = 0;
  const correlations: number[] = [];
  for (let a = 0; a < n; a++) {
    trace += covariance[a]![a]!;
    for (let b = 0; b < n; b++) {
      const value = covariance[a]![b]!;
      frobeniusSquared += value * value;
      if (b > a) {
        const denominator = Math.sqrt(covariance[a]![a]! * covariance[b]![b]!);
        if (denominator > 0) correlations.push(Math.abs(value / denominator));
      }
    }
  }
  return {
    effectiveRank: trace * trace / frobeniusSquared,
    medianAbsCorrelation: median(correlations),
  };
}

const durationS = Number(arg('--duration', String(scalarValue('isf_probe_record_length'))));
const output = resolve(arg('--output', 'prep/out/isf1_current_baseline.json'));
const selected = arg('--states', ALL_STATES.join(','))
  .split(',')
  .map((state) => state.trim())
  .filter((state): state is StateId => ALL_STATES.includes(state as StateId));
const seed = Number(arg('--seed', '426081'));
if (!(durationS > 0) || selected.length === 0 || !Number.isFinite(seed)) {
  throw new Error('positive duration, finite seed, and at least one valid state are required');
}

const isf = bandEdges('isf_band');
const isf1 = bandEdges('isf1_band');
const isf2 = bandEdges('isf2_band');
const nSamples = Math.round(durationS * FS);
const nfft = nextPowerOfTwo(nSamples);
const rows: object[] = [];

for (const state of selected) {
  const generated = composeState(seed, state, nSamples, FS, {
    suppressGraphoelements: true,
    movementArtifact: false,
    amplitudeModulation: false,
    chiModulation: false,
    eventRespirationCoupling: false,
  });
  const referenced = applyReference(generated.channels, 'linked-mastoid');
  const spectra = referenced.channels.map((channel) => spectrum(channel, nfft));
  const fullPowers = spectra.map((spec) => bandPower(spec, isf.lo, isf.hi));
  const lowPowers = spectra.map((spec) => bandPower(spec, isf1.lo, isf1.hi));
  const highPowers = spectra.map((spec) => bandPower(spec, isf2.lo, isf2.hi));
  const slowPowers = spectra.map((spec) => bandPower(spec, isf.hi, 1));
  const spatial = spatialSummary(spectra, isf.lo, isf.hi);
  rows.push({
    state,
    medianRmsUv: {
      isf: Math.sqrt(median(fullPowers)),
      isf1: Math.sqrt(median(lowPowers)),
      isf2: Math.sqrt(median(highPowers)),
      slowPointOneToOneHz: Math.sqrt(median(slowPowers)),
    },
    medianPowerRatio: {
      isfToPointOneToOneHz: median(fullPowers.map((power, i) => power / slowPowers[i]!)),
      isf1ShareOfIsf: median(lowPowers.map((power, i) => power / fullPowers[i]!)),
    },
    spatial,
    truthHasInfraSlow: 'infraSlow' in generated.truth,
  });
  console.log(`${state}: complete`);
}

const result = {
  probe: 'ISF-1 current continuous-generator baseline',
  generatedAt: new Date().toISOString(),
  generatorVersion: GENERATOR_VERSION,
  seed,
  durationS,
  reference: 'linked-mastoid',
  graphoelementsSuppressed: true,
  optionalRespiratoryEegMechanisms: false,
  bandsHz: { isf, isf1, isf2, comparison: { lo: isf.hi, hi: 1 } },
  interpretationBoundary:
    'Measured sub-0.1 Hz voltage is an incidental part of existing continuous sources, not a named or validated infra-slow mechanism and not a future amplitude target.',
  rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);

console.log('\nstate      ISF RMS  ISF/0.1-1  ISF1 share  rank   |corr|');
for (const row of rows as any[]) {
  console.log(
    `${row.state.padEnd(9)} ${row.medianRmsUv.isf.toFixed(3).padStart(7)}  ` +
    `${row.medianPowerRatio.isfToPointOneToOneHz.toFixed(4).padStart(9)}  ` +
    `${row.medianPowerRatio.isf1ShareOfIsf.toFixed(3).padStart(10)}  ` +
    `${row.spatial.effectiveRank.toFixed(2).padStart(5)}  ` +
    `${row.spatial.medianAbsCorrelation.toFixed(3).padStart(6)}`,
  );
}
console.log(`wrote ${output}`);
