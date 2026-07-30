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
  'resp_artifact',
  'alpha',
  'beta',
  'theta',
  'delta',
  'spindle_fast',
  'spindle_slow',
  'kc',
];

// A BAND RHYTHM GETS SUB-SOURCES; a graphoelement or an artifact does not.
//
// Modelling a rhythm as one source made every channel carrying it the same trace: N3 measured
// effective rank 1.07 against a real 3.09, and the oscillation layer measured rank ~1.1 in EVERY
// state. It only SHOWED in N3, where delta at 150 uV p-p swamps a background that measures 3.44
// on its own; elsewhere the background hid it.
//
// A RING OF SUB-SOURCES AROUND THE CENTRE WAS TRIED FIRST AND FAILED. Swept from radius 0.30 to
// 1.30 the family's rank topped out at 1.26, because at `topo_far_field_fraction` = 0.50 every
// source is half a near-flat pedestal and they all share that term -- no radius beats a component
// held in common. Measured, the shipped signal moved only 1.07 -> 1.14.
//
// So the sub-sources are placed on the SAME SIX REGIONAL CENTRES the aperiodic background uses,
// which is the basis Finding 11 already measured at 3.44. compose.ts puts
// `osc_coherent_fraction` of the variance on the registered centre and splits the rest over
// these. The band keeps its topography from the coherent part; it gains somewhere else to be
// from the regional part. See prep/reference/t1m1_osc_basis.py.
//
// The graphoelements are excluded because they are already spatially and temporally sparse --
// each event is one occurrence at one place, not a continuous field -- and `resp_artifact` is a
// single mechanical source by construction.
const OSCILLATIONS = ['alpha', 'beta', 'theta', 'delta'];

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

// VOLUME CONDUCTION NEEDS A HEAVIER TAIL THAN A GAUSSIAN.
//
// Build Plan 3.4 specifies w = exp(-d^2/2sigma^2), and a single Gaussian is wrong in the far
// field in a way that is visible on the trace: at `topo_sigma_alpha` = 0.35, a posterior alpha
// source reaches the frontal electrodes at exp(-8) ~ 3e-4, i.e. NOT AT ALL. Real posterior alpha
// is plainly visible frontally at reduced amplitude, because a dipole's scalp potential falls off
// as a power law, not as a Gaussian.
//
// It is the same defect as P9's measured shortfall -- far-field inter-channel correlation 0.286
// against a real 0.440 -- seen from the other side. One cause, two symptoms.
//
// The fix is a NEAR + FAR mixture: a tight Gaussian for the local generator plus a broad one
// carrying the volume-conducted spread. Two Gaussians are not a lead field, but they give the
// heavy tail the physics requires while keeping the same one-file schema, and
// `topo_far_field_fraction` is FITTED against the real recordings rather than chosen.
// THE REFERENCE ELECTRODES ARE NOT SCALP OVER CORTEX, and that is the whole reason an ear or
// mastoid reference is usable at all: it sits behind the ear over bone with no cortex beneath, so
// it picks up markedly less cortical activity than any scalp site. Modelled here as an
// attenuation of the volume-conducted pedestal at A1/A2 only.
//
// WITHOUT IT THE PEDESTAL IS SELF-DEFEATING, which took a measurement to see. The mastoids sit at
// (+-1.12, 0.08) -- closer to an occipital source than Fp1 is -- so an isotropic pedestal gave
// them MORE alpha (0.211) than the frontal mean (0.196). Linked-mastoid referencing then
// subtracted slightly more than frontal had, leaving referenced frontal alpha at -0.015: zero and
// inverted. A common-mode pedestal is precisely what a linked reference removes, so no fraction
// or width could have fixed it; the model needed the reference sites to differ in kind.
const ffFrac = num('topo_far_field_fraction');
const ffSigma = num('topo_sigma_far');
const refFf = num('topo_reference_far_field');
const REF_LABELS = new Set(montage.reference.map((c) => c.label));

// The sub-source count is the regional basis itself, not an independent choice, so it is
// asserted against the registry rather than read from it -- a mismatch means one of the two
// moved without the other, and compose.ts divides the amplitude by the registry's number.
if (num('osc_n_sources') !== BG_CENTRES.length) {
  throw new Error(
    `osc_n_sources is ${num('osc_n_sources')} but the regional basis has ${BG_CENTRES.length} ` +
    'centres; compose.ts would split the band amplitude into the wrong number of shares',
  );
}

for (const g of GENERATORS) {
  const cx = num(`topo_centre_${g}_x`);
  const cy = num(`topo_centre_${g}_y`);
  const sigma = num(`topo_sigma_${g}`);

  const weights = channels.map((ch) => {
    const d2 = (ch.x - cx) ** 2 + (ch.y - cy) ** 2;
    const near = Math.exp(-d2 / (2 * sigma * sigma));
    const far = Math.exp(-d2 / (2 * ffSigma * ffSigma));
    const share = REF_LABELS.has(ch.label) ? ffFrac * refFf : ffFrac;
    // Convex, so w(0) = 1 before normalization and the mixture cannot change the peak's
    // location -- G6's argmax check therefore still tests the centre, not this mixture.
    return (1 - share) * near + share * far;
  });

  // Normalize to a unit maximum so the weight vector carries SHAPE and the generator's
  // amplitude parameter carries SCALE. Without this the registry's uV amplitudes would mean
  // something different for every sigma.
  const peak = Math.max(...weights);
  projections[g] = {
    weights: weights.map((w) => Number((w / peak).toFixed(6))),
    provenance: {
      method: 'gaussian_near_plus_far_on_projected_10_20',
      centre: [cx, cy],
      sigma,
      far_field_fraction: ffFrac,
      sigma_far: ffSigma,
      registry_keys: [
        `topo_centre_${g}_x`, `topo_centre_${g}_y`, `topo_sigma_${g}`,
        'topo_far_field_fraction', 'topo_sigma_far',
      ],
    },
  };

  // Sub-sources on the background's regional centres, at the BAND's own sigma so each keeps the
  // spatial scale of the rhythm rather than the background's. The parent entry above stays
  // exactly as it was and remains what G6 checks, so adding these cannot move an argmax the
  // gate reads.
  if (OSCILLATIONS.includes(g)) {
    for (let k = 0; k < BG_CENTRES.length; k++) {
      const [sx, sy] = BG_CENTRES[k];
      const w = channels.map((ch) => {
        const d2 = (ch.x - sx) ** 2 + (ch.y - sy) ** 2;
        const near = Math.exp(-d2 / (2 * sigma * sigma));
        const far = Math.exp(-d2 / (2 * ffSigma * ffSigma));
        const share = REF_LABELS.has(ch.label) ? ffFrac * refFf : ffFrac;
        return (1 - share) * near + share * far;
      });
      const pk = Math.max(...w);
      projections[`${g}_s${k}`] = {
        weights: w.map((v) => Number((v / pk).toFixed(6))),
        provenance: {
          method: 'oscillation_regional_sub_source',
          parent: g,
          centre: [sx, sy],
          sigma,
          registry_keys: ['osc_n_sources', `topo_sigma_${g}`,
            'topo_far_field_fraction', 'topo_sigma_far'],
        },
      };
    }
  }
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
