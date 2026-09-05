/**
 * R1 respiratory-controller characterization.
 *
 * Measures the controller directly, before ECG or EEG estimators can obscure its properties.
 * Reference-implementation parity is feature-level: pause frequency and duration, rate, timing
 * CV, depth CV, duty cycle, and exact chunk continuity. It is deliberately not waveform-pixel
 * similarity to BreathMetrics/NeuroKit2.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/r1_respiration_controller.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  createRespiratoryState,
  synthesizeRespiration,
  synthesizeRespirationChunk,
} from '../../src/core/generators/respiration.ts';
import { GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';
import type { StateId } from '../../src/core/types/state.ts';

const FS = scalarValue('fs');
const STATES: readonly StateId[] = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem'];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function cv(values: readonly number[]): number {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2))) / center;
}

function lagOne(values: readonly number[]): number {
  const center = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i < values.length; i++) {
    numerator += (values[i - 1]! - center) * (values[i]! - center);
  }
  for (const value of values) denominator += (value - center) ** 2;
  return denominator > 0 ? numerator / denominator : 0;
}

function maxAbsDifference(a: Float64Array, b: Float64Array): number {
  let maximum = 0;
  for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i]! - b[i]!));
  return maximum;
}

function characterize(state: StateId, seed: number, durationS: number) {
  const n = Math.round(durationS * FS);
  const result = synthesizeRespiration(seed, n, state, FS);
  const periods = result.breaths.map((breath) => breath.durationSamples / FS);
  const depths = result.breaths.map((breath) => breath.depth);
  const inhalePauses = result.breaths.filter((breath) => breath.inhalePauseSamples > 0);
  const exhalePauses = result.breaths.filter((breath) => breath.exhalePauseSamples > 0);
  const ieRatios = result.breaths.map((breath) => breath.exhaleSamples / breath.inhaleSamples);

  const split = Math.round(n * 0.43);
  const first = synthesizeRespirationChunk(createRespiratoryState(seed, state, FS), split);
  const second = synthesizeRespirationChunk(first.state, n - split);
  const chunkedBelt = new Float64Array(n);
  const chunkedPhase = new Float64Array(n);
  chunkedBelt.set(first.result.belt);
  chunkedBelt.set(second.result.belt, split);
  chunkedPhase.set(first.result.phase);
  chunkedPhase.set(second.result.phase, split);

  return {
    state,
    seed,
    targetRatePerMin: createRespiratoryState(seed, state, FS).meanRatePerMin,
    realizedRatePerMin: result.meanRatePerMin,
    periodCv: cv(periods),
    periodLagOne: lagOne(periods),
    depthCv: cv(depths),
    inhalePauseFraction: inhalePauses.length / result.breaths.length,
    exhalePauseFraction: exhalePauses.length / result.breaths.length,
    inhalePauseMeanS: inhalePauses.length > 0
      ? mean(inhalePauses.map((breath) => breath.inhalePauseSamples / FS))
      : 0,
    exhalePauseMeanS: exhalePauses.length > 0
      ? mean(exhalePauses.map((breath) => breath.exhalePauseSamples / FS))
      : 0,
    medianIeRatio: median(ieRatios),
    chunkBeltMaxError: maxAbsDifference(result.belt, chunkedBelt),
    chunkPhaseMaxError: maxAbsDifference(result.phase, chunkedPhase),
  };
}

function main(): void {
  const durationS = Number(arg('--duration', '600'));
  const nSeeds = Number(arg('--seeds', '20'));
  const seedBase = Number(arg('--seed-base', '91000'));
  const output = resolve(arg('--output', 'prep/out/r1_respiration_controller.json'));
  const rows = STATES.flatMap((state) =>
    Array.from({ length: nSeeds }, (_, i) => characterize(state, seedBase + i * 313, durationS)),
  );
  const summary = Object.fromEntries(STATES.map((state) => {
    const selected = rows.filter((row) => row.state === state);
    const m = (key: keyof typeof selected[number]): number =>
      median(selected.map((row) => row[key] as number));
    return [state, {
      // Literature rows are GROUP MEANS, so compare them to the mean across subject phenotypes.
      // Within-subject variability summaries remain medians so one irregular seed cannot dominate.
      ratePerMin: mean(selected.map((row) => row.realizedRatePerMin)),
      periodCv: m('periodCv'),
      periodLagOne: m('periodLagOne'),
      depthCv: m('depthCv'),
      inhalePauseFraction: m('inhalePauseFraction'),
      exhalePauseFraction: m('exhalePauseFraction'),
      pauseDurationS: m('exhalePauseMeanS'),
      ieRatio: m('medianIeRatio'),
      chunkBeltMaxError: Math.max(...selected.map((row) => row.chunkBeltMaxError)),
      chunkPhaseMaxError: Math.max(...selected.map((row) => row.chunkPhaseMaxError)),
    }];
  }));
  const report = {
    probe: 'R1 respiratory controller',
    generatedAt: new Date().toISOString(),
    generatorVersion: GENERATOR_VERSION,
    durationS,
    nSeeds,
    externalFeatureAnchor: {
      implementation: 'BreathMetrics model as exposed by NeuroKit2 rsp_simulate',
      inhalePauseFraction: scalarValue('resp_inhale_pause_probability'),
      exhalePauseFraction: scalarValue('resp_exhale_pause_probability'),
      pauseDurationS: scalarValue('resp_pause_duration_s'),
      comparison: 'feature distributions, not waveform-pixel similarity',
    },
    summary,
    rows,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

  console.log(`R1 respiratory controller — group mean rate, median dynamics across ${nSeeds} seeds x ${durationS} s`);
  console.log('state      rate    IBIcv   lag1 depthCV pauseI pauseE pauseS   I:E join');
  for (const state of STATES) {
    const row = summary[state] as Record<string, number>;
    console.log(
      `${state.padEnd(9)} ${row.ratePerMin!.toFixed(2).padStart(5)}` +
      ` ${row.periodCv!.toFixed(3).padStart(7)} ${row.periodLagOne!.toFixed(3).padStart(6)}` +
      ` ${row.depthCv!.toFixed(3).padStart(7)}` +
      ` ${row.inhalePauseFraction!.toFixed(3).padStart(6)}` +
      ` ${row.exhalePauseFraction!.toFixed(3).padStart(6)}` +
      ` ${row.pauseDurationS!.toFixed(3).padStart(6)}` +
      ` ${row.ieRatio!.toFixed(2).padStart(5)}` +
      ` ${Math.max(row.chunkBeltMaxError!, row.chunkPhaseMaxError!).toExponential(1)}`,
    );
  }
  console.log(`Machine-readable result: ${output}`);
}

main();
