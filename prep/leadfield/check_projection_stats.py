"""Does the EMITTED projection file reproduce Finding 20's prediction?

probe_leadfield_gono.py measured a lead field held in memory. This reads the file the generator
will actually load, so it validates the whole producer -- label lookup, patch assembly, coherence
kernel, eigenmode extraction, sign pinning, family normalisation -- rather than the idea of it.

The gap between those two things is where Finding 19's 8x error lived.

Reported under AVERAGE REFERENCE, per D19.1: the generator's linked-mastoid output depends on how
much cortex the modelled reference electrodes see, and under the Gaussian that was an invented row.
An average reference is defined by the montage alone, so nothing in the comparison is invented.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

#: Same recordings, both references. probe_real_farfield_origin.py.
REAL_AVG = {'rank': 5.36, 'pc1': 0.369, 'near': 0.413, 'far': 0.257}
REAL_LINK = {'rank': 3.07, 'pc1': 0.535, 'near': 0.765, 'far': 0.437}
#: The 31-invented-row Gaussian mixture, for contrast. Fitted under linked-ear.
GAUSS_ERR = 0.250

proj = json.loads((ROOT / 'data' / 'projection_10_20.json').read_text(encoding='utf8'))
CH, SCALP, REFS = proj['channels'], proj['scalp'], proj['reference']
mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
P = {c['label']: (c['x'], c['y']) for c in mont['channels']}

idx = {c: i for i, c in enumerate(CH)}
R_link = np.zeros((len(SCALP), len(CH)))
for i, lab in enumerate(SCALP):
    R_link[i, idx[lab]] = 1.0
    for r in REFS:
        R_link[i, idx[r]] -= 1.0 / len(REFS)
R_avg = np.zeros((len(SCALP), len(CH)))
for i, lab in enumerate(SCALP):
    R_avg[i, idx[lab]] = 1.0
R_avg -= R_avg.mean(axis=0, keepdims=True)

near, far = [], []
for i, a in enumerate(SCALP):
    for j, b in enumerate(SCALP):
        if j <= i:
            continue
        d = np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])
        (near if d < 0.6 else far).append((i, j))


def stats(C, Rm):
    c = Rm @ C @ Rm.T
    lam = np.linalg.eigvalsh(c)
    lam = lam[lam > 1e-12 * lam.max()]
    d = np.sqrt(np.diag(c))
    r = c / np.outer(d, d)
    return {'rank': float(lam.sum() ** 2 / (lam ** 2).sum()),
            'pc1': float(lam.max() / lam.sum()),
            'near': float(np.median([abs(r[i, j]) for i, j in near])),
            'far': float(np.median([abs(r[i, j]) for i, j in far]))}


def family(gen):
    """Every mode of one generator, as an (n_modes, n_channels) array."""
    ks = [gen] + [k for k in proj['generators'] if k.startswith(f'{gen}_m')]
    return np.array([proj['generators'][k]['weights'] for k in ks], dtype=float)


def cov(gen, var=1.0):
    W = family(gen)
    return var * (W.T @ W)


print("Emitted projection file, read back. Average reference (D19.1).\n")

# --- 1. does the family normalisation preserve the amplitude contract? ------------------------
print("  1. FAMILY NORMALISATION -- peak channel must see exactly the registered rms.")
print(f"     {'generator':<16}{'modes':>6}{'peak ch':>9}{'peak rss':>10}")
for gen in ('alpha', 'beta', 'theta', 'delta', 'spindle_fast', 'spindle_slow', 'kc',
            'background', 'resp_artifact'):
    W = family(gen)
    rss = np.sqrt((W ** 2).sum(axis=0))
    print(f"     {gen:<16}{W.shape[0]:>6}{CH[int(np.argmax(rss))]:>9}{rss.max():>10.4f}")

# --- 2. left/right symmetry, which a broken label lookup would destroy ------------------------
print("\n  2. HEMISPHERIC SYMMETRY of the background -- a label-index bug shows up here first.")
Wb = family('background')
rss = np.sqrt((Wb ** 2).sum(axis=0))
for a, b in (('F3', 'F4'), ('C3', 'C4'), ('P3', 'P4'), ('O1', 'O2'), ('T3', 'T4'), ('A1', 'A2')):
    va, vb = rss[idx[a]], rss[idx[b]]
    print(f"     {a}/{b}: {va:.4f} / {vb:.4f}   ratio {va / vb:.3f}")

# --- 3. the spatial statistics, with and without the independent per-channel share ------------
print("\n  3. SPATIAL STATISTICS. background + independent per-channel share.")
print(f"     {'model':<38}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}{'err':>8}")
print("     " + "-" * 77)
print(f"     {'REAL (EEGMAT, average ref)':<38}{REAL_AVG['rank']:7.2f}{REAL_AVG['pc1']:8.3f}"
      f"{REAL_AVG['near']:8.3f}{REAL_AVG['far']:8.3f}")
Cn = cov('background')
Cn = Cn / np.trace(Cn) * len(CH)
best = None
for share in (0.0, 0.10, 0.15, 0.20, 0.25, 0.30):
    s = stats((1 - share) * Cn + share * np.eye(len(CH)), R_avg)
    e = float(np.mean([abs(s[k] - REAL_AVG[k]) / REAL_AVG[k] for k in REAL_AVG]))
    tag = f'lead field + independent share {share:.2f}'
    print(f"     {tag:<38}{s['rank']:7.2f}{s['pc1']:8.3f}{s['near']:8.3f}{s['far']:8.3f}{e:8.3f}")
    if best is None or e < best[0]:
        best = (e, share, s)

from prep import registry as R  # noqa: E402
try:
    reg_share = R.provisional_value('channel_local_share')
except Exception:
    reg_share = R.scalar_value('channel_local_share')
s_reg = stats((1 - reg_share) * Cn + reg_share * np.eye(len(CH)), R_avg)
e_reg = float(np.mean([abs(s_reg[k] - REAL_AVG[k]) / REAL_AVG[k] for k in REAL_AVG]))

print(f"\n     registered channel_local_share = {reg_share:.2f} -> mean relative error {e_reg:.3f}")
print(f"     best on this grid               = {best[1]:.2f} -> {best[0]:.3f}")
print(f"     Gaussian mixture it replaces    = {GAUSS_ERR:.3f}, using 31 invented rows")

# --- 4. the same thing under linked mastoid, REPORTED not fitted ------------------------------
s_link = stats((1 - reg_share) * Cn + reg_share * np.eye(len(CH)), R_link)
print(f"\n  4. LINKED MASTOID, reported only (D19.1 forbids fitting against it):")
print(f"     {'':<38}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}")
print(f"     {'REAL (EEGMAT, linked-ear)':<38}{REAL_LINK['rank']:7.2f}{REAL_LINK['pc1']:8.3f}"
      f"{REAL_LINK['near']:8.3f}{REAL_LINK['far']:8.3f}")
print(f"     {'lead field, registered share':<38}{s_link['rank']:7.2f}{s_link['pc1']:8.3f}"
      f"{s_link['near']:8.3f}{s_link['far']:8.3f}")
print("""
     The mastoids are now real electrodes in a real head model, so how much cortex they see is a
     PREDICTION rather than topo_reference_far_field, which was invented. Any disagreement here is
     evidence about the head model or about the earlobe-versus-mastoid difference in the real
     recordings -- it is not a parameter to turn.""")
