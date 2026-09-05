import assert from 'node:assert/strict';
import test from 'node:test';

import { composeState } from '../src/core/generators/compose.ts';
import { kneeFrequencyOf } from '../src/core/generators/aperiodic.ts';
import { provisionalValue, scalarValue } from '../src/core/registry.ts';

test('N3 truth discloses both aperiodic timescales and their variance shares', () => {
  const fs = scalarValue('fs');
  const r = composeState(1, 'n3', fs * 2, fs);
  const components = r.truth.aperiodicComponents;

  assert.equal(components.length, 2);
  assert.equal(components[0]!.chi, provisionalValue('chi_n3'));
  assert.equal(components[1]!.chi, provisionalValue('chi_n3'));
  assert.equal(components[1]!.rmsFraction, provisionalValue('background_fast_fraction_n3'));
  assert.equal(components[0]!.rmsFraction + components[1]!.rmsFraction, 1);
  assert.equal(
    kneeFrequencyOf(components[1]!.knee, components[1]!.chi),
    provisionalValue('background_fast_knee_n3'),
  );
});

test('states without a fitted mixture still report exactly one aperiodic component', () => {
  const fs = scalarValue('fs');
  const r = composeState(1, 'wake_ec', fs * 2, fs);
  assert.equal(r.truth.aperiodicComponents.length, 1);
  assert.equal(r.truth.aperiodicComponents[0]!.rmsFraction, 1);
});

test('an invalid N3 fast variance share is rejected before synthesis', () => {
  const fs = scalarValue('fs');
  assert.throws(() => composeState(1, 'n3', fs * 2, fs, { n3FastBackgroundFraction: -1 }));
  assert.throws(() => composeState(1, 'n3', fs * 2, fs, { n3FastBackgroundFraction: 2 }));
});
