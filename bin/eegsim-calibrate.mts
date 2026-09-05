#!/usr/bin/env node
/**
 * SNR calibration — T0-M5. Solve once per configuration; --check replays without writing.
 *
 *   node --experimental-strip-types bin/eegsim-calibrate.mts
 *
 * Solves for the mix value at which generated N3 satisfies the AASM criterion, on the named
 * fixture seed and epoch, and writes it to prep/fixtures/snr_calibration.json.
 *
 * WHY THIS IS SEPARATE FROM G5, which is the whole point of D5. If `snr_nominal` were tuned
 * until G5 passed, G5 would pass by construction — the same shape as setting `delta_amp` from
 * the 75 µV figure, reintroduced one level up by its own fix. So:
 *
 *   Calibration (here, once)  solves one scalar on ONE fixture seed.
 *   G5 (every run)            evaluates the criterion on seeds HELD OUT of this, and reports
 *                             a pass fraction rather than a boolean.
 *
 * Calibration fixes a scalar. It does not guarantee the criterion survives across seeds,
 * across epochs, or after any later change to amplitudes or the variability contract — and
 * that residue is all G5's positive arm actually tests.
 *
 * @lit-ok-file: a bisection procedure. Its literals are the dB search bracket (the registry's
 * own UI sweep range, widened), the halving-iteration count, and percent for display. The value
 * it SOLVES is `snr_nominal`, written to the fixture artifact — not a constant hardcoded here.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeState } from '../src/core/generators/compose.ts';
import { aasmN3, AASM_SCORER_VERSION } from '../src/analysis/aasm.ts';
import { ALL_CHANNELS } from '../src/core/generators/projection.ts';
import { scalarValue, GENERATOR_VERSION } from '../src/core/registry.ts';
import { RELEASE_MECHANISMS, RELEASE_PROFILE_ID } from '../src/core/profile.ts';
import { modelFingerprint } from '../src/io/provenance.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fractionAt(snrDb: number, seed: number, epoch: number): number {
  const fs = scalarValue('fs');
  const nSamp = fs * scalarValue('epoch_display');
  // Generate through the target epoch so the calibration epoch is the one specified, not
  // whatever the first epoch happens to be.
  const total = nSamp * (epoch + 1);
  // Calibrate the carrier/event amplitude at neutral infra-slow gain. A 30-second fixture samples
  // only a fraction of one ISF cycle; including the stochastic gain made the solved SNR depend on
  // whether this particular epoch landed in a high- or low-excitability phase. The released
  // modulation is mean-square preserving and is restored in exports and held-out G5 records.
  const r = composeState(seed, 'n3', total, fs, {
    ...RELEASE_MECHANISMS,
    snrDb,
    infraSlowModulation: false,
  });
  const slice = r.channels.map((c) => c.subarray(epoch * nSamp, (epoch + 1) * nSamp));
  return aasmN3(slice, ALL_CHANNELS, fs).fraction;
}

function main(): void {
  const seed = scalarValue('snr_calibration_seed');
  const epoch = scalarValue('snr_calibration_epoch');
  const target = scalarValue('gate_aasm_n3_min_fraction');

  if (process.argv.includes('--check')) {
    const saved = JSON.parse(readFileSync(join(ROOT, 'prep/fixtures/snr_calibration.json'), 'utf8'));
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (saved.generator_version !== GENERATOR_VERSION || saved.scorer_version !== AASM_SCORER_VERSION ||
        saved.profile !== RELEASE_PROFILE_ID || !same(saved.fingerprint, modelFingerprint()) ||
        !same(saved.options, { ...RELEASE_MECHANISMS, infraSlowModulation: false }) ||
        saved.fixture.seed !== seed || saved.fixture.epoch !== epoch || saved.fixture.state !== 'n3' ||
        saved.fixture.derivation !== 'C3-A2' || saved.target_fraction !== target || !Number.isFinite(saved.value_db)) {
      throw new Error('Calibration contract or inputs changed; run npm run calibrate');
    }
    const replay = fractionAt(saved.value_db, seed, epoch);
    if (replay < target || replay !== saved.achieved_fraction) throw new Error('Calibration replay failed');
    console.log(`calibration check OK — ${saved.value_db} dB, occupancy ${replay}`);
    return;
  }

  console.log(`SNR calibration — fixture seed ${seed}, epoch ${epoch}`);
  console.log(`target: AASM N3 occupancy = ${(target * 100).toFixed(0)}%\n`);

  // Refine a bracketed crossing of the occupancy staircase. Interference with background can
  // make occupancy non-monotone: this finds a passing point, not a proven global minimum.
  let lo = -24;
  let hi = 24;
  const fLo = fractionAt(lo, seed, epoch);
  const fHi = fractionAt(hi, seed, epoch);
  console.log(`  bracket: ${lo} dB -> ${(fLo * 100).toFixed(1)}%   ` +
    `${hi} dB -> ${(fHi * 100).toFixed(1)}%`);

  if (fLo > target || fHi < target) {
    console.error(
      `\nFAILED: the target ${(target * 100).toFixed(0)}% is not bracketed by ` +
        `[${lo}, ${hi}] dB. The amplitude registry cannot reach the AASM criterion at any ` +
        'mix in this range, which is a statement about delta_amp and so_amp, not about the ' +
        'calibration.',
    );
    process.exit(1);
  }

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fractionAt(mid, seed, epoch) < target) lo = mid;
    else hi = mid;
  }
  // Occupancy is a staircase because samples enter whole qualifying half-waves. `hi` is the
  // smallest side known to meet the target; the midpoint can fall on the lower step and write a
  // calibration artifact that does not actually satisfy its own defining criterion.
  const snrNominal = hi;
  const achieved = fractionAt(snrNominal, seed, epoch);

  console.log(`\n  snr_nominal = ${snrNominal.toFixed(4)} dB`);
  console.log(`  achieved occupancy on the fixture epoch: ${(achieved * 100).toFixed(1)}%`);

  const artifact = {
    schema: 2,
    solved: 'snr_nominal',
    value_db: snrNominal,
    units: 'dB',
    procedure:
      'Bisection on the mix parameter until AASM N3 occupancy reaches ' +
      'gate_aasm_n3_min_fraction on the named fixture seed and epoch, C3-A2, with the ' +
      'mean-square-preserving infra-slow gain held at its neutral arm.',
    fixture: { seed, epoch, state: 'n3', derivation: 'C3-A2' },
    target_fraction: target,
    achieved_fraction: achieved,
    generator_version: GENERATOR_VERSION,
    profile: RELEASE_PROFILE_ID,
    scorer_version: AASM_SCORER_VERSION,
    options: { ...RELEASE_MECHANISMS, infraSlowModulation: false },
    fingerprint: modelFingerprint(),
    warning:
      'HELD OUT of every G5 evaluation. G5 must run on other seeds and report a pass ' +
      'fraction. Tuning this value until G5 passes would make G5 pass by construction.',
  };

  const outDir = join(ROOT, 'prep', 'fixtures');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, 'snr_calibration.json');
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const replay = fractionAt(saved.value_db, seed, epoch);
  if (replay < target || replay !== saved.achieved_fraction) {
    throw new Error(`Persisted calibration failed replay: ${replay}`);
  }
  console.log(`\n  wrote ${path.replace(ROOT, '.')}`);
}

main();
