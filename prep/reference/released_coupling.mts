/** Record-only sensitivity at released strength, natural respiration, and the full mixture.
 * Paired records differ only in chiModulation. No injected depth is enlarged to aid detection.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { composeState } from '../../src/core/generators/compose.ts';
import { releasedOptions, RELEASE_PROFILE_ID } from '../../src/core/release.ts';
import { scalarValue, GENERATOR_VERSION } from '../../src/core/registry.ts';
import { applyReference } from '../../src/analysis/referencing.ts';
import { chiOverTime } from '../../src/analysis/coupling.ts';
import { modelFingerprint, fileDigest } from '../../src/io/provenance.ts';
import protocol from '../fixtures/state_realism_protocol.json' with { type: 'json' };

const fs = scalarValue('fs');
const durationS = protocol.generated_epochs * scalarValue('epoch_display');

function harmonic(values: Float64Array, phases: Float64Array) {
  const a = Array.from({ length: 3 }, () => [0, 0, 0]);
  const b = [0, 0, 0];
  for (let i = 0; i < values.length; i++) {
    const row = [1, Math.cos(phases[i]!), Math.sin(phases[i]!)];
    for (let j = 0; j < 3; j++) {
      b[j] = b[j]! + row[j]! * values[i]!;
      for (let k = 0; k < 3; k++) a[j]![k] = a[j]![k]! + row[j]! * row[k]!;
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const d = a[col]![col]!;
    if (Math.abs(d) < Number.EPSILON) throw new Error('Insufficient respiratory phase support');
    for (let k = col; k < 3; k++) a[col]![k] = a[col]![k]! / d;
    b[col] = b[col]! / d;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      for (let k = col; k < 3; k++) a[r]![k] = a[r]![k]! - factor * a[col]![k]!;
      b[r] = b[r]! - factor * b[col]!;
    }
  }
  return { depth: Math.hypot(b[1]!, b[2]!), maxPhase: Math.atan2(b[2]!, b[1]!) };
}

const rows = [];
for (const state of ['wake_ec', 'n2', 'n3'] as const) {
  for (const seed of protocol.generated_seeds) {
    const options = releasedOptions();
    const on = composeState(seed, state, fs * durationS, fs, options);
    const off = composeState(seed, state, fs * durationS, fs, { ...options, chiModulation: false });
    const estimate = (channels: Float64Array[]) => {
      const ref = applyReference(channels, 'linked-mastoid');
      return chiOverTime(ref.channels[ref.labels.indexOf('Fz')]!, fs);
    };
    const a = estimate(on.channels);
    const b = estimate(off.channels);
    const phases = Float64Array.from(a.chi, (_, i) => on.respirationPhase[
      Math.round((i / a.fsEst + scalarValue('chi_est_window_s') / 2) * fs)
    ]!);
    const delta = Float64Array.from(a.chi, (value, i) => value - b.chi[i]!);
    rows.push({ state, seed, injectedDepth: on.truth.chiModDepth,
      on: harmonic(a.chi, phases), off: harmonic(b.chi, phases), pairedChange: harmonic(delta, phases) });
  }
  console.log(`Measured released ${state}: ${protocol.generated_seeds.length} paired seeds`);
}
const output = resolve('prep/out/released_coupling.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  generatorVersion: GENERATOR_VERSION, profile: RELEASE_PROFILE_ID, options: releasedOptions(),
  fingerprint: modelFingerprint(), calibrationSha256: fileDigest('prep/fixtures/snr_calibration.json'),
  durationS, channel: 'Fz', reference: 'linked-mastoid', rows,
  claim: 'Record-only on/off sensitivity of the shipped slope estimator to released-strength chi modulation. Natural respiratory phase sampled at estimator-window centers. Other respiratory mechanisms remain enabled; nonzero off-arm coupling is not attributed to chi modulation. No recovery tolerance or physiological-validity threshold is established.',
}, null, 2) + '\n');
console.log(`Wrote ${output}`);
