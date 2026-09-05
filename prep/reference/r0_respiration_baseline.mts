/**
 * R0 — characterize the shipped respiration, respiratory EEG coupling, and RSA.
 *
 * This probe is intentionally outside the shipped generator. It may measure and report, but it
 * must not supply a parameter or change a generated sample. Each EEG mechanism is measured in a
 * paired arm with the same seed and unrelated substreams.
 *
 * Reproduce:
 *   node --experimental-strip-types --no-warnings prep/reference/r0_respiration_baseline.mts
 *
 * Optional:
 *   --duration 600 --seeds 3 --output prep/out/r0_respiration_baseline.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { composeState } from '../../src/core/generators/compose.ts';
import {
  scalarValue,
  uncertainty,
  GENERATOR_VERSION,
} from '../../src/core/registry.ts';
import type { StateId } from '../../src/core/types/state.ts';
import type { GeneratedEvent } from '../../src/core/types/event.ts';
import { weightsFor } from '../../src/core/generators/projection.ts';
import { respiratoryArtifact, synthesizeRespiration } from '../../src/core/generators/respiration.ts';
import { synthesizeEcg } from '../../src/core/generators/cardiac.ts';
import { applyReference, referencedGain } from '../../src/analysis/referencing.ts';
import {
  bandAmplitudeCoupling,
  chiOverTime,
  modulationDepth,
  respiratoryCoupling,
} from '../../src/analysis/coupling.ts';
import { welch } from '../../src/analysis/psd.ts';
import { SignalStream } from '../../src/ui/stream.ts';

const STATES: readonly StateId[] = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem'];
const FS = scalarValue('fs');

interface Summary {
  mean: number;
  sd: number;
  cv: number;
}

interface CircularSummary {
  n: number;
  angleDeg: number;
  resultant: number;
}

interface BaselineRow {
  state: StateId;
  seed: number;
  durationS: number;
  respiration: {
    breaths: number;
    ratePerMin: number;
    ibi: Summary;
    ibiLag1: number;
    ibiDfaShort: number;
    ibiDfaLong: number;
    depth: Summary;
    depthLag1: number;
    inhaleFraction: Summary;
    infraToCarrierPower: number;
  };
  cardiac: {
    beats: number;
    meanHrBpm: number;
    rr: Summary;
    rsaAmplitudeMs: number;
    rsaMaxPhaseDeg: number;
    rsaExplainedFraction: number;
  };
  eegCoupling: {
    movementFzUv: number;
    movementExpectedFzUv: number;
    movementUnexpectedGain: number;
    lowBandDepthOff: number;
    lowBandDepthOn: number;
    lowBandDepthEffect: number;
    chiDepthRequested: number;
    chiDepthOff: number;
    chiDepthOn: number;
    chiDepthEffect: number;
  };
  events: Record<'slow_oscillation' | 'spindle_fast' | 'spindle_slow', CircularSummary>;
  liveJoin: {
    phaseErrorRad: number;
    beltJump: number;
    ecgJumpUv: number;
    rrJoinErrorMs: number;
  };
}

function cliValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function finiteNumber(name: string, fallback: string): number {
  const value = Number(cliValue(name, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function summarize(values: readonly number[]): Summary {
  const x = values.filter(Number.isFinite);
  if (x.length === 0) return { mean: Number.NaN, sd: Number.NaN, cv: Number.NaN };
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const variance = x.length > 1
    ? x.reduce((a, b) => a + (b - mean) ** 2, 0) / (x.length - 1)
    : 0;
  const sd = Math.sqrt(variance);
  return { mean, sd, cv: mean !== 0 ? sd / Math.abs(mean) : Number.NaN };
}

function lag1(values: readonly number[]): number {
  if (values.length < 3) return Number.NaN;
  const a = values.slice(0, -1);
  const b = values.slice(1);
  const ma = summarize(a).mean;
  const mb = summarize(b).mean;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    xy += da * db;
    xx += da * da;
    yy += db * db;
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : Number.NaN;
}

/** First-order DFA slope over integer box sizes in [minScale, maxScale]. */
function dfa(values: readonly number[], minScale: number, maxScale: number): number {
  if (values.length < minScale * 4) return Number.NaN;
  const mean = summarize(values).mean;
  const profile = new Float64Array(values.length);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]! - mean;
    profile[i] = acc;
  }

  const scales: number[] = [];
  const points: { x: number; y: number }[] = [];
  const cap = Math.min(maxScale, Math.floor(values.length / 4));
  for (let k = 0; k < 12; k++) {
    const raw = Math.round(minScale * Math.pow(cap / minScale, k / 11));
    if (raw >= minScale && raw <= cap && !scales.includes(raw)) scales.push(raw);
  }
  for (const scale of scales) {
    const boxes = Math.floor(profile.length / scale);
    if (boxes < 4) continue;
    let residual = 0;
    let count = 0;
    for (let box = 0; box < boxes; box++) {
      const off = box * scale;
      let sy = 0;
      let sxy = 0;
      let sx = 0;
      let sxx = 0;
      for (let i = 0; i < scale; i++) {
        const y = profile[off + i]!;
        sx += i;
        sy += y;
        sxx += i * i;
        sxy += i * y;
      }
      const denom = scale * sxx - sx * sx;
      const slope = denom !== 0 ? (scale * sxy - sx * sy) / denom : 0;
      const intercept = (sy - slope * sx) / scale;
      for (let i = 0; i < scale; i++) {
        const e = profile[off + i]! - (intercept + slope * i);
        residual += e * e;
        count++;
      }
    }
    if (residual > 0 && count > 0) {
      points.push({ x: Math.log(scale), y: Math.log(Math.sqrt(residual / count)) });
    }
  }
  if (points.length < 2) return Number.NaN;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const n = points.length;
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

