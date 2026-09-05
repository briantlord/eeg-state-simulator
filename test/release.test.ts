import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeState, type ComposeOptions } from '../src/core/generators/compose.ts';
import { ALL_CHANNELS } from '../src/core/generators/projection.ts';
import { scalarValue, GENERATOR_VERSION } from '../src/core/registry.ts';
import { RELEASE_CALIBRATION, RELEASE_PROFILE_ID, releasedOptions } from '../src/core/release.ts';
import { aasmN3, AASM_SCORER_VERSION } from '../src/analysis/aasm.ts';
import { modelFingerprint } from '../src/io/provenance.ts';
import { encodeSignal } from '../src/io/epoch_dir.ts';
import { SignalStream } from '../src/ui/stream.ts';

test('persisted calibration replays its stated occupancy and identifies its current inputs', () => {
  const cal = RELEASE_CALIBRATION;
  assert.equal(cal.generator_version, GENERATOR_VERSION);
  assert.equal(cal.scorer_version, AASM_SCORER_VERSION);
  assert.equal(cal.profile, RELEASE_PROFILE_ID);
  assert.deepEqual(cal.fingerprint, modelFingerprint());
  const fs = scalarValue('fs');
  const n = fs * scalarValue('epoch_display');
  const r = composeState(cal.fixture.seed, 'n3', n * (cal.fixture.epoch + 1), fs, {
    ...releasedOptions(), ...(cal.options as ComposeOptions), snrDb: cal.value_db,
  });
  const channels = r.channels.map((c) => c.subarray(cal.fixture.epoch * n));
  const measured = aasmN3(channels, ALL_CHANNELS, fs);
  assert.equal(measured.fraction, cal.achieved_fraction);
  assert.equal(measured.derivation, cal.fixture.derivation);
  assert.equal(cal.fixture.seed, scalarValue('snr_calibration_seed'));
  assert.equal(cal.fixture.epoch, scalarValue('snr_calibration_epoch'));
  assert.ok(measured.meets);
  const check = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
    'bin/eegsim-calibrate.mts', '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('browser stream and default exporter produce identical initial records and configuration', () => {
  const out = mkdtempSync(join(tmpdir(), 'eegsim-parity-'));
  try {
    const stream = new SignalStream({ seed: 20260728, state: 'n3' });
    const epochs = stream.segmentSeconds / scalarValue('epoch_display');
    const p = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
      'bin/eegsim-export.mts', '--seed', '20260728', '--state', 'n3', '--epochs', String(epochs), '--out', out],
    { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.configuration.profile, RELEASE_PROFILE_ID);
    assert.deepEqual(manifest.configuration.options, releasedOptions());
    assert.equal(manifest.provenance.implementationSha256, modelFingerprint().implementationSha256);
    const n = scalarValue('fs') * scalarValue('epoch_display');
    for (let e = 0; e < epochs; e++) {
      const stored = readFileSync(join(out, `epoch_${String(e).padStart(5, '0')}`, 'signal.f64'));
      assert.deepEqual(stored, encodeSignal(stream.channels.map((c) => c.subarray(e * n, (e + 1) * n))));
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('seek endpoint stays in its buffer and resume rolls into the correct next segment', () => {
  const s = new SignalStream({ seed: 77, state: 'wake_ec' });
  s.seekTo(s.segmentSeconds);
  assert.equal(s.segmentIndex, 0);
  assert.equal(s.positionS, s.segmentSeconds - 1 / scalarValue('fs'));
  s.advance(1 / scalarValue('fs'));
  assert.equal(s.segmentIndex, 1);
  assert.equal(s.positionS, 0);
  for (let c = 0; c < s.channels.length; c++) {
    const previous = s.previous!.channels[c]!;
    assert.ok(Math.abs(s.channels[c]![0]! - previous[previous.length - 1]!) < 1e-12);
  }
  assert.throws(() => s.seekTo(NaN));
  assert.throws(() => s.advance(-1));
});

test('large advances consume prefetched physiological segments in the same order', () => {
  const a = new SignalStream({ seed: 78, state: 'wake_ec' });
  const b = new SignalStream({ seed: 78, state: 'wake_ec' });
  a.advance(70); // prefetch
  a.advance(120);
  for (const dt of [70, 20, 90, 10]) b.advance(dt);
  assert.equal(a.segmentIndex, 2);
  assert.deepEqual(a.channels, b.channels);
  assert.deepEqual(a.respirationBelt, b.respirationBelt);
  assert.deepEqual(a.ecg, b.ecg);
});

test('short N3 synthesis returns with feasible scheduling instead of hanging', () => {
  const p = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e',
    "import {composeState} from './src/core/generators/compose.ts'; const r=composeState(28,'n3',26); console.log(r.channels.every(c=>c.every(Number.isFinite)));"],
  { encoding: 'utf8', timeout: 5000 });
  assert.equal(p.status, 0, String(p.error ?? p.stderr));
  assert.equal(p.stdout.trim(), 'true');
});
