"""T1-M2a -- the transfer function of the chi(t) estimator.

Harness section 4: "sliding-window smoothing comparable to a ~4 s respiratory cycle will
attenuate recovered modulation depth by an amount THE ESTIMATOR, NOT THE GENERATOR, determines.
Characterize the transfer function across modulation frequencies; then gate on corrected depth,
or on phase."

WHY THIS IS THE FIRST T1 MEASUREMENT. Two Tier 0 findings say the estimator is the binding
constraint, not the generator:

  Finding 13 -- at the shipped chi_mod_depth = 0.15 the recovered line is 1.02x its own null.
                G4 has to inject 13x that depth to have anything to attribute, and Demo 1's
                (c) row is consequently reading the amplitude half, not the exponent half.
  Finding 14 -- G1b's narrowband noise floor (sd 0.18-0.23) exceeds the chi spacing between
                adjacent states (0.30).

Neither is fixable by fitting parameters more carefully, which is why T1-M2 was promoted above
T1-M1. This probe measures the first one properly.

THE ESTIMATOR CHARACTERIZED IS THE ONE WE SHIP. The spec names SPRiNT; SPRiNT is specparam
applied in sliding windows, and what Tier 0 ships is a deliberately cheap two-band log-power
ratio (src/analysis/coupling.ts chiOverTime, labelled a proxy in its own docstring). The gate and
the artifact both read the proxy, so the proxy is what determines what they may claim. A
companion probe anchors it against specparam-per-window.

DECOMPOSITION, which is the point. The measured "gain" of recovered/injected conflates two
different things, and reporting them together would hide the correctable half:

  UNIT SCALE   the proxy's chi-units per true-chi unit. A fixed calibration constant; it does
               not depend on the modulation frequency. Estimated at the short-window,
               low-frequency corner where attenuation -> 1.
  ATTENUATION  the temporal transfer function H(f, W) of the sliding window. THIS is what the
               spec asks for, and it is correctable if it has an analytic form.

ANALYTIC PREDICTION, tested rather than assumed. A sliding average of length W attenuates a
sinusoid at frequency f by |sinc(pi f W)| = |sin(pi f W) / (pi f W)|. Welch power over a window
is approximately such an average, so if the measured attenuation tracks |sinc| then the transfer
function is KNOWN, not merely observed, and the spec's "gate on corrected depth" becomes
available. If it does not track, the honest conclusion is that only "gate on phase" remains.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

#: A depth far above the noise floor, so the measurement reads GAIN rather than detectability.
#: Deliberately not the shipped 0.15 -- at that depth there is nothing to measure, which is the
#: finding this probe exists to explain.
PROBE_DEPTH = 2.0

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

const F_MOD = [0.02, 0.05, 0.10, 0.15, 0.25, 0.40];
const WINDOWS = [0.5, 1, 2, 4, 8];

// The signal depends on f_mod and depth but NOT on the analysis window, so generate once per
// (f_mod, depth) and re-analyse. Respiratory mechanisms are OFF throughout: the independent
// chi modulator is then the only thing at f_mod, so nothing else can contribute to the line.
const rows: unknown[] = [];
for (const fMod of F_MOD) {
  for (const depth of [DEPTH, 0]) {
    for (let s = 0; s < nSeeds; s++) {
      const r = composeState(70000 + s * 313, 'n3', n, fs, {
        movementArtifact: false,
        amplitudeModulation: false,
        chiModulation: true,
        chiModDepth: depth,
        independentChiModFreq: fMod,
      });
      const ref = applyReference(r.channels, 'linked-mastoid');
      const pz = ref.channels[ref.labels.indexOf('Pz')]!;
      for (const w of WINDOWS) {
        const { chi, fsEst } = chiOverTime(pz, fs, w);
        rows.push({
          fMod, depth, seed: s, windowS: w,
          recovered: modulationDepth(chi, fsEst, fMod),
        });
      }
    }
  }
}
process.stdout.write(JSON.stringify({ fs, T, F_MOD, WINDOWS, rows }));
'''

N_SEEDS = 4

f = ROOT / '.t1m2-transfer.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings', str(f),
     str(PROBE_DEPTH), str(N_SEEDS)],
    cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
rows = d['rows']
F_MOD, WINDOWS, T = d['F_MOD'], d['WINDOWS'], d['T']


def med(fMod, w, depth):
    v = [r['recovered'] for r in rows
         if r['fMod'] == fMod and r['windowS'] == w and r['depth'] == depth]
    v = [x for x in v if np.isfinite(x)]
    return float(np.median(v)) if v else float('nan')


print(f"chi(t) estimator transfer function -- the SHIPPED two-band proxy")
print(f"N3, {T:.0f} s, Pz, linked mastoid, {N_SEEDS} seeds, injected depth {PROBE_DEPTH}")
print(f"Respiratory mechanisms OFF; chi driven by an independent modulator at f_mod.\n")

# ---------------------------------------------------------------- 1. raw gain
print("1. RECOVERED DEPTH (proxy chi-units) at injected depth "
      f"{PROBE_DEPTH}, and the depth-0 floor\n")
hdr = "  f_mod (Hz) " + "".join(f"{w:>10.1f}s" for w in WINDOWS)
print(hdr)
print("  " + "-" * (len(hdr) - 2))
for fm in F_MOD:
    line = f"  {fm:10.2f} " + "".join(f"{med(fm, w, PROBE_DEPTH):11.4f}" for w in WINDOWS)
    print(line)
print("\n  floor (depth 0):")
for fm in F_MOD:
    print(f"  {fm:10.2f} " + "".join(f"{med(fm, w, 0):11.4f}" for w in WINDOWS))

# ------------------------------------------------- 2. decomposition
# Unit scale: the short-window, low-frequency corner, where sinc attenuation ~ 1.
w0, f0 = WINDOWS[0], F_MOD[0]
sinc0 = abs(np.sinc(f0 * w0))          # np.sinc(x) = sin(pi x)/(pi x)
unit_scale = med(f0, w0, PROBE_DEPTH) / (PROBE_DEPTH * sinc0)

print(f"\n2. DECOMPOSITION\n")
print(f"  Unit scale, from the (f={f0} Hz, W={w0} s) corner where |sinc| = {sinc0:.4f}:")
print(f"    {unit_scale:.4f} proxy chi-units per true chi-unit")
print(f"    The proxy is a two-band log ratio, not a calibrated chi, so this is expected to")
print(f"    differ from 1 -- and it is why 'recovered 0.238 vs injected 0.15' in Demo 1 was")
print(f"    never a like-for-like comparison.\n")

print("  MEASURED attenuation (recovered / (unit_scale * injected)) vs |sinc(pi f W)|:\n")
hdr2 = "  f_mod (Hz) " + "".join(f"{w:>9.1f}s m/p" for w in WINDOWS)
print(hdr2)
print("  " + "-" * (len(hdr2) - 2))
resid = []
for fm in F_MOD:
    cells = []
    for w in WINDOWS:
        meas = med(fm, w, PROBE_DEPTH) / (unit_scale * PROBE_DEPTH)
        pred = abs(np.sinc(fm * w))
        resid.append((meas, pred))
        cells.append(f"  {meas:5.2f}/{pred:4.2f}")
    print(f"  {fm:10.2f} " + "".join(cells))

meas_a = np.array([m for m, _ in resid])
pred_a = np.array([p for _, p in resid])
ok = np.isfinite(meas_a) & (pred_a > 0.05)   # ignore sinc nulls, where the ratio is unstable
err = np.abs(meas_a[ok] - pred_a[ok])
print(f"\n  |measured - sinc| over the {ok.sum()} cells with |sinc| > 0.05: "
      f"median {np.median(err):.3f}, max {err.max():.3f}")
if np.median(err) < 0.15:
    print("  TRACKS THE SINC PREDICTION. The transfer function is analytic, so recovered depth")
    print("  CAN be corrected -- the spec's 'gate on corrected depth' is available.")
else:
    print("  DOES NOT track |sinc| closely. Correction by the analytic form is not justified;")
    print("  the spec's fallback of gating on PHASE rather than depth is what remains.")

# --------------------------------------- 3. the number the project actually needs
print(f"\n3. MINIMUM DETECTABLE DEPTH = floor / (unit_scale * attenuation)\n")
print("  The true-chi modulation depth whose recovered line equals the noise floor. Below")
print("  this the estimator cannot see the modulation at all, whatever the generator injects.\n")
hdr3 = "  f_mod (Hz) " + "".join(f"{w:>10.1f}s" for w in WINDOWS)
print(hdr3)
print("  " + "-" * (len(hdr3) - 2))
best = (None, None, np.inf)
for fm in F_MOD:
    cells = []
    for w in WINDOWS:
        att = abs(np.sinc(fm * w))
        mdd = med(fm, w, 0) / (unit_scale * att) if att > 1e-6 else np.inf
        if np.isfinite(mdd) and mdd < best[2]:
            best = (fm, w, mdd)
        cells.append(f"{mdd:11.3f}")
    print(f"  {fm:10.2f} " + "".join(cells))

print(f"\n  Best case over this grid: {best[2]:.3f} at f_mod = {best[0]} Hz, W = {best[1]} s.")
print(f"  The registry's provisional chi_mod_depth is 0.15.")
if best[2] > 0.15:
    print(f"  => 0.15 IS BELOW THE FLOOR EVERYWHERE ON THIS GRID ({best[2]/0.15:.1f}x short at best).")
    print("     No window choice rescues it; the proxy needs replacing, not retuning.")
else:
    print(f"  => 0.15 is detectable at f_mod = {best[0]} Hz with W = {best[1]} s. The Tier 0")
    print("     default window was simply the wrong choice, which is a retune, not a rebuild.")
