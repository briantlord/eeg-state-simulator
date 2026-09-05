#!/usr/bin/env node
/**
 * R4 direct characterization: matched respiratory event hazards over natural breathing.
 *
 * This reads injected event truth, not EEG detections. Its jobs are to establish exact marginal
 * count preservation, quantify the generated circular distributions, and expose the slow-spindle
 * mechanism-off arm before an external detector is asked to recover anything.
 *
 * @lit-ok-file: characterization durations, seed counts, circular-shift count and report
 * precision are probe design, not shipped signal parameters.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeGraphoelements } from '../../src/core/generators/graphoelements.ts';
import { synthesizeRespiration } from '../../src/core/generators/respiration.ts';
import { GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';
import type { GeneratedEvent, EventType } from '../../src/core/types/event.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FS = scalarValue('fs');
const DURATION_S = Number(process.argv[2] ?? 3600);
const N_SEEDS = Number(process.argv[3] ?? 5);
const N_SHIFTS = 17;

interface CircularSummary {
  n: number;
  angle: number;
  length: number;
}

function circular(phases: readonly number[]): CircularSummary {
  let x = 0;
  let y = 0;
  for (const phase of phases) {
    x += Math.cos(phase);
    y += Math.sin(phase);
  }
  return {
    n: phases.length,
    angle: phases.length ? Math.atan2(y, x) : Number.NaN,
    length: phases.length ? Math.hypot(x, y) / phases.length : Number.NaN,
  };
}

function angleError(angle: number, target: number): number {
  return Math.atan2(Math.sin(angle - target), Math.cos(angle - target));
}

function markerTime(event: GeneratedEvent): number {
  return event.onset + (event.params.respMarkerOffsetS ?? 0);
}

function phaseAt(phase: Float64Array, timeS: number): number {
  const i = Math.max(0, Math.min(phase.length - 1, Math.round(timeS * FS)));
  return phase[i] ?? 0;
}

function eventsOf(events: readonly GeneratedEvent[], type: EventType): GeneratedEvent[] {
  return events.filter((event) => event.type === type);
}

function shiftedNull(
  events: readonly GeneratedEvent[],
  phase: Float64Array,
): CircularSummary {
  const pooled: number[] = [];
  for (let shift = 1; shift <= N_SHIFTS; shift++) {
    const offset = Math.floor((phase.length * shift) / (N_SHIFTS + 1));
    for (const event of events) {
      const i = Math.max(0, Math.min(phase.length - 1, Math.round(markerTime(event) * FS)));
      pooled.push(phase[(i + offset) % phase.length] ?? 0);
    }
  }
  return circular(pooled);
}

const rows: Record<string, unknown>[] = [];
let allCountsExact = true;
let slowSpindlesIdentical = true;

for (const state of ['n2', 'n3'] as const) {
  for (let s = 0; s < N_SEEDS; s++) {
    const seed = 73000 + s * 313;
    const respiration = synthesizeRespiration(seed, DURATION_S * FS, state, FS);
    const common = { respirationPhase: respiration.phase } as const;
    const off = synthesizeGraphoelements(seed, state, DURATION_S * FS, FS, {
      ...common,
      respiratoryEventCoupling: false,
    });
    const on = synthesizeGraphoelements(seed, state, DURATION_S * FS, FS, {
      ...common,
      respiratoryEventCoupling: true,
    });

    for (const type of ['slow_oscillation', 'spindle_fast', 'spindle_slow'] as const) {
      const offEvents = eventsOf(off.events, type);
      const onEvents = eventsOf(on.events, type);
      if (offEvents.length !== onEvents.length) allCountsExact = false;
      if (type === 'spindle_slow') {
        const offSignature = offEvents.map((event) => [event.onset, event.duration, event.amplitude]);
        const onSignature = onEvents.map((event) => [event.onset, event.duration, event.amplitude]);
        if (JSON.stringify(offSignature) !== JSON.stringify(onSignature)) slowSpindlesIdentical = false;
      }
      if (onEvents.length === 0) continue;
      const target = type === 'slow_oscillation'
        ? scalarValue('resp_so_pref_phase')
        : type === 'spindle_fast'
          ? scalarValue('resp_spindle_fast_pref_phase')
          : null;
      const onPhases = onEvents.map((event) => phaseAt(respiration.phase, markerTime(event)));
      const offPhases = offEvents.map((event) => phaseAt(respiration.phase, markerTime(event)));
      const observed = circular(onPhases);
      rows.push({
        state,
        seed,
        type,
        count: onEvents.length,
        target,
        phase: observed,
        phaseError: target === null ? null : angleError(observed.angle, target),
        mechanismOff: circular(offPhases),
        shiftedNull: shiftedNull(onEvents, respiration.phase),
      });
    }
  }
}

function pooled(state: 'n2' | 'n3', type: EventType, arm: 'phase' | 'mechanismOff' | 'shiftedNull') {
  const selected = rows.filter((row) => row.state === state && row.type === type);
  let x = 0;
  let y = 0;
  let n = 0;
  for (const row of selected) {
    const value = row[arm] as CircularSummary;
    x += value.length * value.n * Math.cos(value.angle);
    y += value.length * value.n * Math.sin(value.angle);
    n += value.n;
  }
  return { n, angle: Math.atan2(y, x), length: n ? Math.hypot(x, y) / n : Number.NaN };
}

const summary = [];
for (const state of ['n2', 'n3'] as const) {
  for (const type of ['slow_oscillation', 'spindle_fast', 'spindle_slow'] as const) {
    const value = pooled(state, type, 'phase');
    if (value.n === 0) continue;
    const target = type === 'slow_oscillation'
      ? scalarValue('resp_so_pref_phase')
      : type === 'spindle_fast'
        ? scalarValue('resp_spindle_fast_pref_phase')
        : null;
    summary.push({
      state,
      type,
      ...value,
      target,
      phaseError: target === null ? null : angleError(value.angle, target),
      mechanismOff: pooled(state, type, 'mechanismOff'),
      shiftedNull: pooled(state, type, 'shiftedNull'),
    });
  }
}

const result = {
  generatorVersion: GENERATOR_VERSION,
  durationS: DURATION_S,
  nSeeds: N_SEEDS,
  allCountsExact,
  slowSpindlesIdentical,
  summary,
  rows,
};
const out = resolve(ROOT, 'prep/out/r4_event_hazards.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

console.log(`R4 event hazards — ${N_SEEDS} seed(s) x ${DURATION_S}s`);
console.log(`counts exact: ${allCountsExact}; slow-spindle path identical: ${slowSpindlesIdentical}`);
console.log('state type                 n  angle   target   error    R    offR shuffledR');
for (const row of summary) {
  const target = row.target as number | null;
  console.log(
    `${row.state.padEnd(5)} ${row.type.padEnd(20)} ${String(row.n).padStart(4)} ` +
    `${row.angle.toFixed(3).padStart(7)} ${target === null ? '      -' : target.toFixed(3).padStart(7)} ` +
    `${row.phaseError === null ? '      -' : (row.phaseError as number).toFixed(3).padStart(7)} ` +
    `${row.length.toFixed(3).padStart(6)} ` +
    `${row.mechanismOff.length.toFixed(3).padStart(7)} ` +
    `${row.shiftedNull.length.toFixed(3).padStart(9)}`,
  );
}
console.log(`Machine-readable result: ${out}`);
