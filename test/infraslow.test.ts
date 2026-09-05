import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInfraSlowController,
  powerPreservingInfraSlowGain,
  synthesizeInfraSlow,
  synthesizeInfraSlowChunk,
  type InfraSlowControllerState,
} from '../src/core/generators/infraslow.ts';
import { composeState, type InfraSlowFixtureOptions } from '../src/core/generators/compose.ts';
import { ALL_CHANNELS, modesOf, weightsFor } from '../src/core/generators/projection.ts';

const FIXTURE = {
  exponent: 1,
  poleCount: 9, // @lit-ok ISF-1 comparison fixture; deliberately not a registry value
  isf1VarianceFraction: 0.5,
} as const;

const COMPOSE_FIXTURE: InfraSlowFixtureOptions = {
  ...FIXTURE,
  additiveRmsUv: { isf_posterior: 1 },
};

test('whole-record and arbitrary chunks are sample-identical for every ISF driver', () => {
  const ids = ['front/m0', 'central/m0', 'posterior/m0'];
  const count = 4_321; // @lit-ok crosses many 2 Hz controller ticks at 250 Hz
  const whole = synthesizeInfraSlow(8103, ids, count, FIXTURE); // @lit-ok fixture seed

  let state = createInfraSlowController(8103, ids, FIXTURE); // @lit-ok matched fixture seed
  const pieces = [1, 7, 31, 2, 113, 19]; // @lit-ok adversarial arbitrary chunk sequence
  const assembled = Object.fromEntries(ids.map((id) => [id, {
    isf1: [] as number[], isf2: [] as number[], combined: [] as number[],
  }]));
  let emitted = 0;
  let piece = 0;
  while (emitted < count) {
    const take = Math.min(pieces[piece % pieces.length]!, count - emitted);
    const chunk = synthesizeInfraSlowChunk(state, take);
    state = chunk.state;
    for (const id of ids) {
      assembled[id]!.isf1.push(...chunk.drivers[id]!.isf1);
      assembled[id]!.isf2.push(...chunk.drivers[id]!.isf2);
      assembled[id]!.combined.push(...chunk.drivers[id]!.combined);
    }
    emitted += take;
    piece++;
  }
  for (const id of ids) {
    assert.deepEqual(assembled[id]!.isf1, [...whole[id]!.isf1], `${id}/isf1`);
    assert.deepEqual(assembled[id]!.isf2, [...whole[id]!.isf2], `${id}/isf2`);
    assert.deepEqual(assembled[id]!.combined, [...whole[id]!.combined], `${id}/combined`);
  }
});

test('an ISF checkpoint survives JSON serialization exactly', () => {
  const initial = createInfraSlowController(9127, ['one'], FIXTURE); // @lit-ok fixture seed
  const first = synthesizeInfraSlowChunk(initial, 137); // @lit-ok non-controller-aligned chunk
  const restored = JSON.parse(JSON.stringify(first.state)) as InfraSlowControllerState;
  const a = synthesizeInfraSlowChunk(first.state, 509); // @lit-ok continuation length
  const b = synthesizeInfraSlowChunk(restored, 509); // @lit-ok matched continuation length
  assert.deepEqual([...a.drivers.one!.combined], [...b.drivers.one!.combined]);
  assert.deepEqual(a.state, b.state);
});

test('ISF1 and ISF2 can be independently selected without changing their draws', () => {
  const low = synthesizeInfraSlow(771, ['one'], 2_000, { // @lit-ok fixture seed and length
    ...FIXTURE,
    isf1VarianceFraction: 1,
  }).one!;
  const high = synthesizeInfraSlow(771, ['one'], 2_000, { // @lit-ok matched fixture
    ...FIXTURE,
    isf1VarianceFraction: 0,
  }).one!;
  assert.deepEqual([...low.combined], [...low.isf1]);
  assert.deepEqual([...high.combined], [...high.isf2]);
  assert.deepEqual([...low.isf1], [...high.isf1]);
  assert.deepEqual([...low.isf2], [...high.isf2]);
});

test('the modulation gain uses the analytic unit-Gaussian power normalization', () => {
  const driver = new Float64Array([-1, 0, 1]);
  const depth = 0.4; // @lit-ok characterization fixture, not a physiological depth
  const gain = powerPreservingInfraSlowGain(driver, depth);
  for (let i = 0; i < driver.length; i++) {
    assert.equal(gain[i], Math.exp(depth * driver[i]! - depth * depth));
    assert.ok(gain[i]! > 0);
  }
});

