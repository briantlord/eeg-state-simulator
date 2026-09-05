/**
 * ISF-6 release-interface characterization.
 *
 * Record only. This checks that every offered overview length is a single continuous generator
 * call, that the complete-record spectrum reaches the requested axis when duration permits, and
 * that the release UI does not activate any uncalibrated causal fixture.
 */
import { buildFullBandOverview } from '../../src/ui/fullband.ts';
import { fullRecordPeriodogram } from '../../src/render/spectrum.ts';
import {
  bandEdges,
  enumValue,
  record,
  scalarValue,
  uiDomain,
  GENERATOR_VERSION,
} from '../../src/core/registry.ts';

function rms(x: Float64Array): number {
  let sum = 0;
  for (const value of x) sum += value * value;
  return Math.sqrt(sum / x.length);
}

function differenceRms(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const difference = a[i]! - b[i]!;
    sum += difference * difference;
  }
  return Math.sqrt(sum / a.length);
}

const seed = 260825;
const state = 'wake_ec';
const channel = 'Fz';
const axis = uiDomain('isf_spectrum_range');
const isfBand = bandEdges('isf_band');
const durations = enumValue('isf_overview_duration_options').map(Number);
const records = [];

for (const durationS of durations) {
  const started = performance.now();
  const overview = buildFullBandOverview({
    seed,
    state,
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
  const index = overview.labels.indexOf(channel);
  const spectrum = fullRecordPeriodogram(overview.raw[index]!, overview.fs);
  const rawRms = rms(overview.overviewRaw[index]!);
  const highPassedRms = rms(overview.overviewHighPassed[index]!);
  records.push({
    durationS,
    isfLowerEdgeCycles: durationS * isfBand.lo,
    axisLowerEdgeCycles: durationS * axis.lo,
    fundamentalResolutionHz: 1 / durationS,
    plottedBinSpacingHz: spectrum.freqs[1]! - spectrum.freqs[0]!,
    axisLowerHz: axis.lo,
    overviewSamples: overview.overviewRaw[index]!.length,
    dcRetainingRmsUv: rawRms,
    highPassedRmsUv: highPassedRms,
    removedComponentRmsUv: differenceRms(
      overview.overviewRaw[index]!,
      overview.overviewHighPassed[index]!,
    ),
    retainedRmsFraction: highPassedRms / rawRms,
    namedInfraSlowTruth: overview.hasNamedInfraSlowTruth,
    generatedInMs: performance.now() - started,
  });
}

const absent = (key: Parameters<typeof record>[0]): boolean => record(key).value.kind === 'absent';
console.log(JSON.stringify({
  phase: 'ISF-6',
  generatorVersion: GENERATOR_VERSION,
  exportSchemaVersion: scalarValue('export_schema_version'),
  continuousComposeCalls: records.length,
  records,
  releaseLayers: {
    corticalVoltageAvailable: !absent('isf_cortical_rms_wake'),
    excitabilityDepthAvailable: !absent('isf_pac_depth_wake'),
    electrodeDriftAvailable: !absent('electrode_dc_drift_rms'),
    referenceDriftAvailable: !absent('reference_dc_drift_rms'),
  },
  validationRecordS: scalarValue('isf_probe_record_length'),
}, null, 2));
