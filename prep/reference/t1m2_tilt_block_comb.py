"""T1-M2a, part 4 -- does a shorter tilt block deposit a comb at the block rate?

The block sweep found B = 0.75 s recovers 2.1x the detectable modulation depth of the shipped
2.0 s at the respiratory rate. Before adopting it, the risk it trades against must be measured,
and the sweep's own noise-floor column DID NOT MEASURE IT.

WHY THAT COLUMN WAS VACUOUS, stated plainly because it looked like a safety check and was not.
It reported the floor at chi_mod_depth = 0, where delta-chi is constant -- so every block applies
the SAME tilt, there are no coefficient changes, and no transient can occur. The floor came out
bit-identical across all seven block lengths, which should have been the tell. The settling
concern is about transients when delta-chi CHANGES between blocks, and that only happens with
modulation on.

WHAT TO MEASURE INSTEAD. Each block filters from zero state and is overlap-added at a hop of
0.75*B. If the startup transient is not fully hidden by the crossfade, the residual repeats at
the HOP RATE and deposits a comb at k/hop. This is the failure mode with real precedent in the
project: Finding 8 found exactly such a comb at the epoch boundary, k/30 Hz, and it landed on
g4_f1 = 0.10 Hz as harmonic 3 -- a pure export artefact masquerading as the signal G4 measures.
A comb from the tilt block would sit at 1/(0.75*B): 1.78 Hz at B = 0.75 s, which is INSIDE the
N3 delta band and inside chi-hat's 2-8 Hz low band.

ISOLATING IT. Modulation genuinely changes the spectrum over time, so a modulated/unmodulated
PSD ratio is not 1 broadly and a raw ratio proves nothing. A comb, however, is NARROWBAND: the
test is whether that ratio spikes AT k/hop relative to its own local neighbourhood. Excess is
reported in dB against the median ratio in a guard band either side, so the broadband effect of
modulation divides out.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]

PROBE_DEPTH = 2.0      # worst case: the largest delta-chi swing, so the largest transient
N_SEEDS = 3
F_MOD = 0.25           # the respiratory rate, where the attenuation fix matters
BLOCKS = [0.5, 0.75, 1.0, 2.0]

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const T = scalarValue('g4_record_length');
const n = Math.round(T * fs);
const DEPTH = Number(process.argv[2]);
const nSeeds = Number(process.argv[3]);
const fMod = Number(process.argv[4]);
const BLOCKS = JSON.parse(process.argv[5]) as number[];

const out: Record<string, number[][]> = {};
for (const B of BLOCKS) {
  for (const depth of [DEPTH, 0]) {
    const key = `${B}|${depth}`;
    out[key] = [];
    for (let s = 0; s < nSeeds; s++) {
      const r = composeState(70000 + s * 313, 'n3', n, fs, {
        movementArtifact: false, amplitudeModulation: false,
        chiModulation: true, chiModDepth: depth, independentChiModFreq: fMod,
        tiltScheme: 'blockwise', tiltBlockS: B,
      });
      const ref = applyReference(r.channels, 'linked-mastoid');
      out[key]!.push([...ref.channels[ref.labels.indexOf('Pz')]!]);
    }
  }
}
process.stdout.write(JSON.stringify({ fs, out }));
'''

f = ROOT / '.t1m2-comb.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings', '--max-old-space-size=4096', str(f),
     str(PROBE_DEPTH), str(N_SEEDS), str(F_MOD), json.dumps(BLOCKS)],
    cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
fs = d['fs']


def js_num(x: float) -> str:
    """Format a number the way JS `String(n)` does: 2.0 -> '2', 0.75 -> '0.75'.

    The harness keys its output with a JS template literal, so Python must reproduce that
    formatting exactly or every lookup misses. It did, on the first run -- a KeyError on
    '0.5|2.0' against a stored '0.5|2'.
    """
    return str(int(x)) if float(x).is_integer() else str(x)


def psd(key):
    """Mean Welch PSD over seeds. 8 s segments: fine enough to resolve a comb line."""
    acc = None
    for tr in d['out'][key]:
        x = np.asarray(tr, dtype=float)
        fr, pp = sps.welch(x, fs=fs, nperseg=int(8 * fs), noverlap=int(4 * fs))
        acc = pp if acc is None else acc + pp
    return fr, acc / len(d['out'][key])


def excess_db(fr, ratio, f0, guard=(0.15, 0.6)):
    """Narrowband excess of `ratio` at f0, in dB above its own local neighbourhood.

    The guard band is offset from f0 so the line itself is excluded from its own baseline.
    """
    lo, hi = guard
    near = (np.abs(fr - f0) <= lo)
    ring = (np.abs(fr - f0) > lo) & (np.abs(fr - f0) <= hi)
    if near.sum() == 0 or ring.sum() < 3:
        return np.nan
    return 10 * np.log10(ratio[near].max() / np.median(ratio[ring]))


print(f"Tilt-block comb test -- N3, Pz, {N_SEEDS} seeds, chi modulated at {F_MOD} Hz, "
      f"depth {PROBE_DEPTH}")
print("Excess is dB of the modulated/unmodulated PSD ratio AT the hop rate, above its own")
print("local neighbourhood -- so the broadband effect of modulation divides out.\n")

print(f"  {'B (s)':>7} {'hop (s)':>8} {'hop rate':>9} " +
      "".join(f"{'k=' + str(k):>9}" for k in (1, 2, 3)) + f"{'  worst':>9}")
print("  " + "-" * 62)

results = {}
for B in BLOCKS:
    fr, p_mod = psd(f"{js_num(B)}|{js_num(PROBE_DEPTH)}")
    _, p_ref = psd(f"{js_num(B)}|0")
    ratio = p_mod / np.maximum(p_ref, 1e-30)
    hop = 0.75 * B
    rate = 1.0 / hop
    cells, worst = [], -np.inf
    for k in (1, 2, 3):
        f0 = k * rate
        e = excess_db(fr, ratio, f0) if f0 < fs / 2 - 1 else np.nan
        cells.append(e)
        if np.isfinite(e):
            worst = max(worst, e)
    results[B] = worst
    print(f"  {B:7.2f} {hop:8.3f} {rate:9.2f} " +
          "".join(f"{c:9.2f}" if np.isfinite(c) else f"{'--':>9}" for c in cells) +
          f"{worst:9.2f}")

print("\n  A comb would show as a large positive excess at k=1 and its harmonics. For scale,")
print("  Finding 8's epoch-boundary comb was the artefact that forced continuous synthesis.\n")

shipped = results[2.0]
cand = results[0.75]
print(f"  Shipped B = 2.0 s : worst excess {shipped:+.2f} dB")
print(f"  Candidate B = 0.75 s: worst excess {cand:+.2f} dB")

THRESH = 3.0
if cand <= THRESH and cand <= shipped + THRESH:
    print(f"\n  NO COMB INTRODUCED. The candidate's narrowband excess is within {THRESH:.0f} dB of")
    print(f"  the shipped block's, so the 2.1x detectability gain is not bought with sideband")
    print(f"  contamination. The overlap >= t99 bound is doing its job.")
else:
    print(f"\n  COMB PRESENT at the shorter block ({cand:+.2f} dB). The overlap >= t99 bound is")
    print(f"  NOT sufficient, and B = 0.75 s must not be adopted on the attenuation argument")
    print(f"  alone -- transient splatter at {1/(0.75*0.75):.2f} Hz sits inside the N3 delta band")
    print(f"  and inside chi-hat's 2-8 Hz low band.")
