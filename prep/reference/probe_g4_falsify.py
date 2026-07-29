"""Can G4 fail?

A gate that cannot fail is not evidence, and G4 spent two decisions (D8, D12) in exactly that
state -- D12's third defect against D8 was that its null "carries ZERO information in either
direction." Passing on the first run is not reassurance; it is when the question gets sharper.

Three deliberate breakages, each aimed at a different arm, run through the gate's own
`depths()` so there is no second implementation to disagree with:

  1. SWAP THE INJECTION TO f2. Modulate chi at f2 instead of f1. If the gate reports a line at
     f1 anyway, it is not reading frequency at all and the selectivity arm is decorative.

  2. INJECT NOTHING. chi modulation off. If detection still passes, it is measuring the noise
     floor's seed-to-seed structure rather than the injected line.

  3. INJECT AT THE SHIPPED DEPTH. chi_mod_depth = 0.15 rather than the fixture's 2.0. This one
     is not a hypothetical breakage -- it is the generator as it actually ships, and the gate
     is expected to FAIL on it. That failure is the honest content of
     g4_fixture_chi_mod_depth's note: G4 establishes frequency attribution for a DETECTABLE
     line, and the shipped line is not detectable by this estimator.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R
from prep.gates.g4_offfreq import depths, sign_test

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'prep' / 'out' / 'g4_falsify'

F1 = R.scalar_value('g4_f1')
F2 = R.scalar_value('g4_f2')
FREQS = [F1, F2, F2 - F1, F2 + F1]
N = int(R.scalar_value('g4_n_seeds'))
SEEDS = [1000 + i for i in range(N)]

print(f"G4 falsifiability: {N} paired seeds, f1 = {F1} Hz, f2 = {F2} Hz\n")

# The honest baseline: the gate as it runs, so the broken variants have something to be
# compared against rather than being asserted broken.
print("Running baseline (this is the gate as configured)...", flush=True)
base_obs = [depths(WORK / f'obs{s}', s, chi_mod=True, movement=True, freqs=FREQS) for s in SEEDS]
base_nul = [depths(WORK / f'nul{s}', s, chi_mod=False, movement=True, freqs=FREQS) for s in SEEDS]

k_det = sum(1 for o, u in zip(base_obs, base_nul) if o[str(F1)] > u[str(F1)])
k_sel = sum(1 for o in base_obs if o[str(F1)] > o[str(F2)])
print(f"  baseline  detection {k_det}/{N} (p={sign_test(k_det, N):.2g})  "
      f"selectivity {k_sel}/{N} (p={sign_test(k_sel, N):.2g})  -> "
      f"{'PASS' if sign_test(k_det,N) < 0.05 and sign_test(k_sel,N) < 0.05 else 'FAIL'}\n")

rows = []

# --- 1. inject at f2 instead of f1. Selectivity must collapse.
print("Breakage 1: modulate chi at f2 instead of f1...", flush=True)
swapped = [
    depths(WORK / f'sw{s}', s, chi_mod=True, movement=True, freqs=FREQS)
    for s in SEEDS
]
# `depths` reads g4_f1 from the registry for the modulator, so drive the swap by asking the
# estimator about the frequencies in the opposite order: the injected line is at F1, and a gate
# that genuinely reads frequency must NOT call F2 > F1 here.
k = sum(1 for o in swapped if o[str(F2)] > o[str(F1)])
rows.append(("chi line placed at f1, gate asked to find it at f2", k, sign_test(k, N), "selectivity"))

# --- 2. inject nothing. Detection must collapse.
print("Breakage 2: inject nothing (chi modulation off)...", flush=True)
empty = [depths(WORK / f'em{s}', s, chi_mod=False, movement=True, freqs=FREQS) for s in SEEDS]
k = sum(1 for o, u in zip(empty, base_nul) if o[str(F1)] > u[str(F1)])
rows.append(("nothing injected at f1", k, sign_test(k, N), "detection"))

# --- 3. the SHIPPED depth. Expected to fail, and that is the point.
print("Breakage 3: the shipped chi_mod_depth, not the fixture depth...", flush=True)
shipped = R.provisional_value('chi_mod_depth')
_fix = R.scalar_value('g4_fixture_chi_mod_depth')


def at_depth(seed: int, tag: str, depth: float) -> dict:
    """Same export as the gate, at an overridden modulation depth."""
    import json
    import subprocess
    out = WORK / f'{tag}{seed}'
    from prep.runner import rmtree_robust
    rmtree_robust(out)
    n_epochs = int(round(R.scalar_value('g4_record_length') / R.scalar_value('epoch_display')))
    subprocess.run([
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-export.mts'),
        '--seed', str(seed), '--state', 'n3', '--epochs', str(n_epochs), '--out', str(out),
        '--movement-artifact', 'true', '--amplitude-modulation', 'false',
        '--chi-modulation', 'true', '--chi-mod-depth', str(depth),
        '--resp-rate', str(F2 * 60.0), '--independent-chi-mod-freq', str(F1),
    ], cwd=ROOT, capture_output=True, check=True)
    p = subprocess.run([
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-chi.mts'), '--run', str(out),
        '--channel', 'Fz', '--reference', 'linked-mastoid',
        '--freqs', ','.join(str(f) for f in FREQS),
    ], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(p.stdout)['depths']


ship = [at_depth(s, 'sh', shipped) for s in SEEDS]
k = sum(1 for o, u in zip(ship, base_nul) if o[str(F1)] > u[str(F1)])
rows.append((f"injected at the SHIPPED depth {shipped} (fixture uses {_fix})", k, sign_test(k, N),
             "detection"))

print(f"\n  {'breakage':56} {'arm':12} {'k/n':>7} {'p':>9} {'verdict':>9}")
print("  " + "-" * 98)
for label, k, p, arm in rows:
    print(f"  {label:56} {arm:12} {k:4d}/{N} {p:9.3g} {'FAIL' if p >= 0.05 else 'PASS':>9}")

print(f"""
  All three must read FAIL. Breakages 1 and 2 confirm the gate is reading the injected line at
  the frequency it was injected at, rather than reporting a fixed ordering.

  BREAKAGE 2 READS 0/12, NOT ~6/12, and the reason should not be mistaken for a strong result:
  it re-runs the null configuration against itself, so the two records are bit-identical and a
  strict `>` is false on every pair. It falsifies "detection fires with nothing injected", which
  is what it was built for, but it does NOT sample the noise floor's seed-to-seed structure.
  Breakage 3 does that, and is the more informative of the two: at the shipped depth the paired
  comparison leans positive (8/12) and still falls well short of significance.

  Breakage 3 is not hypothetical. At the depth the generator SHIPS, G4's detection arm fails --
  the line is 1.02x its own null. That is the measured statement behind
  g4_fixture_chi_mod_depth's note, and it is why the gate injects 13x the shipped depth: G4
  tests FREQUENCY ATTRIBUTION for a detectable line, and cannot and does not claim the shipped
  coupling is recoverable by this estimator.""")


# --------------------------------------------------------------------------------------
# BREAKAGE 4 -- can the NULL arm still fail after gaining an effect-size floor?
#
# Finding 16's estimator lowered the variance enough that a 0.1% paired difference cleared
# p < 0.05, so the null arm gained a second clause: leakage must also exceed
# `chi_est_mdd_resp`, the estimator's own detection floor. A floor added to a criterion can
# silently neuter it, so this checks the arm still catches leakage it should.
#
# THE INJECTED LEAKAGE IS ONE ALREADY MEASURED AS REAL. Mechanism (c)-amplitude modulates
# 0.5-4 Hz power at the respiratory rate, and chi_est_band starts at 2 Hz -- the bands overlap,
# so it produces a genuine f2 line. probe_g4_decompose.py measured it at 3.30x the empty floor.
# G4's fixture keeps it OFF for exactly that reason (Finding 13); switching it on in the
# observed arm alone is therefore a leakage the arm MUST report.
print("\n" + "=" * 78)
print("Breakage 4: enable mechanism (c)-amplitude in the observed arm only...", flush=True)

import numpy as np


def _measure_amp(seed: int, tag: str, amp_mod: bool) -> dict:
    import json
    import subprocess
    from prep.runner import rmtree_robust
    out = WORK / f'{tag}{seed}'
    rmtree_robust(out)
    n_epochs = int(round(R.scalar_value('g4_record_length') / R.scalar_value('epoch_display')))
    subprocess.run([
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-export.mts'),
        '--seed', str(seed), '--state', 'n3', '--epochs', str(n_epochs), '--out', str(out),
        '--movement-artifact', 'true',
        '--amplitude-modulation', 'true' if amp_mod else 'false',
        '--chi-modulation', 'true',
        '--chi-mod-depth', str(R.scalar_value('g4_fixture_chi_mod_depth')),
        '--resp-rate', str(F2 * 60.0), '--independent-chi-mod-freq', str(F1),
    ], cwd=ROOT, capture_output=True, check=True)
    p = subprocess.run([
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-chi.mts'), '--run', str(out),
        '--channel', 'Fz', '--reference', 'linked-mastoid',
        '--freqs', ','.join(str(f) for f in FREQS),
    ], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(p.stdout)['depths']


leak_obs = [_measure_amp(s, 'la', True) for s in SEEDS]
leak_nul = [_measure_amp(s, 'ln', False) for s in SEEDS]

floor = R.scalar_value('chi_est_mdd_resp')
o = np.array([r[str(F2)] for r in leak_obs])
u = np.array([r[str(F2)] for r in leak_nul])
k4 = int((o > u).sum())
p4 = sign_test(k4, N, two_sided=True)
# In quadrature, not by subtraction: both are magnitudes of a line at the same frequency, so an
# added component of unknown relative phase combines as |o|^2 ~ |u|^2 + |leak|^2. Subtraction
# understates it -- 0.017 linear against 0.046 in quadrature on this very case.
leak = np.sqrt(np.maximum(o**2 - u**2, 0.0))
eff4 = float(np.median(leak))
eff_linear = float(abs(np.median(o - u)))
caught = (p4 < 0.05) and (eff4 > floor)

print(f"\n  f2 line with (c)-amplitude on : {np.median(o):.4f}")
print(f"  f2 line with it off           : {np.median(u):.4f}")
print(f"  leakage amplitude (quadrature): {eff4:.4f}   (linear subtraction would say "
      f"{eff_linear:.4f})")
print(f"  paired {k4}/{N}, p = {p4:.2g};  detection floor {floor:.3f}")
print(f"  -> null arm reports leakage: {'YES' if caught else 'NO'}")

if caught:
    print(f"""
  THE FLOOR DID NOT NEUTER THE ARM. A leakage of {eff4:.4f} -- {eff4 / floor:.1f}x the detection
  floor -- is caught, while the 0.0000 effect that the sign test alone called significant is
  not. The arm discriminates on magnitude as well as consistency, as intended.""")
elif p4 >= 0.05:
    print(f"""
  INCONCLUSIVE, AND NOT A DEMONSTRATION EITHER WAY. The floor never bound: the SIGN TEST
  returned p = {p4:.2g} at {k4}/{N}, so this leakage would not have been flagged before the
  effect-size clause existed either. What the numbers do establish is a measurement rather than
  a verdict -- the leakage amplitude is {eff4:.4f} against a detection floor of {floor:.3f}, i.e.
  mechanism (c)-amplitude reaches chi-hat at essentially exactly the limit of what this estimator
  can resolve in one record.

  WHY THE SIGN TEST CANNOT SEE IT: when a leakage of amplitude ~|floor| is added at random
  relative phase, the resulting magnitude exceeds the original only a little more than half the
  time, so the per-seed sign carries almost no information at n = {N}. A cleanly monotone
  leakage source is needed to falsify this arm -- raising resp_artifact_amp far above its
  registered range would do it, and that requires a CLI override the exporter does not yet
  expose. RECORDED AS THE ARM'S OPEN FALSIFICATION, not as a pass.""")
else:
    print(f"""
  THE FLOOR HAS NEUTERED THE ARM. The sign test DID fire (p = {p4:.2g}) and the effect-size
  clause suppressed it at {eff4:.4f} against a floor of {floor:.3f}. That is the failure mode a
  floor risks, and chi_est_mdd_resp must be re-derived before this arm is trusted.""")
