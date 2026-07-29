/**
 * The tilt filter's sign, and its stability.
 *
 * The sign is pinned against a measured spectrum rather than reasoned about, because the
 * achieved PSD exponent is −2g where the zeros sit at pole·D^g, I got that backwards once
 * while characterizing it, and it is the sign that silently inverts the wake/sleep phase
 * reversal in §5.2 — the artifact's most striking behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng/xoshiro128pp.ts';
import { synthesizeAperiodic } from '../src/core/generators/aperiodic.ts';
import { designTilt, applyTimeVaryingTilt } from '../src/core/filters/tilt.ts';
import { applyBiquad } from '../src/core/dsp/biquad.ts';
import { magnitudeSpectrum } from '../src/core/dsp/fft.ts';

const FS = 256;
const N = 1 << 16;

/** Least-squares log-log slope of the power spectrum over [lo, hi] Hz. */
function spectralExponent(x: Float64Array, lo = 2, hi = 40): number {
  const mag = magnitudeSpectrum(x);
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 1; i < mag.length; i++) {
    const f = (i * FS) / x.length;
    if (f < lo || f > hi) continue;
    const lx = Math.log10(f);
    const ly = Math.log10(mag[i]! * mag[i]! + 1e-300);
    sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; n++;
  }
  return -(n * sxy - sx * sy) / (n * sxx - sx * sx);
}

function pinkNoise(): Float64Array {
  return synthesizeAperiodic(
    Rng.substream(11, 'tilt-test'),
    N,
    { chi: 1.5, k: 0, rmsUv: 20 },
    FS,
  );
}

test('a POSITIVE requested tilt FLATTENS the spectrum', () => {
  // PSD ~ f^(+dchi): adding f^(+0.5) to an f^(-1.5) spectrum gives f^(-1.0), so chi DROPS.
  const x = pinkNoise();
  const base = spectralExponent(x);

  const up = Float64Array.from(x);
  for (const s of designTilt(0.5, FS)) applyBiquad(up, s);
  const flattened = spectralExponent(up);

  assert.ok(
    flattened < base - 0.3,
    `chi went ${base.toFixed(3)} -> ${flattened.toFixed(3)}; a positive tilt must lower it`,
  );
});

test('a negative requested tilt steepens it', () => {
  const x = pinkNoise();
  const base = spectralExponent(x);
  const down = Float64Array.from(x);
  for (const s of designTilt(-0.5, FS)) applyBiquad(down, s);
  assert.ok(spectralExponent(down) > base + 0.3);
});

test('the achieved tilt is close to the requested one', () => {
  const x = pinkNoise();
  const base = spectralExponent(x);
  for (const d of [-0.4, -0.2, 0.2, 0.4]) {
    const y = Float64Array.from(x);
    for (const s of designTilt(d, FS)) applyBiquad(y, s);
    const achieved = base - spectralExponent(y);
    assert.ok(
      Math.abs(achieved - d) < 0.12,
      `requested ${d}, achieved ${achieved.toFixed(3)}`,
    );
  }
});

test('the cascade is stable — no non-finite output', () => {
  // Built as a single transfer function rather than sections, a cascade at this order
  // overflows to non-finite values within a 120 s impulse response. Sections do not.
  const impulse = new Float64Array(FS * 120);
  impulse[0] = 1;
  for (const s of designTilt(0.5, FS)) applyBiquad(impulse, s);
  assert.ok(impulse.every((v) => Number.isFinite(v)), 'cascade produced non-finite output');
  const tail = impulse.subarray(impulse.length - FS);
  assert.ok(Math.max(...tail.map(Math.abs)) < 1e-3, 'impulse response has not decayed');
});

test('both coefficient schemes run and neither blows up', () => {
  const x = pinkNoise();
  const dchi = new Float64Array(N);
  for (let i = 0; i < N; i++) dchi[i] = 0.5 * Math.cos((2 * Math.PI * 0.1 * i) / FS);
  for (const scheme of ['blockwise', 'filterbank'] as const) {
    const y = applyTimeVaryingTilt(x, dchi, FS, { scheme, levels: 9 });
    assert.ok(y.every((v) => Number.isFinite(v)), `${scheme} produced non-finite output`);
    assert.equal(y.length, x.length);
  }
});
