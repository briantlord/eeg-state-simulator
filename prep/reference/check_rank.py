"""What is the data rank of the generated channels?

Build Plan 3.1: "Generate a small number of SHARED SOURCE GENERATORS, then project to
channels. Do not generate independent signals per channel -- it is instantly wrong to anyone
who has looked at EEG and it breaks every downstream measure."

That rule prevents one failure and invites its opposite. With a handful of shared sources and
a uniformly-weighted background, the channels become nearly identical -- which is equally
wrong and equally visible in a covariance matrix.

Reported here:
  * the singular-value spectrum of the channel covariance
  * components needed to reach 95% and 99% of variance
  * EFFECTIVE RANK by the participation ratio, (sum s)^2 / sum(s^2), which unlike a
    hard threshold does not depend on where you draw a line
  * the same under several reference montages, because referencing is a rank operation:
    average reference removes one dimension by construction, and a Laplacian removes far more.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep.epochio import generate
from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
SCALP = int(R.scalar_value('n_channels'))


def montage_positions() -> dict[str, tuple[float, float]]:
    import json
    m = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    return {c['label']: (c['x'], c['y']) for c in m['channels'] + m['reference']}


def rereference(sig: np.ndarray, labels: list[str], mode: str) -> tuple[np.ndarray, list[str]]:
    pos = montage_positions()
    scalp_idx = [i for i, l in enumerate(labels) if l not in ('A1', 'A2')]
    x = sig[scalp_idx]
    names = [labels[i] for i in scalp_idx]

    if mode == 'as-generated':
        return x, names
    if mode == 'linked-mastoid':
        a1, a2 = sig[labels.index('A1')], sig[labels.index('A2')]
        return x - 0.5 * (a1 + a2), names
    if mode == 'average':
        return x - x.mean(axis=0, keepdims=True), names
    if mode == 'laplacian':
        # Hjorth nearest-neighbour Laplacian: each channel minus the mean of its k nearest
        # scalp neighbours by 2-D montage distance. A spatial high-pass.
        k = 4
        out = np.empty_like(x)
        for i, name in enumerate(names):
            here = np.array(pos[name])
            d = [(np.hypot(*(np.array(pos[n]) - here)), j) for j, n in enumerate(names) if n != name]
            d.sort()
            nb = [j for _, j in d[:k]]
            out[i] = x[i] - x[nb].mean(axis=0)
        return out, names
    raise ValueError(mode)


def rank_stats(x: np.ndarray) -> dict:
    xc = x - x.mean(axis=1, keepdims=True)
    s = np.linalg.svd(xc, compute_uv=False)
    var = s ** 2
    frac = var / var.sum()
    cum = np.cumsum(frac)
    # Participation ratio: a threshold-free effective dimensionality.
    eff = (var.sum() ** 2) / (var ** 2).sum()
    corr = np.corrcoef(xc)
    iu = np.triu_indices(len(corr), 1)
    return dict(
        n=len(s),
        eff=eff,
        n95=int(np.searchsorted(cum, 0.95) + 1),
        n99=int(np.searchsorted(cum, 0.99) + 1),
        top=frac[0],
        med_corr=float(np.median(np.abs(corr[iu]))),
    )


print("Data rank of the generated channels\n")
print(f"  {'state':9} {'reference':16} {'rank':>5} {'eff':>6} {'n95':>4} {'n99':>4} "
      f"{'PC1 var':>8} {'|corr|':>7}")
print("  " + "-" * 66)

for state in ['wake_ec', 'n2', 'n3']:
    run = generate(Path(__file__).parent.parent / 'out' / f'rank_{state}',
                   seed=20260728, state=state, epochs=4)
    sig, labels = run.concatenated()
    for mode in ['as-generated', 'linked-mastoid', 'average', 'laplacian']:
        x, _ = rereference(sig, labels, mode)
        r = rank_stats(x)
        print(f"  {state:9} {mode:16} {r['n']:5d} {r['eff']:6.2f} {r['n95']:4d} {r['n99']:4d} "
              f"{r['top']:8.3f} {r['med_corr']:7.3f}")
    print()

print("  eff     = participation ratio, a threshold-free effective dimensionality")
print("  n95/n99 = components needed for that fraction of variance")
print("  PC1 var = fraction of all variance in the first component")
print("  |corr|  = median absolute off-diagonal channel correlation")
print()
print("  Real 19-channel scalp EEG is not full rank either -- volume conduction guarantees")
print("  that -- but an effective dimensionality near 1 means every channel is essentially")
print("  the same trace scaled, which no recording looks like.")
