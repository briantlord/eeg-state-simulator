/**
 * Demo 1's claim, pinned.
 *
 * The Tier 0 shipping test names the filter demonstration as the artifact's thesis. It was
 * flat for a whole build cycle (Finding 10) because the only respiratory mechanism implemented
 * was the one a high-pass cannot reach, and the omission was invisible until someone measured
 * it. These tests make the same regression loud.
 *
 * Each one pins a claim the documentation makes, not an implementation detail:
 *
 *   1. mechanism (a) is destroyed by a clinical high-pass  -- the demonstration
 *   2. mechanism (c) is NOT                                -- the control, and the corrected
 *                                                             claim; asserting this direction
 *                                                             is the point, because the build
 *                                                             plan predicted the opposite
 *   3. ground truth is stated at the electrode             -- or geometry reads as filter loss
 *   4. the off-resonance null is a null                    -- a magnitude estimator never
 *                                                             returns zero, so "indistinguish-
 *                                                             able from nothing" needs a floor
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeState } from '../src/core/generators/compose.ts';
import { applyReference, referencedGain } from '../src/analysis/referencing.ts';
import { applyHighpass } from '../src/core/filters/hpf.ts';
import { weightsFor } from '../src/core/generators/projection.ts';
import { bandAmplitudeCoupling, respiratoryCoupling } from '../src/analysis/coupling.ts';

const FS = 256;
const SECONDS = 120;
const N = FS * SECONDS;

/** One composed N3 record with all three respiratory mechanisms on, filtered and referenced. */
function fzAt(cutoffHz: number) {
  const r = composeState(4242, 'n3', N, FS, {
    movementArtifact: true,
    amplitudeModulation: true,
    chiModulation: true,
    respRatePerMin: 15,
  });
  const hp = r.channels.map((c) => applyHighpass(c, cutoffHz, 'zeroPhase', FS));
  const ref = applyReference(hp, 'linked-mastoid');
  return { fz: ref.channels[ref.labels.indexOf('Fz')]!, truth: r.truth, phase: r.respirationPhase };
}

test('mechanism (a) is destroyed by a clinical high-pass — this is Demo 1', () => {
  const open = fzAt(0.01);
  const clinical = fzAt(1.0);

  const before = respiratoryCoupling(open.fz, open.phase);
  const after = respiratoryCoupling(clinical.fz, clinical.phase);

  // Ground truth AT THE ELECTRODE: source amplitude times projection-and-reference gain.
  const gain = Math.abs(referencedGain(weightsFor('resp_artifact'), 'linked-mastoid', 'Fz'));
  const injected = open.truth.respArtifactAmpUv * gain;

  assert.ok(
    before > 0.7 * injected,
    `essentially unfiltered, the artifact should be recovered near its injected amplitude at ` +
      `the electrode: got ${before.toFixed(2)} uV against ${injected.toFixed(2)} uV`,
  );
  assert.ok(
    after < 0.1 * injected,
    `a 1 Hz high-pass sits above the respiratory rate and should remove the artifact almost ` +
      `entirely: got ${after.toFixed(3)} uV, more than 10% of ${injected.toFixed(2)} uV`,
  );
});

test('mechanism (c) amplitude modulation SURVIVES the same filter — the control', () => {
  // THE BUILD PLAN PREDICTED THE OPPOSITE, and the prediction was wrong: a high-pass removes a
  // carrier below its cutoff but not amplitude modulation of a carrier that passes. Asserting
  // the measured direction is deliberate. If this test starts failing because the number fell,
  // the generator changed -- do not "fix" it by loosening the bound.
  const open = fzAt(0.01);
  const clinical = fzAt(1.0);

  const before = bandAmplitudeCoupling(open.fz, open.phase, 0.5, 4, FS);
  const after = bandAmplitudeCoupling(clinical.fz, clinical.phase, 0.5, 4, FS);

  assert.ok(before > 0.05, `nothing injected? got ${before.toFixed(4)}`);
  assert.ok(
    after > 0.8 * before,
    `envelope modulation of a passing carrier should survive: ${after.toFixed(4)} vs ` +
      `${before.toFixed(4)} is a loss the measurement says should not happen`,
  );
});

test('referencedGain reproduces the reference operator exactly', () => {
  // The gain is only trustworthy because applyReference is linear and sample-wise. Verify that
  // against the operator itself rather than trusting the argument: project a unit impulse of
  // the resp_artifact topography and reference it the long way.
  const w = weightsFor('resp_artifact');
  for (const mode of ['as-generated', 'linked-mastoid', 'contralateral', 'average', 'laplacian'] as const) {
    const channels = w.map((wi) => Float64Array.of(wi, 2 * wi, -3 * wi));
    const r = applyReference(channels, mode);
    const long = r.channels[r.labels.indexOf('Fz')]!;
    const gain = referencedGain(w, mode, 'Fz');
    // Linear, so the three samples must be gain x (1, 2, -3).
    for (const [i, k] of [1, 2, -3].entries()) {
      assert.ok(
        Math.abs(long[i]! - k * gain) < 1e-12,
        `${mode}: sample ${i} is ${long[i]}, expected ${k * gain}`,
      );
    }
  }
});

test('the off-resonance null returns a floor, not the signal', () => {
  const open = fzAt(0.01);
  const onResonance = respiratoryCoupling(open.fz, open.phase);

  const nullPhase = new Float64Array(N);
  const w = (2 * Math.PI * 1.7 * open.truth.respFreqHz) / FS;
  for (let i = 0; i < N; i++) nullPhase[i] = i * w;
  const offResonance = respiratoryCoupling(open.fz, nullPhase);

  assert.ok(offResonance > 0, 'a magnitude estimator returns something from any finite record');
  assert.ok(
    offResonance < 0.6 * onResonance,
    `the off-resonance probe must be well below the injected component, else it is not a ` +
      `null: ${offResonance.toFixed(2)} uV against ${onResonance.toFixed(2)} uV`,
  );

  // A CIRCULAR ROTATION IS NOT A VALID NULL HERE, and this pins why. Respiration is
  // near-periodic, so rotating by half a respiratory cycle anti-aligns -- and because this
  // estimator takes a magnitude, an anti-aligned surrogate hands the signal straight back.
  const halfCycle = Math.round(FS / (2 * open.truth.respFreqHz));
  const rotated = new Float64Array(N);
  for (let i = 0; i < N; i++) rotated[i] = open.phase[(i + halfCycle) % N]!;
  const rotatedCoupling = respiratoryCoupling(open.fz, rotated);
  assert.ok(
    rotatedCoupling > 0.6 * onResonance,
    `if a half-cycle rotation ever became a real null, the reasoning recorded in coupling.ts ` +
      `and Finding 10 would be wrong: got ${rotatedCoupling.toFixed(2)} uV against ` +
      `${onResonance.toFixed(2)} uV`,
  );
});
