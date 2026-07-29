/**
 * The pink-noise demo preset, as a test.
 *
 * Build Plan §7: "REQUIRED DEMO PRESET — 'the most complex signal is noise.' Boxcar, pure
 * 10 Hz sine, sine plus pink noise, pure pink noise. LZc rises monotonically across that
 * sequence with PURE NOISE HIGHEST. This does more against the consciousness-meter misreading
 * than any disclaimer."
 *
 * It is a test and not just a UI preset because the ordering is a property of the measure. If
 * it ever stops holding, either the LZ implementation is wrong or the second observable axis
 * does not mean what the artifact says it means — and the artifact's entire framing rests on
 * complexity NOT being a proxy for richness or awareness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng/xoshiro128pp.ts';
import { synthesizeAperiodic } from '../src/core/generators/aperiodic.ts';
import {
  lempelZiv,
  binarizeAtMedian,
  symbolDensity,
  lz76,
  lzw,
  type LzParse,
} from '../src/analysis/lz.ts';

const FS = 256;
const N = FS * 30;

function boxcar(): Float64Array {
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = i % (FS * 2) < FS ? 1 : -1;
  return x;
}

function sine(freq = 10): Float64Array {
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / FS);
  return x;
}

function pink(seed = 3): Float64Array {
  return synthesizeAperiodic(Rng.substream(seed, 'pink'), N, { chi: 1, k: 0, rmsUv: 1 }, FS);
}

function sinePlusPink(): Float64Array {
  const s = sine();
  const p = pink(4);
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = s[i]! + p[i]!;
  return x;
}

for (const parse of ['lzw', 'lz76'] as const) {
  test(`the most complex signal is noise (${parse})`, () => {
    const rng = () => Rng.substream(7, `lz-${parse}`);
    const lz = (x: Float64Array) => lempelZiv([x], rng(), parse as LzParse).normalized;

    const values = {
      boxcar: lz(boxcar()),
      sine: lz(sine()),
      sinePlusPink: lz(sinePlusPink()),
      pink: lz(pink()),
    };

    const order = ['boxcar', 'sine', 'sinePlusPink', 'pink'] as const;
    for (let i = 1; i < order.length; i++) {
      const prev = values[order[i - 1]!];
      const cur = values[order[i]!];
      assert.ok(
        cur > prev,
        `${order[i]} (${cur.toFixed(4)}) must exceed ${order[i - 1]} (${prev.toFixed(4)}); ` +
          `full ordering ${JSON.stringify(values)}`,
      );
    }
    // The headline claim, stated separately so a failure names it directly.
    assert.ok(values.pink > values.sine, 'pure noise must be more complex than a pure tone');
  });
}

test('binarization sits at the median, so density is ~0.5 by construction', () => {
  const d = symbolDensity(binarizeAtMedian(pink()));
  assert.ok(Math.abs(d - 0.5) < 0.01, `density ${d}`);
});

test('normalization names its null', () => {
  const r = lempelZiv([pink()], Rng.substream(1, 'n'), 'lzw');
  assert.match(r.nullDescription, /same density, no structure/);
  assert.equal(r.parse, 'lzw');
});

test('a constant sequence is minimally complex and noise is far above it', () => {
  const flat = new Uint8Array(4096); // all zeros
  const rnd = new Uint8Array(4096);
  const rng = Rng.substream(2, 'r');
  for (let i = 0; i < rnd.length; i++) rnd[i] = rng.nextFloat() > 0.5 ? 1 : 0;

  // The two parses have very different floors on a constant sequence, and that is a real
  // property rather than a bug: LZ76 emits a couple of productions, while LZW keeps
  // extending its dictionary and grows as O(sqrt(n)) even on all-zeros. A single ratio
  // threshold across both parses would be asserting something false about one of them.
  const floors = { lz76: 3, lzw: 2 };
  for (const [name, fn] of [['lz76', lz76], ['lzw', lzw]] as const) {
    const ratio = fn(rnd) / fn(flat);
    assert.ok(
      ratio > floors[name],
      `${name}: random ${fn(rnd)} vs constant ${fn(flat)} = ${ratio.toFixed(1)}x, ` +
        `expected > ${floors[name]}x`,
    );
  }
});

test('both parses agree on the ORDERING even though magnitudes differ', () => {
  // This is why the parse decision does not block Tier 0: our landmarks are computed from our
  // own output and are self-consistent under either parse. Only comparison to PUBLISHED
  // magnitudes needs the decision settled.
  const sigs = [boxcar(), sine(), sinePlusPink(), pink()];
  const rank = (parse: LzParse) =>
    sigs.map((s) => lempelZiv([s], Rng.substream(9, 'x'), parse).normalized);
  const a = rank('lzw');
  const b = rank('lz76');
  for (let i = 1; i < a.length; i++) {
    assert.equal(
      a[i]! > a[i - 1]!,
      b[i]! > b[i - 1]!,
      `parses disagree on ordering at position ${i}: lzw ${a}, lz76 ${b}`,
    );
  }
});
