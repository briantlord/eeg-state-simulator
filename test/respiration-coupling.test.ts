import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amplitudeModulation,
  chiModulation,
  synthesizeRespiration,
} from '../src/core/generators/respiration.ts';
import {
  ALL_CHANNELS,
  patchPowerLoading,
} from '../src/core/generators/projection.ts';
import { scalarValue } from '../src/core/registry.ts';
import type { StateId } from '../src/core/types/state.ts';

const FS = scalarValue('fs');

test('respiratory phase follows the literature convention around the actual belt peak', () => {
  const result = synthesizeRespiration(72, FS * 20, 'wake_ec', FS, 15);
  assert.ok(Math.abs(result.phase[0]! + Math.PI) < 1e-12);

  const firstWrap = result.phase.findIndex((value, i) => i > 0 && value < result.phase[i - 1]!);
  assert.ok(firstWrap > 0);
  let peak = 0;
  for (let i = 1; i < firstWrap; i++) {
    if (Math.abs(result.phase[i]!) < Math.abs(result.phase[peak]!)) peak = i;
  }
  const beltMaximum = Math.max(...result.belt.subarray(0, firstWrap));
  assert.ok(Math.abs(result.phase[peak]!) < 0.01, `nearest peak phase ${result.phase[peak]}`);
  assert.ok(Math.abs(result.belt[peak]! - beltMaximum) < 1e-12,
    'phase zero must sit on the peak-inspiration plateau');
  assert.ok(result.phase[Math.floor(peak / 2)]! < 0, 'inspiration must occupy negative phase');
  assert.ok(result.phase[Math.floor((peak + firstWrap) / 2)]! > 0,
    'expiration must occupy positive phase');
});

test('periodic respiratory gain preserves mean squared amplitude', () => {
  const n = 100_000;
  const phase = new Float64Array(n);
  const depth = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) phase[i] = -Math.PI + (2 * Math.PI * i) / n;
  const gain = amplitudeModulation(phase, depth, 0.35, Math.PI);
  const meanPower = gain.reduce((sum, value) => sum + value * value, 0) / n;
  assert.ok(Math.abs(meanPower - 1) < 1e-12, `mean gain squared ${meanPower}`);
  assert.ok(gain.every((value) => value > 0), 'gain must never invert a rhythm');
});

test('aperiodic phase maxima are the registered state-specific literature directions', () => {
  const keys: Record<StateId, Parameters<typeof scalarValue>[0]> = {
    wake_eo: 'chi_mod_phi0_wake',
    wake_ec: 'chi_mod_phi0_wake',
    n1: 'chi_mod_phi0_n1',
    n2: 'chi_mod_phi0_n2',
    n3: 'chi_mod_phi0_n3',
    rem: 'chi_mod_phi0_rem',
  };
  for (const [state, key] of Object.entries(keys) as [StateId, Parameters<typeof scalarValue>[0]][]) {
    const phase = new Float64Array([scalarValue(key)]);
    const value = chiModulation(phase, 2, state, 0.25);
    assert.ok(Math.abs(value[0]! - 2.25) < 1e-12, state);
  }
});

test('aperiodic respiratory loading is widespread with a posterior maximum', () => {
  const loading = patchPowerLoading('resp_aperiodic');
  const mean = (labels: readonly string[]) =>
    labels.reduce((sum, label) => sum + loading[ALL_CHANNELS.indexOf(label)]!, 0) / labels.length;
  const posterior = mean(['O1', 'O2', 'Pz']);
  const frontal = mean(['Fp1', 'Fp2', 'F3', 'Fz', 'F4']);
  assert.ok(posterior > frontal * 2, `${posterior} posterior vs ${frontal} frontal`);
  assert.ok(frontal > 0.25, 'volume conduction must leave a substantial frontal tail');
  assert.equal(Math.max(...loading), 1);
});