test('the additive arm reaches electrodes only through the named BEM modes', () => {
  const seed = 6019; // @lit-ok matched mechanism fixture seed
  const n = 733; // @lit-ok non-controller-aligned record
  const common = {
    suppressGraphoelements: true,
    eventRespirationCoupling: false,
    infraSlow: false,
  } as const;
  const off = composeState(seed, 'wake_ec', n, undefined, common);
  const on = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: COMPOSE_FIXTURE,
  });
  const familyModes = modesOf('isf_posterior');
  const drivers = synthesizeInfraSlow(seed, familyModes, n, FIXTURE);
  let largestError = 0;
  let largestExpected = 0;
  for (let c = 0; c < ALL_CHANNELS.length; c++) {
    for (let i = 0; i < n; i++) {
      let expected = 0;
      for (const mode of familyModes) {
        expected += weightsFor(mode)[c]! * drivers[mode]!.combined[i]!;
      }
      const actual = on.channels[c]![i]! - off.channels[c]![i]!;
      largestError = Math.max(largestError, Math.abs(actual - expected));
      largestExpected = Math.max(largestExpected, Math.abs(expected));
    }
  }
  const roundingBound = 128 * Number.EPSILON * Math.max(1, largestExpected); // @lit-ok complete-mixture subtraction plus seven BEM mode sums; machine rounding only
  assert.ok(largestError <= roundingBound, `${largestError} > ${roundingBound}`);
  assert.equal(on.truth.infraSlow?.sourceModes.length, familyModes.length);
  assert.equal(off.truth.infraSlow, undefined);
});

test('additive and modulation mechanisms are independently switchable matched arms', () => {
  const seed = 42019; // @lit-ok matched mechanism fixture seed
  const n = 2_117; // @lit-ok non-controller-aligned record
  const common = {
    suppressGraphoelements: true,
    eventRespirationCoupling: false,
    infraSlow: false,
  } as const;
  const modulation = [{
    targetSource: 'alpha',
    driverFamily: 'isf_posterior',
    logAmplitudeDepth: 0.4, // @lit-ok recovery fixture, not a physiological depth
  }] as const;
  const off = composeState(seed, 'wake_ec', n, undefined, common);
  const additive = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: COMPOSE_FIXTURE,
  });
  const modulated = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: { ...FIXTURE, modulation },
  });
  const both = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: { ...COMPOSE_FIXTURE, modulation },
  });

  let residual = 0;
  let scale = 0;
  for (let c = 0; c < ALL_CHANNELS.length; c++) {
    for (let i = 0; i < n; i++) {
      const additiveOnly = additive.channels[c]![i]! - off.channels[c]![i]!;
      const additiveInsideBoth = both.channels[c]![i]! - modulated.channels[c]![i]!;
      residual = Math.max(residual, Math.abs(additiveOnly - additiveInsideBoth));
      scale = Math.max(scale, Math.abs(additiveOnly));
    }
  }
  const roundingBound = 64 * Number.EPSILON * Math.max(1, scale); // @lit-ok two matched subtractions and source sums
  assert.ok(residual <= roundingBound, `${residual} > ${roundingBound}`);
  assert.equal(both.truth.infraSlow?.modulation.length, 1);
  assert.equal(both.truth.infraSlow?.modulation[0]?.phaseInverted, false);
});

test('the π-shifted arm changes only ISF gain phase, not carriers or additive voltage', () => {
  const seed = 88013; // @lit-ok matched phase fixture seed
  const n = 1_003; // @lit-ok non-controller-aligned record
  const common = { suppressGraphoelements: true, eventRespirationCoupling: false } as const;
  const baseModulation = {
    targetSource: 'alpha' as const,
    driverFamily: 'isf_posterior' as const,
    logAmplitudeDepth: 0.4, // @lit-ok recovery fixture, not a physiological depth
  };
  const aligned = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: { ...COMPOSE_FIXTURE, modulation: [baseModulation] },
  });
  const inverted = composeState(seed, 'wake_ec', n, undefined, {
    ...common,
    infraSlowFixture: {
      ...COMPOSE_FIXTURE,
      modulation: [{ ...baseModulation, phaseInverted: true }],
    },
  });
  assert.equal(aligned.truth.infraSlow?.sourceModes[0]?.realizedAdditiveRmsUv,
    inverted.truth.infraSlow?.sourceModes[0]?.realizedAdditiveRmsUv);
  assert.equal(inverted.truth.infraSlow?.modulation[0]?.phaseInverted, true);
  assert.notDeepEqual([...aligned.channels[14]!], [...inverted.channels[14]!]); // @lit-ok Pz montage index
});

test('changing respiration does not change an independently driven ISF EEG arm', () => {
  const seed = 30211; // @lit-ok separation fixture seed
  const n = 1_511; // @lit-ok non-controller-aligned record
  const options = {
    suppressGraphoelements: true,
    eventRespirationCoupling: false,
    infraSlowFixture: COMPOSE_FIXTURE,
  } as const;
  const slowBreathing = composeState(seed, 'wake_ec', n, undefined, {
    ...options,
    respRatePerMin: 10, // @lit-ok matched respiratory separation fixture
  });
  const fastBreathing = composeState(seed, 'wake_ec', n, undefined, {
    ...options,
    respRatePerMin: 20, // @lit-ok matched respiratory separation fixture
  });
  for (let c = 0; c < ALL_CHANNELS.length; c++) {
    assert.deepEqual([...slowBreathing.channels[c]!], [...fastBreathing.channels[c]!]);
  }
  assert.notDeepEqual([...slowBreathing.respirationBelt], [...fastBreathing.respirationBelt]);
});
