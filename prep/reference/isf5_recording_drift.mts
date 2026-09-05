/**
 * ISF-5 recording-drift mechanism probe.
 *
 * Fixture magnitudes are deliberately visible and have no physiological standing. The probe
 * checks causal location, reference behavior, filtering and truth separation; it does not fit an
 * artifact amplitude from the simulator's own output.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/isf5_recording_drift.mts
 */
import { applyReference, effectiveRank, type ReferenceMode } from '../../src/analysis/referencing.ts';
import { applyHighpass } from '../../src/core/filters/hpf.ts';
import { composeState, type RecordingDriftFixtureOptions } from '../../src/core/generators/compose.ts';
import { scalarValue } from '../../src/core/registry.ts';

const fs = scalarValue('fs');
const n = fs * 120;
const seed = 250825;
const temporal = {
  exponent: 1,
  poleCount: 9,
  isf1VarianceFraction: 0.5,
} as const;
const driftFixture: RecordingDriftFixtureOptions = {
  ...temporal,
  perChannelRmsUv: 1,
  commonReferenceRmsUv: 0.7,
};
const common = { suppressGraphoelements: true, eventRespirationCoupling: false } as const;
const off = composeState(seed, 'wake_ec', n, fs, common);
const cortical = composeState(seed, 'wake_ec', n, fs, {
  ...common,
  infraSlowFixture: { ...temporal, additiveRmsUv: { isf_posterior: 1 } },
});
const drift = composeState(seed, 'wake_ec', n, fs, {
  ...common,
  recordingDriftFixture: driftFixture,
});

function difference(a: readonly Float64Array[], b: readonly Float64Array[]): Float64Array[] {
  return a.map((channel, c) =>
    Float64Array.from(channel, (value, i) => value - b[c]![i]!),
  );
}

function rms(x: Float64Array, trim = 0): number {
  let power = 0;
  let count = 0;
  for (let i = trim; i < x.length - trim; i++) {
    power += x[i]! * x[i]!;
    count++;
  }
  return count > 0 ? Math.sqrt(power / count) : Number.NaN;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function referenceSummary(delta: readonly Float64Array[], mode: ReferenceMode) {
  const referenced = applyReference(delta, mode);
  const rmsUv = referenced.channels.map((channel) => rms(channel));
  return {
    medianRmsUv: median(rmsUv),
    minRmsUv: Math.min(...rmsUv),
    maxRmsUv: Math.max(...rmsUv),
    effectiveRank: effectiveRank(referenced.channels),
  };
}

const driftDelta = difference(drift.channels, off.channels);
const corticalDelta = difference(cortical.channels, off.channels);
const linked = applyReference(driftDelta, 'linked-mastoid');
const fz = linked.channels[linked.labels.indexOf('Fz')]!;
const filtered = applyHighpass(fz, 1, 'zeroPhase', fs);
const trim = fs * 5;

const result = {
  probe: 'ISF-5 observation-layer recording drift',
  fixtureOnly: true,
  fixture: driftFixture,
  reference: Object.fromEntries(
    (['as-generated', 'linked-mastoid', 'contralateral', 'average', 'laplacian'] as const)
      .map((mode) => [mode, referenceSummary(driftDelta, mode)]),
  ),
  corticalPosteriorEffectiveRank: referenceSummary(corticalDelta, 'linked-mastoid').effectiveRank,
  linkedMastoidFz: {
    unfilteredRmsUv: rms(fz, trim),
    highpass1HzRmsUv: rms(filtered, trim),
    retainedFraction: rms(filtered, trim) / rms(fz, trim),
  },
  truth: {
    sourceModeCount: drift.truth.infraSlow?.sourceModes.length,
    modulationCount: drift.truth.infraSlow?.modulation.length,
    electrodeDrift: drift.truth.infraSlow?.electrodeDrift,
    neuralGateEligible:
      (drift.truth.infraSlow?.sourceModes.length ?? 0) > 0
      || (drift.truth.infraSlow?.modulation.length ?? 0) > 0,
  },
  defaultOutputChanged: off.truth.infraSlow !== undefined,
};

console.log(JSON.stringify(result, null, 2));
