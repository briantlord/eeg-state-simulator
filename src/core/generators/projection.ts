/**
 * Seam 3 — signal class and projection are separate objects.
 *
 *     x_c(t) = sum_g w_{g,c} * s_g(t) + sum_a w_{a,c} * art_a(t) + eta_c(t)
 *
 * "DO NOT generate independent signals per channel — it is instantly wrong to anyone who has
 * looked at EEG and it breaks every downstream measure." A small number of shared source
 * generators are projected to channels through weight vectors read from a data file.
 *
 * This loader reads `weights` and NOTHING ELSE. The projection file also carries a
 * `provenance` block recording that Tier 0's weights came from a Gaussian, but reading it
 * here would let the Gaussian back into the runtime and make the upgrade path fiction.
 */
import projectionFile from '../../../data/projection_10_20.json' with { type: 'json' };
import montageFile from '../../../data/montage_10_20.json' with { type: 'json' };

export interface MontageChannel {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

const montage = montageFile as {
  channels: MontageChannel[];
  reference: MontageChannel[];
};

const projection = projectionFile as {
  schema: string;
  channels: string[];
  scalp: string[];
  reference: string[];
  generators: Record<string, { weights: number[] }>;
};

/** The 19 scalp electrodes. n_channels is definitional and excludes the mastoids. */
export const CHANNELS: readonly string[] = montage.channels.map((c) => c.label);

/** Mastoid references, ADDITIONAL to the 10-20 montage. gate_aasm_n3 needs them. */
export const REFERENCE_LABELS: readonly string[] = montage.reference.map((c) => c.label);

/** Every generated channel: scalp then reference. Projection weights are in this order. */
export const ALL_CHANNELS: readonly string[] = [...montage.channels, ...montage.reference].map(
  (c) => c.label,
);
export const CHANNEL_POSITIONS: readonly MontageChannel[] = montage.channels;
export const REFERENCE_CHANNELS: readonly MontageChannel[] = montage.reference;

/** Positions for every generated channel, in ALL_CHANNELS order. */
export const ALL_POSITIONS: readonly MontageChannel[] = [
  ...montage.channels,
  ...montage.reference,
];

if (projection.channels.length !== ALL_CHANNELS.length ||
    projection.channels.some((c, i) => c !== ALL_CHANNELS[i])) {
  throw new Error(
    'projection file channel order does not match the montage. The weight vectors are ' +
      'positional, so a mismatch silently projects every generator to the wrong scalp.',
  );
}

/** A generator that owns a cortical patch in the projection file. */
export type PatchId =
  | 'background'
  | 'alpha' | 'beta' | 'theta' | 'delta'
  | 'spindle_fast' | 'spindle_slow' | 'kc';

export type GeneratorId =
  | PatchId
  // SPATIAL EIGENMODES of the same cortical patch, `<patch>_m<k>` for k >= 1 (k = 0 is the patch
  // id itself). A patch is many dipoles with graded coherence, so its channel covariance
  // L C_s L^T has a spectrum; these are its leading modes. Driving them independently is what
  // gives a rhythm more than one spatial dimension -- seven point dipoles through a real lead
  // field would still be rank <= 7 and still separable (D19, Finding 20).
  | `${PatchId}_m${number}`
  // Mechanism (a). Deliberately NOT cortical: electrode movement and impedance change with the
  // chest, so a forward model is the wrong instrument. The sole non-anatomical topography.
  | 'resp_artifact';

/** Weight vector for a generator, indexed by `CHANNELS` order. */
export function weightsFor(generator: GeneratorId): readonly number[] {
  const entry = projection.generators[generator];
  if (!entry) {
    throw new Error(`projection file has no generator '${generator}'`);
  }
  return entry.weights;
}

/**
 * Every mode id of a patch, mode 0 first. Empty patches are a build error, not a silent zero.
 *
 * The COUNT IS READ FROM THE FILE rather than registered, because it is a property of the head
 * model and `patch_mode_variance`, not an independent choice. A registry row for it could
 * disagree with the projection, and the weights would win silently.
 */
export function modesOf(patch: PatchId): GeneratorId[] {
  const ids: GeneratorId[] = [patch];
  for (let k = 1; ; k++) {
    const id = `${patch}_m${k}` as GeneratorId;
    if (!projection.generators[id]) break;
    ids.push(id);
  }
  return ids;
}

/** Channel with the largest weight. G6's quantity — structural, no tolerance needed. */
export function argmaxChannel(generator: GeneratorId): string {
  const w = weightsFor(generator);
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i]! > w[best]!) best = i;
  return CHANNELS[best]!;
}

/**
 * Accumulate a source into the channel mix.
 *
 * `out` is [channel][sample]. Adds `w_{g,c} * s(t)` for every channel, in place.
 */
export function projectInto(
  out: Float64Array[],
  source: Float64Array,
  generator: GeneratorId,
): void {
  const w = weightsFor(generator);
  for (let c = 0; c < out.length; c++) {
    const wc = w[c]!;
    if (wc === 0) continue;
    const dst = out[c]!;
    for (let i = 0; i < source.length; i++) dst[i] = dst[i]! + wc * source[i]!;
  }
}

/**
 * Anterior-posterior position in [0, 1], 0 = most posterior. Drives the travelling-slow-wave
 * delay in Build Plan 3.5: delay = (AP position) / v.
 */
export function apPosition(channelIndex: number): number {
  const ys = CHANNEL_POSITIONS.map((c) => c.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return (CHANNEL_POSITIONS[channelIndex]!.y - lo) / (hi - lo);
}
