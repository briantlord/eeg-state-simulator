#!/usr/bin/env node
/**
 * Headless epoch-directory exporter — the boundary the harness measures (DECISIONS D7).
 *
 *   node --experimental-strip-types bin/eegsim-export.mts \
 *        --seed 20260728 --state n3 --epochs 10 --out prep/out/run_n3
 *
 * Signal model: aperiodic-with-knee background plus the state's oscillations, projected to
 * channels through data/projection_10_20.json, plus independent sensor noise. See
 * src/core/generators/compose.ts.
 *
 *   TODO(WP-E): graphoelements — spindles, K-complexes, slow oscillations with AP travel.
 *   TODO(WP-F): respiration, the tilt filter, and chi(t) modulation.
 *   TODO(WP-J): blink, EMG and line-noise artifacts.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedState, STATE_IDS, isStateId } from '../src/core/types/state.ts';
import type { StateId } from '../src/core/types/state.ts';
import { makeEventList } from '../src/core/types/event.ts';
import {
  writeEpoch,
  writeManifest,
  writeEventList,
  defaultManifestFields,
  epochSamples,
  type EpochSidecar,
  type InjectedTruth,
} from '../src/io/epoch_dir.ts';
import { scalarValue, electrodeSet, STATES } from '../src/core/registry.ts';
import { composeState } from '../src/core/generators/compose.ts';
import { CHANNELS, weightsFor } from '../src/core/generators/projection.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MONTAGE = CHANNELS;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}


function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const seed = Number(args['seed'] ?? scalarValue('snr_calibration_seed'));
  const stateArg = args['state'] ?? 'n3';
  if (!isStateId(stateArg)) {
    console.error(`unknown state '${stateArg}'; expected one of ${STATE_IDS.join(', ')}`);
    process.exit(2);
  }
  const nEpochs = Number(args['epochs'] ?? 1);
  // `resolve`, not `join`: an absolute --out must be honoured, and join() would concatenate
  // it onto ROOT and produce a nonsense path.
  const outDir = resolve(ROOT, args['out'] ?? `prep/out/run_${stateArg}_${seed}`);

  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    console.error(`--seed must be an integer, got ${args['seed']}`);
    process.exit(2);
  }

  const fs = scalarValue('fs');
  const epochDur = scalarValue('epoch_display');
  const nSamp = epochSamples();
  const state = new FixedState(stateArg);

  const registryDigest = createHash('sha256')
    .update(readFileSync(join(ROOT, 'gen', 'registry.json')))
    .digest('hex')
    .slice(0, 16);

  writeManifest(outDir, {
    ...defaultManifestFields(),
    seed,
    fs,
    channels: MONTAGE,
    referenceChannels: electrodeSet('reference_channels'),
    nEpochs,
    epochDuration: epochDur,
    registryDigest,
    stateSourceKind: state.kind,
  });

  // ONE CONTINUOUS RUN, sliced into epochs — not one independent realisation per epoch.
  //
  // Per-epoch streams gave the record `prep/epochio.concatenated()` stitches for G4 a hard
  // discontinuity every 30 s, depositing a comb at k/epoch_display = k x 0.03333 Hz. `g4_f1`
  // = 0.10 Hz is harmonic k = 3 EXACTLY while `g4_f2` = 0.25 Hz is k = 7.5 and lands on
  // nothing — so a pure export artefact put energy at f1 and not at f2, which is precisely
  // the pattern G4 declares a pass, on the gate the Build Plan calls the most important thing
  // in Tier 0.
  const totalSamples = nSamp * nEpochs;
  const composed = composeState(seed, stateArg, totalSamples, fs);

  const truth: InjectedTruth = {
    chi: composed.truth.chi,
    knee: composed.truth.knee,
    snrDb: 0,
    chiModDepth: 0,
    chiModPhi0: 0,
    respFreq: 0,
    independentChiModFreq: null,
    projectionWeights: Object.fromEntries(
      ['background', ...composed.truth.oscillations.map((o) => o.generator)].map((g) => [
        g,
        [...weightsFor(g as Parameters<typeof weightsFor>[0])],
      ]),
    ),
    respMechanisms: { movementArtifact: false, rmbo: false, chiModulation: false },
  };

  for (let e = 0; e < nEpochs; e++) {
    const signal = composed.channels.map((full) => full.subarray(e * nSamp, (e + 1) * nSamp));

    const sidecar: EpochSidecar = {
      schemaVersion: defaultManifestFields().schemaVersion,
      epochIndex: e,
      tStart: e * epochDur,
      duration: epochDur,
      fs,
      channels: MONTAGE,
      state: state.at(e * epochDur),
      truth,
      events: composed.events.filter(
        (ev) => ev.onset < (e + 1) * epochDur && ev.onset + ev.duration > e * epochDur,
      ),
      shape: [MONTAGE.length, nSamp],
      dtype: 'float64',
      byteOrder: 'little',
      units: 'uV',
    };
    writeEpoch(outDir, { signal, sidecar });
  }

  writeEventList(outDir, makeEventList(composed.events));

  console.log(
    `wrote ${nEpochs} epoch(s) to ${outDir}\n` +
      `  state=${stateArg} seed=${seed} fs=${fs} channels=${MONTAGE.length} ` +
      `samples/epoch=${nSamp}\n` +
      `  registry=${registryDigest} states-known=${STATES.length}\n` +
      `  chi=${composed.truth.chi} knee=${composed.truth.knee.toFixed(3)} ` +
      `(${Math.pow(composed.truth.knee, 1 / composed.truth.chi).toFixed(1)} Hz)\n` +
      `  sources: background@${composed.truth.backgroundRmsUv}uV` +
      composed.truth.oscillations
        .map((o) => ` + ${o.generator}@${o.rmsUv}uV(${o.band[0]}-${o.band[1]}Hz)`)
        .join('') +
      ` + sensor@${composed.truth.sensorNoiseRmsUv}uV`,
  );
}

main();
