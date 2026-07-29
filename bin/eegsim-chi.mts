#!/usr/bin/env node
/**
 * Run the SHIPPED coupling estimator over an exported epoch directory (DECISIONS D7).
 *
 *   node --experimental-strip-types bin/eegsim-chi.mts \
 *        --run prep/out/g4/s90000 --channel Fz --reference linked-mastoid \
 *        --freqs 0.1,0.15,0.25,0.35
 *
 * Emits JSON: the modulation depth of chi-hat(t) at each requested frequency.
 *
 * WHY THIS EXISTS RATHER THAN A PYTHON MIRROR. G5 reimplements `aasm.ts` in Python and says
 * so, which is defensible there: the AASM rule is external, published, and short, so two
 * implementations agreeing is worth something. G4 is the opposite case. It is class C — the
 * estimator IS the thing under test — and its stated purpose is to check that the filter
 * demonstration measures coupling rather than leakage. The demonstration uses
 * `chiOverTime`/`modulationDepth`. A Python mirror that silently drifted from those would
 * leave the gate green while covering nothing, which is the specific failure the harness spec
 * warns about when it says a stated check that does not exist is worse than none.
 *
 * So the boundary stays where D7 put it — the harness reads an exported epoch directory — and
 * the estimator on the far side of it is the shipped one. `/prep` does statistics only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chiOverTime, modulationDepth } from '../src/analysis/coupling.ts';
import { applyReference, type ReferenceMode } from '../src/analysis/referencing.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    out[a.slice(2)] = next !== undefined && !next.startsWith('--') ? (i++, next) : 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const runDir = resolve(args['run'] ?? '');
const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) as {
  fs: number;
  channels: string[];
  nEpochs: number;
};

const epochs = readdirSync(runDir).filter((d) => d.startsWith('epoch_')).sort();
if (epochs.length === 0) throw new Error(`no epochs in ${runDir}`);

// ONE CONTINUOUS RECORD, reassembled in epoch order. The exporter writes a single continuous
// run sliced into epochs precisely so this concatenation has no seam: a per-epoch stream
// deposits a comb at k/30 Hz, and g4_f1 = 0.10 Hz is harmonic k = 3 exactly.
const nCh = manifest.channels.length;
const perEpoch: Float64Array[][] = epochs.map((e) => {
  const buf = readFileSync(join(runDir, e, 'signal.f64'));
  const all = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const n = all.length / nCh;
  return Array.from({ length: nCh }, (_, c) => all.subarray(c * n, (c + 1) * n));
});
const total = perEpoch.reduce((s, p) => s + p[0]!.length, 0);
const channels = Array.from({ length: nCh }, (_, c) => {
  const out = new Float64Array(total);
  let at = 0;
  for (const ep of perEpoch) {
    out.set(ep[c]!, at);
    at += ep[c]!.length;
  }
  return out;
});

const mode = (args['reference'] ?? 'linked-mastoid') as ReferenceMode;
const ref = applyReference(channels, mode);
const label = args['channel'] ?? 'Fz';
const idx = ref.labels.indexOf(label);
if (idx < 0) throw new Error(`no channel '${label}' after referencing; have ${ref.labels.join(',')}`);

const { chi, fsEst } = chiOverTime(ref.channels[idx]!, manifest.fs);
const freqs = (args['freqs'] ?? '0.1,0.25').split(',').map(Number);

process.stdout.write(
  JSON.stringify({
    run: runDir,
    channel: label,
    reference: mode,
    fs: manifest.fs,
    samples: total,
    durationS: total / manifest.fs,
    chiSamples: chi.length,
    fsEst,
    depths: Object.fromEntries(freqs.map((f) => [String(f), modulationDepth(chi, fsEst, f)])),
  }),
);
