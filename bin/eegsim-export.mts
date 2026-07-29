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
import { ALL_CHANNELS, weightsFor } from '../src/core/generators/projection.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MONTAGE = ALL_CHANNELS;

/** The solved snr_nominal, or 0 dB if calibration has not been run. */
function solvedSnrNominal(): number {
  try {
    const p = join(ROOT, 'prep', 'fixtures', 'snr_calibration.json');
    return JSON.parse(readFileSync(p, 'utf8')).value_db as number;
  } catch {
    return 0;
  }
}

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
  // Defaults to the solved snr_nominal when the calibration artifact exists, so exported
  // data is at the calibrated mix unless a caller deliberately overrides it.
  const snrDb = args['snr-db'] !== undefined ? Number(args['snr-db']) : solvedSnrNominal();
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
    .slice(0, 16); // @lit-ok 16-hex-char registry-digest prefix

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

  // THE RESPIRATORY MECHANISMS ARE OFF UNLESS ASKED FOR, and each is its own flag, because
  // Build Plan 5.1 requires the three stay separable and a single --respiration would be that
  // error in a CLI. G4's fixture needs exactly one of them on (the movement artifact) and one
  // deliberately off (the amplitude half), so a combined flag could not express it at all.
  const respOpts = {
    movementArtifact: args['movement-artifact'] === 'true',
    amplitudeModulation: args['amplitude-modulation'] === 'true',
    chiModulation: args['chi-modulation'] === 'true',
    ...(args['chi-mod-depth'] !== undefined ? { chiModDepth: Number(args['chi-mod-depth']) } : {}),
    // Exists to falsify G4's null arm by injecting a leakage large enough for a paired sign test
    // to resolve; see ComposeOptions.respAmpModDepth.
    ...(args['resp-amp-mod-depth'] !== undefined
      ? { respAmpModDepth: Number(args['resp-amp-mod-depth']) }
      : {}),
    ...(args['resp-rate'] !== undefined ? { respRatePerMin: Number(args['resp-rate']) } : {}),
    ...(args['independent-chi-mod-freq'] !== undefined
      ? { independentChiModFreq: Number(args['independent-chi-mod-freq']) }
      : {}),
  };

  // G3's matched null: the same background with the graphoelements left out of the mix.
  const suppressGraphoelements = args['no-graphoelements'] === 'true';

  const composed = composeState(seed, stateArg, totalSamples, fs, {
    snrDb,
    suppressGraphoelements,
    ...respOpts,
  });

  const truth: InjectedTruth = {
    chi: composed.truth.chi,
    knee: composed.truth.knee,
    snrDb: composed.truth.snrDb,
    // Read back from the generator rather than from the CLI arguments. The sidecar records
    // WHAT WAS INJECTED; echoing the request would make it agree with itself even if the
    // option never reached the generator -- which is the exact failure the f1 arm of G4 was
    // built to detect, so the gate must not be handed a truth block that cannot disagree.
    chiModDepth: respOpts.chiModulation ? composed.truth.chiModDepth : 0,
    chiModPhi0: composed.truth.chiModPhi0,
    respFreq: composed.truth.respFreqHz,
    independentChiModFreq: respOpts.independentChiModFreq ?? null,
    projectionWeights: Object.fromEntries(
      [
        // One entry per background source, since there are now several with distinct
        // topographies rather than one uniform one.
        ...Array.from({ length: scalarValue('background_n_sources') }, (_, i) => `background_${i}`),
        ...composed.truth.oscillations.map((o) => o.generator),
        // Graphoelement generators, DERIVED FROM THE EVENT LIST rather than listed for every
        // state. G6 needs these weights, and the temptation was to add spindle/kc
        // unconditionally so the gate always finds them — but this field means "weights
        // ACTUALLY APPLIED", and a wake record does not apply a spindle topography. Writing
        // one there would make the sidecar agree with a question nobody asked of that record.
        // G6 instead reads each generator from the state that generates it.
        //
        // Under --no-graphoelements the events still exist and the weights are still listed:
        // they describe the topography those events would have had, and
        // `graphoelementsSuppressed` in this same block says they did not reach the signal.
        ...composed.truth.graphoelementGenerators,
      ].map((g) => [g, [...weightsFor(g as Parameters<typeof weightsFor>[0])]]),
    ),
    // `rmbo` is mechanism (b), respiration-entrained neural activity. Still not implemented,
    // and recorded as false rather than omitted so the sidecar says so explicitly.
    respMechanisms: {
      movementArtifact: respOpts.movementArtifact,
      rmbo: false,
      amplitudeModulation: respOpts.amplitudeModulation,
      chiModulation: respOpts.chiModulation,
    },
    graphoelementsSuppressed: suppressGraphoelements,
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
      `  chi=${composed.truth.chi} knee=${composed.truth.knee.toFixed(3)} ` + // @lit-ok display precision (3 decimals)
      `(${Math.pow(composed.truth.knee, 1 / composed.truth.chi).toFixed(1)} Hz)\n` +
      `  sources: background@${composed.truth.backgroundRmsUv}uV` +
      composed.truth.oscillations
        .map((o) => ` + ${o.generator}@${o.rmsUv}uV(${o.band[0]}-${o.band[1]}Hz)`)
        .join('') +
      ` + sensor@${composed.truth.sensorNoiseRmsUv}uV`,
  );
}

main();
