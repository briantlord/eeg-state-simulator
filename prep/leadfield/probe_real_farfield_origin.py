"""Is the real far-field correlation of 0.440 NEURAL, or is it the reference?

THIS QUESTION SHOULD HAVE BEEN ASKED BEFORE ANY OF IT WAS FITTED.

Far-pair inter-channel correlation is the single target this project has repeatedly failed and
repeatedly chased. It drove `topo_far_field_fraction`, then `topo_sigma_far`, then
`topo_reference_far_field` (D18), and it survived all of them: 0.251-0.323 against a real 0.440
across 21 configurations. D19 concluded the model class was at fault and prescribed a lead field.

Then probe_leadfield_gono.py measured a real fsaverage lead field with a parameter-free white-cortex
source model and got far-pair 0.239 -- WORSE than the Gaussian mixture it was meant to replace, with
a near/far ratio of 3.03 against a real 1.74. Real head geometry, given uncorrelated cortical
activity, produces LESS long-range correlation than our invented Gaussians did. So the target is not
reachable by improving the forward model, and the prescription in D19 was wrong about the mechanism.

That leaves two possibilities, and they demand opposite designs:

  (a) real long-range NEURAL coherence -- large-scale networks correlate distant cortex, which no
      distance kernel and no forward model can produce, and the source covariance needs explicit
      long-range structure; or

  (b) the 0.440 is largely REFERENCE and broadband ARTIFACT -- a linked-ear reference does not
      cancel common mode when the ears themselves carry signal, and eye, muscle and sweat
      contributions are spatially broad. Then chasing it with source models is chasing an artifact.

D19 named this error class: comparing two quantities that are not the same quantity, and it caught
the same mistake in chi. This probe applies the rule to the metric that motivated D19 itself.

HOW IT DISCRIMINATES. Common mode is defined by what a reference removes. An average reference
subtracts the mean across scalp channels and therefore annihilates any spatially uniform component;
a Laplacian is even more aggressive against broad structure. If the real 0.440 is common mode it
collapses under re-referencing. If it is distributed neural coherence it largely survives.

Band-limiting separates the other half: eye and movement artifact is concentrated below ~4 Hz and
EMG above ~20 Hz, so if 0.440 is artifact it should fall sharply in a 4-20 Hz band.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]
REALDIR = ROOT / 'prep' / 'realdata'
FS = 256

SCALP = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']


def main() -> int:
    import json
    import mne
    mne.set_log_level('ERROR')

    mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    P = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    near, far = [], []
    for i, a in enumerate(SCALP):
        for j, b in enumerate(SCALP):
            if j <= i:
                continue
            d = np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])
            (near if d < 0.6 else far).append((i, j))

    def stats(x):
        x = x - x.mean(axis=1, keepdims=True)
        lam = np.linalg.eigvalsh(np.cov(x))
        lam = lam[lam > 1e-12 * lam.max()]
        r = np.corrcoef(x)
        return {'rank': float(lam.sum() ** 2 / (lam ** 2).sum()),
                'pc1': float(lam.max() / lam.sum()),
                'near': float(np.median([abs(r[i, j]) for i, j in near])),
                'far': float(np.median([abs(r[i, j]) for i, j in far]))}

    files = sorted(REALDIR.glob('Subject*_1.edf'))
    if not files:
        print(f"no real recordings under {REALDIR}")
        return 1

    #: Each entry transforms the AS-RECORDED (linked-ear) montage.
    def as_recorded(x):
        return x

    def average_ref(x):
        return x - x.mean(axis=0, keepdims=True)

    def laplacian(x):
        # Each channel minus the mean of its near neighbours -- the most aggressive removal of
        # spatially broad structure available without a head model.
        out = np.empty_like(x)
        for i in range(len(SCALP)):
            nb = [j for j in range(len(SCALP))
                  if j != i and np.hypot(P[SCALP[i]][0] - P[SCALP[j]][0],
                                        P[SCALP[i]][1] - P[SCALP[j]][1]) < 0.6]
            out[i] = x[i] - (x[nb].mean(axis=0) if nb else 0.0)
        return out

    def band(x, lo, hi):
        b, a = sps.butter(4, [lo / (FS / 2), hi / (FS / 2)], btype='band')
        return sps.filtfilt(b, a, x, axis=-1)

    CASES = [
        ('as recorded (linked-ear)', lambda x: as_recorded(x)),
        ('  band 4-20 Hz', lambda x: band(as_recorded(x), 4, 20)),
        ('  band 1-4 Hz  (eye/movement)', lambda x: band(as_recorded(x), 1, 4)),
        ('  band 20-40 Hz (EMG)', lambda x: band(as_recorded(x), 20, 40)),
        ('average reference', lambda x: average_ref(x)),
        ('  band 4-20 Hz', lambda x: band(average_ref(x), 4, 20)),
        ('laplacian (near-neighbour)', lambda x: laplacian(x)),
    ]

    acc = {name: [] for name, _ in CASES}
    for f in files:
        raw = mne.io.read_raw_edf(f, preload=True, verbose='ERROR')
        ren = {}
        for ch in raw.ch_names:
            base = ch.replace('EEG ', '').split('-')[0].strip()
            ren[ch] = base
        raw.rename_channels(ren)
        missing = [c for c in SCALP if c not in raw.ch_names]
        if missing:
            print(f"  {f.name}: missing {missing}, skipped")
            continue
        raw.pick(SCALP)
        raw.resample(FS, verbose='ERROR')
        x0 = raw.get_data()
        for name, fn in CASES:
            acc[name].append(stats(fn(x0.copy())))

    n = len(acc[CASES[0][0]])
    print(f"PhysioNet EEGMAT, {n} subjects. Medians across subjects.\n")
    print(f"  {'reference / band':<34}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}"
          f"{'near/far':>10}")
    print("  " + "-" * 76)
    base_far = None
    for name, _ in CASES:
        rows = acc[name]
        m = {k: float(np.median([r[k] for r in rows])) for k in ('rank', 'pc1', 'near', 'far')}
        if base_far is None:
            base_far = m['far']
        ratio = m['near'] / m['far'] if m['far'] > 0 else float('nan')
        print(f"  {name:<34}{m['rank']:7.2f}{m['pc1']:8.3f}{m['near']:8.3f}{m['far']:8.3f}"
              f"{ratio:10.2f}")

    print(f"""
  HOW TO READ IT. The generator is compared against the FIRST row, because that is the reference
  the generator reproduces. If far-pair correlation collapses under average reference or the
  Laplacian, then most of that 0.44 is a spatially broad component -- and a broad component under a
  linked-EAR reference on real data is largely the reference failing to cancel, because real
  earlobes carry signal. If instead it survives, the correlation is distributed neural coherence and
  the source covariance genuinely needs long-range structure that no forward model supplies.

  Either answer changes D19's prescription, which is why this runs before the lead field is built.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
