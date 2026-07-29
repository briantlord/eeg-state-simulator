/**
 * Reference montages.
 *
 * Referencing is not a display preference — it is a linear operator on the data, and it
 * changes what every downstream measure returns. Harness §5 warns about exactly this for the
 * one criterion the project treats as definitional: "AASM's criterion is referenced to
 * CONTRALATERAL MASTOID; evaluating it under average reference gives a different number and
 * would silently miscalibrate everything downstream."
 *
 * It is also a RANK operation, which is why the control belongs in an artifact about what
 * analysis choices do to data:
 *
 *   average    subtracts the mean across channels, removing exactly one dimension.
 *   Laplacian  is a spatial high-pass; it suppresses whatever is spatially broad, which for
 *              scalp EEG is most of the shared variance.
 *
 * Measured on this generator, effective dimensionality (participation ratio) in wake-EC:
 * as-generated 2.67, linked-mastoid 2.59, average 2.72, Laplacian 3.67. The Laplacian nearly
 * doubles it — not by adding information, but by removing the common component that was
 * dominating it.
 */
import { ALL_CHANNELS, CHANNEL_POSITIONS, REFERENCE_LABELS } from '../core/generators/projection.ts';

export type ReferenceMode = 'as-generated' | 'linked-mastoid' | 'contralateral' | 'average' | 'laplacian';

export const REFERENCE_LABEL: Record<ReferenceMode, string> = {
  'as-generated': 'as generated',
  'linked-mastoid': 'linked mastoid',
  contralateral: 'contralateral mastoid',
  average: 'average',
  laplacian: 'Laplacian',
};

export const REFERENCE_NOTE: Record<ReferenceMode, string> = {
  'as-generated': 'The raw generated sources, before any reference is applied.',
  'linked-mastoid':
    'Each channel minus the mean of A1 and A2. Common clinically; slightly attenuates ' +
    'activity that is itself picked up by the mastoids.',
  contralateral:
    'Left-hemisphere channels referenced to A2, right to A1. THIS is the derivation the AASM ' +
    'N3 criterion is defined on, and the one snr_nominal was calibrated against.',
  average:
    'Each channel minus the mean across all scalp channels. Removes exactly one dimension by ' +
    'construction, and assumes the head is fully sampled — which 19 electrodes are not.',
  laplacian:
    'Each channel minus the mean of its four nearest neighbours. A spatial high-pass: it ' +
    'suppresses broadly distributed activity and sharpens focal events, raising the effective ' +
    'rank without adding information.',
};

const N_SCALP = ALL_CHANNELS.length - REFERENCE_LABELS.length;

/** Indices of the k nearest scalp neighbours of each scalp channel, by montage distance. */
const NEIGHBOURS: number[][] = (() => {
  const k = 4;
  const out: number[][] = [];
  for (let i = 0; i < N_SCALP; i++) {
    const here = CHANNEL_POSITIONS[i]!;
    const d: { j: number; r: number }[] = [];
    for (let j = 0; j < N_SCALP; j++) {
      if (j === i) continue;
      const p = CHANNEL_POSITIONS[j]!;
      d.push({ j, r: Math.hypot(p.x - here.x, p.y - here.y) });
    }
    d.sort((a, b) => a.r - b.r);
    out.push(d.slice(0, k).map((e) => e.j));
  }
  return out;
})();

export interface Referenced {
  readonly channels: Float64Array[];
  readonly labels: string[];
  readonly mode: ReferenceMode;
}

/**
 * Apply a reference montage. Input is every generated channel (scalp then mastoids); output is
 * scalp only, because a referenced mastoid is not a meaningful trace.
 */
