"""The G4 fixture, settled, and the two numbers the gate needs.

probe_g4_decompose.py established:

  * Mechanism (a) does NOT reach chi-hat: 1.00x the empty floor. The estimator is not leaking,
    so the f2 arm is a real check the generator passes rather than a vacuous one.
  * Mechanism (c)-amplitude DOES, at 3.30x, and correctly -- it moves 0.5-4 Hz power and
    chi-hat's low band is 2-8 Hz. It must be OFF in the fixture or the gate fails by design.
  * The injected chi modulation is invisible at the registry's provisional depth of 0.15
    (1.02x the depth-0 floor) but recovers cleanly at 2.0 (3.32x). The mechanism works; the
    cheap two-band proxy's floor is simply above the shipped depth.

This probe pins the two numbers that follow from that:

  1. g4_fixture_chi_mod_depth -- the smallest depth at which the f1 line clears its own null
     across seeds. Not a realism parameter: G4 asks whether the estimator puts a line at the
     RIGHT FREQUENCY, and a line has to be detectable before that question means anything.
     Recorded as a measured sensitivity limit, which is also the honest statement of what G4
     does not establish: that the SHIPPED depth is detectable. It is not.

  2. Both arms' separation under the corrected fixture, over enough seeds to set a criterion.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
N_SEEDS = 40

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

// THE FIXTURE. Mechanism (a) ON -- it is the confound the f2 arm must survive, and leaving it
// off is what made the arm vacuous. Mechanism (c)-amplitude OFF -- it modulates 0.5-4 Hz power
// at f2 and chi-hat's low band is 2-8 Hz, so it produces a legitimate f2 line by construction.
const FIXTURE = {
  movementArtifact: true,
  amplitudeModulation: false,
  chiModulation: true,
  respRatePerMin: F2 * 60,
  independentChiModFreq: F1,
};

function measure(seed: number, opts: Record<string, unknown>) {
  const r = composeState(seed, 'n3', n, fs, { ...FIXTURE, ...opts });
  const ref = applyReference(r.channels, 'linked-mastoid');
  const fz = ref.channels[ref.labels.indexOf('Fz')]!;
  const { chi, fsEst } = chiOverTime(fz, fs);
  return { f1: modulationDepth(chi, fsEst, F1), f2: modulationDepth(chi, fsEst, F2) };
}

// --- sensitivity sweep, finer between the bracket decompose left: 0.6 invisible, 2.0 clean.
const DEPTHS = [0, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
const sweep: Record<string, number[]> = {};
for (const dv of DEPTHS) {
  sweep[String(dv)] = [];
  for (let s = 0; s < nSeeds; s++) {
    sweep[String(dv)]!.push(measure(90000 + s * 101, { chiModDepth: dv }).f1);
  }
}

// --- both arms at the fixture depth, and their matched nulls.
const DEPTH = 2.0;
const arms: Record<string, { f1: number[]; f2: number[] }> = {
  observed: { f1: [], f2: [] },   // the fixture as specified
  null_f1:  { f1: [], f2: [] },   // chi modulation off: nothing at f1
  null_f2:  { f1: [], f2: [] },   // movement artifact off: nothing at f2
};
for (let s = 0; s < nSeeds; s++) {
  const seed = 90000 + s * 101;
  const o = measure(seed, { chiModDepth: DEPTH });
  const n1 = measure(seed, { chiModDepth: 0 });
  const n2 = measure(seed, { chiModDepth: DEPTH, movementArtifact: false });
  arms['observed']!.f1.push(o.f1); arms['observed']!.f2.push(o.f2);
  arms['null_f1']!.f1.push(n1.f1); arms['null_f1']!.f2.push(n1.f2);
  arms['null_f2']!.f1.push(n2.f1); arms['null_f2']!.f2.push(n2.f2);
}

process.stdout.write(JSON.stringify({ F1, F2, T, DEPTHS, sweep, arms, DEPTH }));
'''

f = ROOT / '.g4-fixture.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f), str(N_SEEDS)],
                   cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
print(f"G4 fixture: N3, {d['T']:.0f} s, Fz, linked mastoid, unfiltered, {N_SEEDS} seeds")
print(f"  chi modulated at f1 = {d['F1']} Hz by an independent modulator")
print(f"  respiration at f2 = {d['F2']} Hz, mechanism (a) ON, mechanism (c)-amplitude OFF\n")

print("1. SENSITIVITY: the smallest fixture depth whose f1 line clears its own null\n")
z = np.array(d['sweep']['0'])
z95 = np.percentile(z, 95)
print(f"  depth-0 null at f1: median {np.median(z):.5f}, p95 {z95:.5f}\n")
print(f"  {'depth':>8} {'median':>10} {'p5':>9} {'seeds > null p95':>18} {'rate':>7}")
print("  " + "-" * 58)
chosen = None
for dv in d['DEPTHS']:
    v = np.array(d['sweep'][str(dv)])
    k = int((v > z95).sum())
    rate = k / N_SEEDS
    mark = ''
    if dv > 0 and chosen is None and rate >= 0.95:
        chosen = dv
        mark = '  <- smallest with >=95% of seeds clearing'
    print(f"  {dv:8.2f} {np.median(v):10.5f} {np.percentile(v,5):9.5f} "
          f"{k:14d}/{N_SEEDS} {rate:7.2f}{mark}")

if chosen is None:
    print("\n  NO DEPTH TESTED IS RELIABLY DETECTABLE. The f1 arm cannot be built on this")
    print("  estimator at this record length.")
else:
    print(f"\n  g4_fixture_chi_mod_depth = {chosen}")
    print(f"  This is {chosen/0.15:.0f}x the registry's provisional chi_mod_depth of 0.15.")
    print("  WHAT THAT MEANS, stated because it is easy to misread: G4 asks whether the")
    print("  estimator puts a detectable line at the RIGHT frequency. It does not, and after")
    print("  this cannot, establish that the SHIPPED modulation depth is detectable. Measured,")
    print("  it is not -- 1.02x its own null. That is a property of the cheap two-band proxy,")
    print("  and replacing it is T1-M2 estimator-characterization work.")

print("\n2. BOTH ARMS AT THE FIXTURE DEPTH\n")
a = {k: {kk: np.array(vv) for kk, vv in v.items()} for k, v in d['arms'].items()}
print(f"  {'':38} {'median':>9} {'p5':>9} {'p95':>9}")
print("  " + "-" * 68)
print(f"  {'f1 arm  observed (chi mod ON @ f1)':38} {np.median(a['observed']['f1']):9.5f} "
      f"{np.percentile(a['observed']['f1'],5):9.5f} {np.percentile(a['observed']['f1'],95):9.5f}")
print(f"  {'f1 arm  null     (chi mod OFF)':38} {np.median(a['null_f1']['f1']):9.5f} "
      f"{np.percentile(a['null_f1']['f1'],5):9.5f} {np.percentile(a['null_f1']['f1'],95):9.5f}")
print()
print(f"  {'f2 arm  observed (artifact ON @ f2)':38} {np.median(a['observed']['f2']):9.5f} "
      f"{np.percentile(a['observed']['f2'],5):9.5f} {np.percentile(a['observed']['f2'],95):9.5f}")
print(f"  {'f2 arm  null     (artifact OFF)':38} {np.median(a['null_f2']['f2']):9.5f} "
      f"{np.percentile(a['null_f2']['f2'],5):9.5f} {np.percentile(a['null_f2']['f2'],95):9.5f}")

t1 = np.percentile(a['null_f1']['f1'], 95)
t2 = np.percentile(a['null_f2']['f2'], 95)
k1 = int((a['observed']['f1'] > t1).sum())
k2 = int((a['observed']['f2'] > t2).sum())
print(f"\n  f1 arm: {k1}/{N_SEEDS} seeds exceed the null p95 ({t1:.5f})   -- must be MOST")
print(f"  f2 arm: {k2}/{N_SEEDS} seeds exceed the null p95 ({t2:.5f})   -- must be FEW (~5%)")
print(f"\n  Ratio of the two observed lines: f1/f2 = "
      f"{np.median(a['observed']['f1'])/np.median(a['observed']['f2']):.2f}x")
print("\n  The f2 arm's expected exceedance rate is 0.05 BY CONSTRUCTION -- it is the null's")
print("  own percentile, so under no leakage the observed and null distributions are the same")
print("  distribution. That is the derived criterion D12 asked for and D8 failed to supply.")
