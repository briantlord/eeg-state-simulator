import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCardiacState,
  synthesizeEcg,
  synthesizeEcgChunk,
  type CardiacState,
} from '../src/core/generators/cardiac.ts';
import {
  createRespiratoryState,
  synthesizeRespiration,
  synthesizeRespirationChunk,
} from '../src/core/generators/respiration.ts';
import { SignalStream } from '../src/ui/stream.ts';
import { scalarValue } from '../src/core/registry.ts';

const FS = scalarValue('fs');

function concatenate(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

test('whole-record and chunked cardiac synthesis are sample-identical', () => {
  const seed = 7712;
  const split = FS * 73;
  const tail = FS * 107;
  const respiration = synthesizeRespiration(seed, split + tail, 'n3', FS);
  const whole = synthesizeEcg(seed, 'n3', respiration, FS);

  const firstResp = synthesizeRespirationChunk(
    createRespiratoryState(seed, 'n3', FS),
    split,
  );
  const secondResp = synthesizeRespirationChunk(firstResp.state, tail);
  const first = synthesizeEcgChunk(
    createCardiacState(seed, 'n3', FS),
    firstResp.result,
  );
  const second = synthesizeEcgChunk(first.state, secondResp.result);

  assert.deepEqual(concatenate(first.result.ecg, second.result.ecg), whole.ecg);
  assert.deepEqual(
    [...first.result.rPeaks, ...second.result.rPeaks.map((peak) => peak + split / FS)],
    whole.rPeaks,
  );
});

test('a cardiac checkpoint survives JSON serialization exactly', () => {
  const seed = 887;
  const firstResp = synthesizeRespirationChunk(
    createRespiratoryState(seed, 'rem', FS),
    FS * 19,
  );
  const secondResp = synthesizeRespirationChunk(firstResp.state, FS * 23);
  const first = synthesizeEcgChunk(
    createCardiacState(seed, 'rem', FS),
    firstResp.result,
  );
  const restored = JSON.parse(JSON.stringify(first.state)) as CardiacState;
  const memory = synthesizeEcgChunk(first.state, secondResp.result);
  const json = synthesizeEcgChunk(restored, secondResp.result);

  assert.deepEqual(json.result.ecg, memory.result.ecg);
  assert.deepEqual(json.result.rPeaks, memory.result.rPeaks);
  assert.deepEqual(json.state, memory.state);
});

test('one seed carries the same cardiac phenotype through every state', () => {
  const wake = createCardiacState(221, 'wake_ec', FS);
  for (const state of ['n1', 'n2', 'n3', 'rem'] as const) {
    assert.equal(createCardiacState(221, state, FS).subjectHrMultiplier, wake.subjectHrMultiplier);
  }
});

test('RSA is stronger in NREM than REM and weakest in wake', () => {
  const wake = createCardiacState(1, 'wake_ec', FS).rsaAmplitudeS;
  const n2 = createCardiacState(1, 'n2', FS).rsaAmplitudeS;
  const n3 = createCardiacState(1, 'n3', FS).rsaAmplitudeS;
  const rem = createCardiacState(1, 'rem', FS).rsaAmplitudeS;
  assert.ok(wake < rem);
  assert.ok(rem < n2);
  assert.ok(n2 < n3);
});

test('the live buffer preserves ECG morphology and beat timing across its join', () => {
  const seed = 9903;
  const stream = new SignalStream({ seed, state: 'n2' });
  const n = stream.ecg.length;
  stream.advance(stream.segmentSeconds * 0.8);
  stream.advance(stream.segmentSeconds * 0.2 + 0.01);
  assert.ok(stream.previous);

  const live = concatenate(stream.previous.ecg, stream.ecg);
  const respiration = synthesizeRespiration(seed, n * 2, 'n2', FS);
  const whole = synthesizeEcg(seed, 'n2', respiration, FS);
  assert.deepEqual(live, whole.ecg);
  assert.deepEqual(
    [...stream.previous.rPeaks, ...stream.rPeaks.map((peak) => peak + n / FS)],
    whole.rPeaks,
  );
});
