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
 * Defaults to the same named calibrated configuration as the browser. Isolated validation
 * arms must use --profile isolated or override individual mechanisms explicitly.
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedState, STATE_IDS, isStateId } from '../src/core/types/state.ts';
import type { StateId } from '../src/core/types/state.ts';
import { makeEventList } from '../src/core/types/event.ts';
import {
  writeEpoch,
  writeManifest,
  writeEventList,
  writePhysiologyTruth,
  defaultManifestFields,
  epochSamples,
  type EpochSidecar,
  type InjectedTruth,
} from '../src/io/epoch_dir.ts';
import { scalarValue, electrodeSet, enumValue, STATES } from '../src/core/registry.ts';
import { composeState, type ComposeOptions } from '../src/core/generators/compose.ts';
import { ALL_CHANNELS, weightsFor, modesOf, type PatchId } from '../src/core/generators/projection.ts';
import { releasedOptions, RELEASE_PROFILE_ID, RELEASE_CALIBRATION } from '../src/core/release.ts';
import { ISOLATED_MECHANISMS } from '../src/core/profile.ts';
import { fileDigest, modelFingerprint } from '../src/io/provenance.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MONTAGE = ALL_CHANNELS;

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
  const known = new Set(['profile', 'seed', 'state', 'epochs', 'out', 'snr-db', 'movement-artifact',
    'amplitude-modulation', 'chi-modulation', 'no-resp-event-coupling', 'chi-mod-depth',
    'resp-amp-mod-depth', 'resp-rate', 'independent-chi-mod-freq', 'no-graphoelements',
    'no-infraslow-cortical', 'no-infraslow-modulation', 'line-noise', 'line-freq', 'respiration-mode']);
  for (const key of Object.keys(args)) if (!known.has(key)) throw new Error(`Unknown option --${key}`);
  const profile = args['profile'] ?? 'released';
  if (profile !== 'released' && profile !== 'isolated') throw new Error('Expected --profile released or isolated');
  const defaults = releasedOptions(profile === 'isolated' ? ISOLATED_MECHANISMS : {});
  const flag = (name: string, fallback: boolean): boolean => {
    if (args[name] === undefined) return fallback;
    if (args[name] !== 'true' && args[name] !== 'false') throw new Error(`--${name} must be true or false`);
    return args[name] === 'true';
  };
  for (const name of ['snr-db', 'epochs', 'seed', 'chi-mod-depth', 'resp-amp-mod-depth',
    'resp-rate', 'independent-chi-mod-freq', 'line-freq']) {
    if (args[name] !== undefined && !Number.isFinite(Number(args[name]))) {
      throw new Error(`--${name} must be finite`);
    }
  }
  for (const name of ['resp-rate', 'independent-chi-mod-freq']) {
    if (args[name] !== undefined && Number(args[name]) <= 0) throw new Error(`--${name} must be positive`);
  }
  for (const name of ['chi-mod-depth', 'resp-amp-mod-depth']) {
    if (args[name] !== undefined && Number(args[name]) < 0) throw new Error(`--${name} must be non-negative`);
  }
  const respirationMode = args['respiration-mode'] ?? defaults.respirationMode;
  if (respirationMode !== 'natural' && respirationMode !== 'regular') throw new Error('Invalid --respiration-mode');
  if (args['line-freq'] !== undefined && !enumValue('line_freq').includes(Number(args['line-freq']))) {
    throw new Error('--line-freq must be one of the registered mains frequencies');
  }

  const seed = Number(args['seed'] ?? scalarValue('snr_calibration_seed'));
  const stateArg = args['state'] ?? 'n3';
  if (!isStateId(stateArg)) {
    console.error(`unknown state '${stateArg}'; expected one of ${STATE_IDS.join(', ')}`);
    process.exit(2);
  }
  const nEpochs = Number(args['epochs'] ?? 1);
  if (!Number.isSafeInteger(nEpochs) || nEpochs < 1) throw new Error('--epochs must be a positive integer');
  // Defaults to the solved snr_nominal when the calibration artifact exists, so exported
  // data is at the calibrated mix unless a caller deliberately overrides it.
  const snrDb = args['snr-db'] !== undefined ? Number(args['snr-db']) : defaults.snrDb!;
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

  const fingerprint = modelFingerprint();
  const registryDigest = fingerprint.registrySha256.slice(0, 16); // @lit-ok legacy 16-hex registry identifier
  if (JSON.stringify(fingerprint) !== JSON.stringify(RELEASE_CALIBRATION.fingerprint)) {
    throw new Error('Calibration inputs changed; run npm run calibrate before exporting');
  }

  // ONE CONTINUOUS RUN, sliced into epochs — not one independent realisation per epoch.
  //
  // Per-epoch streams gave the record `prep/epochio.concatenated()` stitches for G4 a hard
  // discontinuity every 30 s, depositing a comb at k/epoch_display = k x 0.03333 Hz. `g4_f1`
  // = 0.10 Hz is harmonic k = 3 EXACTLY while `g4_f2` = 0.25 Hz is k = 7.5 and lands on
  // nothing — so a pure export artefact put energy at f1 and not at f2, which is precisely
  // the pattern G4 declares a pass, on the gate the Build Plan calls the most important thing
  // in Tier 0.
  const totalSamples = nSamp * nEpochs;

  // Independent overrides preserve fixture isolation without changing the released defaults.
  const respOpts = {
    movementArtifact: flag('movement-artifact', defaults.movementArtifact!),
    amplitudeModulation: flag('amplitude-modulation', defaults.amplitudeModulation!),
    chiModulation: flag('chi-modulation', defaults.chiModulation!),
    eventRespirationCoupling: !flag('no-resp-event-coupling', false),
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
  const suppressGraphoelements = flag('no-graphoelements', false);

  const resolvedOptions = {
    ...defaults,
    respirationMode,
    snrDb,
    suppressGraphoelements,
    ...respOpts,
    infraSlowCortical: !flag('no-infraslow-cortical', false),
    infraSlowModulation: !flag('no-infraslow-modulation', false),
    lineNoise: flag('line-noise', defaults.lineNoise!),
    ...(args['line-freq'] !== undefined ? { lineFreqHz: Number(args['line-freq']) } : {}),
  } satisfies ComposeOptions;
  const composed = composeState(seed, stateArg, totalSamples, fs, resolvedOptions);
  // Validate and compose before creating any output files.
  writeManifest(outDir, {
    ...defaultManifestFields(), seed, fs, channels: MONTAGE,
    referenceChannels: electrodeSet('reference_channels'), nEpochs, epochDuration: epochDur,
    registryDigest, stateSourceKind: state.kind,
    configuration: { profile: profile === 'released' ? RELEASE_PROFILE_ID : 'isolated-fixture', options: resolvedOptions },
    provenance: { ...fingerprint, calibrationSha256: fileDigest('prep/fixtures/snr_calibration.json') },
  });

  const { breaths: _breaths, ...respirationSummary } = composed.truth.respiration;
  const {
    rPeaksS: _rPeaksS,
    rrIntervalsS: _rrIntervalsS,
    ...cardiacSummary
  } = composed.truth.cardiac;

  const truth: InjectedTruth = {
    chi: composed.truth.chi,
    knee: composed.truth.knee,
    aperiodicComponents: composed.truth.aperiodicComponents,
    snrDb: composed.truth.snrDb,
    // Read back from the generator rather than from the CLI arguments. The sidecar records
    // WHAT WAS INJECTED; echoing the request would make it agree with itself even if the
    // option never reached the generator -- which is the exact failure the f1 arm of G4 was
    // built to detect, so the gate must not be handed a truth block that cannot disagree.
    chiModDepth: respOpts.chiModulation ? composed.truth.chiModDepth : 0,
    chiModPhi0: composed.truth.chiModPhi0,
    chiSpatialLoading: composed.truth.chiSpatialLoading,
    periodicModulations: composed.truth.oscillations.map((osc) => ({
      generator: osc.generator,
      band: osc.band,
      depth: osc.respModDepth,
      phi0: osc.respModPhi0,
    })),
    respFreq: composed.truth.respFreqHz,
    respEventCoupling: composed.truth.respEventCoupling,
    respiration: respirationSummary,
    cardiac: cardiacSummary,
    eventPhaseSummaries: composed.truth.eventPhaseSummaries,
    infraSlow: composed.truth.infraSlow
      ? {
          fixture: composed.truth.infraSlow.fixture,
          profile: composed.truth.infraSlow.profile,
          extrapolated: composed.truth.infraSlow.extrapolated,
          sourceModeIds: composed.truth.infraSlow.sourceModes.map((mode) => mode.sourceId),
          modulationTargets: composed.truth.infraSlow.modulation.map((item) => item.targetSource),
          electrodeDriftEnabled: composed.truth.infraSlow.electrodeDrift.enabled,
        }
      : null,
    physiologyFile: 'physiology.json',
    independentChiModFreq: respOpts.independentChiModFreq ?? null,
    projectionWeights: Object.fromEntries(
      [
        // One entry per background MODE. The count comes from the projection file rather than a
        // registry row: it is a property of the head model and `patch_mode_variance`, and a row
        // could disagree with the weights that were actually applied.
        ...modesOf('background'),
        // A non-additive lead-field family: when chi modulation is enabled its root-sum-square
        // sets the spatial modulation depth. Schema v3 records it because it was actually used.
        ...(respOpts.chiModulation ? modesOf('resp_aperiodic') : []),
        // Schema v6: every named cortical ISF mode that contributed additive voltage or drove
        // a source gain. The complete amplitudes and target map live in physiology.json.
        ...(composed.truth.infraSlow?.sourceModes.map((mode) => mode.sourceId) ?? []),
        // ...and every mode of each oscillation the state ran.
        ...composed.truth.oscillations.flatMap((o) => modesOf(o.generator as PatchId)),
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
      eventTiming: respOpts.eventRespirationCoupling,
    },
    graphoelementsSuppressed: suppressGraphoelements,
  };

  writePhysiologyTruth(outDir, {
    schemaVersion: defaultManifestFields().schemaVersion,
    respiration: composed.truth.respiration,
    cardiac: composed.truth.cardiac,
    eventPhaseSummaries: composed.truth.eventPhaseSummaries,
    infraSlow: composed.truth.infraSlow ?? null,
  });

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
