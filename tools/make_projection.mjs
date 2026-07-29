#!/usr/bin/env node
/**
 * Generate data/projection_10_20.json from the registry and the montage.
 *
 * Seam 3: "Projection is a per-generator weight vector read from a data file in a fixed
 * schema — never hardcoded channel weights." The Gaussian lives HERE, in a build tool. The
 * runtime loader reads weight vectors and knows nothing about how they were made, which is
 * what makes the upgrade ("swapping in eigenmode columns or a SEREEGA lead field is a file,
 * not a refactor") true rather than aspirational.
 *
 *   node tools/make_projection.mjs
 *   node tools/make_projection.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const registry = JSON.parse(readFileSync(join(ROOT, 'gen', 'registry.json'), 'utf8'));
const montage = JSON.parse(readFileSync(join(ROOT, 'data', 'montage_10_20.json'), 'utf8'));

/** Registry accessor: scalar rows read directly, pending rows via their provisional value. */
function num(key) {
  const row = registry.params[key];
  if (!row) throw new Error(`registry: no row '${key}'`);
  if (row.value.kind === 'scalar') return row.value.v;
  if (row.value.kind === 'pending') return row.provisional.v;
  throw new Error(`registry: '${key}' is ${row.value.kind}, expected scalar or pending`);
}

const GENERATORS = [
  'alpha',
  'beta',
  'theta',
  'delta',
  'spindle_fast',
  'spindle_slow',
  'kc',
];

// Scalp electrodes AND the mastoid references. gate_aasm_n3 is referenced to contralateral
// mastoid and anchors snr_nominal, hence every absolute uV amplitude in the registry -- so
// without A1/A2 the project's one definitional threshold cannot be computed at all.
// n_channels stays 19: the mastoids are additional to the 10-20 montage, not part of it.
const channels = [...montage.channels, ...montage.reference];

const projections = {};

// The aperiodic background is SEVERAL shared sources with distinct topographies.
//
// Build Plan 3.1 forbids per-channel independent signals: "instantly wrong to anyone who has
// looked at EEG". A SINGLE uniformly-weighted source is the opposite error and just as
// visible — measured, it gave an effective rank of 1.14, PC1 carrying 93% of variance and a
// median inter-channel correlation of 0.988. Every channel was the same trace scaled.
//
// Overlapping wide sources give correlation that falls off with distance, which is what
// volume conduction produces. Positions are left/right x frontal/central/posterior — a coarse
// spatial basis, not a claim about where cortical aperiodic activity lives.
// TODO(T1-M1): replace with fitted topographies or eigenmode columns; the schema is unchanged.
const bgN = num('background_n_sources');
const bgSigma = num('topo_sigma_background');
const BG_CENTRES = [
  [-0.5, 0.5], [0.5, 0.5],
  [-0.6, 0.0], [0.6, 0.0],
  [-0.45, -0.55], [0.45, -0.55],
];
// Source 0 is GLOBAL � uniform across the scalp. Sources 1..N-1 are regional.
//
// Regional sources alone cannot reproduce the observed long-range correlation: measured
// against PhysioNet EEGMAT resting (near 0.767, far 0.440), widening the regional sigma
// peaks the far-field correlation at 0.29 and then DECREASES it, because six independent
// realizations average out rather than sharing anything. Real scalp EEG has a genuinely
// common mode. `background_global_fraction` sets how much variance it carries.
projections['background_0'] = {
  weights: channels.map(() => 1),
  provenance: {
    method: 'uniform_global',
    note: 'the common mode; amplitude set by background_global_fraction',
    registry_keys: ['background_global_fraction'],
  },
};
for (let i = 1; i < bgN; i++) {
  const [cx, cy] = BG_CENTRES[(i - 1) % BG_CENTRES.length];
  const weights = channels.map((ch) =>
    Math.exp(-(((ch.x - cx) ** 2 + (ch.y - cy) ** 2)) / (2 * bgSigma * bgSigma)),
  );
  const peak = Math.max(...weights);
  projections[`background_${i}`] = {
    weights: weights.map((w) => Number((w / peak).toFixed(6))),
    provenance: {
      method: 'gaussian_on_projected_10_20',
      centre: [cx, cy],
      sigma: bgSigma,
      registry_keys: ['background_n_sources', 'topo_sigma_background'],
    },
  };
}

for (const g of GENERATORS) {
  const cx = num(`topo_centre_${g}_x`);
  const cy = num(`topo_centre_${g}_y`);
  const sigma = num(`topo_sigma_${g}`);

  // w = exp(-d^2 / 2*sigma^2), Build Plan 3.4.
  const weights = channels.map((ch) => {
    const d2 = (ch.x - cx) ** 2 + (ch.y - cy) ** 2;
    return Math.exp(-d2 / (2 * sigma * sigma));
  });

  // Normalize to a unit maximum so the weight vector carries SHAPE and the generator's
  // amplitude parameter carries SCALE. Without this the registry's uV amplitudes would mean
  // something different for every sigma.
  const peak = Math.max(...weights);
  projections[g] = {
    weights: weights.map((w) => Number((w / peak).toFixed(6))),
    provenance: {
      method: 'gaussian_on_projected_10_20',
      centre: [cx, cy],
      sigma,
      registry_keys: [`topo_centre_${g}_x`, `topo_centre_${g}_y`, `topo_sigma_${g}`],
    },
  };
}

const out = {
  schema: 'projection/1',
  note:
    'GENERATED by tools/make_projection.mjs from registry/parameters.yaml and ' +
    'data/montage_10_20.json. Seam 3: the runtime reads `weights` only. `provenance` is ' +
    'documentation — no loader may read it, or the Gaussian leaks back into the runtime. ' +
    'TODO(T1-M1): replace `weights` with LPsi^T columns or a SEREEGA lead field; the loader ' +
    'and this schema do not change.',
  channels: channels.map((c) => c.label),
  scalp: montage.channels.map((c) => c.label),
  reference: montage.reference.map((c) => c.label),
  generators: projections,
};

const text = JSON.stringify(out, null, 2) + '\n';
const path = join(ROOT, 'data', 'projection_10_20.json');

if (CHECK) {
  const existing = readFileSync(path, 'utf8');
  if (existing !== text) {
    console.error('DRIFT: data/projection_10_20.json is stale. Run: node tools/make_projection.mjs');
    process.exit(1);
  }
  console.log(`projection check OK — ${GENERATORS.length} generators over ${channels.length} channels`);
} else {
  writeFileSync(path, text);
  console.log(`wrote data/projection_10_20.json — ${GENERATORS.length} generators over ${channels.length} channels`);
  for (const g of GENERATORS) {
    const w = projections[g].weights;
    const argmax = channels[w.indexOf(Math.max(...w))].label;
    console.log(`  ${g.padEnd(14)} argmax ${argmax}`);
  }
}
