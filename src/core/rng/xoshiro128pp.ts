/**
 * Seam 4 — the RNG: named, seeded, version-pinned, with documented substream derivation.
 *
 * `rng_algorithm_ts` = xoshiro128++ (DECISIONS D2): 32-bit state, native in typed arrays.
 * PCG64 in a float64 language means BigInt or hand-rolled limb arithmetic, and parity across
 * languages is struck, so there is nothing to make identical.
 *
 * THE REQUIRED PROPERTY, which is the whole point of this file:
 *
 *   Adding a generator must not perturb the draws of any existing generator.
 *
 * It is supplied by deriving each substream from `(rootSeed, name)` alone — never from a
 * counter, an array index, or registration order, all of which shift when a generator is
 * added. `substream()` is a pure function of its two arguments, so a new name is a new stream
 * and every existing stream is bit-identical. `test/rng.test.ts` asserts exactly that.
 */

const ALGORITHM = 'xoshiro128++' as const;
const VERSION = 1 as const;

/** Algorithm identity, stamped into every epoch sidecar so a run is reproducible. */
export const RNG_IDENTITY = { algorithm: ALGORITHM, version: VERSION } as const;

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** FNV-1a over the generator name. Stable across platforms and versions. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** SplitMix32 — expands one 32-bit seed into the four words xoshiro needs. */
function splitmix32(seed: number): () => number {
  let z = seed >>> 0;
  return () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private readonly s: Uint32Array;
  /** Cached second Box-Muller variate; `null` when none is pending. */
  private spare: number | null = null;

  readonly label: string;

  private constructor(state: Uint32Array, label: string) {
    this.s = state;
    this.label = label;
  }

  /**
   * Root generator for a run. Prefer `substream()` for anything a generator draws from —
   * drawing directly from the root couples every generator's stream to every other's.
   */
  static fromSeed(seed: number, label = 'root'): Rng {
    const mix = splitmix32(seed);
    const st = new Uint32Array(4);
    // A zero state is a fixed point of xoshiro. Re-mix until it is non-zero.
    do {
      st[0] = mix();
      st[1] = mix();
      st[2] = mix();
      st[3] = mix();
    } while ((st[0]! | st[1]! | st[2]! | st[3]!) === 0);
    return new Rng(st, label);
  }

  /**
   * A per-generator substream, derived from `(rootSeed, name)` and nothing else.
   *
   * Deterministic, order-independent, and unaffected by which other substreams exist. This is
   * the non-perturbation property seam 4 requires.
   */
  static substream(rootSeed: number, name: string): Rng {
    return Rng.fromSeed((rootSeed ^ fnv1a32(name)) >>> 0, name);
  }

  /** Uniform uint32. The primitive; everything else is derived from it. */
  nextUint32(): number {
    const s = this.s;
    let s0 = s[0]!, s1 = s[1]!, s2 = s[2]!, s3 = s[3]!;

    const result = (rotl((s0 + s3) >>> 0, 7) + s0) >>> 0;
    const t = (s1 << 9) >>> 0;

    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);

    s[0] = s0; s[1] = s1; s[2] = s2; s[3] = s3;
    return result;
  }

  /** Uniform float64 in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float64 in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.nextFloat();
  }

  /** Standard normal, Box-Muller. Draws come in pairs; the spare is cached. */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u: number, v: number, r: number;
    do {
      u = 2 * this.nextFloat() - 1;
      v = 2 * this.nextFloat() - 1;
      r = u * u + v * v;
    } while (r === 0 || r >= 1);
    const f = Math.sqrt((-2 * Math.log(r)) / r);
    this.spare = v * f;
    return u * f;
  }

  /** Normal with mean and sd. */
  gaussian(mean: number, sd: number): number {
    return mean + sd * this.normal();
  }

  /** Fill a Float64Array with standard normals. Hot path for aperiodic synthesis. */
  fillNormal(out: Float64Array): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.normal();
    return out;
  }

  /** Exponential with the given rate. Used for event inter-arrival times. */
  exponential(rate: number): number {
    // 1 - nextFloat() so the argument is in (0, 1] and never 0.
    return -Math.log(1 - this.nextFloat()) / rate;
  }

  /** Snapshot of internal state, for the determinism gate and for resumable streams. */
  saveState(): Uint32Array {
    return this.s.slice();
  }

  restoreState(state: Uint32Array): void {
    if (state.length !== 4) throw new Error('rng: state must be 4 uint32 words');
    this.s.set(state);
    this.spare = null;
  }
}
