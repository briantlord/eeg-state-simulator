/**
 * Optional recording-system drift for ISF-5.
 *
 * This is an OBSERVATION-LAYER artifact, not a cortical source. Independent electrode terms are
 * added directly to every generated lead. A separate shared mastoid term is added only to A1/A2,
 * so linked/contralateral referencing can inject that reference-electrode drift into scalp
 * derivations while average reference is unaffected. Nothing here calls `projectInto` or reads a
 * lead-field weight.
 *
 * The temporal engine is reused only as a broad, causal stochastic fixture. Amplitudes and its
 * still-unfitted shape must be supplied explicitly; there are no physiological defaults.
 */
import { ALL_CHANNELS, REFERENCE_LABELS } from './projection.ts';
import {
  rms,
  synthesizeInfraSlow,
  type InfraSlowTemporalConfig,
} from './infraslow.ts';
import { scalarValue } from '../registry.ts';

export interface RecordingDriftFixtureOptions extends InfraSlowTemporalConfig {
  readonly perChannelRmsUv: number;
  readonly commonReferenceRmsUv: number;
}

export interface RecordingDriftTruth {
  readonly enabled: true;
  readonly requestedPerChannelRmsUv: number;
  readonly realizedPerChannelRmsUv: readonly number[];
  readonly requestedCommonReferenceRmsUv: number;
  readonly realizedCommonReferenceRmsUv: number;
}

export interface RecordingDriftResult {
  /** Direct electrode-space additions in ALL_CHANNELS order. */
  readonly channels: readonly Float64Array[];
  readonly commonReference: Float64Array;
  readonly truth: RecordingDriftTruth;
}

function nonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`recording drift ${name} must be finite and non-negative`);
  }
}

export function synthesizeRecordingDrift(
  seed: number,
  nSamples: number,
  config: RecordingDriftFixtureOptions,
  fs = scalarValue('fs'),
): RecordingDriftResult {
  nonNegativeFinite('per-channel RMS', config.perChannelRmsUv);
  nonNegativeFinite('common-reference RMS', config.commonReferenceRmsUv);

  const electrodeIds = ALL_CHANNELS.map((label) => `recording-drift/electrode/${label}`);
  const commonId = 'recording-drift/reference/common';
  const drivers = synthesizeInfraSlow(
    seed,
    [...electrodeIds, commonId],
    nSamples,
    {
      exponent: config.exponent,
      poleCount: config.poleCount,
      isf1VarianceFraction: config.isf1VarianceFraction,
    },
    fs,
  );

  const channels = electrodeIds.map((id) =>
    Float64Array.from(drivers[id]!.combined, (value) => value * config.perChannelRmsUv),
  );
  const commonReference = Float64Array.from(
    drivers[commonId]!.combined,
    (value) => value * config.commonReferenceRmsUv,
  );
  for (const label of REFERENCE_LABELS) {
    const channel = channels[ALL_CHANNELS.indexOf(label)]!;
    for (let i = 0; i < nSamples; i++) channel[i] = channel[i]! + commonReference[i]!;
  }

  return {
    channels,
    commonReference,
    truth: {
      enabled: true,
      requestedPerChannelRmsUv: config.perChannelRmsUv,
      // The per-channel truth excludes the separately reported common mastoid term.
      realizedPerChannelRmsUv: electrodeIds.map((id) =>
        rms(drivers[id]!.combined) * config.perChannelRmsUv,
      ),
      requestedCommonReferenceRmsUv: config.commonReferenceRmsUv,
      realizedCommonReferenceRmsUv: rms(commonReference),
    },
  };
}