export function applyReference(
  all: readonly Float64Array[],
  mode: ReferenceMode,
): Referenced {
  const n = all[0]!.length;
  const scalp = all.slice(0, N_SCALP);
  const labels = ALL_CHANNELS.slice(0, N_SCALP) as string[];

  if (mode === 'as-generated') {
    return { channels: scalp.map((c) => Float64Array.from(c)), labels, mode };
  }

  const a1 = all[ALL_CHANNELS.indexOf('A1')]!;
  const a2 = all[ALL_CHANNELS.indexOf('A2')]!;

  // The average reference needs the across-channel mean ONCE per sample, not once per
  // channel per sample. Recomputing it inside the channel loop is O(channels^2 x samples) --
  // 8.3 million operations for a 90 s buffer, enough to stall the UI thread visibly.
  let avg: Float64Array | null = null;
  if (mode === 'average') {
    avg = new Float64Array(n);
    for (let c = 0; c < N_SCALP; c++) {
      const src = scalp[c]!;
      for (let i = 0; i < n; i++) avg[i] = avg[i]! + src[i]!;
    }
    for (let i = 0; i < n; i++) avg[i] = avg[i]! / N_SCALP;
  }

  const out: Float64Array[] = [];
  for (let c = 0; c < N_SCALP; c++) {
    const src = scalp[c]!;
    const dst = new Float64Array(n);

    if (mode === 'linked-mastoid') {
      for (let i = 0; i < n; i++) dst[i] = src[i]! - 0.5 * (a1[i]! + a2[i]!);
    } else if (mode === 'contralateral') {
      // Odd-numbered electrodes are left-hemisphere and pair with the right mastoid (A2).
      // Midline (z) electrodes have no contralateral side; linked mastoid is the convention.
      const label = labels[c]!;
      const isLeft = /[13579]$/.test(label);
      const isMid = /z$/i.test(label);
      for (let i = 0; i < n; i++) {
        const ref = isMid ? 0.5 * (a1[i]! + a2[i]!) : isLeft ? a2[i]! : a1[i]!;
        dst[i] = src[i]! - ref;
      }
    } else if (mode === 'average') {
      for (let i = 0; i < n; i++) dst[i] = src[i]! - avg![i]!;
    } else {
      const nb = NEIGHBOURS[c]!;
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (const j of nb) m += scalp[j]![i]!;
        dst[i] = src[i]! - m / nb.length;
      }
    }
    out.push(dst);
  }
  return { channels: out, labels, mode };
}

/**
 * How much of a generator's amplitude survives projection AND referencing, at one electrode.
 *
 * Demo 1 needs this to state ground truth honestly. The generator injects a respiratory
 * artifact of a known amplitude AT ITS SOURCE, but what reaches referenced Fz is that
 * amplitude times the projection weight, minus the same source picked up by whatever the
 * reference is. Measured on this montage under linked mastoid: 0.66. Comparing the recovered
 * µV against the source amplitude would therefore show a 34% "loss" at a 0.01 Hz cutoff, where
 * the filter has done nothing at all — attributing geometry to the filter.
 *
 * Every operator here is linear and sample-wise, so pushing the weight VECTOR through
 * `applyReference` as a one-sample record gives the exact gain. Reusing the operator rather
 * than re-deriving the algebra per mode is deliberate: the two can never drift apart.
 */
export function referencedGain(
  weights: readonly number[],
  mode: ReferenceMode,
  label: string,
): number {
  const asChannels = weights.map((w) => Float64Array.of(w));
  const r = applyReference(asChannels, mode);
  const i = r.labels.indexOf(label);
  return i < 0 ? Number.NaN : r.channels[i]![0]!;
}

/**
 * Effective dimensionality by the participation ratio, (Σλ)² / Σλ².
 *
 * Threshold-free, unlike "components to reach 95%", so it does not depend on where a line is
 * drawn. Computed from the channel covariance eigenvalues via the power-free route: for a
 * covariance matrix, Σλ = trace and Σλ² = ‖C‖_F², both available without a decomposition.
 */
export function effectiveRank(channels: readonly Float64Array[], stride = 4): number {
  const m = channels.length;
  const n = channels[0]!.length;
  // Rank is a statistical property of the covariance, so it does not need every sample.
  // Striding by 4 cuts the cost fourfold and moves the estimate by well under 0.01.
  const means = channels.map((c) => {
    let s = 0;
    let k = 0;
    for (let i = 0; i < n; i += stride) {
      s += c[i]!;
      k++;
    }
    return s / k;
  });

  let trace = 0;
  let frob2 = 0;
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) {
      let s = 0;
      let k = 0;
      for (let i = 0; i < n; i += stride) {
        s += (channels[a]![i]! - means[a]!) * (channels[b]![i]! - means[b]!);
        k++;
      }
      const cov = s / k;
      if (a === b) {
        trace += cov;
        frob2 += cov * cov;
      } else {
        frob2 += 2 * cov * cov;
      }
    }
  }
  return frob2 > 0 ? (trace * trace) / frob2 : Number.NaN;
}
