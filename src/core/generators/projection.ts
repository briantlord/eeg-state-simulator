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

export type GeneratorId =
  | `background_${number}`
  | 'alpha' | 'beta' | 'theta' | 'delta'
  // Sub-sources of a band rhythm, on a ring about its registered centre. A rhythm modelled as
  // ONE source made every channel carrying it the same trace -- N3 rank 1.07 against a real 3.09
  // -- so compose.ts splits its variance across these. See osc_n_sources.
  | `alpha_s${number}` | `beta_s${number}` | `theta_s${number}` | `delta_s${number}`
  | 'spindle_fast' | 'spindle_slow' | 'kc'
  // Mechanism (a). Its own topography, deliberately unlike any neural generator's, because
  // Build Plan 5.1 requires the three respiratory mechanisms stay separable.
  | 'resp_artifact';

/** Weight vector for a generator, indexed by `CHANNELS` order. */
export function weightsFor(generator: GeneratorId): readonly number[] {
  const entry = projection.generators[generator];
  if (!entry) {
    throw new Error(`projection file has no generator '${generator}'`);
  }
  return entry.weights;
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
