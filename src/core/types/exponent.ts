/**
 * Seam 7 — an exponent is a (value, band, aperiodic mode) tuple everywhere. Never a bare
 * number, in code, exports, UI or any gate.
 *
 * "The two bands the artifact exposes require different aperiodic modes and recover different
 * quantities; make it a type error to compare them."
 *
 * The brand is declared as a FUNCTION taking B and M and returning them. A function type is
 * contravariant in its parameters and covariant in its return, so the pair is invariant in
 * both B and M. That is what makes `difference(broad, narrow)` fail to compile: TypeScript
 * cannot widen both arguments to a common union, because an invariant brand refuses the
 * widening. A plain `readonly band: B` property would be covariant and would widen happily.
 *
 * ============================ KNOWN GAP — READ THIS ============================
 *
 * The brand guards FUNCTIONS THAT MENTION IT. It does not guard `.value`, which is a public
 * `readonly value: number`. All of the following compile clean under this project's own
 * strict config, and all produce numbers at runtime:
 *
 *     broad.value - narrow.value
 *     [broad, narrow].map(e => e.value).sort((p, q) => p - q)
 *     Math.abs(broad.value - narrow.value)
 *
 * The second is exactly what a state-ordering gate (harness section 6, "State orderings
 * (chi, LZc)") would write. So seam 7 is enforced at `difference()` and NOWHERE ELSE, and an
 * earlier version of this comment claimed otherwise ("This file is that type error") — it was
 * wrong, and the type-level tests in test/exponent.test.ts only ever exercised `difference`.
 *
 * TODO(WP-G, before the state-ordering gate is written): make `value` opaque —
 * `readonly value: Chi<B, M>` where `Chi` is a nominal object-like type, with an explicit
 * `chiNumber<B, M>(v: Chi<B, M>, band: B, mode: M): number` unwrap, so extracting a number
 * has to name the band and mode. Branding as `number & {...}` will NOT work: arithmetic on a
 * number subtype is still legal.
 *
 * Until then, treat the tuple discipline here as a convention with one enforced choke point,
 * not as a guarantee.
 * ==============================================================================
 */

declare const EXPONENT_BRAND: unique symbol;

export type FitBand = 'broad_1_45' | 'narrow_30_45';
export type AperiodicMode = 'knee' | 'fixed';

export interface Exponent<B extends FitBand, M extends AperiodicMode> {
  readonly [EXPONENT_BRAND]: (b: B, m: M) => [B, M];
  /** The exponent chi. Positive means falling power with frequency. */
  readonly value: number;
  readonly band: B;
  readonly mode: M;
  /** Knee parameter k, present only in knee mode. Knee frequency is k^(1/chi). */
  readonly knee: M extends 'knee' ? number : undefined;
  /** Goodness of fit, as reported by the fitting tool. Carried so a report can print it. */
  readonly rSquared: number | undefined;
}

/**
 * The only two legal pairings.
 *
 * A knee cannot be identified from a band lying entirely above it, so the 30-45 Hz fit must be
 * fixed-mode. There is deliberately no `Exponent<'narrow_30_45', 'knee'>` constructor.
 */
export type BroadKneeExponent = Exponent<'broad_1_45', 'knee'>;
export type NarrowFixedExponent = Exponent<'narrow_30_45', 'fixed'>;
export type AnyExponent = BroadKneeExponent | NarrowFixedExponent;

/** G1a's quantity: chi and k, knee mode over 1-45 Hz. */
export function broadKnee(value: number, knee: number, rSquared?: number): BroadKneeExponent {
  return {
    value,
    knee,
    band: 'broad_1_45',
    mode: 'knee',
    rSquared,
  } as BroadKneeExponent;
}

/** G1b's quantity: chi only, fixed mode over 30-45 Hz. A DIFFERENT quantity, not an estimate of the same one. */
export function narrowFixed(value: number, rSquared?: number): NarrowFixedExponent {
  return {
    value,
    knee: undefined,
    band: 'narrow_30_45',
    mode: 'fixed',
    rSquared,
  } as NarrowFixedExponent;
}

/**
 * Difference between two exponents of the SAME band and mode.
 *
 * `difference(broadKnee(...), narrowFixed(...))` is a compile error, which is the point.
 */
export function difference<B extends FitBand, M extends AperiodicMode>(
  a: Exponent<B, M>,
  b: Exponent<B, M>,
): number {
  return a.value - b.value;
}

/** Knee frequency in Hz, from the knee parameter and the exponent: f_knee = k^(1/chi). */
export function kneeFrequency(e: BroadKneeExponent): number {
  if (e.knee <= 0) return Number.NaN;
  return Math.pow(e.knee, 1 / e.value);
}

/** Human-readable, and never a bare number — the UI and every report line use this. */
export function formatExponent(e: AnyExponent): string {
  const band = e.band === 'broad_1_45' ? '1–45 Hz' : '30–45 Hz';
  const base = `χ = ${e.value.toFixed(3)} (${band}, ${e.mode} mode)`; // @lit-ok display precision (3 decimals)
  return e.mode === 'knee' && e.knee !== undefined
    ? `${base}, knee ${kneeFrequency(e as BroadKneeExponent).toFixed(1)} Hz`
    : base;
}

/**
 * Analytic log-log slope of the generative form L(f) = b - log10(k + f^chi), least-squares
 * fitted over [lo, hi].
 *
 * Why this lives in the core rather than the harness: it separates the STRUCTURAL component of
 * G1b's recovery error from estimator error. Measured, G1b's bias (0.417) matches this
 * prediction (0.429) to within 3% — so specparam is not making an error, it is correctly
 * reporting the slope of a curve that is not a straight line over that band. The runner prints
 * both, so the two are never conflated. See docs/Tier0-Estimator-Probe.md Finding 2.
 */
export function analyticSlope(chi: number, k: number, lo: number, hi: number, n = 400): number { // @lit-ok analytic-slope sample count over the fit band
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const logLo = Math.log10(lo);
  const step = (Math.log10(hi) - logLo) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = logLo + i * step;
    const f = Math.pow(10, x); // @lit-ok log-frequency base
    const y = -Math.log10(k + Math.pow(f, chi));
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  return -(n * sxy - sx * sy) / (n * sxx - sx * sx);
}
