/**
 * R3 characterization: state-specific aperiodic phase, posterior loading, distinct periodic
 * dynamics, and paired no-silent-power checks.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/r3_eeg_coupling.mts
 *
 * Optional:
 *   --duration 180 --seeds 3 --output prep/out/r3_eeg_coupling.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { composeState, type ComposeResult } from '../../src/core/generators/compose.ts';
import {
  bandAmplitudeHarmonic,
  chiOverTime,
} from '../../src/analysis/coupling.ts';
import { scalarValue, GENERATOR_VERSION } from '../../src/core/registry.ts';
import { ALL_CHANNELS } from '../../src/core/generators/projection.ts';
import type { StateId } from '../../src/core/types/state.ts';

const STATES: readonly StateId[] = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem'];
const FS = scalarValue('fs');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function mean(x: readonly number[]): number {
  return x.reduce((sum, value) => sum + value, 0) / x.length;
}

function signalRms(x: Float64Array): number {
  let power = 0;
  for (const value of x) power += value * value;
  return Math.sqrt(power / x.length);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

interface Harmonic {
  mean: number;
  cos: number;
  sin: number;
  amplitude: number;
  phase: number;
}

/** Least-squares y = intercept + bcos*cos(phi) + bsin*sin(phi). */
function harmonic(values: Float64Array, phases: Float64Array): Harmonic {
  const n = Math.min(values.length, phases.length);
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [1, Math.cos(phases[i]!), Math.sin(phases[i]!)];
    for (let j = 0; j < 3; j++) {
      b[j] = b[j]! + row[j]! * values[i]!;
      for (let k = 0; k < 3; k++) a[j]![k] = a[j]![k]! + row[j]! * row[k]!;
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const d = a[col]![col]!;
    for (let k = col; k < 3; k++) a[col]![k] = a[col]![k]! / d;
    b[col] = b[col]! / d;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      for (let k = col; k < 3; k++) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  return {
    mean: b[0]!,
    cos: b[1]!,
    sin: b[2]!,
    amplitude: Math.hypot(b[1]!, b[2]!),
    phase: Math.atan2(b[2]!, b[1]!),
  };
}

function chiHarmonic(result: ComposeResult, channelIndex: number): Harmonic {
  const estimate = chiOverTime(result.channels[channelIndex]!, FS);
  const hopSamples = Math.round(FS / estimate.fsEst);
  const halfWindow = Math.round((scalarValue('chi_est_window_s') * FS) / 2);
  const phases = new Float64Array(estimate.chi.length);
  for (let i = 0; i < phases.length; i++) {
    phases[i] = result.respirationPhase[Math.min(
      result.respirationPhase.length - 1,
      i * hopSamples + halfWindow,
    )]!;
  }
  return harmonic(estimate.chi, phases);
}

function subtract(a: Harmonic, b: Harmonic): Harmonic {
  const cos = a.cos - b.cos;
  const sin = a.sin - b.sin;
  return {
    mean: a.mean - b.mean,
    cos,
    sin,
    amplitude: Math.hypot(cos, sin),
    phase: Math.atan2(sin, cos),
  };
}

function periodicVector(result: ComposeResult, channelIndex: number): Harmonic {
  const osc = result.truth.oscillations[0]!;
  const fit = bandAmplitudeHarmonic(
    result.channels[channelIndex]!,
    result.respirationPhase,
    osc.band[0],
    osc.band[1],
    FS,
  );
  return {
    mean: fit.meanAmplitude,
    cos: fit.depth * Math.cos(fit.maxPhase),
    sin: fit.depth * Math.sin(fit.maxPhase),
    amplitude: fit.depth,
    phase: fit.maxPhase,
  };
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    xy += da * db;
    xx += da * da;
    yy += db * db;
  }
  return xy / Math.sqrt(xx * yy);
}

const durationS = Number(arg('--duration', '180'));
const nSeeds = Number(arg('--seeds', '3'));
const output = arg('--output', 'prep/out/r3_eeg_coupling.json');
const nSamples = Math.round(durationS * FS);
const pz = ALL_CHANNELS.indexOf('Pz');
const fz = ALL_CHANNELS.indexOf('Fz');
const rows: object[] = [];

