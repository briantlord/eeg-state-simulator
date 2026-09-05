/** Direct R2 characterization before ECG morphology or EEG analysis can obscure timing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  createCardiacState,
  synthesizeEcg,
  synthesizeEcgChunk,
} from '../../src/core/generators/cardiac.ts';
import {
  createRespiratoryState,
  synthesizeRespiration,
  synthesizeRespirationChunk,
} from '../../src/core/generators/respiration.ts';
import { GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';
import type { StateId } from '../../src/core/types/state.ts';

const FS = scalarValue('fs');
const STATES: readonly StateId[] = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem'];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function sd(values: readonly number[]): number {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function rmssd(values: readonly number[]): number {
  return Math.sqrt(mean(values.slice(1).map((value, i) => (value - values[i]!) ** 2)));
}

function rsaFit(rr: readonly number[], phases: readonly number[]): { amplitudeS: number; r2: number } {
  const yMean = mean(rr);
  let cc = 0, ss = 0, cs = 0, cy = 0, sy = 0;
  for (let i = 0; i < rr.length; i++) {
    const c = Math.cos(phases[i]!);
    const s = Math.sin(phases[i]!);
    const y = rr[i]! - yMean;
    cc += c * c;
    ss += s * s;
    cs += c * s;
    cy += c * y;
    sy += s * y;
  }
  const determinant = cc * ss - cs * cs;
  const betaC = (cy * ss - sy * cs) / determinant;
  const betaS = (sy * cc - cy * cs) / determinant;
  let residual = 0, total = 0;
  for (let i = 0; i < rr.length; i++) {
    const centered = rr[i]! - yMean;
    const predicted = betaC * Math.cos(phases[i]!) + betaS * Math.sin(phases[i]!);
    residual += (centered - predicted) ** 2;
    total += centered * centered;
  }
  return { amplitudeS: Math.hypot(betaC, betaS), r2: 1 - residual / total };
}

function characterize(state: StateId, seed: number, durationS: number) {
  const n = Math.round(durationS * FS);
  const respiration = synthesizeRespiration(seed, n, state, FS);
  const cardiac = synthesizeEcg(seed, state, respiration, FS);
  const rr = cardiac.rPeaks.slice(1).map((peak, i) => peak - cardiac.rPeaks[i]!);
  const phases = cardiac.rPeaks.slice(0, -1).map((peak) =>
    respiration.phase[Math.min(n - 1, Math.max(0, Math.round(peak * FS)))]!,
  );
  const rsa = rsaFit(rr, phases);

  const split = Math.round(n * 0.43);
  const firstResp = synthesizeRespirationChunk(createRespiratoryState(seed, state, FS), split);
  const secondResp = synthesizeRespirationChunk(firstResp.state, n - split);
  const first = synthesizeEcgChunk(createCardiacState(seed, state, FS), firstResp.result);
  const second = synthesizeEcgChunk(first.state, secondResp.result);
  const chunked = new Float64Array(n);
  chunked.set(first.result.ecg);
  chunked.set(second.result.ecg, split);
  let chunkMaxError = 0;
  for (let i = 0; i < n; i++) {
    chunkMaxError = Math.max(chunkMaxError, Math.abs(chunked[i]! - cardiac.ecg[i]!));
  }

  return {
    state,
    seed,
    beats: cardiac.rPeaks.length,
    meanHrBpm: 60 / mean(rr),
    sdnnMs: sd(rr) * 1000,
    rmssdMs: rmssd(rr) * 1000,
    rsaAmplitudeMs: rsa.amplitudeS * 1000,
    rsaR2: rsa.r2,
    requestedRsaAmplitudeMs: cardiac.rsaAmplitudeS * 1000,
    targetSdnnMs: cardiac.targetSdnnS * 1000,
    chunkMaxError,
  };
}

function main(): void {
  const durationS = Number(arg('--duration', '1200'));
  const nSeeds = Number(arg('--seeds', '20'));
  const seedBase = Number(arg('--seed-base', '93000'));
  const output = resolve(arg('--output', 'prep/out/r2_cardiac_controller.json'));
  const rows = STATES.flatMap((state) =>
    Array.from({ length: nSeeds }, (_, i) => characterize(state, seedBase + i * 313, durationS)),
  );
  const summary = Object.fromEntries(STATES.map((state) => {
    const selected = rows.filter((row) => row.state === state);
    const m = (key: keyof typeof selected[number]): number =>
      median(selected.map((row) => row[key] as number));
    return [state, {
      meanHrBpm: mean(selected.map((row) => row.meanHrBpm)),
      sdnnMs: m('sdnnMs'),
      rmssdMs: m('rmssdMs'),
      rsaAmplitudeMs: m('rsaAmplitudeMs'),
      rsaR2: m('rsaR2'),
      requestedRsaAmplitudeMs: m('requestedRsaAmplitudeMs'),
      targetSdnnMs: m('targetSdnnMs'),
      chunkMaxError: Math.max(...selected.map((row) => row.chunkMaxError)),
    }];
  }));
  const report = {
    probe: 'R2 cardiac controller',
    generatedAt: new Date().toISOString(),
    generatorVersion: GENERATOR_VERSION,
    durationS,
    nSeeds,
    summary,
    rows,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

  console.log(`R2 cardiac controller — group mean HR, median dynamics across ${nSeeds} seeds x ${durationS} s`);
  console.log('state        HR   SDNN  target RMSSD RSAfit RSAreq RSA-R2 join');
  for (const state of STATES) {
    const row = summary[state] as Record<string, number>;
    console.log(
      `${state.padEnd(9)} ${row.meanHrBpm!.toFixed(1).padStart(5)}` +
      ` ${row.sdnnMs!.toFixed(1).padStart(6)} ${row.targetSdnnMs!.toFixed(1).padStart(7)}` +
      ` ${row.rmssdMs!.toFixed(1).padStart(5)} ${row.rsaAmplitudeMs!.toFixed(1).padStart(6)}` +
      ` ${row.requestedRsaAmplitudeMs!.toFixed(1).padStart(6)}` +
      ` ${row.rsaR2!.toFixed(3).padStart(6)} ${row.chunkMaxError!.toExponential(1)}`,
    );
  }
  console.log(`Machine-readable result: ${output}`);
}

main();
