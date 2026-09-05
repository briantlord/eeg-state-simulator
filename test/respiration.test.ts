import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRespiratoryState,
  synthesizeRespiration,
  synthesizeRespirationChunk,
  type RespiratoryState,
} from '../src/core/generators/respiration.ts';
import { composeState } from '../src/core/generators/compose.ts';
import { SignalStream } from '../src/ui/stream.ts';
import { scalarValue } from '../src/core/registry.ts';

const FS = scalarValue('fs');

function concatenate(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function cv(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function rms(signal: Float64Array): number {
  return Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);
}

test('whole-record and chunked respiration are sample-identical', () => {
  const split = FS * 37;
  const tail = FS * 53;
  const whole = synthesizeRespiration(9182, split + tail, 'rem', FS);
  const first = synthesizeRespirationChunk(createRespiratoryState(9182, 'rem', FS), split);
  const second = synthesizeRespirationChunk(first.state, tail);

  assert.deepEqual(concatenate(first.result.belt, second.result.belt), whole.belt);
  assert.deepEqual(concatenate(first.result.phase, second.result.phase), whole.phase);
});

test('a respiratory checkpoint survives JSON serialization exactly', () => {
  const first = synthesizeRespirationChunk(createRespiratoryState(731, 'wake_ec', FS), FS * 11);
  const restored = JSON.parse(JSON.stringify(first.state)) as RespiratoryState;
  const fromMemory = synthesizeRespirationChunk(first.state, FS * 17);
  const fromJson = synthesizeRespirationChunk(restored, FS * 17);

  assert.deepEqual(fromJson.result.belt, fromMemory.result.belt);
  assert.deepEqual(fromJson.result.phase, fromMemory.result.phase);
  assert.deepEqual(fromJson.state, fromMemory.state);
});

test('one seed carries the same subject-rate phenotype through every state', () => {
  const wake = createRespiratoryState(4401, 'wake_ec', FS);
  for (const state of ['n1', 'n2', 'n3', 'rem'] as const) {
    assert.equal(createRespiratoryState(4401, state, FS).subjectRateMultiplier, wake.subjectRateMultiplier);
  }
});

test('natural morphology varies depth, duty cycle, and pause occurrence', () => {
  const result = synthesizeRespiration(509, FS * 600, 'wake_ec', FS);
  assert.ok(new Set(result.breaths.map((breath) => breath.depth.toFixed(6))).size > 10);
  assert.ok(new Set(result.breaths.map((breath) => breath.inhaleSamples)).size > 10);
  assert.ok(result.breaths.some((breath) => breath.inhalePauseSamples === 0));
  assert.ok(result.breaths.some((breath) => breath.inhalePauseSamples > 0));
  assert.ok(result.breaths.some((breath) => breath.exhalePauseSamples === 0));
  assert.ok(result.breaths.some((breath) => breath.exhalePauseSamples > 0));
});

test('N3 timing is more regular than wake and REM in a matched long run', () => {
  const periodCv = (state: 'wake_ec' | 'n3' | 'rem'): number => {
    const result = synthesizeRespiration(8204, FS * 3600, state, FS);
    return cv(result.breaths.map((breath) => breath.durationSamples));
  };
  const wake = periodCv('wake_ec');
  const n3 = periodCv('n3');
  const rem = periodCv('rem');
  assert.ok(n3 < wake, `expected N3 CV ${n3} < wake CV ${wake}`);
  assert.ok(n3 < rem, `expected N3 CV ${n3} < REM CV ${rem}`);
});

test('a fixed-rate fixture remains periodic and morphology-stable', () => {
  const result = synthesizeRespiration(12, FS * 120, 'n3', FS, 15);
  assert.equal(new Set(result.breaths.map((breath) => breath.durationSamples)).size, 1);
  assert.equal(new Set(result.breaths.map((breath) => breath.depth)).size, 1);
  assert.equal(result.meanRatePerMin, 15);
});

test('the live buffer preserves the generated belt across its segment join', () => {
  const stream = new SignalStream({ seed: 3302, state: 'wake_ec' });
  const n = stream.respirationBelt.length;
  stream.advance(stream.segmentSeconds * 0.8);
  stream.advance(stream.segmentSeconds * 0.2 + 0.01);
  assert.ok(stream.previous);

  const live = concatenate(stream.previous.respirationBelt, stream.respirationBelt);
  const whole = synthesizeRespiration(3302, n * 2, 'wake_ec', FS);
  assert.deepEqual(live, whole.belt);
  assert.equal(stream.respirationPhase[0], whole.phase[n]);
});

test('N3 background gain no longer amplifies the mechanical artifact', () => {
  const artifactAt = (state: 'wake_ec' | 'n3'): number => {
    const options = { respRatePerMin: 15, movementArtifact: true } as const;
    const withArtifact = composeState(602, state, FS * 20, FS, options);
    const withoutArtifact = composeState(602, state, FS * 20, FS, {
      ...options,
      movementArtifact: false,
    });
    const difference = new Float64Array(withArtifact.channels[0]!.length);
    for (let i = 0; i < difference.length; i++) {
      difference[i] = withArtifact.channels[0]![i]! - withoutArtifact.channels[0]![i]!;
    }
    return rms(difference);
  };

  assert.ok(Math.abs(artifactAt('wake_ec') - artifactAt('n3')) < 1e-10);
});