function breathFeatures(belt: Float64Array, phase: Float64Array): {
  starts: number[];
  ibi: number[];
  depths: number[];
  inhaleFractions: number[];
} {
  const starts = [0];
  for (let i = 1; i < phase.length; i++) {
    if (phase[i]! < phase[i - 1]!) starts.push(i);
  }
  const ibi: number[] = [];
  const depths: number[] = [];
  const inhaleFractions: number[] = [];
  for (let b = 0; b + 1 < starts.length; b++) {
    const lo = starts[b]!;
    const hi = starts[b + 1]!;
    ibi.push((hi - lo) / FS);
    let min = Infinity;
    let max = -Infinity;
    for (let i = lo; i < hi; i++) {
      min = Math.min(min, belt[i]!);
      max = Math.max(max, belt[i]!);
    }
    depths.push((max - min) / 2);
    const threshold = max - 0.01 * Math.max(max - min, Number.EPSILON);
    let peakStart = lo;
    while (peakStart < hi && belt[peakStart]! < threshold) peakStart++;
    inhaleFractions.push((peakStart - lo) / (hi - lo));
  }
  return { starts, ibi, depths, inhaleFractions };
}

function integrate(power: Float64Array, freqs: Float64Array, lo: number, hi: number): number {
  let sum = 0;
  for (let i = 1; i < freqs.length; i++) {
    if (freqs[i]! < lo || freqs[i]! > hi) continue;
    const df = freqs[i]! - freqs[i - 1]!;
    sum += power[i]! * df;
  }
  return sum;
}

function beltPowerRatio(belt: Float64Array, carrierHz: number): number {
  const decimation = Math.round(FS / 4);
  const n = Math.floor(belt.length / decimation);
  const down = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < decimation; i++) sum += belt[k * decimation + i]!;
    down[k] = sum / decimation;
  }
  const nperseg = Math.min(1024, 2 ** Math.floor(Math.log2(down.length)));
  const psd = welch(down, 4, nperseg, nperseg / 2);
  const infra = integrate(psd.power, psd.freqs, 0.005, 0.1);
  const carrier = integrate(
    psd.power,
    psd.freqs,
    Math.max(0.1, carrierHz - 0.03),
    carrierHz + 0.03,
  );
  return carrier > 0 ? infra / carrier : Number.NaN;
}

