#!/usr/bin/env node
/**
 * The build process. One command, everything that must hold before a commit.
 *
 *   npm run verify
 *
 * Ordered so the earliest failure is the most informative — the same rule harness section 7
 * applies to gates: "if a gate fails, refuse to evaluate its dependents and report the
 * earliest failure only." A registry drift makes every downstream result meaningless, so
 * there is no point running the type checker against it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The project venv, wherever this is running. */
/**
 * The Python that has this project's dependencies. Prefers the local venv; falls back to one on
 * PATH.
 *
 * THE FALLBACK EXISTS BECAUSE CI HAS NO VENV. actions/setup-python installs interpreter and
 * requirements system-wide, so a venv-only lookup returned null there, every Python step reported
 * "no .venv found", and the runner counts a skipped check as a failure -- correctly, since a check
 * that did not run has not passed. The projection step then passed that null straight to
 * spawnSync and the build died with ERR_INVALID_ARG_TYPE before printing which step it was in.
 *
 * Returning a name rather than a path is deliberate: spawn resolves it on PATH, and if that
 * interpreter lacks the dependencies the failure is an ImportError naming the module, which is a
 * better error than a silent skip.
 */
function venvPython() {
  for (const rel of ['.venv/Scripts/python.exe', '.venv/bin/python']) {
    const p = join(ROOT, rel);
    if (existsSync(p)) return p;
  }
  for (const name of ['python3', 'python']) {
    const r = spawnSync(name, ['-c', 'import sys'], { stdio: 'ignore', shell: false });
    if (r.status === 0) return name;
  }
  return null;
}

const PY = venvPython();

const STEPS = [
  {
    name: 'registry fixed-point',
    why: 'the human table and the machine values must be incapable of disagreeing',
    cmd: process.execPath,
    args: [join(ROOT, 'tools', 'registry', 'emit.mjs'), '--check'],
  },
  {
    // THE PROJECTION IS GENERATED TOO, and until now nothing checked it had not drifted from the
    // producer. Under the Gaussian that was a small risk; under a forward model the weights are
    // the one place the head model reaches the runtime, and a stale file would silently ship a
    // different head than the one the registry describes.
    name: 'projection fixed-point',
    why: 'the weights are the only path the head model takes into the runtime (seam 3)',
    cmd: PY,
    args: ['-m', 'prep.leadfield.make_projection', '--check'],
    skipIf: () => (PY ? null : 'no Python found — run: python -m venv .venv'),
  },
  {
    name: 'literal acceptance check',
    why: 'the register\'s top-rated risk: no signal constant may ship outside the registry',
    cmd: process.execPath,
    args: [join(ROOT, 'tools', 'lint', 'literals.mjs')],
  },
  {
    name: 'typecheck',
    why: 'seam 7 is enforced by the type system, so a type error can be a science error',
    // The compiler's JS entry point directly, rather than npx: npx resolves to a .cmd shim on
    // Windows which does not spawn without a shell, and `shell: true` would then need quoting.
    cmd: process.execPath,
    args: [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
    skipIf: () =>
      existsSync(join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'))
        ? null
        : 'typescript not installed — run: npm install',
  },
  {
    name: 'core tests',
    why: 'seam 4 non-perturbation, seam 7 branding, the exponent contract',
    cmd: process.execPath,
    args: ['--test', '--experimental-strip-types', '--no-warnings', 'test/**/*.test.ts'],
  },
  {
    name: 'harness tests',
    why: 'the D7 boundary: TS exporter -> epoch directory -> Python harness',
    cmd: PY,
    args: ['-m', 'pytest', 'prep/', '-q'],
    skipIf: () => (PY ? null : 'no .venv found — run: python -m venv .venv'),
  },
  {
    name: 'gate runner (all tiers)',
    why: 'the gates themselves, with V/C/U printing and matched nulls',
    cmd: PY,
    // NO --allow-partial. The ledger declares seven arms and all seven are implemented, each
    // with its matched null, so the runner now refuses to start if one goes missing — which is
    // the whole point of freezing the ledger. Restoring the flag would restore a build that
    // does not notice a deleted gate.
    //
    // `--tier all` rather than `fast`, because G3 is the only slow-tier gate and skipping it
    // would leave the one class-V morphology check out of every commit.
    args: ['-m', 'prep.runner', '--tier', 'all', '--seeds', '6'],
    skipIf: () => (PY ? null : 'no .venv found — run: python -m venv .venv'),
  },
];

let failed = 0;
for (const step of STEPS) {
  const skip = step.skipIf?.();
  if (skip) {
    console.log(`\n[33mSKIP[0m  ${step.name} — ${skip}`);
    console.log('      A skipped check is not a passing check.');
    failed++;
    continue;
  }
  console.log(`\n[36m▸[0m ${step.name}  [2m(${step.why})[0m`);
  const r = spawnSync(step.cmd, step.args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`\n[31mFAIL[0m  ${step.name}`);
    console.error('Later steps are not run: their results would be meaningless.');
    failed++;
    break;
  }
}

if (failed) {
  console.error(`\n[31mverify failed[0m\n`);
  process.exit(1);
}
console.log(`\n[32mverify OK[0m — ${STEPS.length} checks passed\n`);
