/**
 * Lempel–Ziv complexity (Build Plan §7.2).
 *
 * "Bandpass, Hilbert, binarize around the median, concatenate channels column-wise, parse,
 * normalize against a surrogate."
 *
 * THE PARSE IS DELIBERATELY OPEN (pending decision P1). LZ76 and LZW are both implemented
 * behind one interface because the decision is "by which parse the landmark literature used",
 * and that question cannot be settled by preference. It does not block Tier 0: our landmarks
 * are computed from the generator's own output and are self-consistent under either parse.
 * It DOES constrain any comparison to published magnitudes, so `lz_parse` stays `absent` in
 * the registry until someone reads the reference papers.
 *
 * THE SURROGATE IS TIME-SHUFFLED, and that is decided (D1). Time-shuffling destroys the
 * spectrum, so the surrogate's complexity depends only on sequence length and symbol density —
 * its χ-dependence is zero by construction. That is what makes it cacheable by (length,
 * density) and what removes any Tier 0 dependency on estimator characterization. A
 * phase-shuffled surrogate preserves the spectrum, so its complexity tracks χ, and caching it
 * would inflate normalized LZc as a systematic function of χ — manufacturing correlated
 * structure along the second observable axis, which is the collinearity risk already rated
 * High. Phase-shuffled normalization is Tier 1, gated on T1-M2.
 *
 * WHAT THE NORMALIZED VALUE MEANS, which the UI must say beside the number: it normalizes
 * against "same density, no structure". A normalized complexity is meaningless without naming
 * its null.
 */
import { Rng } from '../core/rng/xoshiro128pp.ts';

export type LzParse = 'lz76' | 'lzw';

/**
 * LZ76 — Lempel & Ziv (1976) production complexity: the number of distinct substrings
 * encountered when scanning left to right.
 *
 * O(n²) worst case. Measured on the sequences this project actually produces it runs well
 * inside the per-second budget, but the Build Plan is explicit that the ~10⁵ ms figure quoted
 * earlier "is a property of the exhaustive-parse implementation, not of the measure", and
 * that if LZ76 is chosen it should be implemented with a suffix automaton.
 * TODO(P1): if LZ76 wins the parse decision, replace this with the O(n) automaton form.
 */
export function lz76(s: Uint8Array): number {
  const n = s.length;
  if (n === 0) return 0;
  let i = 0;
  let k = 1;
  let l = 1;
  let kMax = 1;
  let c = 1;

  for (;;) {
    if (s[i + k - 1] === s[l + k - 1]) {
      k++;
      if (l + k > n) {
        c++;
        break;
      }
    } else {
      if (k > kMax) kMax = k;
      i++;
      if (i === l) {
        c++;
        l += kMax;
        if (l + 1 > n) break;
        i = 0;
        k = 1;
        kMax = 1;
      } else {
        k = 1;
      }
    }
  }
  return c;
}

/**
 * LZW — dictionary complexity: the number of dictionary entries created.
 *
 * O(n) with a hash map. Kept as the default for now purely because it is linear; that is a
 * performance property and NOT an argument for it as the scientifically correct parse.
 */
export function lzw(s: Uint8Array): number {
  const dict = new Map<string, number>();
  dict.set('0', 0);
  dict.set('1', 1);
  let next = 2;
  let w = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] === 0 ? '0' : '1';
    const wc = w + c;
    if (dict.has(wc)) {
      w = wc;
    } else {
      dict.set(wc, next++);
      w = c;
    }
  }
  return next - 2;
}

export function parseComplexity(s: Uint8Array, parse: LzParse): number {
  return parse === 'lz76' ? lz76(s) : lzw(s);
}

/** Binarize about the median. The literature method (`lz_binarize`). */
export function binarizeAtMedian(x: Float64Array): Uint8Array {
  const sorted = Float64Array.from(x).sort();
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const out = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i]! > median ? 1 : 0;
  return out;
}

/** Fraction of ones. The surrogate depends on this and on length, and on nothing else. */
export function symbolDensity(s: Uint8Array): number {
  let ones = 0;
  for (let i = 0; i < s.length; i++) ones += s[i]!;
  return ones / s.length;
}

/**
 * Time-shuffled surrogate complexity, averaged over `nSurrogates` shuffles.
 *
 * Cacheable by (length, density, parse) — and this is the only reason a cache is legal here.
 * See the note at the top of the file.
 */
const surrogateCache = new Map<string, number>();

export function surrogateComplexity(
  s: Uint8Array,
  parse: LzParse,
  rng: Rng,
  nSurrogates = 5,
): number {
  const ones = Math.round(symbolDensity(s) * s.length);
  const key = `${s.length}|${ones}|${parse}|${nSurrogates}`;
  const hit = surrogateCache.get(key);
  if (hit !== undefined) return hit;

  const buf = Uint8Array.from(s);
  let total = 0;
  for (let r = 0; r < nSurrogates; r++) {
    // Fisher-Yates. Shuffling in time destroys the spectrum while preserving the density
    // exactly, which is precisely the null being normalized against.
    for (let i = buf.length - 1; i > 0; i--) {
      const j = Math.floor(rng.nextFloat() * (i + 1));
      const t = buf[i]!;
      buf[i] = buf[j]!;
      buf[j] = t;
    }
    total += parseComplexity(buf, parse);
  }
  const mean = total / nSurrogates;
  surrogateCache.set(key, mean);
  return mean;
}

export interface LzResult {
  /** Raw parse count. Meaningless without its length and parse. */
  readonly raw: number;
  /** Raw divided by the time-shuffled surrogate. */
  readonly normalized: number;
  readonly surrogate: number;
  readonly density: number;
  readonly parse: LzParse;
  readonly nSymbols: number;
  /** What the normalization is against. The UI must display this beside the number. */
  readonly nullDescription: string;
}

/**
 * Normalized Lempel-Ziv complexity of one or more channels.
 *
 * Channels are concatenated COLUMN-WISE — sample 0 of every channel, then sample 1, and so on
 * — so the parse sees the multichannel pattern at each instant rather than one channel after
 * another. The order is fixed by the montage, because the parse result depends on it.
 */
export function lempelZiv(
  channels: readonly Float64Array[],
  rng: Rng,
  parse: LzParse = 'lzw',
): LzResult {
  if (channels.length === 0) throw new Error('lempelZiv: no channels');
  const nSamp = channels[0]!.length;
  const bins = channels.map(binarizeAtMedian);

  const concat = new Uint8Array(nSamp * channels.length);
  let w = 0;
  for (let i = 0; i < nSamp; i++) {
    for (let c = 0; c < bins.length; c++) concat[w++] = bins[c]![i]!;
  }

  const raw = parseComplexity(concat, parse);
  const surrogate = surrogateComplexity(concat, parse, rng);
  return {
    raw,
    normalized: surrogate > 0 ? raw / surrogate : Number.NaN,
    surrogate,
    density: symbolDensity(concat),
    parse,
    nSymbols: concat.length,
    nullDescription: 'same density, no structure (time-shuffled surrogate)',
  };
}