function circular(phases: readonly number[]): CircularSummary {
  if (phases.length === 0) return { n: 0, angleDeg: Number.NaN, resultant: Number.NaN };
  const c = phases.reduce((s, p) => s + Math.cos(p), 0) / phases.length;
  const q = phases.reduce((s, p) => s + Math.sin(p), 0) / phases.length;
  return {
    n: phases.length,
    angleDeg: (Math.atan2(q, c) * 180) / Math.PI,
    resultant: Math.hypot(c, q),
  };
}

function eventPhases(
  events: readonly GeneratedEvent[],
  phase: Float64Array,
): BaselineRow['events'] {
  const one = (type: GeneratedEvent['type']): CircularSummary => circular(
    events
      .filter((e) => e.type === type)
      .map((e) => phase[Math.min(phase.length - 1, Math.max(0, Math.round(e.onset * FS)))]!),
  );
  return {
    slow_oscillation: one('slow_oscillation'),
    spindle_fast: one('spindle_fast'),
    spindle_slow: one('spindle_slow'),
  };
}

/** Least-squares fit y = intercept + betaCos*cos(phi) + betaSin*sin(phi). */
function harmonicFit(values: readonly number[], phases: readonly number[]): {
  amplitude: number;
  maxPhase: number;
  explainedFraction: number;
} {
  const n = Math.min(values.length, phases.length);
  if (n < 4) return { amplitude: Number.NaN, maxPhase: Number.NaN, explainedFraction: Number.NaN };
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [1, Math.cos(phases[i]!), Math.sin(phases[i]!)];
    for (let j = 0; j < 3; j++) {
      b[j] = b[j]! + row[j]! * values[i]!;
      for (let k = 0; k < 3; k++) a[j]![k] = a[j]![k]! + row[j]! * row[k]!;
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const d = a[col]![col]!;
    if (Math.abs(d) < Number.EPSILON) {
      return { amplitude: Number.NaN, maxPhase: Number.NaN, explainedFraction: Number.NaN };
    }
    for (let k = col; k < 3; k++) a[col]![k] = a[col]![k]! / d;
    b[col] = b[col]! / d;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      for (let k = col; k < 3; k++) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  const mean = summarize(values.slice(0, n)).mean;
  let ssTotal = 0;
  let ssResidual = 0;
  for (let i = 0; i < n; i++) {
    const pred = b[0]! + b[1]! * Math.cos(phases[i]!) + b[2]! * Math.sin(phases[i]!);
    ssTotal += (values[i]! - mean) ** 2;
    ssResidual += (values[i]! - pred) ** 2;
  }
  return {
    amplitude: Math.hypot(b[1]!, b[2]!),
    maxPhase: Math.atan2(b[2]!, b[1]!),
    explainedFraction: ssTotal > 0 ? 1 - ssResidual / ssTotal : Number.NaN,
  };
}

function cardiacFeatures(rPeaks: readonly number[], phase: Float64Array): BaselineRow['cardiac'] {
  const rr: number[] = [];
  const rrPhase: number[] = [];
  for (let i = 0; i + 1 < rPeaks.length; i++) {
    rr.push(rPeaks[i + 1]! - rPeaks[i]!);
    const sample = Math.min(phase.length - 1, Math.max(0, Math.round(rPeaks[i]! * FS)));
    rrPhase.push(phase[sample]!);
  }
  const fit = harmonicFit(rr, rrPhase);
  const rrStats = summarize(rr);
  return {
    beats: rPeaks.length,
    meanHrBpm: rrStats.mean > 0 ? 60 / rrStats.mean : Number.NaN,
    rr: rrStats,
    rsaAmplitudeMs: fit.amplitude * 1000,
    rsaMaxPhaseDeg: (fit.maxPhase * 180) / Math.PI,
    rsaExplainedFraction: fit.explainedFraction,
  };
}

function channel(
  result: ReturnType<typeof composeState>,
  label: string,
): Float64Array {
  const referenced = applyReference(result.channels, 'linked-mastoid');
  const i = referenced.labels.indexOf(label);
  if (i < 0) throw new Error(`missing referenced channel ${label}`);
  return referenced.channels[i]!;
}

function quadratureEffect(on: number, off: number): number {
  return Math.sqrt(Math.max(0, on * on - off * off));
}

function liveJoin(state: StateId, seed: number): BaselineRow['liveJoin'] {
  const segmentS = scalarValue('display_buffer_s');
  const n = Math.round(segmentS * FS);
  const options = {
    movementArtifact: true,
    amplitudeModulation: true,
    chiModulation: true,
  } as const;
  const stream = new SignalStream({ seed, state, ...options });
  // Cross the same prefetch and roll paths the browser uses, rather than reconstructing what the
  // stream used to do from two independent composeState calls.
  stream.advance(segmentS * 0.8);
  stream.advance(segmentS * 0.2 + 1 / FS);
  const previous = stream.previous;
  if (previous === null) throw new Error('liveJoin: stream did not roll');
  const prevPhase = previous.respirationPhase;
  const nextPhase = stream.respirationPhase;
  const last = prevPhase.length - 1;
  const wholeRespiration = synthesizeRespiration(seed, n * 2, state, FS);
  const wholeCardiac = synthesizeEcg(seed, state, wholeRespiration, FS);
  const expected = wholeRespiration.phase[n]!;
  const error = Math.abs(Math.atan2(
    Math.sin(nextPhase[0]! - expected),
    Math.cos(nextPhase[0]! - expected),
  ));
  const acrossJoinRr = previous.rPeaks.length > 0 && stream.rPeaks.length > 0
    ? segmentS - previous.rPeaks[previous.rPeaks.length - 1]! + stream.rPeaks[0]!
    : Number.NaN;
  const wholeBefore = wholeCardiac.rPeaks.filter((peak) => peak < segmentS).at(-1);
  const wholeAfter = wholeCardiac.rPeaks.find((peak) => peak >= segmentS);
  const expectedAcrossJoinRr = wholeBefore !== undefined && wholeAfter !== undefined
    ? wholeAfter - wholeBefore
    : Number.NaN;
  return {
    phaseErrorRad: error,
    beltJump: Math.abs(stream.respirationBelt[0]! - wholeRespiration.belt[n]!),
    ecgJumpUv: Math.abs(stream.ecg[0]! - wholeCardiac.ecg[n]!),
    rrJoinErrorMs: Math.abs(acrossJoinRr - expectedAcrossJoinRr) * 1000,
  };
}

function characterize(state: StateId, seed: number, durationS: number): BaselineRow {
  const n = Math.round(durationS * FS);
  const off = composeState(seed, state, n, FS, {
    movementArtifact: false,
    amplitudeModulation: false,
    chiModulation: false,
  });
  const breaths = breathFeatures(off.respirationBelt, off.respirationPhase);
  const ibi = summarize(breaths.ibi);

  const movement = composeState(seed, state, n, FS, {
    movementArtifact: true,
    amplitudeModulation: false,
    chiModulation: false,
  });
  const amplitude = composeState(seed, state, n, FS, {
    movementArtifact: false,
    amplitudeModulation: true,
    chiModulation: false,
  });
  const chi = composeState(seed, state, n, FS, {
    movementArtifact: false,
    amplitudeModulation: false,
    chiModulation: true,
  });

  const offFz = channel(off, 'Fz');
  const movementFz = channel(movement, 'Fz');
  const movementDelta = new Float64Array(n);
  for (let i = 0; i < n; i++) movementDelta[i] = movementFz[i]! - offFz[i]!;
  const expectedMovement = respiratoryCoupling(
    respiratoryArtifact(
      off.respirationBelt,
      (uncertainty('resp_artifact_amp').lo + uncertainty('resp_artifact_amp').hi) / 2,
    ),
    off.respirationPhase,
  ) * Math.abs(referencedGain(weightsFor('resp_artifact'), 'linked-mastoid', 'Fz'));
  const observedMovement = respiratoryCoupling(movementDelta, movement.respirationPhase);

  const ampOff = bandAmplitudeCoupling(offFz, off.respirationPhase, 0.5, 4, FS);
  const ampOn = bandAmplitudeCoupling(
    channel(amplitude, 'Fz'),
    amplitude.respirationPhase,
    0.5,
    4,
    FS,
  );

  const offChi = chiOverTime(channel(off, 'Pz'), FS);
  const onChi = chiOverTime(channel(chi, 'Pz'), FS);
  const fResp = off.truth.respFreqHz;
  const chiOffDepth = modulationDepth(offChi.chi, offChi.fsEst, fResp);
  const chiOnDepth = modulationDepth(onChi.chi, onChi.fsEst, fResp);

  return {
    state,
    seed,
    durationS,
    respiration: {
      breaths: breaths.ibi.length,
      ratePerMin: ibi.mean > 0 ? 60 / ibi.mean : Number.NaN,
      ibi,
      ibiLag1: lag1(breaths.ibi),
      ibiDfaShort: dfa(breaths.ibi, 4, 12),
      ibiDfaLong: dfa(breaths.ibi, 12, 50),
      depth: summarize(breaths.depths),
      depthLag1: lag1(breaths.depths),
      inhaleFraction: summarize(breaths.inhaleFractions),
      infraToCarrierPower: beltPowerRatio(off.respirationBelt, fResp),
    },
    cardiac: cardiacFeatures(off.rPeaks, off.respirationPhase),
    eegCoupling: {
      movementFzUv: observedMovement,
      movementExpectedFzUv: expectedMovement,
      movementUnexpectedGain: expectedMovement > 0 ? observedMovement / expectedMovement : Number.NaN,
      lowBandDepthOff: ampOff,
      lowBandDepthOn: ampOn,
      lowBandDepthEffect: quadratureEffect(ampOn, ampOff),
      chiDepthRequested: chi.truth.chiModDepth,
      chiDepthOff: chiOffDepth,
      chiDepthOn: chiOnDepth,
      chiDepthEffect: quadratureEffect(chiOnDepth, chiOffDepth),
    },
    events: eventPhases(off.events, off.respirationPhase),
    liveJoin: liveJoin(state, seed),
  };
}

function median(values: readonly number[]): number {
  const x = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (x.length === 0) return Number.NaN;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m]! : (x[m - 1]! + x[m]!) / 2;
}

