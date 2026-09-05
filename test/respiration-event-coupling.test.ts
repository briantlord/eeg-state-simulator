import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeGraphoelements } from '../src/core/generators/graphoelements.ts';
import { phaseRamp } from '../src/core/generators/respiration.ts';
import { scalarValue } from '../src/core/registry.ts';
import type { GeneratedEvent, EventType } from '../src/core/types/event.ts';

const FS = scalarValue('fs');

function count(events: readonly GeneratedEvent[], type: EventType): number {
  return events.filter((event) => event.type === type).length;
}

function circularMean(phases: readonly number[]): { angle: number; length: number } {
  let x = 0;
  let y = 0;
  for (const phase of phases) {
    x += Math.cos(phase);
    y += Math.sin(phase);
  }
  return {
    angle: Math.atan2(y, x),
    length: phases.length === 0 ? 0 : Math.hypot(x, y) / phases.length,
  };
}

function angleDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

test('respiratory event hazards preserve every marginal event count exactly', () => {
  const n = FS * 3600; // @lit-ok one-hour invariant fixture
  const phase = phaseRamp(n, 0.25, FS); // @lit-ok representative respiratory-rate fixture
  for (const state of ['n2', 'n3'] as const) {
    const common = { respirationPhase: phase } as const;
    const off = synthesizeGraphoelements(8192, state, n, FS, {
      ...common,
      respiratoryEventCoupling: false,
    });
    const on = synthesizeGraphoelements(8192, state, n, FS, {
      ...common,
      respiratoryEventCoupling: true,
    });
    for (const type of ['slow_oscillation', 'spindle_fast', 'spindle_slow'] as const) {
      assert.equal(count(on.events, type), count(off.events, type), `${state} ${type}`);
    }
  }
});

test('slow-spindle timing is the bit-identical respiratory negative-control path', () => {
  const n = FS * 1200; // @lit-ok twenty-minute negative-control fixture
  const phase = phaseRamp(n, 0.25, FS); // @lit-ok representative respiratory-rate fixture
  const common = { respirationPhase: phase, spindleFastFraction: 0 } as const;
  const off = synthesizeGraphoelements(4096, 'n2', n, FS, {
    ...common,
    respiratoryEventCoupling: false,
  });
  const on = synthesizeGraphoelements(4096, 'n2', n, FS, {
    ...common,
    respiratoryEventCoupling: true,
  });
  assert.deepEqual(
    on.events.map((event) => [event.type, event.onset, event.duration, event.amplitude]),
    off.events.map((event) => [event.type, event.onset, event.duration, event.amplitude]),
  );
});

test('conditioned event markers recover the registered phase ordering', () => {
  const n = FS * 7200; // @lit-ok two-hour circular-statistics fixture
  const phase = phaseRamp(n, 0.25, FS); // @lit-ok representative respiratory-rate fixture
  const result = synthesizeGraphoelements(2048, 'n3', n, FS, {
    respirationPhase: phase,
    respiratoryEventCoupling: true,
    spindleFastFraction: 1,
  });
  const mechanismOff = synthesizeGraphoelements(2048, 'n3', n, FS, {
    respirationPhase: phase,
    respiratoryEventCoupling: false,
    spindleFastFraction: 1,
  });
  const slowOsc = result.events
    .filter((event) => event.type === 'slow_oscillation')
    .map((event) => event.params.respPhase!);
  const fastSpindle = result.events
    .filter((event) => event.type === 'spindle_fast')
    .map((event) => event.params.respPhase!);
  const so = circularMean(slowOsc);
  const spindle = circularMean(fastSpindle);
  const offSo = circularMean(mechanismOff.events
    .filter((event) => event.type === 'slow_oscillation')
    .map((event) => event.params.respPhase!));
  const offSpindle = circularMean(mechanismOff.events
    .filter((event) => event.type === 'spindle_fast')
    .map((event) => event.params.respPhase!));
  assert.ok(
    angleDistance(so.angle, scalarValue('resp_so_pref_phase')) <
      angleDistance(offSo.angle, scalarValue('resp_so_pref_phase')),
  );
  assert.ok(
    angleDistance(spindle.angle, scalarValue('resp_spindle_fast_pref_phase')) <
      angleDistance(offSpindle.angle, scalarValue('resp_spindle_fast_pref_phase')),
  );
  assert.ok(so.length > offSo.length);
  assert.ok(spindle.length > offSpindle.length);
});
