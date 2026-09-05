import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { composeState } from '../src/core/generators/compose.ts';
import { bandEdges, enumValue, provisionalValue, record, scalarValue } from '../src/core/registry.ts';
import { auditEvidence } from '../prep/reference/isf4_external_evidence.mts';

test('ISF1 and ISF2 exactly partition the literature-defined infra-slow band', () => {
  const full = bandEdges('isf_band');
  const low = bandEdges('isf1_band');
  const high = bandEdges('isf2_band');

  assert.equal(low.lo, full.lo);
  assert.equal(low.hi, high.lo);
  assert.equal(high.hi, full.hi);
  assert.equal(scalarValue('isf_probe_record_length') * full.lo, 10);
});

test('released ISF values are explicit provisionals while unidentified structure stays absent', () => {
  for (const key of [
    'isf_cortical_rms_wake',
    'isf_cortical_rms_nrem',
    'isf_cortical_rms_rem',
    'isf_band_variance_fraction',
    'isf_pac_depth_wake',
    'isf_pac_depth_nrem',
    'isf_pac_depth_rem',
  ] as const) {
    assert.equal(record(key).value.kind, 'pending', key);
    assert.equal(Number.isFinite(provisionalValue(key)), true, key);
  }
  for (const key of [
    'isf_shared_source_fraction',
    'isf_source_delay_s',
    'isf_pac_preferred_phase',
    'electrode_dc_drift_rms',
    'reference_dc_drift_rms',
  ] as const) {
    assert.equal(record(key).value.kind, 'absent', key);
  }
});

test('released ISF drives the BEM bases and labels its provisional truth', () => {
  const generated = composeState(260825, 'wake_ec', scalarValue('fs') * 2);
  assert.equal(generated.truth.infraSlow?.fixture, false);
  assert.equal(generated.truth.infraSlow?.profile, 'provisional_release');
  assert.equal(generated.truth.infraSlow?.extrapolated, false);
  assert.ok((generated.truth.infraSlow?.sourceModes.length ?? 0) > 0);
});

test('ISF-1 selects a temporal family with conspicuous provisional settings', () => {
  assert.deepEqual(enumValue('isf_temporal_model'), ['band_limited_power_law_state_space']);
  assert.equal(scalarValue('isf_controller_rate'), 2);
  assert.equal(record('isf_temporal_exponent').value.kind, 'pending');
  assert.equal(record('isf_temporal_pole_count').value.kind, 'pending');
  assert.equal(record('isf_resonance_fraction').value.kind, 'absent');
});

test('ISF-2 exposes three named cortical families only through BEM modes', () => {
  assert.deepEqual(enumValue('isf_spatial_model'), ['fsaverage_bem_patch_covariance_modes']);
  assert.deepEqual(enumValue('isf_source_families'), [
    'frontomedial_association',
    'sensorimotor',
    'posterior_visual',
  ]);
  assert.equal(record('isf_lateral_family').value.kind, 'absent');

  const projection = JSON.parse(readFileSync('data/projection_10_20.json', 'utf8')) as {
    generators: Record<string, {
      provenance: { method?: string; regions?: readonly string[]; phase?: unknown; delay?: unknown };
    }>;
  };
  for (const family of ['isf_frontomedial', 'isf_sensorimotor', 'isf_posterior']) {
    const modes = Object.entries(projection.generators).filter(
      ([key]) => key === family || key.startsWith(`${family}_m`),
    );
    assert.ok(modes.length > 1, `${family} must retain multiple covariance modes`);
    for (const [key, entry] of modes) {
      assert.equal(entry.provenance.method, 'leadfield_patch_eigenmode', key);
      assert.ok(entry.provenance.regions?.length, `${key} has named atlas regions`);
      assert.equal('phase' in entry.provenance, false, `${key} has no channel phase`);
      assert.equal('delay' in entry.provenance, false, `${key} has no channel delay`);
    }
  }
});

test('ISF-3 fixes mechanism algebra and exposes provisional release parameters', () => {
  assert.deepEqual(enumValue('isf_modulation_gain_model'), ['lognormal_unit_mean_square']);
  assert.equal(record('isf_band_variance_fraction').value.kind, 'pending');
  assert.equal(record('isf_modulation_target_map').value.kind, 'procedure');
  assert.equal(record('isf_pac_preferred_phase').value.kind, 'absent');
  assert.equal(record('isf_pac_depth_wake').value.kind, 'pending');
  assert.equal(record('isf_pac_depth_nrem').value.kind, 'pending');
  assert.equal(record('isf_pac_depth_rem').value.kind, 'pending');
});

test('ISF-4 still cannot turn total scalp voltage into a fitted cortical-source amplitude', () => {
  const evidence = auditEvidence();
  assert.ok(evidence.length > 0);
  assert.equal(evidence.some((item) => item.eligibleCorticalRmsFit), false);
  for (const key of [
    'isf_shared_source_fraction',
    'isf_source_delay_s',
  ] as const) {
    assert.equal(record(key).value.kind, 'absent', key);
  }
  for (const key of [
    'isf_cortical_rms_wake',
    'isf_cortical_rms_nrem',
    'isf_cortical_rms_rem',
  ] as const) {
    assert.equal(record(key).value.kind, 'pending', key);
  }
});
