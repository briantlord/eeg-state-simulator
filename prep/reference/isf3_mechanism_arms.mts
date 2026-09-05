/**
 * ISF-3 matched mechanism arms.
 *
 * The fixture numbers below are deliberately local. They demonstrate identifiability of the
 * additive and modulatory paths; they do not fill any absent registry row. Recovery uses an
 * estimator path independent of the generator's gain implementation: alpha bandpass -> Hilbert
 * envelope -> least-squares log-envelope loading on the known infra-slow driver.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf3_mechanism_arms.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bandpassSections, filtfilt } from '../../src/core/dsp/biquad.ts';
import { envelopeAndPhase } from '../../src/core/dsp/fft.ts';
import {
  composeState,
  type InfraSlowFixtureOptions,
} from '../../src/core/generators/compose.ts';
import { synthesizeInfraSlow } from '../../src/core/generators/infraslow.ts';
import { modesOf } from '../../src/core/generators/projection.ts';
import { bandEdges, GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fs = scalarValue('fs');
const n = 65_536;
const seed = 830_117;
const temporal = {
  exponent: 1,
  poleCount: 9,
  isf1VarianceFraction: 0.5,
} as const;
const additiveRmsUv = 5;
const modulationDepth = 0.4;
const common = {
  suppressGraphoelements: true,
  eventRespirationCoupling: false,
} as const;

const additive: InfraSlowFixtureOptions = {
  ...temporal,
  additiveRmsUv: { isf_posterior: additiveRmsUv },
};
const alignedModulation = [{
  targetSource: 'alpha' as const,
  driverFamily: 'isf_posterior' as const,
  logAmplitudeDepth: modulationDepth,
}];

const arms = {
  off: composeState(seed, 'wake_ec', n, fs, common),
  additive: composeState(seed, 'wake_ec', n, fs, {
    ...common,
    infraSlowFixture: additive,
  }),
  modulation: composeState(seed, 'wake_ec', n, fs, {
    ...common,
    infraSlowFixture: { ...temporal, modulation: alignedModulation },
  }),
  both: composeState(seed, 'wake_ec', n, fs, {
    ...common,
    infraSlowFixture: { ...additive, modulation: alignedModulation },
  }),
  inverted: composeState(seed, 'wake_ec', n, fs, {
    ...common,
    infraSlowFixture: {
      ...additive,
      modulation: [{ ...alignedModulation[0]!, phaseInverted: true }],
    },
  }),
};

const posteriorMode0 = modesOf('isf_posterior')[0]!;
const driver = synthesizeInfraSlow(seed, [posteriorMode0], n, temporal, fs)[posteriorMode0]!.combined;
const pz = 14;
const alpha = bandEdges('alpha_band');
const trim = Math.round(10 * fs);

function alphaEnvelope(signal: Float64Array): Float64Array {
  const filtered = Float64Array.from(signal);
  filtfilt(filtered, bandpassSections(alpha.lo, alpha.hi, fs, scalarValue('filter_order')));
  return envelopeAndPhase(filtered).envelope;
}

function mean(values: Float64Array, lo: number, hi: number): number {
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += values[i]!;
  return sum / (hi - lo);
}

function regressionSlope(x: Float64Array, y: Float64Array): number {
  const lo = trim;
  const hi = Math.min(x.length, y.length) - trim;
  const mx = mean(x, lo, hi);
  let my = 0;
  for (let i = lo; i < hi; i++) my += Math.log(Math.max(y[i]!, Number.EPSILON));
  my /= hi - lo;
  let covariance = 0;
  let variance = 0;
  for (let i = lo; i < hi; i++) {
    const dx = x[i]! - mx;
    covariance += dx * (Math.log(Math.max(y[i]!, Number.EPSILON)) - my);
    variance += dx * dx;
  }
  return covariance / variance;
}

function rms(values: Float64Array): number {
  let power = 0;
  for (const value of values) power += value * value;
  return Math.sqrt(power / values.length);
}

function correlation(a: Float64Array, b: Float64Array): number {
  const ma = mean(a, trim, a.length - trim);
  const mb = mean(b, trim, b.length - trim);
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = trim; i < a.length - trim; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    xy += x * y;
    xx += x * x;
    yy += y * y;
  }
  return xy / Math.sqrt(xx * yy);
}

const recovered = Object.fromEntries(Object.entries(arms).map(([name, arm]) => {
  const envelope = alphaEnvelope(arm.channels[pz]!);
  const filtered = Float64Array.from(arm.channels[pz]!);
  filtfilt(filtered, bandpassSections(alpha.lo, alpha.hi, fs, scalarValue('filter_order')));
  return [name, {
    logEnvelopeSlopeOnDriver: regressionSlope(driver, envelope),
    alphaBandRmsUv: rms(filtered.subarray(trim, filtered.length - trim)),
  }];
}));

let additiveLinearityResidual = 0;
for (let c = 0; c < arms.off.channels.length; c++) {
  for (let i = 0; i < n; i++) {
    const additiveOnly = arms.additive.channels[c]![i]! - arms.off.channels[c]![i]!;
    const additiveInBoth = arms.both.channels[c]![i]! - arms.modulation.channels[c]![i]!;
    additiveLinearityResidual = Math.max(
      additiveLinearityResidual,
      Math.abs(additiveOnly - additiveInBoth),
    );
  }
}

const result = {
  probe: 'ISF-3 matched additive/modulation mechanism arms',
  generatorVersion: GENERATOR_VERSION,
  fixture: {
    note: 'Characterization only; no value in this block is promoted to the registry.',
    durationS: n / fs,
    seed,
    temporal,
    additiveRmsUv,
    modulationDepth,
  },
  estimator: 'Pz 8-12 Hz bandpass; Hilbert amplitude; LS slope of log amplitude on known ISF driver',
  recovered,
  additiveLinearityMaxAbsResidualUv: additiveLinearityResidual,
  respirationSeparation: {
    driverBeltCorrelation: correlation(driver, arms.both.respirationBelt),
    statement: 'Respiration is generated from an independent substream and is not an ISF driver.',
  },
  claimBoundary: {
    physiologicalAmplitudeSelected: false,
    modulationDepthSelected: false,
    sharedFractionSelected: false,
    sourceDelaySelected: false,
    remProfileSelected: false,
  },
};

const out = resolve(root, 'prep', 'out', 'isf3_mechanism_arms.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.table(recovered);
console.log(`additive linearity residual: ${additiveLinearityResidual}`);
console.log(`driver/belt correlation: ${result.respirationSeparation.driverBeltCorrelation}`);
console.log(`wrote ${out}`);
