#!/usr/bin/env node
/** Write compact full-generator fixtures for the independent YASA R4 recovery probe.
 * @lit-ok-file: fixture duration, seed spacing and channel selection are probe design.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeState } from '../../src/core/generators/compose.ts';
import { ALL_CHANNELS } from '../../src/core/generators/projection.ts';
import { GENERATOR_VERSION, scalarValue } from '../../src/core/registry.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outRoot = resolve(process.argv[2] ?? resolve(ROOT, 'prep/out/r4_external'));
const durationS = Number(process.argv[3] ?? 1800);
const nSeeds = Number(process.argv[4] ?? 4);
const fs = scalarValue('fs');
const channels = ['Fz', 'C3'] as const;

mkdirSync(outRoot, { recursive: true });
const rows = [];
for (const state of ['n2', 'n3'] as const) {
  for (let s = 0; s < nSeeds; s++) {
    const seed = 88000 + s * 313;
    for (const coupled of [false, true]) {
      const id = `${state}_s${seed}_${coupled ? 'on' : 'off'}`;
      const result = composeState(seed, state, durationS * fs, fs, {
        eventRespirationCoupling: coupled,
      });
      for (const channel of channels) {
        const signal = result.channels[ALL_CHANNELS.indexOf(channel)]!;
        writeFileSync(resolve(outRoot, `${id}_${channel}.f64`), Buffer.from(
          signal.buffer,
          signal.byteOffset,
          signal.byteLength,
        ));
      }
      writeFileSync(resolve(outRoot, `${id}_phase.f64`), Buffer.from(
        result.respirationPhase.buffer,
        result.respirationPhase.byteOffset,
        result.respirationPhase.byteLength,
      ));
      rows.push({
        id,
        state,
        seed,
        coupled,
        nSamples: result.respirationPhase.length,
        events: result.events.filter((event) =>
          event.type === 'slow_oscillation' || event.type.startsWith('spindle'),
        ),
      });
    }
  }
}
writeFileSync(resolve(outRoot, 'manifest.json'), `${JSON.stringify({
  generatorVersion: GENERATOR_VERSION,
  fs,
  durationS,
  channels,
  rows,
}, null, 2)}\n`);
console.log(resolve(outRoot, 'manifest.json'));
