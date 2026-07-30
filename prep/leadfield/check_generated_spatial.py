"""The GENERATED signal against real, under both references (D19.1).

compare_real.py reports linked-mastoid, because that is the montage the artifact ships. D19.1
forbids FITTING against it: how much cortex a reference electrode sees is a property of the head
model, the real recordings used interconnected EARLOBES rather than mastoids, and under the
Gaussian it had been an invented row. Average reference is defined by the montage alone.

This measures the shipped generator both ways and compares each against the real recordings
measured the same way, so the two columns are like-for-like.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

#: probe_real_farfield_origin.py, 8 EEGMAT subjects, same montage.
REAL = {
    'linked': {'rank': 3.07, 'pc1': 0.535, 'near': 0.765, 'far': 0.437},
    'average': {'rank': 5.36, 'pc1': 0.369, 'near': 0.413, 'far': 0.257},
}

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const out = {};
for (const state of ['wake_ec', 'n2', 'n3']) {
  const r = composeState(4242, state, fs * 180, fs);
  const ref = applyReference(r.channels, 'linked-mastoid');
  out[state] = { labels: ref.labels, data: ref.channels.map((c) => [...c]) };
}
process.stdout.write(JSON.stringify(out));
'''

f = ROOT / '.spatial-probe.mts'
f.write_text(HARNESS, encoding='utf8')
try:
    p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                        '--max-old-space-size=8192', str(f)], cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(p.stderr.decode()[:1500])
    D = json.loads(p.stdout)
finally:
    f.unlink(missing_ok=True)

mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
P = {c['label']: (c['x'], c['y']) for c in mont['channels']}


def stats(x, labels):
    x = np.asarray(x, dtype=float)
    x = x - x.mean(axis=1, keepdims=True)
    lam = np.linalg.eigvalsh(np.cov(x))
    lam = lam[lam > 1e-12 * lam.max()]
    c = np.corrcoef(x)
    near, far = [], []
    for i, a in enumerate(labels):
        for j, b in enumerate(labels):
            if j <= i or a not in P or b not in P:
                continue
            d = np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])
            (near if d < 0.6 else far).append(abs(c[i, j]))
    return {'rank': float(lam.sum() ** 2 / (lam ** 2).sum()),
            'pc1': float(lam.max() / lam.sum()),
            'near': float(np.median(near)), 'far': float(np.median(far))}


print("Generated signal vs real, like-for-like under each reference.\n")
for refname in ('linked', 'average'):
    r = REAL[refname]
    label = 'LINKED MASTOID (reported; D19.1 forbids fitting)' if refname == 'linked' \
        else 'AVERAGE REFERENCE (the comparison that invents nothing)'
    print(f"  === {label} ===")
    print(f"  {'':<10}{'rank':>8}{'PC1':>8}{'near':>8}{'far':>8}{'err':>8}")
    print(f"  {'REAL':<10}{r['rank']:8.2f}{r['pc1']:8.3f}{r['near']:8.3f}{r['far']:8.3f}")
    for state, d in D.items():
        x = np.asarray(d['data'], dtype=float)
        if refname == 'average':
            x = x - x.mean(axis=0, keepdims=True)
        s = stats(x, d['labels'])
        e = float(np.mean([abs(s[k] - r[k]) / r[k] for k in r]))
        print(f"  {state:<10}{s['rank']:8.2f}{s['pc1']:8.3f}{s['near']:8.3f}{s['far']:8.3f}{e:8.3f}")
    print()

print("""  wake_ec carries the comparison: EEGMAT is resting wake and contains no N2 or N3, so those
  rows are sanity bounds rather than fits. A disagreement under LINKED MASTOID that disappears
  under AVERAGE REFERENCE is evidence about the reference electrodes -- real interconnected
  earlobes sit further from cortex than the modelled mastoids -- and not about the source model.""")
