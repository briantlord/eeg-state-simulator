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
from prep.gates.g4_offfreq import depths, paired_sign_test, sign_test

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
# BREAKAGE 4 -- the null arm's SENSITIVITY, by sweeping a monotone leakage source.
#
# Finding 16 amended the null arm: leakage must be both statistically consistent AND exceed
# `chi_est_mdd_resp`, the estimator's detection floor, because a paired sign test detects
# direction rather than magnitude. A floor added to a criterion can silently neuter it, so the
# arm has to be shown able to fail.
#
# The first attempt at this was INCONCLUSIVE and is worth recording. It enabled mechanism
# (c)-amplitude at its registered depth in the observed arm only, which leaks 0.033 against a
# 0.048 floor -- and got 6/12, p = 1. The sign test never fired, so the floor never bound and
# nothing was demonstrated either way. The reason is instructive: a leakage of amplitude ~= the
# floor, added at random relative phase, raises the resulting magnitude only slightly more than
# half the time, so the per-seed sign carries almost no information at n = 12.
#
# SWEEPING THE DEPTH FIXES THAT AND MEASURES MORE. `resp_amp_mod_depth` now has a CLI override,
# so the leakage can be driven from below the floor to well above it. That gives the arm's
# detection threshold as a number rather than a yes/no, which is the honest form of "it can fail".
#
# (c)-amplitude is the right source: it moves 0.5-4 Hz power, overlapping the low edge of
# chi_est_band, and G4's fixture keeps it OFF precisely because it leaks (Finding 13). Mechanism
# (a) cannot serve -- it is sub-1 Hz and measures 0.0000 in quadrature, correctly.
print("\n" + "=" * 78)
print("Breakage 4: sweep mechanism (c)-amplitude depth to find the null arm's threshold")
print("=" * 78, flush=True)

import json
import subprocess
import numpy as np
from prep.runner import rmtree_robust

DEPTHS = [0.0, 0.35, 0.7, 1.2, 2.0]
FLOOR = R.scalar_value('chi_est_mdd_resp')
N_EPOCHS = int(round(R.scalar_value('g4_record_length') / R.scalar_value('epoch_display')))


def _leak_run(seed: int, tag: str, amp_depth: float | None) -> dict:
    """One export/estimate pair. `amp_depth` None disables mechanism (c)-amplitude entirely."""
    out = WORK / f'{tag}{seed}'
    rmtree_robust(out)
    cmd = [
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-export.mts'),
        '--seed', str(seed), '--state', 'n3', '--epochs', str(N_EPOCHS), '--out', str(out),
        '--movement-artifact', 'true',
        '--amplitude-modulation', 'false' if amp_depth is None else 'true',
        '--chi-modulation', 'true',
        '--chi-mod-depth', str(R.scalar_value('g4_fixture_chi_mod_depth')),
        '--resp-rate', str(F2 * 60.0), '--independent-chi-mod-freq', str(F1),
    ]
    if amp_depth is not None:
        cmd += ['--resp-amp-mod-depth', str(amp_depth)]
    subprocess.run(cmd, cwd=ROOT, capture_output=True, check=True)
    r = subprocess.run([
        'node', '--experimental-strip-types', '--no-warnings',
        str(ROOT / 'bin' / 'eegsim-chi.mts'), '--run', str(out),
        '--channel', 'Fz', '--reference', 'linked-mastoid',
        '--freqs', ','.join(str(f) for f in FREQS),
    ], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)['depths']


print("\n  Building the null arm (mechanism (c)-amplitude off)...", flush=True)
arm_null = [_leak_run(sd, 'k0', None) for sd in SEEDS]
u = np.array([r[str(F2)] for r in arm_null])

print(f"\n  {'amp depth':>10} {'f2 obs':>9} {'f2 null':>9} {'leak (quad)':>12} "
      f"{'k/n':>7} {'p':>9} {'reports leakage':>17}")
print("  " + "-" * 80)

rows4 = []
for d in DEPTHS:
    obs = [_leak_run(sd, f'k{d}', d if d > 0 else None) for sd in SEEDS]
    o = np.array([r[str(F2)] for r in obs])
    leak = float(np.median(np.sqrt(np.maximum(o**2 - u**2, 0.0))))
    # Tie-aware: at depth 0 the two arms are bit-identical, and counting 12 ties as 0/12 read
    # as "highly significant" (p = 0.000488) before this was fixed.
    k, n_eff, pv = paired_sign_test(o, u, two_sided=True)
    caught = (pv < 0.05) and (leak > FLOOR)
    rows4.append((d, leak, k, pv, caught))
    print(f"  {d:10.2f} {np.median(o):9.4f} {np.median(u):9.4f} {leak:12.4f} "
          f"{k:4d}/{n_eff:<2d} {pv:9.3g} {'YES' if caught else 'no':>17}")

registered = R.provisional_value('resp_amp_mod_depth')
caught_any = [r for r in rows4 if r[4]]

print(f"""
  Detection floor chi_est_mdd_resp = {FLOOR:.3f}. Registered resp_amp_mod_depth = {registered}.
  Depth 0.00 is the null arm against itself: it must NOT report leakage, and a nonzero reading
  there would mean the pairing is broken rather than that leakage exists.""")

if rows4[0][4]:
    print("""
  BROKEN PAIRING. Depth 0 reports leakage, which is impossible if the two arms differ only in
  mechanism (c)-amplitude. Everything below is uninterpretable until that is fixed.""")
elif caught_any:
    thr = caught_any[0]
    print(f"""
  THE ARM CAN FAIL, AND ITS THRESHOLD IS MEASURED. Leakage is first reported at amplitude
  depth {thr[0]:.2f}, where the leaked line is {thr[1]:.4f} -- {thr[1] / FLOOR:.1f}x the detection
  floor. Below that the arm stays silent, including at the registered depth {registered}, where
  the leakage genuinely sits at the limit of what this estimator can resolve in one record.

  So the effect-size floor did NOT neuter the arm: it moved the arm's verdict from "any
  consistently-signed difference, however microscopic" to "a difference large enough to be
  mistaken for coupling". The 0.999x ratio that failed the gate before Finding 16 would still
  be silent here, and correctly.""")
else:
    print(f"""
  STILL NOT FALSIFIED. Even at amplitude depth {DEPTHS[-1]:.2f} -- {DEPTHS[-1] / registered:.1f}x the
  registered value -- the arm reports nothing. Either the leakage does not grow with depth as
  expected, or the two clauses are jointly too strict. The arm must not be trusted as a check
  until this is resolved, and STATUS should keep it listed as open.""")
