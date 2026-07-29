/**
 * Seam 4's required property, tested rather than asserted in a comment.
 *
 * "Named, seeded, version-pinned, with documented substream derivation such that ADDING A
 * GENERATOR DOES NOT PERTURB EXISTING DRAWS."
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, RNG_IDENTITY } from '../src/core/rng/xoshiro128pp.ts';

const draws = (r: Rng, n = 16): number[] => Array.from({ length: n }, () => r.nextUint32());

test('same seed reproduces the same stream (G2 in miniature)', () => {
  assert.deepEqual(draws(Rng.fromSeed(12345)), draws(Rng.fromSeed(12345)));
});

test('different seeds produce different streams', () => {
  assert.notDeepEqual(draws(Rng.fromSeed(1)), draws(Rng.fromSeed(2)));
});

test('THE SEAM 4 PROPERTY: adding a generator does not perturb existing draws', () => {
  const seed = 20260728;

  // A run with three generators.
  const before = {
    aperiodic: draws(Rng.substream(seed, 'aperiodic')),
    spindle: draws(Rng.substream(seed, 'spindle_fast')),
    kc: draws(Rng.substream(seed, 'kcomplex')),
  };

  // Now a fourth generator is added to the project. Derivation is a pure function of
  // (seed, name), so nothing about the existing three can shift.
  const _newcomer = draws(Rng.substream(seed, 'sawtooth'));

  const after = {
    aperiodic: draws(Rng.substream(seed, 'aperiodic')),
    spindle: draws(Rng.substream(seed, 'spindle_fast')),
    kc: draws(Rng.substream(seed, 'kcomplex')),
  };

  assert.deepEqual(after, before, 'existing substreams must be bit-identical');
});

test('substreams are order-independent', () => {
  const seed = 7;
  const a1 = draws(Rng.substream(seed, 'alpha'));
  const b1 = draws(Rng.substream(seed, 'beta'));
  // Reverse the creation order.
  const b2 = draws(Rng.substream(seed, 'beta'));
  const a2 = draws(Rng.substream(seed, 'alpha'));
  assert.deepEqual(a2, a1);
  assert.deepEqual(b2, b1);
});

test('distinct names give distinct streams', () => {
  const seed = 99;
  const names = ['aperiodic', 'alpha', 'spindle_fast', 'spindle_slow', 'kcomplex', 'blink'];
  const firsts = names.map((n) => Rng.substream(seed, n).nextUint32());
  assert.equal(new Set(firsts).size, names.length, 'substream collision');
});

test('output stays in uint32 range', () => {
  const r = Rng.fromSeed(4242);
  for (let i = 0; i < 5000; i++) {
    const v = r.nextUint32();
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, `out of range: ${v}`);
  }
});

test('nextFloat is in [0,1) and roughly uniform', () => {
  const r = Rng.fromSeed(31337);
  const n = 200000;
  const bins = new Array(10).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = r.nextFloat();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    bins[Math.floor(v * 10)]!++;
    sum += v;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01, `mean ${sum / n}`);
  for (const b of bins) assert.ok(Math.abs(b - n / 10) < n / 100, `bin skew: ${b}`);
});

test('normal() has unit variance and zero mean', () => {
  const r = Rng.fromSeed(5150);
  const n = 200000;
  let s = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const v = r.normal();
    s += v;
    ss += v * v;
  }
  const mean = s / n;
  const sd = Math.sqrt(ss / n - mean * mean);
  assert.ok(Math.abs(mean) < 0.01, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.01, `sd ${sd}`);
});

test('state save/restore reproduces the stream', () => {
  const r = Rng.fromSeed(808);
  draws(r, 50);
  const snapshot = r.saveState();
  const expected = draws(r, 20);
  r.restoreState(snapshot);
  assert.deepEqual(draws(r, 20), expected);
});

test('save/restore round-trips through normal(), including the Box-Muller spare', () => {
  // Regression: saveState() previously returned only the four state words, so a snapshot
  // taken after an ODD number of normal() calls dropped the cached spare and the restored
  // stream was shifted by one draw. The test above missed it because nextUint32() has no
  // spare -- and the exporter's synthesizeChannel uses normal() exclusively.
  for (const priorDraws of [0, 1, 2, 3]) {
    const r = Rng.fromSeed(99);
    for (let i = 0; i < priorDraws; i++) r.normal();
    const snap = r.saveState();
    const expected = [r.normal(), r.normal(), r.normal()];
    r.restoreState(snap);
    assert.deepEqual(
      [r.normal(), r.normal(), r.normal()],
      expected,
      `stream diverged after ${priorDraws} prior normal() call(s)`,
    );
  }
});

test('substreams do not collide at full-night scale', () => {
  // The 32-bit derivation this replaced had ~3.8% collision probability over an 8 h night
  // (19 channels x 960 epochs) and ~98% with ten generators. A collision means two channels
  // carrying bit-identical noise.
  const seed = 20260728;
  const names: string[] = [];
  for (const gen of ['aperiodic', 'alpha', 'spindle_fast', 'kcomplex', 'slow_osc']) {
    for (let ch = 0; ch < 19; ch++) {
      for (let ep = 0; ep < 240; ep++) names.push(`${gen}/ch${ch}/epoch${ep}`);
    }
  }
  const firsts = new Set(names.map((n) => Rng.substream(seed, n).nextUint32()));
  // 22,800 names into 2^32: a handful of coincidental first-draw ties is expected and
  // harmless; what matters is that it is not the systematic collapse the old scheme had.
  const collisionRate = 1 - firsts.size / names.length;
  assert.ok(
    collisionRate < 0.001,
    `${names.length} substreams gave ${firsts.size} distinct first draws ` +
      `(collision rate ${(collisionRate * 100).toFixed(2)}%)`,
  );
});

test('a zero seed does not produce the degenerate all-zero state', () => {
  // Zero state is a fixed point of xoshiro; fromSeed must re-mix past it.
  const r = Rng.fromSeed(0);
  const d = draws(r, 8);
  assert.ok(d.some((v) => v !== 0), 'all-zero state');
});

test('algorithm identity is pinned', () => {
  assert.equal(RNG_IDENTITY.algorithm, 'xoshiro128++');
  assert.equal(RNG_IDENTITY.version, 1);
});
