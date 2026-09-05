/**
 * Continuous long-timescale data for the full-band / DC interface (ISF-6).
 *
 * This is deliberately NOT assembled from SignalStream's 90-second display segments. Those
 * segments are crossfaded for a smooth clinical scroll and are explicitly ineligible for
 * scientific analysis across their joins. A long-timescale view has to be one composeState call
 * or its apparent infra-slow structure would partly be a property of the UI buffer.
 *
 * Named cortical ISF is part of the provisional released signal. Recording drift remains a
 * fixture-only, deferred artifact. This view shows the released signal below 1 Hz and makes the
 * effect of a conventional 0.1 Hz high-pass directly visible without splicing presentation
 * buffers together.
 */
import { applyReference, type ReferenceMode } from '../analysis/referencing.ts';
import { applyFilterChain, type FilterSpec } from '../core/filters/hpf.ts';
import { composeState, type ComposeOptions } from '../core/generators/compose.ts';
import { scalarValue } from '../core/registry.ts';
import type { StateId } from '../core/types/state.ts';
import { releasedOptions } from '../core/release.ts';

export interface FullBandOptions {
  readonly seed: number;
  readonly state: StateId;
  readonly durationS: number;
  readonly reference: ReferenceMode;
  /** Released mechanisms shared with the clinical scroll. Fixture-only ISF fields are excluded. */
  readonly compose?: Pick<
    ComposeOptions,
    | 'respirationMode'
    | 'infraSlowCortical'
    | 'infraSlowModulation'
    | 'movementArtifact'
    | 'amplitudeModulation'
    | 'chiModulation'
    | 'eventRespirationCoupling'
    | 'lineNoise'
    | 'lineFreqHz'
    | 'snrDb'
  >;
}

export interface FullBandOverview {
  /** Full-rate, referenced, unfiltered signal used by the spectrum. */
  readonly raw: readonly Float64Array[];
  /** Anti-aliased display signal retaining DC. */
  readonly overviewRaw: readonly Float64Array[];
  /** The same display signal with the fixed comparison high-pass. */
  readonly overviewHighPassed: readonly Float64Array[];
  readonly labels: readonly string[];
  readonly fs: number;
  readonly overviewFs: number;
  readonly durationS: number;
  readonly comparisonSpec: FilterSpec;
  /** True when either named cortical ISF path contributed generator truth. */
  readonly hasNamedInfraSlowTruth: boolean;
}

function decimate(x: Float64Array, stride: number): Float64Array {
  const out = new Float64Array(Math.ceil(x.length / stride));
  for (let i = 0; i < out.length; i++) out[i] = x[i * stride]!;
  return out;
}

export function buildFullBandOverview(options: FullBandOptions): FullBandOverview {
  const fs = scalarValue('fs');
  const overviewFs = scalarValue('isf_overview_rate');
  const stride = fs / overviewFs;
  if (!Number.isInteger(stride)) {
    throw new Error('full-band overview rate must divide the generator sampling rate exactly');
  }
  const nSamples = Math.round(options.durationS * fs);
  const generated = composeState(options.seed, options.state, nSamples, fs, releasedOptions(options.compose));

  // Filter every generated lead before applying the reference, matching the ordinary display
  // pipeline. Both overview arms receive the same anti-alias low-pass; the only contrast is the
  // fixed 0.1 Hz high-pass.
  const order = scalarValue('filter_order');
  const antialiasHz = scalarValue('isf_overview_antialias_hz');
  const comparisonSpec: FilterSpec = {
    highpassHz: scalarValue('isf_comparison_hpf'),
    lowpassHz: null,
    type: 'zeroPhase',
    order,
  };
  const overviewRawSpec: FilterSpec = {
    highpassHz: null,
    lowpassHz: antialiasHz,
    type: 'zeroPhase',
    order,
  };
  const overviewHighPassedSpec: FilterSpec = {
    ...comparisonSpec,
    lowpassHz: antialiasHz,
  };

  const rawReference = applyReference([...generated.channels], options.reference);
  const lowRawReference = applyReference(
    generated.channels.map((channel) => applyFilterChain(channel, overviewRawSpec, fs)),
    options.reference,
  );
  const lowHighPassedReference = applyReference(
    generated.channels.map((channel) => applyFilterChain(channel, overviewHighPassedSpec, fs)),
    options.reference,
  );

  return {
    raw: rawReference.channels,
    overviewRaw: lowRawReference.channels.map((channel) => decimate(channel, stride)),
    overviewHighPassed: lowHighPassedReference.channels.map((channel) => decimate(channel, stride)),
    labels: rawReference.labels,
    fs,
    overviewFs,
    durationS: options.durationS,
    comparisonSpec,
    hasNamedInfraSlowTruth: generated.truth.infraSlow !== undefined,
  };
}
