/**
 * Waveform shape, and the sign that must not be reasoned about.
 *
 * The rise-decay asymmetry sign is load-bearing: it determines the direction of the harmonic
 * structure a PAC estimator will see, the stored signal is standard polarity while the display
 * convention is negative-up, and a registry note already carried the formula inverted once.
 * So it is pinned here against the generated signal rather than against a comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng/xoshiro128pp.ts';
import { synthesizeDampedOscillator } from '../src/core/generators/oscillations.ts';
import { envelopeAndPhase } from '../src/core/dsp/fft.ts';

const FS = 256;
const N = 1 << 16; // 256 s
const F0 = 10;

/**
 * rdsym = rise / (rise + decay), segmented TROUGH TO TROUGH.
 *
 * Segmenting by rising zero crossings instead makes `rise` a quarter-cycle (zero to peak) and
 * `decay` a half-cycle (peak to trough), which forces a baseline of 1/3 regardless of the
 * waveform: a symmetric oscillator measured 0.316 that way. The bias then swamped the effect
 * being measured. Trough-to-trough is the bycycle definition and gives 0.5 for symmetric.
 */
function riseDecaySymmetry(x: Float64Array): number {
  const troughs: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i]! < x[i - 1]! && x[i]! <= x[i + 1]! && x[i]! < 0) troughs.push(i);
  }
  const vals: number[] = [];
  for (let c = 0; c + 1 < troughs.length; c++) {
    const a = troughs[c]!;
    const b = troughs[c + 1]!;
    if (b - a < 6) continue;
    let pk = a;
    for (let i = a; i < b; i++) if (x[i]! > x[pk]!) pk = i;
    const rise = pk - a;
    const decay = b - pk;
    if (rise > 0 && decay > 0) vals.push(rise / (rise + decay));
  }
  vals.sort((p, q) => p - q);
  return vals[Math.floor(vals.length / 2)]!;
}

function make(shape?: { triangularity: number; riseDecaySymmetry: number }) {
  return synthesizeDampedOscillator(
    Rng.substream(99, 'shape-test'),
    N,
    {
      f0: F0,
      bandwidthSharpHz: 1.0,
      rmsUv: 10,
      ...(shape ? { shape } : {}),
    },
    FS,
  );
}

test('an unshaped damped oscillator is symmetric', () => {
  const rd = riseDecaySymmetry(make());
  assert.ok(Math.abs(rd - 0.5) < 0.05, `rdsym ${rd}, expected ~0.5 for a linear oscillator`);
});

test('rdsym below 0.5 gives a steeper rise', () => {
  // A steeper rise is a shorter rise, so rdsym = rise/(rise+decay) goes DOWN.
  // The registry note once claimed the opposite. Measurement decides.
  const rd = riseDecaySymmetry(make({ triangularity: 0, riseDecaySymmetry: 0.35 }));
  assert.ok(rd < 0.45, `rdsym ${rd}, expected well below 0.5 for a steeper rise`);
});

test('rdsym above 0.5 reverses it', () => {
  const rd = riseDecaySymmetry(make({ triangularity: 0, riseDecaySymmetry: 0.65 }));
  assert.ok(rd > 0.55, `rdsym ${rd}, expected well above 0.5`);
});

test('the achieved rdsym tracks the requested one', () => {
  const a = riseDecaySymmetry(make({ triangularity: 0, riseDecaySymmetry: 0.45 }));
  const b = riseDecaySymmetry(make({ triangularity: 0, riseDecaySymmetry: 0.30 }));
  assert.ok(b < a, `rdsym did not decrease with asymmetry: ${a} then ${b}`);
});

test('shaping preserves the envelope, so bistable burst structure survives', () => {
  // Shape is applied to the phase; the envelope must be untouched.
  const plain = make();
  const shaped = make({ triangularity: 0.45, riseDecaySymmetry: 0.35 });
  const ep = envelopeAndPhase(plain.subarray(0, N));
  const es = envelopeAndPhase(shaped.subarray(0, N));

  let num = 0, dp = 0, ds = 0, mp = 0, ms = 0;
  const n = N;
  for (let i = 0; i < n; i++) { mp += ep.envelope[i]!; ms += es.envelope[i]!; }
  mp /= n; ms /= n;
  for (let i = 0; i < n; i++) {
    const a = ep.envelope[i]! - mp;
    const b = es.envelope[i]! - ms;
    num += a * b; dp += a * a; ds += b * b;
  }
  const r = num / Math.sqrt(dp * ds);
  assert.ok(r > 0.9, `envelope correlation ${r.toFixed(3)} — shaping disturbed the envelope`);
});

test('triangularity sharpens extrema without breaking peak/trough symmetry', () => {
  // A triangle is symmetric between peak and trough; it sharpens BOTH. Peak-trough asymmetry
  // would have to come from somewhere else, and this asserts triangularity is not it.
  const x = make({ triangularity: 0.9, riseDecaySymmetry: 0.5 });
  let pos = 0;
  for (let i = 0; i < N; i++) if (x[i]! > 0) pos++;
  const frac = pos / N;
  assert.ok(Math.abs(frac - 0.5) < 0.03, `fraction above zero ${frac}, expected ~0.5`);
});
