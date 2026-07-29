"""Which mechanism puts the line at f2, and can the f1 arm see anything at all?

probe_g4.py found two things at once and neither can be acted on until it is decomposed:

  f2: FULL reads 0.228 against a 0.068 null, 39/40 seeds. Something respiratory is reaching
      chi-hat. But "something respiratory" is two mechanisms, and they are not equivalent:

        (a) movement artifact -- energy at 0.25 Hz and its harmonics, all below 1 Hz. It has
            no business appearing in a 2-8 vs 16-40 Hz band ratio. If it does, that IS the
            estimator artifact G4 exists to catch.

        (c) amplitude half -- modulates the 0.5-4 Hz envelope at the respiratory rate. chi-hat's
            low band is 2-8 Hz. THESE OVERLAP. A band-ratio estimator will read a line at f2
            and be RIGHT to: the band power genuinely moves at f2. That is not leakage, it is
            the mechanism working, and a gate that fails on it would be failing by design.

      Conflating the two is the standard error Build Plan 5.1 warns about, one level up: in the
      gate rather than the generator.

  f1: FULL reads 0.1076 against a chi_mod_depth = 0 null of 0.1057. The injected modulation is
      invisible. Either independentChiModFreq does not reach the tilt filter, or the injected
      depth sits under the estimator's floor. A depth sweep separates those: a bug is flat in
      depth, a floor problem is not.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
N_SEEDS = 24

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { chiOverTime, modulationDepth } from './src/analysis/coupling.ts';
import { scalarValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const T = scalarValue('g4_record_length');
const F1 = scalarValue('g4_f1');
const F2 = scalarValue('g4_f2');
const n = Math.round(T * fs);
const nSeeds = Number(process.argv[2]);
const RESP_RATE = F2 * 60;

function measure(seed: number, opts: Record<string, unknown>) {
  const r = composeState(seed, 'n3', n, fs, {
    respRatePerMin: RESP_RATE, independentChiModFreq: F1, ...opts,
  });
  const ref = applyReference(r.channels, 'linked-mastoid');
  const fz = ref.channels[ref.labels.indexOf('Fz')]!;
  const { chi, fsEst } = chiOverTime(fz, fs);
  return { f1: modulationDepth(chi, fsEst, F1), f2: modulationDepth(chi, fsEst, F2) };
}

// --- which mechanism puts the line at f2? chi modulation OFF throughout, so f1 is empty and
// anything at f2 is attributable to the respiratory mechanisms alone.
const MECH: Record<string, Record<string, unknown>> = {
  'neither':   { movementArtifact: false, amplitudeModulation: false, chiModulation: false },
  '(a) only':  { movementArtifact: true,  amplitudeModulation: false, chiModulation: false },
  '(c) only':  { movementArtifact: false, amplitudeModulation: true,  chiModulation: false },
  'both':      { movementArtifact: true,  amplitudeModulation: true,  chiModulation: false },
};
const mech: Record<string, number[]> = {};
for (const [key, opts] of Object.entries(MECH)) {
  mech[key] = [];
  for (let s = 0; s < nSeeds; s++) mech[key]!.push(measure(90000 + s * 101, opts).f2);
}

// --- can the f1 arm see the injected modulation at any depth? Respiratory mechanisms off, so
// f1 carries the chi modulation and nothing else competes.
const DEPTHS = [0, 0.15, 0.3, 0.6, 1.0, 2.0];
const depth: Record<string, number[]> = {};
for (const dv of DEPTHS) {
  depth[String(dv)] = [];
  for (let s = 0; s < nSeeds; s++) {
    depth[String(dv)]!.push(measure(90000 + s * 101, {
      movementArtifact: false, amplitudeModulation: false,
      chiModulation: true, chiModDepth: dv,
    }).f1);
  }
}

process.stdout.write(JSON.stringify({ F1, F2, mech, depth, depths: DEPTHS }));
'''

f = ROOT / '.g4-decomp.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f), str(N_SEEDS)],
                   cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)

print(f"N3, 300 s, Fz, linked mastoid, unfiltered. {N_SEEDS} seeds. "
      f"f1 = {d['F1']}, f2 = {d['F2']} Hz\n")

print("1. WHICH MECHANISM PUTS THE LINE AT f2?  (chi modulation off throughout)\n")
print(f"  {'respiratory mechanisms':24} {'median @ f2':>12} {'p5':>9} {'p95':>9} {'vs neither':>11}")
print("  " + "-" * 70)
base = np.median(d['mech']['neither'])
for key in ['neither', '(a) only', '(c) only', 'both']:
    v = np.array(d['mech'][key])
    print(f"  {key:24} {np.median(v):12.5f} {np.percentile(v,5):9.5f} "
          f"{np.percentile(v,95):9.5f} {np.median(v)/base:10.2f}x")

a_only = np.median(d['mech']['(a) only']) / base
c_only = np.median(d['mech']['(c) only']) / base
print()
if a_only < 1.3:
    print(f"  (a) MOVEMENT ARTIFACT DOES NOT REACH chi-hat ({a_only:.2f}x the empty floor).")
    print("      Energy at 0.25 Hz and its harmonics stays below the 2-8 Hz band. The")
    print("      estimator is not leaking, and the f2 arm is a real check the generator passes.")
else:
    print(f"  (a) reaches chi-hat at {a_only:.2f}x the floor -- estimator leakage, G4's target.")
if c_only >= 1.3:
    print(f"\n  (c) AMPLITUDE MODULATION DOES, at {c_only:.2f}x -- and correctly so. It moves")
    print("      0.5-4 Hz power at f2 and chi-hat's low band is 2-8 Hz. The bands overlap by")
    print("      construction. THIS IS NOT LEAKAGE, and a fixture that leaves it on would")
    print("      fail the gate for doing what it was built to do.")

print("\n2. CAN THE f1 ARM SEE THE INJECTED MODULATION?  (respiratory mechanisms off)\n")
print(f"  {'chi_mod_depth':>14} {'median @ f1':>12} {'p5':>9} {'p95':>9} {'vs depth 0':>11}")
print("  " + "-" * 60)
z = np.median(d['depth']['0'])
for dv in d['depths']:
    v = np.array(d['depth'][str(dv)])
    flag = '  <- registry provisional' if dv == 0.15 else ''
    print(f"  {dv:14.2f} {np.median(v):12.5f} {np.percentile(v,5):9.5f} "
          f"{np.percentile(v,95):9.5f} {np.median(v)/z:10.2f}x{flag}")

top = np.median(d['depth'][str(d['depths'][-1])]) / z
print()
if top < 1.3:
    print(f"  FLAT IN DEPTH ({top:.2f}x at depth {d['depths'][-1]}). This is a BUG, not a floor")
    print("  problem: a 13x increase in injected depth changes nothing, so the modulation is")
    print("  not reaching the signal. independentChiModFreq is the first place to look.")
else:
    print(f"  RESPONDS TO DEPTH ({top:.2f}x at depth {d['depths'][-1]}). The mechanism works; the")
    print("  registry's provisional 0.15 simply sits at or under the estimator's floor. The")
    print("  smallest depth clearing the depth-0 p95 is the gate's real sensitivity limit,")
    print("  and it must be recorded rather than assumed.")
    for dv in d['depths']:
        if np.median(d['depth'][str(dv)]) > np.percentile(d['depth']['0'], 95):
            print(f"  Smallest depth tested that clears it: {dv}")
            break
