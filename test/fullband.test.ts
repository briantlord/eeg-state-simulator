import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fullRecordPeriodogram,
  hybridLowNperseg,
  hybridSpectrum,
} from '../src/render/spectrum.ts';
import { welch } from '../src/analysis/psd.ts';
import { bandEdges, scalarValue, enumValue, uiDomain } from '../src/core/registry.ts';
import { buildFullBandOverview } from '../src/ui/fullband.ts';

test('full-band overview is one released record with named provisional ISF truth', () => {
  const durationS = 4;
  const overview = buildFullBandOverview({
    seed: 260825,
    state: 'wake_ec',
    durationS,
    reference: 'linked-mastoid',
    compose: {
      respirationMode: 'natural',
      movementArtifact: true,
      amplitudeModulation: true,
      chiModulation: true,
      eventRespirationCoupling: true,
      lineNoise: false,
    },
  });

  assert.equal(overview.hasNamedInfraSlowTruth, true);
  assert.equal(overview.raw.length, 19);
  assert.equal(overview.overviewRaw.length, 19);
  assert.equal(overview.overviewRaw[0]!.length, durationS * scalarValue('isf_overview_rate'));
  assert.equal(overview.comparisonSpec.highpassHz, scalarValue('isf_comparison_hpf'));
  assert.equal(overview.comparisonSpec.lowpassHz, null);
  assert.equal(overview.labels.includes('Fz'), true);

  const fz = overview.labels.indexOf('Fz');
  let maxDifference = 0;
  for (let i = 0; i < overview.overviewRaw[fz]!.length; i++) {
    assert.equal(Number.isFinite(overview.overviewRaw[fz]![i]!), true);
    assert.equal(Number.isFinite(overview.overviewHighPassed[fz]![i]!), true);
    maxDifference = Math.max(
      maxDifference,
      Math.abs(overview.overviewRaw[fz]![i]! - overview.overviewHighPassed[fz]![i]!),
    );
  }
  assert.ok(maxDifference > 0, 'raw and high-passed arms must be a genuine comparison');
});

test('full-record spectrum reaches the low-frequency UI domain when duration supports it', () => {
  const fs = scalarValue('fs');
  const durationS = 300;
  const frequencyHz = 0.02;
  const x = Float64Array.from(
    { length: fs * durationS },
    (_, i) => Math.sin((2 * Math.PI * frequencyHz * i) / fs),
  );
  const psd = fullRecordPeriodogram(x, fs);
  const binSpacing = psd.freqs[1]! - psd.freqs[0]!;
  assert.ok(binSpacing <= 1 / durationS);
  assert.ok(binSpacing < uiDomain('isf_spectrum_range').lo);

  let peak = 1;
  for (let i = 2; i < psd.power.length; i++) {
    if (psd.power[i]! > psd.power[peak]!) peak = i;
  }
  assert.ok(Math.abs(psd.freqs[peak]! - frequencyHz) <= binSpacing);
});

test('full-band duration choices are UI choices and do not replace the validation record', () => {
  assert.deepEqual(enumValue('isf_overview_duration_options'), [120, 300, 600]);
  assert.ok(
    Math.max(...enumValue('isf_overview_duration_options').map(Number)) <
      scalarValue('isf_probe_record_length'),
  );
});

test('the live hybrid averages long windows below 1 Hz and ordinary Welch above it', () => {
  const fs = scalarValue('fs');
  const durationS = scalarValue('display_buffer_s');
  const x = Float64Array.from(
    { length: fs * durationS },
    (_, i) => Math.sin((2 * Math.PI * bandEdges('isf_band').lo * i) / fs),
  );
  const hybrid = hybridSpectrum(x, fs);
  const ordinary = welch(x, fs);

  const lowNper = hybridLowNperseg(x.length);
  assert.equal(lowNper, 8192);
  assert.equal(hybrid.freqs[1], fs / lowNper);
  assert.ok(hybrid.freqs[1]! < ordinary.freqs[1]!);
  assert.ok(hybrid.freqs.some((frequency) => frequency >= bandEdges('isf_band').lo &&
    frequency < ordinary.freqs[1]!));
  // Above the blend, the returned frequency grid is exactly ordinary Welch's sparse, heavily
  // averaged grid—not a dense periodogram that draws estimator variance as physiology.
  const blendHi = 1;
  assert.deepEqual(
    [...hybrid.freqs].filter((frequency) => frequency > blendHi),
    [...ordinary.freqs].filter((frequency) => frequency > blendHi),
  );
});
