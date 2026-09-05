/**
 * R5 release-integration audit.
 *
 * This is deliberately structural. It asserts exact invariants (count preservation, fixed-mode
 * regularity, complete finite truth) and RECORDS marginal RMS interactions. It does not invent
 * a realism tolerance from the same generated records it evaluates.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/r5_release_integration.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { composeState, type ComposeOptions, type ComposeResult } from '../../src/core/generators/compose.ts';
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

function multichannelRms(result: ComposeResult): number {
  let sumSquares = 0;
  let count = 0;
  for (const channel of result.channels) {
    for (const value of channel) sumSquares += value * value;
    count += channel.length;
  }
  return Math.sqrt(sumSquares / count);
}

function differenceRms(a: ComposeResult, b: ComposeResult): number {
  let sumSquares = 0;
  let count = 0;
  for (let c = 0; c < a.channels.length; c++) {
    for (let i = 0; i < a.channels[c]!.length; i++) {
      const difference = a.channels[c]![i]! - b.channels[c]![i]!;
      sumSquares += difference * difference;
      count++;
    }
  }
  return Math.sqrt(sumSquares / count);
}

function eventCounts(result: ComposeResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of result.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
}

function sameCounts(a: ComposeResult, b: ComposeResult): boolean {
  return JSON.stringify(eventCounts(a)) === JSON.stringify(eventCounts(b));
}

function generate(seed: number, state: StateId, n: number, options: ComposeOptions): ComposeResult {
  return composeState(seed, state, n, FS, {
    suppressGraphoelements: false,
    ...options,
  });
}

const durationS = Number(arg('--duration', '120'));
const nSeeds = Number(arg('--seeds', '2'));
const output = resolve(arg('--output', 'prep/out/r5_release_integration.json'));
const n = Math.round(durationS * FS);
const rows: object[] = [];

for (const state of STATES) {
  for (let i = 0; i < nSeeds; i++) {
    const seed = 97001 + i * 313; // @lit-ok stable characterization seed family
    const all = {
      respirationMode: 'natural',
      movementArtifact: true,
      amplitudeModulation: true,
      chiModulation: true,
      eventRespirationCoupling: true,
    } as const;
    const full = generate(seed, state, n, all);
    const noMovement = generate(seed, state, n, { ...all, movementArtifact: false });
    const noAmplitude = generate(seed, state, n, { ...all, amplitudeModulation: false });
    const noChi = generate(seed, state, n, { ...all, chiModulation: false });
    const noEventTiming = generate(seed, state, n, { ...all, eventRespirationCoupling: false });
    const regular = generate(seed, state, n, { ...all, respirationMode: 'regular' });

    if (!sameCounts(full, noEventTiming)) {
      throw new Error(`R5 count invariant failed for ${state} seed ${seed}`);
    }
    if (regular.truth.respiration.periodCv !== 0 || regular.truth.respiration.depthCv !== 0) {
      throw new Error(`R5 regular-mode invariant failed for ${state} seed ${seed}`);
    }
    if (full.truth.respiration.breaths.length === 0 || full.truth.cardiac.rPeaksS.length === 0) {
      throw new Error(`R5 truth is incomplete for ${state} seed ${seed}`);
    }
    const mechanisms = {
      movement: differenceRms(full, noMovement),
      periodicAmplitude: differenceRms(full, noAmplitude),
      aperiodicSlope: differenceRms(full, noChi),
      eventTiming: differenceRms(full, noEventTiming),
    };
    for (const [mechanism, rms] of Object.entries(mechanisms)) {
      const shouldAct = mechanism !== 'eventTiming' || state === 'n2' || state === 'n3';
      if (shouldAct && !(rms > 0)) {
        throw new Error(`R5 ${mechanism} path is inert for ${state} seed ${seed}`);
      }
      if (!shouldAct && rms !== 0) {
        throw new Error(`R5 event timing leaked into ${state} seed ${seed}`);
      }
    }

    rows.push({
      state,
      seed,
      natural: {
        ratePerMin: full.truth.respiration.meanRatePerMin,
        periodCv: full.truth.respiration.periodCv,
        periodLag1: full.truth.respiration.periodLag1,
        depthCv: full.truth.respiration.depthCv,
      },
      regular: {
        ratePerMin: regular.truth.respiration.meanRatePerMin,
        periodCv: regular.truth.respiration.periodCv,
        depthCv: regular.truth.respiration.depthCv,
      },
      fullRmsUv: multichannelRms(full),
      marginalDifferenceRmsUv: mechanisms,
      eventCounts: eventCounts(full),
      eventCountsPreserved: true,
      cardiac: full.truth.cardiac,
    });
  }
}

const result = {
  probe: 'R5 release interaction audit',
  generatedAt: new Date().toISOString(),
  generatorVersion: GENERATOR_VERSION,
  durationS,
  nSeeds,
  rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);

console.log(`R5 release integration — ${nSeeds} seed(s) x ${durationS}s, generator ${GENERATOR_VERSION}`);
console.log('state      period CV  regular CV  movement Δ  amp Δ      chi Δ      event Δ');
for (const state of STATES) {
  const selected = rows.filter((row) => (row as any).state === state) as any[];
  const m = (read: (row: any) => number) => mean(selected.map(read));
  console.log(
    `${state.padEnd(9)} ${m((r) => r.natural.periodCv).toFixed(3).padStart(8)}  ` +
    `${m((r) => r.regular.periodCv).toFixed(3).padStart(10)}  ` +
    `${m((r) => r.marginalDifferenceRmsUv.movement).toFixed(3).padStart(10)}  ` +
    `${m((r) => r.marginalDifferenceRmsUv.periodicAmplitude).toFixed(3).padStart(8)}  ` +
    `${m((r) => r.marginalDifferenceRmsUv.aperiodicSlope).toFixed(3).padStart(8)}  ` +
    `${m((r) => r.marginalDifferenceRmsUv.eventTiming).toFixed(3).padStart(8)}`,
  );
}
console.log('exact event-count invariant: PASS');
console.log(`wrote ${output}`);
