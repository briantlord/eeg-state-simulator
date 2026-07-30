"""Which component makes N3 rank 1?

compare_real.py: N3 effective rank 1.07 against a real 3.09, PC1 carrying 0.967 of the variance,
median |corr| 0.950. Every channel is very nearly the same trace scaled. wake_eo (3.64) and n2
(2.80) are close to real, so this is not a global defect -- something specific to N3 dominates.

Finding 11 fixed exactly this shape once already, for the aperiodic background: a SINGLE
uniformly-weighted source gave rank 1.14, and six spatially distinct sources took it to 2.99. The
question here is whether the same argument now applies to the OSCILLATION layer, where delta is
one source projected to every channel and its amplitude in N3 is large.

MEASURED BY REMOVAL, one layer at a time, because the alternative is arguing from amplitudes.
Each row rebuilds the signal with one contribution suppressed and reports what the rank becomes.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REAL_RANK = 3.09

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const n = fs * 120;
const out: Record<string, number[][]> = {};

// snrDb scales every non-background source -- oscillations AND graphoelements -- against the
// aperiodic background, which is held fixed. So a large negative snrDb isolates the background,
// and suppressGraphoelements isolates the oscillation layer from the event layer.
const CASES: Record<string, Record<string, unknown>> = {
  'as shipped': {},
  'no graphoelements': { suppressGraphoelements: true },
  'background only (snr -60 dB)': { snrDb: -60 },
  'oscillations only, no events': { suppressGraphoelements: true },
};

for (const state of ['n3', 'n2', 'wake_ec'] as const) {
  for (const [name, opts] of Object.entries(CASES)) {
    const r = composeState(4242, state, n, fs, opts);
    const ref = applyReference(r.channels, 'linked-mastoid');
    out[`${state}|${name}`] = ref.channels.map((c) => [...c]);
  }
}
process.stdout.write(JSON.stringify({ fs, out }));
'''

f = ROOT / '.rank-decomp.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                    '--max-old-space-size=8192', str(f)], cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:2500])
d = json.loads(p.stdout)


def stats(mat):
    x = np.asarray(mat, dtype=float)
    x = x - x.mean(axis=1, keepdims=True)
    lam = np.linalg.eigvalsh(np.cov(x))
    lam = lam[lam > 0]
    eff = float(lam.sum() ** 2 / (lam ** 2).sum())
    c = np.corrcoef(x)
    iu = np.triu_indices(len(x), 1)
    return eff, float(lam.max() / lam.sum()), float(np.median(np.abs(c[iu])))


print(f"Effective rank by layer, linked-mastoid, 120 s. Real resting rank {REAL_RANK:.2f}.\n")
print(f"  {'state':>8} {'configuration':>30} {'rank':>7} {'PC1':>7} {'|corr|':>8}")
print("  " + "-" * 64)
seen = set()
for key, mat in d['out'].items():
    state, name = key.split('|')
    if key in seen:
        continue
    seen.add(key)
    eff, pc1, med = stats(mat)
    print(f"  {state:>8} {name:>30} {eff:7.2f} {pc1:7.3f} {med:8.3f}")

print(f"""
  READ THE 'background only' ROW AGAINST 'as shipped'. The background layer was rebuilt in
  Finding 11 as six spatially distinct sources plus a global common mode, and its rank is the
  ceiling any state can reach. If the background alone is near the real 3.09 while the shipped
  signal is near 1, then the layer added on top is a single dominant source -- the same defect
  Finding 11 fixed, one layer up.

  'no graphoelements' separates the continuous band oscillation from the injected events. If
  removing events barely moves the rank, the oscillation is the culprit rather than the spindles
  and slow waves.""")