function printSummary(rows: readonly BaselineRow[]): void {
  console.log('\nR0 shipped respiration baseline — median across seeds');
  console.log(`generator ${GENERATOR_VERSION}, ${rows[0]?.durationS ?? 0} s per state/seed, linked mastoid`);
  console.log('');
  console.log(
    'state      rate   IBIcv  IBIr1 DFA-long depthCV infra/car  RSAms RSA-R2 moveFz move/x ampEff chiEff joinPhi RRjoin',
  );
  for (const state of STATES) {
    const r = rows.filter((x) => x.state === state);
    const m = (read: (row: BaselineRow) => number): string => median(r.map(read)).toFixed(3);
    console.log(
      `${state.padEnd(9)} ${m((x) => x.respiration.ratePerMin).padStart(6)}` +
      ` ${m((x) => x.respiration.ibi.cv).padStart(7)}` +
      ` ${m((x) => x.respiration.ibiLag1).padStart(6)}` +
      ` ${m((x) => x.respiration.ibiDfaLong).padStart(8)}` +
      ` ${m((x) => x.respiration.depth.cv).padStart(7)}` +
      ` ${median(r.map((x) => x.respiration.infraToCarrierPower)).toExponential(1).padStart(9)}` +
      ` ${m((x) => x.cardiac.rsaAmplitudeMs).padStart(6)}` +
      ` ${m((x) => x.cardiac.rsaExplainedFraction).padStart(6)}` +
      ` ${m((x) => x.eegCoupling.movementFzUv).padStart(7)}` +
      ` ${m((x) => x.eegCoupling.movementUnexpectedGain).padStart(6)}` +
      ` ${m((x) => x.eegCoupling.lowBandDepthEffect).padStart(7)}` +
      ` ${m((x) => x.eegCoupling.chiDepthEffect).padStart(6)}` +
      ` ${m((x) => x.liveJoin.phaseErrorRad).padStart(7)}` +
      ` ${m((x) => x.liveJoin.rrJoinErrorMs).padStart(6)}`,
    );
  }
  console.log('\nEvent phase relative to inhalation onset: pooled angle degrees / resultant length');
  for (const state of STATES) {
    const r = rows.filter((x) => x.state === state);
    const event = (type: keyof BaselineRow['events']): string => {
      let re = 0;
      let im = 0;
      let n = 0;
      for (const row of r) {
        const cell = row.events[type];
        const angle = (cell.angleDeg * Math.PI) / 180;
        re += cell.n * cell.resultant * Math.cos(angle);
        im += cell.n * cell.resultant * Math.sin(angle);
        n += cell.n;
      }
      const angle = (Math.atan2(im, re) * 180) / Math.PI;
      const resultant = n > 0 ? Math.hypot(re, im) / n : Number.NaN;
      return n > 0 ? `${angle.toFixed(1)}deg/${resultant.toFixed(3)} (n=${n})` : '—';
    };
    console.log(
      `${state.padEnd(9)} SO ${event('slow_oscillation').padEnd(24)}` +
      ` fast ${event('spindle_fast').padEnd(24)} slow ${event('spindle_slow')}`,
    );
  }
}

