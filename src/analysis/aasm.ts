/**
 * The AASM N3 scoring criterion — the project's one definitional threshold.
 *
 * "≥20% of a 30 s epoch occupied by 0.5–2 Hz activity at ≥75 µV peak-to-peak, REFERENCED TO
 * CONTRALATERAL MASTOID."
 *
 * THE REFERENCE IS NOT A DETAIL. Harness §5: "AASM's criterion is referenced to contralateral
 * mastoid; evaluating it under average reference gives a different number and would silently
 * miscalibrate everything downstream." A 19-channel 10-20 montage contains no mastoids, so
 * A1/A2 are generated as additional channels purely so this can be computed at all.
 *
 * THE 75 µV FIGURE APPEARS HERE AND NOWHERE ELSE. `delta_amp` must never be set from it —
 * that would generate N3 to satisfy the check meant to test it, which is the circularity the
 * registry exists to expose.
 */
import { bandpassSections, filtfiltPadded } from '../core/dsp/biquad.ts';
import { scalarValue, bandEdges, electrodeSet } from '../core/registry.ts';

/** Operational slow-wave proxy; see docs/Scoring-Contract.md. */
export const AASM_SCORER_VERSION = 'central-halfwave-cascade-v2';

export function aasmFiltered(signal: Float64Array, fs: number): Float64Array {
  const band = bandEdges('gate_aasm_n3_band');
  return filtfiltPadded(signal, bandpassSections(band.lo, band.hi, fs, scalarValue('filter_order')));
}

export interface AasmResult {
  /** Fraction of the epoch occupied by qualifying slow-wave activity. */
  readonly fraction: number;
  /** Whether the epoch meets the criterion. */
  readonly meets: boolean;
  /** The derivation actually evaluated, e.g. "C3-A2". */
  readonly derivation: string;
  readonly thresholdFraction: number;
  readonly thresholdUvPp: number;
}

/**
 * Contralateral-mastoid derivation: C3 referenced to A2, or C4 to A1.
 *
 * This project's explicit operational proxy uses C3-A2. It does not claim that central
 * derivations are the universal AASM primary montage; see docs/Scoring-Contract.md.
 */
export function contralateralDerivation(
  channels: readonly Float64Array[],
  labels: readonly string[],
  scalp = 'C3',
): { signal: Float64Array; name: string } {
  const refs = electrodeSet('reference_channels'); // [A1, A2]
  // Contralateral: a left-hemisphere electrode pairs with the right mastoid.
  const ref = scalp.match(/[13579]$/) ? refs[1]! : refs[0]!; // @lit-ok 10-20 odd-numbered electrodes are left-hemisphere (regex character class, not a number)
  const si = labels.indexOf(scalp);
  const ri = labels.indexOf(ref);
  if (si < 0) throw new Error(`aasm: no channel '${scalp}'`);
  if (ri < 0) {
    throw new Error(
      `aasm: no reference channel '${ref}'. The AASM criterion is referenced to ` +
        'contralateral mastoid and cannot be evaluated without one.',
    );
  }
  const a = channels[si]!;
  const b = channels[ri]!;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! - b[i]!;
  return { signal: out, name: `${scalp}-${ref}` };
}

/**
 * Evaluate the criterion on one epoch.
 *
 * "Occupied by" is measured half-wave by half-wave: the band-limited signal is split at zero
 * crossings, and each half-wave whose peak-to-peak excursion reaches the threshold contributes
 * its own duration. That is closer to how a scorer reads a trace than a sliding-window
 * amplitude would be, and it makes the fraction a genuine occupancy rather than a smoothed
 * envelope statistic.
 */
export function aasmN3(
  channels: readonly Float64Array[],
  labels: readonly string[],
  fs = scalarValue('fs'),
  scalp = 'C3',
): AasmResult {
  const { signal, name } = contralateralDerivation(channels, labels, scalp);
  const minFrac = scalarValue('gate_aasm_n3_min_fraction');
  const minPp = scalarValue('gate_aasm_n3_min_amp');

  const x = aasmFiltered(signal, fs);

  // Zero crossings bound half-waves.
  let occupied = 0;
  let start = 0;
  for (let i = 1; i <= x.length; i++) {
    const crossed = i === x.length || (x[i - 1]! < 0) !== (x[i]! < 0);
    if (!crossed) continue;
    if (i - start < 2) { start = i; continue; }
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = start; j < i; j++) {
      if (x[j]! < lo) lo = x[j]!;
      if (x[j]! > hi) hi = x[j]!;
    }
    // A half-wave's peak-to-peak excursion is twice its peak amplitude about zero.
    if (2 * Math.max(Math.abs(lo), Math.abs(hi)) >= minPp) occupied += i - start;
    start = i;
  }

  const fraction = occupied / x.length;
  return {
    fraction,
    meets: fraction >= minFrac,
    derivation: name,
    thresholdFraction: minFrac,
    thresholdUvPp: minPp,
  };
}
