import test from 'node:test';
import assert from 'node:assert/strict';

import { chainMagnitude, applyFilterChain, type FilterSpec } from '../src/core/filters/hpf.ts';
import { bandEdges, scalarValue, uiDomain } from '../src/core/registry.ts';

test('the high-pass control extends below the named infra-slow band', () => {
  const domain = uiDomain('filter_ui_range');
  const isf = bandEdges('isf_band');
  assert.ok(domain.lo < isf.lo, `${domain.lo} Hz does not extend below ${isf.lo} Hz`);

  const spec: FilterSpec = {
    highpassHz: domain.lo,
    lowpassHz: null,
    type: 'zeroPhase',
    order: scalarValue('filter_order'),
  };
  assert.ok(
    chainMagnitude(spec, isf.lo, scalarValue('fs')) > Math.SQRT1_2,
    'the lowest selectable high-pass should retain the lower edge of the named ISF band',
  );
});

test('the opening high-pass preserves the mechanism instead of silently deleting it', () => {
  const domain = uiDomain('filter_ui_range');
  const isf = bandEdges('isf_band');
  const opening = scalarValue('hpf_default');
  assert.equal(opening, domain.lo);
  assert.ok(chainMagnitude({
    highpassHz: opening,
    lowpassHz: scalarValue('lpf_default'),
    type: 'zeroPhase',
    order: scalarValue('filter_order'),
  }, isf.lo, scalarValue('fs')) > 0.95);
});

test('the lowest selectable high-pass remains numerically stable on a live buffer', () => {
  const fs = scalarValue('fs');
  const n = fs * scalarValue('display_buffer_s');
  const x = new Float64Array(n);
  const frequency = bandEdges('isf_band').lo;
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * frequency * i) / fs);

  const y = applyFilterChain(x, {
    highpassHz: uiDomain('filter_ui_range').lo,
    lowpassHz: null,
    type: 'zeroPhase',
    order: scalarValue('filter_order'),
  }, fs);
  assert.ok(y.every(Number.isFinite));
});