for (const state of STATES) {
  for (let k = 0; k < nSeeds; k++) {
    const seed = 89000 + 313 * k;
    const common = { suppressGraphoelements: true } as const;
    const off = composeState(seed, state, nSamples, FS, common);
    const chiOn = composeState(seed, state, nSamples, FS, { ...common, chiModulation: true });
    const periodicOn = composeState(seed, state, nSamples, FS, {
      ...common,
      amplitudeModulation: true,
    });
    const chiPz = subtract(chiHarmonic(chiOn, pz), chiHarmonic(off, pz));
    const chiFz = subtract(chiHarmonic(chiOn, fz), chiHarmonic(off, fz));
    const periodicOnFit = periodicVector(periodicOn, pz);
    const periodicOffFit = periodicVector(off, pz);
    const periodic = subtract(periodicOnFit, periodicOffFit);
    const osc = periodicOn.truth.oscillations[0]!;
    rows.push({
      state,
      seed,
      chi: {
        requestedDepthAtPz: chiOn.truth.chiModDepth * chiOn.truth.chiSpatialLoading[pz]!,
        requestedPhase: chiOn.truth.chiModPhi0,
        recoveredDepthPz: chiPz.amplitude,
        recoveredPhasePz: chiPz.phase,
        phaseErrorPz: wrap(chiPz.phase - chiOn.truth.chiModPhi0),
        recoveredDepthFz: chiFz.amplitude,
        loadingPz: chiOn.truth.chiSpatialLoading[pz],
        loadingFz: chiOn.truth.chiSpatialLoading[fz],
      },
      periodic: {
        generator: osc.generator,
        band: osc.band,
        requestedLogDepth: osc.respModDepth,
        requestedPhase: osc.respModPhi0,
        recoveredDepthPz: periodic.amplitude,
        recoveredPhasePz: periodic.phase,
        phaseErrorPz: wrap(periodic.phase - osc.respModPhi0),
        meanBandAmplitudeRatio: periodicOnFit.mean / periodicOffFit.mean,
      },
      totalRmsRatio: mean(chiOn.channels.map((channel, c) =>
        signalRms(channel) / signalRms(off.channels[c]!))),
    });
  }
}

// One estimator-side topography: does the recovered scalp effect follow the independent BEM
// loading rather than merely recording the truth vector that generated it?
const topoSeed = 89471;
const topoOff = composeState(topoSeed, 'wake_ec', nSamples, FS, { suppressGraphoelements: true });
const topoOn = composeState(topoSeed, 'wake_ec', nSamples, FS, {
  suppressGraphoelements: true,
  chiModulation: true,
});
const recoveredTopography = ALL_CHANNELS.map((_, c) =>
  subtract(chiHarmonic(topoOn, c), chiHarmonic(topoOff, c)).amplitude);
const expectedTopography = [...topoOn.truth.chiSpatialLoading];
const scalpCount = 19;
const topography = {
  recovered: Object.fromEntries(ALL_CHANNELS.map((label, c) => [label, recoveredTopography[c]])),
  loading: Object.fromEntries(ALL_CHANNELS.map((label, c) => [label, expectedTopography[c]])),
  scalpCorrelation: correlation(
    expectedTopography.slice(0, scalpCount),
    recoveredTopography.slice(0, scalpCount),
  ),
};

const result = {
  probe: 'R3 continuous respiratory EEG coupling',
  generatedAt: new Date().toISOString(),
  generatorVersion: GENERATOR_VERSION,
  durationS,
  nSeeds,
  rows,
  topography,
};
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), `${JSON.stringify(result, null, 2)}\n`);

console.log(`R3 EEG coupling — ${nSeeds} seed(s) x ${durationS}s, generator ${GENERATOR_VERSION}`);
console.log('state      chi depth  phase err   Fz/Pz    periodic depth phase err  total RMS');
for (const state of STATES) {
  const selected = rows.filter((row) => (row as any).state === state) as any[];
  const m = (path: (row: any) => number) => mean(selected.map(path));
  console.log(
    `${state.padEnd(9)} ${m(r => r.chi.recoveredDepthPz).toFixed(3).padStart(7)}  ` +
    `${(m(r => Math.abs(r.chi.phaseErrorPz)) * 180 / Math.PI).toFixed(1).padStart(7)}°  ` +
    `${m(r => r.chi.recoveredDepthFz / r.chi.recoveredDepthPz).toFixed(3).padStart(6)}  ` +
    `${m(r => r.periodic.recoveredDepthPz).toFixed(3).padStart(7)}       ` +
    `${(m(r => Math.abs(r.periodic.phaseErrorPz)) * 180 / Math.PI).toFixed(1).padStart(7)}°  ` +
    `${m(r => r.totalRmsRatio).toFixed(4)}`,
  );
}
console.log(`recovered-vs-BEM scalp topography r = ${topography.scalpCorrelation.toFixed(3)}`);
console.log(`wrote ${resolve(output)}`);
