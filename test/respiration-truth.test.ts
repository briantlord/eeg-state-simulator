import test from 'node:test';
import assert from 'node:assert/strict';

import { composeState } from '../src/core/generators/compose.ts';
import { respiratoryRateForState } from '../src/core/generators/respiration.ts';
import { scalarValue } from '../src/core/registry.ts';

const FS = scalarValue('fs');

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sd(values: readonly number[]): number {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

test('regular respiration is a fixed-cycle contrast at the state mean', () => {
  const durationS = 240; // @lit-ok four-minute truth fixture
  const regular = composeState(5501, 'n3', durationS * FS, FS, {
    respirationMode: 'regular',
    suppressGraphoelements: true,
  });
  const natural = composeState(5501, 'n3', durationS * FS, FS, {
    respirationMode: 'natural',
    suppressGraphoelements: true,
  });

  assert.equal(regular.truth.respiration.mode, 'regular');
  assert.equal(natural.truth.respiration.mode, 'natural');
  assert.equal(regular.truth.respiration.periodCv, 0);
  assert.equal(regular.truth.respiration.depthCv, 0);
  assert.equal(regular.truth.respiration.periodLag1, null);
  assert.ok(natural.truth.respiration.periodCv! > 0);
  assert.ok(natural.truth.respiration.depthCv! > 0);
  assert.ok(
    Math.abs(regular.truth.respiration.meanRatePerMin - respiratoryRateForState('n3')) < 0.05, // @lit-ok sample-quantization bound in breaths/min
  );
});

test('schema-v6 physiology summaries equal controller truth', () => {
  const result = composeState(7712, 'n2', 300 * FS, FS, { // @lit-ok five-minute truth fixture
    movementArtifact: true,
    amplitudeModulation: true,
    chiModulation: true,
    eventRespirationCoupling: true,
  });
  const truth = result.truth;
  const periods = truth.respiration.breaths.map((breath) => breath.durationS);
  const depths = truth.respiration.breaths.map((breath) => breath.depth);
  assert.equal(truth.respiration.periodCv, sd(periods) / mean(periods));
  assert.equal(truth.respiration.depthCv, sd(depths) / mean(depths));
  assert.deepEqual(truth.cardiac.rPeaksS, result.rPeaks);
  assert.equal(truth.cardiac.rrIntervalsS.length, result.rPeaks.length);
  assert.equal(truth.cardiac.sdnnMs, sd(truth.cardiac.rrIntervalsS) * 1000); // @lit-ok milliseconds per second
  assert.ok(truth.cardiac.recoveredRsaAmplitudeMs! > 0);
  assert.ok(Number.isFinite(truth.cardiac.recoveredRsaR2));
  assert.equal(truth.infraSlow?.profile, 'provisional_release');
  assert.ok((truth.infraSlow?.sourceModes.length ?? 0) > 0);

  for (const summary of truth.eventPhaseSummaries) {
    const selected = result.events.filter((event) => event.type === summary.type);
    assert.equal(summary.n, selected.length);
    assert.equal(
      summary.coupledCount,
      selected.filter((event) => event.params['respCoupled'] === 1).length,
    );
  }
});

test('short records serialize unavailable realized statistics as null, never NaN', () => {
  const result = composeState(8804, 'wake_ec', FS, FS);
  const encoded = JSON.stringify(result.truth);
  assert.ok(!encoded.includes('NaN'));
  assert.equal(result.truth.cardiac.sdnnMs, null);
  assert.equal(result.truth.cardiac.recoveredRsaAmplitudeMs, null);
});
