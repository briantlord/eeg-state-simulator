/**
 * ISF-0 structural probe.
 *
 * This probe began as the pre-implementation fixed point. ISF-2 permits undriven BEM source
 * bases, and ISF-3 permits an explicit fixture path, while the default generator continues to
 * reject invented physiological magnitudes and generated infra-slow truth.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf0_contract.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeState } from '../../src/core/generators/compose.ts';
import {
  bandEdges,
  enumValue,
  GENERATOR_VERSION,
  record,
  scalarValue,
} from '../../src/core/registry.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projection = JSON.parse(
  readFileSync(resolve(root, 'data', 'projection_10_20.json'), 'utf8'),
) as {
  generators: Record<string, {
    provenance: { method?: string; regions?: readonly string[]; phase?: unknown; delay?: unknown };
  }>;
};

const full = bandEdges('isf_band');
const low = bandEdges('isf1_band');
const high = bandEdges('isf2_band');
const durationS = scalarValue('isf_probe_record_length');
const cyclesAtLowerEdge = durationS * full.lo;
const unknownRows = [
  'isf_cortical_rms_wake',
  'isf_cortical_rms_nrem',
  'isf_cortical_rms_rem',
  'isf_shared_source_fraction',
  'isf_source_delay_s',
  'isf_band_variance_fraction',
  'isf_modulation_target_map',
  'isf_pac_preferred_phase',
  'isf_pac_depth_wake',
  'isf_pac_depth_nrem',
  'isf_pac_depth_rem',
  'electrode_dc_drift_rms',
  'reference_dc_drift_rms',
] as const;

const failures: string[] = [];
if (low.lo !== full.lo || low.hi !== high.lo || high.hi !== full.hi) {
  failures.push('ISF1 and ISF2 do not exactly partition the registered full band');
}
if (Math.abs(cyclesAtLowerEdge - 10) > Number.EPSILON) {
  failures.push(`probe spans ${cyclesAtLowerEdge} lower-edge cycles rather than ten`);
}
for (const key of unknownRows) {
  if (record(key).value.kind !== 'absent') failures.push(`${key} acquired an unsupported value`);
}

const projectedIsfIds = Object.keys(projection.generators).filter((key) => key.startsWith('isf'));
const selectedFamilies = enumValue('isf_source_families');
const familyIds = ['isf_frontomedial', 'isf_sensorimotor', 'isf_posterior'] as const;
for (const family of familyIds) {
  const entries = Object.entries(projection.generators).filter(
    ([key]) => key === family || key.startsWith(`${family}_m`),
  );
  if (entries.length === 0) failures.push(`ISF-2 projection is missing ${family}`);
  for (const [key, entry] of entries) {
    if (entry.provenance.method !== 'leadfield_patch_eigenmode') {
      failures.push(`${key} does not use the BEM patch-eigenmode path`);
    }
    if (!entry.provenance.regions?.length) failures.push(`${key} has no named atlas regions`);
    if ('phase' in entry.provenance || 'delay' in entry.provenance) {
      failures.push(`${key} stores source timing in channel projection metadata`);
    }
  }
}
if (selectedFamilies.length !== familyIds.length) failures.push('registry does not select three ISF families');
if (record('isf_lateral_family').value.kind !== 'absent') {
  failures.push('conditional lateral family was promoted without an external requirement');
}

const short = composeState(260825, 'wake_ec', scalarValue('fs') * 2);
const truthHasInfraSlow = 'infraSlow' in short.truth;
if (truthHasInfraSlow) failures.push('pre-implementation truth already claims an infraSlow source');

const result = {
  probe: 'ISF-0 through ISF-3 structural fixed point',
  generatorVersion: GENERATOR_VERSION,
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  bandsHz: { full, isf1: low, isf2: high },
  probeRecord: { durationS, cyclesAtLowerEdge },
  referenceMetrics: {
    pacPlvWake: scalarValue('isf_pac_plv_wake_reference'),
    pacPlvNrem: scalarValue('isf_pac_plv_nrem_reference'),
  },
  absentRows: unknownRows,
  selectedFamilies,
  projectedIsfIds,
  truthHasInfraSlow,
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;
