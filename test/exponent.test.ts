/**
 * Seam 7. The important assertions here are the `@ts-expect-error` lines: `tsc` fails the
 * build if the marked line does NOT error, so these are real tests of the type system rather
 * than comments hoping for the best.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  broadKnee,
  narrowFixed,
  difference,
  kneeFrequency,
  formatExponent,
  analyticSlope,
} from '../src/core/types/exponent.ts';

test('same band and mode may be compared', () => {
  const a = broadKnee(1.7, Math.pow(20, 1.7));
  const b = broadKnee(2.1, Math.pow(20, 2.1));
  assert.ok(Math.abs(difference(b, a) - 0.4) < 1e-9);

  const c = narrowFixed(1.2);
  const d = narrowFixed(1.5);
  assert.ok(Math.abs(difference(d, c) - 0.3) < 1e-9);
});

test('comparing across bands is a COMPILE error, not a runtime one', () => {
  const broad = broadKnee(1.7, Math.pow(20, 1.7));
  const narrow = narrowFixed(1.2);

  // @ts-expect-error seam 7: a 1-45 Hz knee-mode exponent and a 30-45 Hz fixed-mode exponent
  // are different quantities, not two estimates of one quantity.
  difference(broad, narrow);

  // @ts-expect-error and in the other order.
  difference(narrow, broad);

  assert.ok(true, 'the assertions above are checked by tsc, not at runtime');
});

test('a bare number is not an exponent', () => {
  // @ts-expect-error an exponent is never a bare number.
  difference(1.7, broadKnee(1.7, 400));
  assert.ok(true);
});

test('knee frequency inverts the knee parameter', () => {
  // k = f_knee ^ chi, so f_knee = k ^ (1/chi).
  const e = broadKnee(2.0, Math.pow(20, 2.0));
  assert.ok(Math.abs(kneeFrequency(e) - 20) < 1e-9);
});

test('format never prints a bare number', () => {
  const s = formatExponent(broadKnee(1.75, Math.pow(20, 1.75)));
  assert.match(s, /1–45 Hz/);
  assert.match(s, /knee mode/);
  assert.match(s, /knee 20\.0 Hz/);

  const t = formatExponent(narrowFixed(1.31));
  assert.match(t, /30–45 Hz/);
  assert.match(t, /fixed mode/);
  assert.doesNotMatch(t, /knee/);
});

test('analyticSlope reproduces the measured G1b structural bias', () => {
  // docs/Tier0-Estimator-Probe.md Finding 2: at chi=2 with a 20 Hz knee, a fixed-mode fit over
  // 30-45 Hz recovers ~1.54 analytically and ~1.56 empirically. The bias is a property of the
  // curve, not of specparam.
  const chi = 2.0;
  const k = Math.pow(20, chi);
  const slope = analyticSlope(chi, k, 30, 45);
  assert.ok(Math.abs(slope - 1.54) < 0.03, `analytic slope ${slope}, expected ~1.54`);

  // Far above the knee the fixed-mode slope must converge to chi.
  const far = analyticSlope(chi, k, 2000, 4000);
  assert.ok(Math.abs(far - chi) < 0.02, `slope far above knee ${far}, expected ~${chi}`);

  // With no knee at all it is exact at any band.
  assert.ok(Math.abs(analyticSlope(1.5, 0, 30, 45) - 1.5) < 1e-6);
});
