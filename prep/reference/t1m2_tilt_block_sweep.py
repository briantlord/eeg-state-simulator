"""T1-M2a, part 3 -- deriving `tilt_block_s` from its two opposed constraints.

The A/B in t1m2_chi_generator_side.py established the mechanism: the blockwise tilt scheme holds
chi constant for `tilt_block_s`, and at the shipped 2.0 s only 48% of a 0.25 Hz modulation
survives generation. This probe picks the block length on evidence.

TWO CONSTRAINTS, PULLING OPPOSITE WAYS, both already measured elsewhere in the project:

  FIDELITY wants B SMALL. A hold of length B attenuates a modulation at f by roughly |sinc(fB)|,
  and `tiltBlockwise` stacks a second smoothing on top (overlap-add at a 0.75*B hop).

  SETTLING wants B LARGE. Each block filters its segment FROM ZERO STATE, so every block has a
  startup transient. It is masked only while the crossfade region -- overlap = B/4 -- is longer
  than the cascade's settling time, measured at t99 = 0.164 s (Finding 5). That gives
  B >= 4 * 0.164 = 0.66 s. Below it, transients leak into the output, and transient splatter at
  the block rate is exactly the sideband contamination the risk register rates High and G4 exists
  to catch.

So the derivation is: THE SMALLEST BLOCK THAT STILL HIDES ITS OWN SETTLING TRANSIENT. That is a
procedure, not a preference, and it is why this row can be `derived` rather than `chosen`.

WHAT THIS PROBE ADDS to the arithmetic: the arithmetic gives B >= 0.66 s, but it does not say
whether fidelity at 0.25 Hz is then acceptable, nor whether the second (overlap-add) smoothing
makes the sinc estimate optimistic. Both are measured here. The floor is measured too, because a
block length that improves the signal while raising the floor buys nothing.
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
READ_WINDOW_S = 0.5
#: t99 of the pole cascade, measured in Finding 5. Sets the lower bound via overlap = B/4.
T99_S = 0.164

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

const BLOCKS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
const F_MOD = [0.10, 0.25, 0.40];

const rows: unknown[] = [];
for (const B of BLOCKS) {
  for (const fMod of F_MOD) {
    for (const depth of [DEPTH, 0]) {
      for (let s = 0; s < nSeeds; s++) {
        const r = composeState(70000 + s * 313, 'n3', n, fs, {
          movementArtifact: false,
          amplitudeModulation: false,
          chiModulation: true,
          chiModDepth: depth,
          independentChiModFreq: fMod,
          tiltScheme: 'blockwise',
          tiltBlockS: B,
        });
        const ref = applyReference(r.channels, 'linked-mastoid');
        const pz = ref.channels[ref.labels.indexOf('Pz')]!;
        const { chi, fsEst } = chiOverTime(pz, fs, W);
        rows.push({ B, fMod, depth, recovered: modulationDepth(chi, fsEst, fMod) });
      }
    }
  }
}
process.stdout.write(JSON.stringify({ BLOCKS, F_MOD, T, rows }));
'''

f = ROOT / '.t1m2-blocksweep.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings', str(f),
     str(PROBE_DEPTH), str(N_SEEDS), str(READ_WINDOW_S)],
    cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
rows, BLOCKS, F_MOD, T = d['rows'], d['BLOCKS'], d['F_MOD'], d['T']


def med(B, fMod, depth):
    v = [r['recovered'] for r in rows
         if r['B'] == B and r['fMod'] == fMod and r['depth'] == depth]
    v = [x for x in v if np.isfinite(x)]
    return float(np.median(v)) if v else float('nan')


bound = 4 * T99_S
print(f"tilt_block_s derivation -- blockwise scheme, N3, {T:.0f} s, Pz, {N_SEEDS} seeds")
print(f"injected depth {PROBE_DEPTH}, read at W = {READ_WINDOW_S} s\n")
print(f"Settling lower bound: overlap = B/4 must exceed t99 = {T99_S} s  =>  "
      f"B >= {bound:.2f} s\n")

print("1. RECOVERED DEPTH by block length and modulation frequency\n")
hdr = f"  {'B (s)':>7} {'overlap':>8} {'hides t99':>10}" + "".join(
    f"{'f=' + format(fm, '.2f'):>12}" for fm in F_MOD)
print(hdr)
print("  " + "-" * (len(hdr) - 2))
for B in BLOCKS:
    ov = B / 4
    flag = 'yes' if ov >= T99_S else 'NO'
    print(f"  {B:7.2f} {ov:8.3f} {flag:>10}" + "".join(
        f"{med(B, fm, PROBE_DEPTH):12.4f}" for fm in F_MOD))

print("\n2. ACHIEVED FRACTION relative to the shortest VIABLE block "
      f"(B >= {bound:.2f} s)\n")
viable = [B for B in BLOCKS if B / 4 >= T99_S]
ref_B = min(viable)
hdr2 = f"  {'B (s)':>7}" + "".join(f"{'f=' + format(fm, '.2f'):>12}" for fm in F_MOD) \
    + f"{'|sinc| @0.25':>14}"
print(hdr2)
print("  " + "-" * (len(hdr2) - 2))
for B in BLOCKS:
    cells = "".join(
        f"{med(B, fm, PROBE_DEPTH) / med(ref_B, fm, PROBE_DEPTH):12.3f}" for fm in F_MOD)
    print(f"  {B:7.2f}" + cells + f"{abs(np.sinc(0.25 * B)):14.3f}")

print("\n3. NOISE FLOOR (depth 0) -- a shorter block must not buy signal with noise\n")
hdr3 = f"  {'B (s)':>7}" + "".join(f"{'f=' + format(fm, '.2f'):>12}" for fm in F_MOD)
print(hdr3)
print("  " + "-" * (len(hdr3) - 2))
for B in BLOCKS:
    print(f"  {B:7.2f}" + "".join(f"{med(B, fm, 0):12.4f}" for fm in F_MOD))

print("\n4. MINIMUM DETECTABLE DEPTH at the respiratory rate (0.25 Hz), "
      "model-free\n")
print(f"  {'B (s)':>7} {'viable':>8} {'min detectable depth':>22}")
print("  " + "-" * 40)
best = (None, np.inf)
for B in BLOCKS:
    sig = med(B, 0.25, PROBE_DEPTH)
    flo = med(B, 0.25, 0)
    mdd = PROBE_DEPTH * flo / sig if sig > 0 else np.inf
    ok = B / 4 >= T99_S
    if ok and mdd < best[1]:
        best = (B, mdd)
    print(f"  {B:7.2f} {'yes' if ok else 'NO':>8} {mdd:22.3f}")

print(f"\n  Best VIABLE block: B = {best[0]} s, minimum detectable depth {best[1]:.3f}")
print(f"  Shipped B = 2.0 s gives "
      f"{PROBE_DEPTH * med(2.0, 0.25, 0) / med(2.0, 0.25, PROBE_DEPTH):.3f}.")
print(f"  Registry chi_mod_depth (provisional) = 0.15.")
gain = (PROBE_DEPTH * med(2.0, 0.25, 0) / med(2.0, 0.25, PROBE_DEPTH)) / best[1]
print(f"\n  => tilt_block_s = {best[0]} improves detectability at the respiratory rate by "
      f"{gain:.1f}x")
print(f"     over the shipped 2.0 s, while still hiding its own settling transient.")
