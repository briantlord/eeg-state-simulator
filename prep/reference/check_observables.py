"""The two observable axes across states, and how correlated they are.

Build Plan §7 sets two traps and this checks both:

  "DO NOT ASSUME MONOTONIC ORDERINGS. LZc rises from N1 to N2 and is less stage-modulated
  than slope. Narrowband slope steepens across all sleep stages with a small reversal in N3.
  TREAT A CLEAN LADDER FROM WAKE DOWN TO N3 AS A BUG."

  "COLLINEARITY IS A DOCUMENTED OPEN QUESTION, not merely a design worry -- investigators
  have asked in print whether LZc adds anything over the aperiodic exponent. Display the
  correlation between axes across landmarks."

A monotone ladder here would mean the generator is producing a one-dimensional story dressed
up as two axes. So would a near-perfect correlation between the axes.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
STATES = R.STATES

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { broadbandExponent, narrowbandExponent } from './src/analysis/psd.ts';
import { lempelZiv } from './src/analysis/lz.ts';
import { Rng } from './src/core/rng/xoshiro128pp.ts';
import { CHANNELS } from './src/core/generators/projection.ts';

const fs = 256, n = fs * 30;
const rows = [];
for (const state of %(states)s) {
  for (let s = 0; s < %(nseeds)d; s++) {
    const r = composeState(3000 + s, state, n, fs);
    const pz = r.channels[CHANNELS.indexOf('Pz')];
    const broad = broadbandExponent(pz, fs);
    const narrow = narrowbandExponent(pz, fs);
    // LZc over a 4-channel subset: the full 19 is slow and the ordering is what matters here.
    const subset = ['Fz','Cz','Pz','O1'].map(c => r.channels[CHANNELS.indexOf(c)]);
    const lz = lempelZiv(subset, Rng.substream(5000 + s, 'lz'), 'lzw');
    rows.push({ state, seed: s, chiBroad: broad.value, knee: broad.knee,
                chiNarrow: narrow.value, lzc: lz.normalized });
  }
}
process.stdout.write(JSON.stringify(rows));
'''

src = HARNESS % dict(states=str(list(STATES)).replace("'", "'"), nseeds=8)
f = ROOT / '.obs-probe.mts'
f.write_text(src, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f)],
                   cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:2000])

import json
rows = json.loads(p.stdout)

print("Two observable axes, 8 seeds per state, 30 s at Pz\n")
print(f"  {'state':9} {'chi broad':>10} {'chi narrow':>11} {'LZc norm':>10}")
print("  " + "-" * 44)
med = {}
for st in STATES:
    r = [x for x in rows if x['state'] == st]
    cb = np.median([x['chiBroad'] for x in r])
    cn = np.median([x['chiNarrow'] for x in r])
    lz = np.median([x['lzc'] for x in r])
    med[st] = (cb, cn, lz)
    print(f"  {st:9} {cb:10.3f} {cn:11.3f} {lz:10.4f}")

print("\nORDERING CHECKS  (a clean ladder is a BUG, per Build Plan §7)")
sleep = ['wake_ec', 'n1', 'n2', 'n3']
cn_seq = [med[s][1] for s in sleep]
lz_seq = [med[s][2] for s in sleep]
mono = all(b > a for a, b in zip(cn_seq, cn_seq[1:]))
print(f"  narrowband chi wake->N3 monotone increasing? {mono}"
      f"   {'<-- SUSPICIOUS' if mono else '(good: not a clean ladder)'}")
lz_mono = all(b < a for a, b in zip(lz_seq, lz_seq[1:]))
print(f"  LZc wake->N3 monotone decreasing?            {lz_mono}"
      f"   {'<-- SUSPICIOUS' if lz_mono else '(good)'}")
print(f"  LZc N1 -> N2 rises (documented)?             {med['n2'][2] > med['n1'][2]}")

print("\nCOLLINEARITY BETWEEN AXES  (the documented open question)")
cb = np.array([x['chiBroad'] for x in rows])
cn = np.array([x['chiNarrow'] for x in rows])
lz = np.array([x['lzc'] for x in rows])
print(f"  corr(chi_broad,  LZc) = {np.corrcoef(cb, lz)[0,1]:+.3f}")
print(f"  corr(chi_narrow, LZc) = {np.corrcoef(cn, lz)[0,1]:+.3f}")
print(f"  corr(chi_broad, chi_narrow) = {np.corrcoef(cb, cn)[0,1]:+.3f}")
print("\n  |r| near 1 between an exponent and LZc would mean the second axis adds nothing,")
print("  which is exactly what investigators have asked in print. The artifact must display")
print("  this number rather than hide it.")
