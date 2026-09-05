/**
 * ISF-7 provisional release calibration.
 *
 * This reproduces the structure of Väyrynen et al.'s estimator on the complete generated scalp
 * signal: ISF1 phase; fast-band Hilbert envelope; ISF1 phase of that envelope; then 1:1 PLV.
 * The paper used long FIR filters and 3 Hz resampling. We use the project's zero-phase
 * Butterworth implementation and approximately 3 Hz sampling, so the literature values remain
 * comparators rather than interchangeable thresholds. Circular shifts provide the channel-wise
 * null without regenerating either signal.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyReference } from '../../src/analysis/referencing.ts';
import { bandpassSections, filtfilt } from '../../src/core/dsp/biquad.ts';
import { analyticSignal } from '../../src/core/dsp/fft.ts';
import { composeState } from '../../src/core/generators/compose.ts';
import { bandEdges, GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';
import type { StateId } from '../../src/core/types/state.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fs = scalarValue('fs');
const depthOverride = process.argv[2] === undefined ? undefined : Number(process.argv[2]);
const durationS = process.argv[3] === undefined
  ? scalarValue('isf_probe_record_length')
  : Number(process.argv[3]);
const n = Math.round(durationS * fs);
const trim = Math.round(125 * fs); // @lit-ok one ISF1 lower-edge period at 0.008 Hz
const order = scalarValue('filter_order');
const isf1 = bandEdges('isf1_band');
const isf = bandEdges('isf_band');
const targets = {
  wake_ec: { band: bandEdges('alpha_band'), plv: scalarValue('isf_pac_plv_wake_reference') },
  n2: { band: bandEdges('theta_band'), plv: scalarValue('isf_pac_plv_nrem_reference') },
} as const;

function nextPow2(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function analyticPhaseAndEnvelope(x: Float64Array): {
  phase: Float64Array;
  envelope: Float64Array;
} {
  const padded = new Float64Array(nextPow2(x.length));
  padded.set(x);
  const analytic = analyticSignal(padded);
  const phase = new Float64Array(x.length);
  const envelope = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    phase[i] = Math.atan2(analytic.im[i]!, analytic.re[i]!);
    envelope[i] = Math.hypot(analytic.re[i]!, analytic.im[i]!);
  }
  return { phase, envelope };
}

function filtered(x: Float64Array, lo: number, hi: number): Float64Array {
  const result = Float64Array.from(x);
  filtfilt(result, bandpassSections(lo, hi, fs, order));
  return result;
}

function downsamplePhase(phase: Float64Array): Float64Array {
  const step = fs / 3; // @lit-ok paper estimator resampling rate, Hz
  const count = Math.floor((phase.length - 2 * trim) / step);
  return Float64Array.from({ length: count }, (_, index) =>
    phase[Math.round(trim + index * step)]!,
  );
}

function plv(a: Float64Array, b: Float64Array, shift = 0): number {
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[(i + shift) % b.length]!;
    x += Math.cos(d);
    y += Math.sin(d);
  }
  return Math.hypot(x, y) / a.length;
}

function channelReadout(signal: Float64Array, band: { lo: number; hi: number }) {
  const slowPhase = downsamplePhase(
    analyticPhaseAndEnvelope(filtered(signal, isf1.lo, isf1.hi)).phase,
  );
  const fastEnvelope = analyticPhaseAndEnvelope(filtered(signal, band.lo, band.hi)).envelope;
  const envelopePhase = downsamplePhase(
    analyticPhaseAndEnvelope(filtered(fastEnvelope, isf1.lo, isf1.hi)).phase,
  );
  const observed = plv(slowPhase, envelopePhase);
  let atLeastObserved = 0;
  const surrogates = 100; // @lit-ok matches Väyrynen et al.'s shifted-surrogate count
  for (let s = 0; s < surrogates; s++) {
    const shift = Math.max(1, Math.floor(((s + 1) * slowPhase.length) / (surrogates + 1)));
    if (plv(slowPhase, envelopePhase, shift) >= observed) atLeastObserved++;
  }
  return { plv: observed, p: (atLeastObserved + 1) / (surrogates + 1) };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trimmedRms(values: Float64Array): number {
  let power = 0;
  for (let i = trim; i < values.length - trim; i++) power += values[i]! * values[i]!;
  return Math.sqrt(power / (values.length - 2 * trim));
}

const records = [];
for (const [state, target] of Object.entries(targets) as [StateId, (typeof targets)[keyof typeof targets]][]) {
  const generated = composeState(260_825, state, n, fs, {
    suppressGraphoelements: true,
    movementArtifact: false,
    lineNoise: false,
    ...(depthOverride === undefined ? {} : { infraSlowModulationDepth: depthOverride }),
  });
  const referenced = applyReference(generated.channels, 'linked-mastoid');
  const channels = referenced.channels.map((signal) => channelReadout(signal, target.band));
  const isfRmsUv = referenced.channels.map((signal) =>
    trimmedRms(filtered(signal, isf.lo, isf.hi)),
  );
  const frontalLabels = new Set(['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8']);
  const frontalRmsUv = isfRmsUv.filter((_, index) => frontalLabels.has(referenced.labels[index]!));
  records.push({
    state,
    fastBandHz: [target.band.lo, target.band.hi],
    targetPlv: target.plv,
    meanPlv: mean(channels.map((item) => item.plv)),
    medianPlv: median(channels.map((item) => item.plv)),
    significantChannelFraction: channels.filter((item) => item.p < 0.05).length / channels.length,
    medianIsfRmsUv: median(isfRmsUv),
    frontalMedianIsfRmsUv: median(frontalRmsUv),
    channels: Object.fromEntries(referenced.labels.map((label, index) => [label, channels[index]])),
    truth: generated.truth.infraSlow,
  });
}

const result = {
  probe: 'ISF-7 provisional release coupling calibration',
  generatorVersion: GENERATOR_VERSION,
  durationS,
  seed: 260_825,
  depthOverride: depthOverride ?? null,
  estimator: 'zero-phase Butterworth; Hilbert phase; ~3 Hz resampling; 100 circular shifts',
  comparability: 'record-only comparator; paper used long FIR filters and participant-level aggregation',
  records,
};

const out = resolve(root, 'prep', 'out', 'isf7_release_calibration.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.table(records.map(({ state, targetPlv, meanPlv, medianPlv, significantChannelFraction }) => ({
  state, targetPlv, meanPlv, medianPlv, significantChannelFraction,
})));
console.log(`wrote ${out}`);
