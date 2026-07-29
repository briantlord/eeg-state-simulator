"""T1-M2a, part 2 -- is the chi attenuation the ESTIMATOR or the GENERATOR?

t1m2_chi_transfer.py swept modulation frequency against analysis window and found the recovered
depth collapsing at high f_mod. It then reported two conclusions that DO NOT SURVIVE INSPECTION,
recorded here because the error is instructive:

  "TRACKS THE SINC PREDICTION (median |err| 0.100)". The median masked a systematic failure. At
  W = 0.5 s, where a sliding window attenuates almost nothing, measured/predicted was 0.47/0.97
  at 0.25 Hz and 0.10/0.94 at 0.40 Hz. Something W-INDEPENDENT is removing the modulation, and a
  median over a grid whose low-frequency corner is all 1.00/1.00 cannot see it.

  "0.15 is detectable at W = 8 s". Arithmetic inconsistency: the minimum-detectable-depth formula
  divided the measured floor by the PREDICTED sinc attenuation while the MEASURED attenuation at
  that cell was 5x smaller. Recomputed model-free as depth x floor/recovered, W = 8 s is the
  WORST cell (0.127), not the best.

Harness section 4 is explicit that the quantity of interest is what "the ESTIMATOR, NOT THE
GENERATOR, determines" -- so separating them is not a detail, it is the measurement.

THE SUSPECT. `applyTimeVaryingTilt` defaults to `blockwise` with `blockSamples = 2 * fs` -- chi
is held CONSTANT for 2 s at a time, a sample-and-hold staircase. At the respiratory rate of
0.25 Hz that is two blocks per cycle; at 0.40 Hz, 1.25. A hold of length B attenuates a sinusoid
at f by |sinc(f B)|, entirely inside the generator and before any estimator sees it.

THE TEST is an A/B on a switch that already exists. `filterbank` interpolates between 17
pre-filtered levels PER SAMPLE, so it has no staircase. Read out with the same proxy at the same
short window in both arms: whatever bias the readout has, it is identical in both and cancels in
the ratio. If the collapse is generator-side it disappears under `filterbank`; if it is the
estimator, both arms collapse together.

WHY IT MATTERS BEYOND TIDINESS. The epoch sidecar records `truth.chiModDepth` as the REQUESTED
depth. Every recovery gate compares against that number. If the generator delivers half of it at
the respiratory rate, then the sidecar overstates what was injected -- the same class of defect
as the k_* rows that contradicted their own basis (D11), where truth disagreed with what was
generated and no per-row check could see it.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

PROBE_DEPTH = 2.0
N_SEEDS = 4
#: Short enough that the estimator's own sinc attenuation is small and, crucially, IDENTICAL
#: across the two schemes -- so it cancels when the arms are compared.
READ_WINDOW_S = 0.5

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { chiOverTime, modulationDepth } from './src/analysis/coupling.ts';
import { scalarValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const T = scalarValue('g4_record_length');
const n = Math.round(T * fs);
const DEPTH = Number(process.argv[2]);
const nSeeds = Number(process.argv[3]);
const W = Number(process.argv[4]);

const F_MOD = [0.05, 0.10, 0.15, 0.25, 0.40];
const SCHEMES = ['blockwise', 'filterbank'] as const;

const rows: unknown[] = [];
for (const scheme of SCHEMES) {
  for (const fMod of F_MOD) {
    for (const depth of [DEPTH, 0]) {
      for (let s = 0; s < nSeeds; s++) {
        const r = composeState(70000 + s * 313, 'n3', n, fs, {
          movementArtifact: false,
          amplitudeModulation: false,
          chiModulation: true,
          chiModDepth: depth,
          independentChiModFreq: fMod,
          tiltScheme: scheme,
        });
        const ref = applyReference(r.channels, 'linked-mastoid');
        const pz = ref.channels[ref.labels.indexOf('Pz')]!;
        const { chi, fsEst } = chiOverTime(pz, fs, W);
        rows.push({ scheme, fMod, depth, seed: s,
                    recovered: modulationDepth(chi, fsEst, fMod) });
      }
    }
  }
}
process.stdout.write(JSON.stringify({ fs, T, F_MOD, SCHEMES, W, rows }));
'''

f = ROOT / '.t1m2-genside.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings', str(f),
     str(PROBE_DEPTH), str(N_SEEDS), str(READ_WINDOW_S)],
    cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
rows, F_MOD, SCHEMES, T = d['rows'], d['F_MOD'], d['SCHEMES'], d['T']


def med(scheme, fMod, depth):
    v = [r['recovered'] for r in rows
         if r['scheme'] == scheme and r['fMod'] == fMod and r['depth'] == depth]
    v = [x for x in v if np.isfinite(x)]
    return float(np.median(v)) if v else float('nan')


print(f"Generator-side vs estimator-side chi attenuation")
print(f"N3, {T:.0f} s, Pz, linked mastoid, {N_SEEDS} seeds, injected depth {PROBE_DEPTH},")
print(f"read with the shipped proxy at W = {READ_WINDOW_S} s in BOTH arms.\n")

print("1. RECOVERED DEPTH by coefficient-update scheme\n")
print(f"  {'f_mod (Hz)':>11} {'blockwise':>12} {'filterbank':>12} {'fb/bw':>8}   "
      f"{'|sinc(2f)|':>10}")
print("  " + "-" * 60)
for fm in F_MOD:
    bw = med('blockwise', fm, PROBE_DEPTH)
    fb = med('filterbank', fm, PROBE_DEPTH)
    print(f"  {fm:11.2f} {bw:12.4f} {fb:12.4f} {fb/bw:8.2f}   "
          f"{abs(np.sinc(fm * 2.0)):10.4f}")

# Normalise each scheme by its own lowest-frequency value: that is the achieved fraction,
# with the readout's fixed bias divided out.
print("\n2. ACHIEVED FRACTION (each scheme normalised to its own 0.05 Hz value)\n")
print(f"  {'f_mod (Hz)':>11} {'blockwise':>12} {'filterbank':>12}   {'|sinc(2f)|':>10}")
print("  " + "-" * 52)
bw0 = med('blockwise', F_MOD[0], PROBE_DEPTH)
fb0 = med('filterbank', F_MOD[0], PROBE_DEPTH)
for fm in F_MOD:
    bwf = med('blockwise', fm, PROBE_DEPTH) / bw0
    fbf = med('filterbank', fm, PROBE_DEPTH) / fb0
    print(f"  {fm:11.2f} {bwf:12.3f} {fbf:12.3f}   {abs(np.sinc(fm * 2.0)):10.3f}")

resp = 0.25
bw_resp = med('blockwise', resp, PROBE_DEPTH) / bw0
fb_resp = med('filterbank', resp, PROBE_DEPTH) / fb0
print(f"\n  At the RESPIRATORY RATE ({resp} Hz): blockwise retains {bw_resp:.0%}, "
      f"filterbank {fb_resp:.0%}.")

if fb_resp > bw_resp + 0.15:
    print(f"\n  GENERATOR-SIDE, AND FIXABLE. The 2 s coefficient hold is the dominant cause:")
    print(f"  switching to per-sample interpolation recovers "
          f"{fb_resp - bw_resp:+.0%} at the respiratory rate with no change to the estimator.")
    print(f"  `truth.chiModDepth` therefore OVERSTATES what blockwise actually injects, and")
    print(f"  every gate that compares against it inherits the overstatement.")
elif abs(fb_resp - bw_resp) <= 0.15:
    print(f"\n  NOT THE COEFFICIENT HOLD. Both schemes lose the same amount, so the staircase")
    print(f"  is not the cause and the loss is either the tilt filter's settling or the")
    print(f"  estimator after all. The next probe must separate those.")

# --------------------------------------- 3. model-free minimum detectable depth
print(f"\n3. MINIMUM DETECTABLE DEPTH, model-free: depth x floor / recovered\n")
print("  The injected true-chi depth at which the recovered line equals the noise floor.")
print("  No sinc, no unit-scale, no fitted correction -- just the measured signal-to-floor.\n")
print(f"  {'f_mod (Hz)':>11} {'blockwise':>12} {'filterbank':>12}")
print("  " + "-" * 38)
for fm in F_MOD:
    cells = []
    for sc in SCHEMES:
        sig = med(sc, fm, PROBE_DEPTH)
        flo = med(sc, fm, 0)
        cells.append(PROBE_DEPTH * flo / sig if sig > 0 else np.inf)
    print(f"  {fm:11.2f} {cells[0]:12.3f} {cells[1]:12.3f}")

print(f"\n  The registry's provisional chi_mod_depth is 0.15, and the shipped generator drives")
print(f"  chi from RESPIRATION -- i.e. at {resp} Hz, the worst column above.")
mdd_bw = PROBE_DEPTH * med('blockwise', resp, 0) / med('blockwise', resp, PROBE_DEPTH)
print(f"  Minimum detectable there, blockwise: {mdd_bw:.3f} against an injected 0.15 "
      f"({0.15/mdd_bw:.1f}x the floor).")
print(f"\n  So the shipped configuration sits just above its own detection floor -- which is")
print(f"  why Finding 13 measured 1.02x and why the ratio is so fragile. Two independent")
print(f"  fixes are now on the table (a faster coefficient update, and a shorter analysis")
print(f"  window), and they multiply rather than compete.")
