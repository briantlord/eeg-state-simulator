import assert from 'node:assert/strict';
import test from 'node:test';

import { applyReference } from '../src/analysis/referencing.ts';
import {
  composeState,
  type RecordingDriftFixtureOptions,
} from '../src/core/generators/compose.ts';
import { ALL_CHANNELS } from '../src/core/generators/projection.ts';
import { synthesizeRecordingDrift } from '../src/core/generators/recording_drift.ts';

const FIXTURE: RecordingDriftFixtureOptions = {
  exponent: 1,
  poleCount: 9, // @lit-ok ISF fixture approximation; deliberately not a registry value
  isf1VarianceFraction: 0.5,
  perChannelRmsUv: 1,
  commonReferenceRmsUv: 0.7, // @lit-ok visible reference-path fixture, not physiology
};

test('recording drift is added directly in electrode space, never through BEM modes', () => {
  const seed = 51031; // @lit-ok matched ISF-5 fixture seed
  const n = 1_337; // @lit-ok non-controller-aligned fixture record
  const common = {
    suppressGraphoelements: true,
    eventRespirationCoupling: false,
    infraSlow: false,
  } as const;
  const off = composeState(seed, 'wake_ec', n, undefined, common);
  const on = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    recordingDriftFixture: FIXTURE,
  });
  const expected = synthesizeRecordingDrift(seed, n, FIXTURE);

  let residual = 0;
  let scale = 0;
  for (let c = 0; c < ALL_CHANNELS.length; c++) {
    for (let i = 0; i < n; i++) {
      const actual = on.channels[c]![i]! - off.channels[c]![i]!;
      residual = Math.max(residual, Math.abs(actual - expected.channels[c]![i]!));
      scale = Math.max(scale, Math.abs(expected.channels[c]![i]!));
    }
  }
  const roundingBound = 32 * Number.EPSILON * Math.max(1, scale); // @lit-ok one matched subtraction after source summation; machine rounding only
  assert.ok(residual <= roundingBound, `${residual} > ${roundingBound}`);
  assert.equal(on.truth.infraSlow?.electrodeDrift.enabled, true);
  assert.deepEqual(on.truth.infraSlow?.sourceModes, []);
  assert.deepEqual(on.truth.infraSlow?.modulation, []);
  assert.equal(off.truth.infraSlow, undefined);
});

test('shared mastoid drift follows the reference operator, not a scalp topography', () => {
  const seed = 63011; // @lit-ok matched reference fixture seed
  const n = 947; // @lit-ok non-controller-aligned fixture record
  const withoutCommon = synthesizeRecordingDrift(seed, n, {
    ...FIXTURE,
    commonReferenceRmsUv: 0,
  });
  const withCommon = synthesizeRecordingDrift(seed, n, FIXTURE);

  for (const mode of ['as-generated', 'average', 'laplacian'] as const) {
    const a = applyReference(withoutCommon.channels, mode);
    const b = applyReference(withCommon.channels, mode);
    for (let c = 0; c < a.channels.length; c++) {
      assert.deepEqual([...a.channels[c]!], [...b.channels[c]!], mode);
    }
  }

  for (const mode of ['linked-mastoid', 'contralateral'] as const) {
    const a = applyReference(withoutCommon.channels, mode);
    const b = applyReference(withCommon.channels, mode);
    for (let c = 0; c < a.channels.length; c++) {
      for (let i = 0; i < n; i++) {
        assert.ok(
          Math.abs((b.channels[c]![i]! - a.channels[c]![i]!) + withCommon.commonReference[i]!)
            <= 8 * Number.EPSILON * Math.max(1, Math.abs(withCommon.commonReference[i]!)), // @lit-ok one reference and one matched subtraction; machine rounding only
        );
      }
    }
  }
});

test('an ISF fixture without recording drift retains the explicit disabled truth arm', () => {
  const generated = composeState(7139, 'wake_ec', 511, undefined, { // @lit-ok fixture seed and non-aligned record
    suppressGraphoelements: true,
    infraSlowFixture: {
      exponent: 1,
      poleCount: 9, // @lit-ok ISF fixture approximation; deliberately not a registry value
      isf1VarianceFraction: 0.5,
      additiveRmsUv: { isf_posterior: 1 },
    },
  });
  assert.deepEqual(generated.truth.infraSlow?.electrodeDrift, { enabled: false });
});
