#!/usr/bin/env node
/**
 * Headless epoch-directory exporter — the boundary the harness measures (DECISIONS D7).
 *
 *   node --experimental-strip-types bin/eegsim-export.mts \
 *        --seed 20260728 --state n3 --epochs 10 --out prep/out/run_n3
 *
 * FOUNDATION STATUS: the synthesis function is a stub. It draws white noise from the seeded
 * substream so the directory contract, the manifest, the sidecar and G2's determinism check
 * are all exercisable now. WP-D replaces `synthesizeChannel` with aperiodic-with-knee FFT
 * synthesis behind this same signature — a prefix, not a placeholder.
 *
 *   TODO(WP-D): replace synthesizeChannel with the aperiodic + oscillation generators.
 *   TODO(WP-D): replace the flat projection with data/projection_10_20.json.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/core/rng/xoshiro128pp.ts';
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
import { scalarValue, electrodeSet, provisionalValue, STATES } from '../src/core/registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The 19-channel 10-20 montage. TODO(WP-D): move to data/montage_10_20.json.
const MONTAGE = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T3', 'C3', 'Cz', 'C4', 'T4',
  'T5', 'P3', 'Pz', 'P4', 'T6',
  'O1', 'O2',
] as const;

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

/**
 * STUB. White noise at unit variance, scaled to a plausible amplitude.
 * WP-D replaces the body; the signature is the seam.
 */
function synthesizeChannel(rng: Rng, n: number, amplitudeUv: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.normal() * amplitudeUv;
  return out;
}

function chiForState(state: StateId): number {
  const key = `chi_${state}` as Parameters<typeof provisionalValue>[0];
  return provisionalValue(key);
}

function kForState(state: StateId): number {
  const key = `k_${state}` as Parameters<typeof provisionalValue>[0];
  return provisionalValue(key);
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

  const truth: InjectedTruth = {
    chi: chiForState(stateArg),
    knee: kForState(stateArg),
    snrDb: 0,
    chiModDepth: 0,
    chiModPhi0: 0,
    respFreq: 0,
    independentChiModFreq: null,
    // TODO(WP-D): real per-generator weights from data/projection_10_20.json.
    projectionWeights: { stub_white_noise: MONTAGE.map(() => 1) },
    respMechanisms: { movementArtifact: false, rmbo: false, chiModulation: false },
  };

  // ONE CONTINUOUS RUN, sliced into epochs — not one independent realisation per epoch.
  //
  // The earlier `substream(seed, ...${ch}/epoch${e})` gave every epoch its own stream, so the
  // record `prep/epochio.concatenated()` stitches for G4 had a hard discontinuity every 30 s.
  // That deposits a comb at k/epoch_display = k x 0.03333 Hz — and `g4_f1` = 0.10 Hz is
  // harmonic k = 3 EXACTLY, while `g4_f2` = 0.25 Hz is k = 7.5 and lands on nothing. So a pure
  // export artefact put energy at f1 and not at f2: precisely the pattern G4 declares a pass,
  // on the gate the Build Plan calls the most important thing in Tier 0.
  //
  // One substream per (generator, channel) for the whole run; the epoch index only slices it.
  const totalSamples = nSamp * nEpochs;
  const continuous = MONTAGE.map((ch) =>
    synthesizeChannel(Rng.substream(seed, `stub_white_noise/${ch}`), totalSamples, 10),
  );

  for (let e = 0; e < nEpochs; e++) {
    const signal = continuous.map((full) => full.subarray(e * nSamp, (e + 1) * nSamp));

    const sidecar: EpochSidecar = {
      schemaVersion: defaultManifestFields().schemaVersion,
      epochIndex: e,
      tStart: e * epochDur,
      duration: epochDur,
      fs,
      channels: MONTAGE,
      state: state.at(e * epochDur),
      truth,
      events: [],
      shape: [MONTAGE.length, nSamp],
      dtype: 'float64',
      byteOrder: 'little',
      units: 'uV',
    };
    writeEpoch(outDir, { signal, sidecar });
  }

  writeEventList(outDir, makeEventList([]));

  console.log(
    `wrote ${nEpochs} epoch(s) to ${outDir}\n` +
      `  state=${stateArg} seed=${seed} fs=${fs} channels=${MONTAGE.length} ` +
      `samples/epoch=${nSamp}\n` +
      `  registry=${registryDigest} states-known=${STATES.length}\n` +
      `  NOTE: signal is the WP-D stub (white noise), not aperiodic-with-knee.`,
  );
}

main();