function main(): void {
  const durationS = finiteNumber('--duration', '600');
  const nSeeds = Math.round(finiteNumber('--seeds', '3'));
  const seedBase = Math.round(finiteNumber('--seed-base', '86000'));
  const output = resolve(cliValue('--output', 'prep/out/r0_respiration_baseline.json'));
  const rows: BaselineRow[] = [];

  for (const state of STATES) {
    for (let i = 0; i < nSeeds; i++) {
      const seed = seedBase + i * 313;
      process.stdout.write(`characterizing ${state}, seed ${seed}... `);
      const started = performance.now();
      rows.push(characterize(state, seed, durationS));
      console.log(`${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
  }

  const result = {
    probe: 'R0 respiration baseline',
    generatedAt: new Date().toISOString(),
    generatorVersion: GENERATOR_VERSION,
    fs: FS,
    durationS,
    nSeeds,
    seedBase,
    estimators: {
      ibiDfaShort: 'first-order DFA over 4-12 breaths',
      ibiDfaLong: 'first-order DFA over 12-50 breaths',
      infraToCarrierPower: 'Welch belt power 0.005-0.1 Hz / carrier +/-0.03 Hz',
      rsa: 'RR-domain least-squares harmonic regression against analytic respiratory phase',
      movement: 'paired mechanism-on minus mechanism-off Fz, linked mastoid',
      lowBand: '0.5-4 Hz running-RMS phase modulation, linked-mastoid Fz',
      chi: '2-40 Hz sliding log-log slope at linked-mastoid Pz',
      eventPhase: 'analytic respiratory phase sampled at injected event onset',
      join: 'displayed previous/next samples after SignalStream rolls at display_buffer_s',
    },
    rows,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  printSummary(rows);
  console.log(`\nMachine-readable result: ${output}`);
}

main();
