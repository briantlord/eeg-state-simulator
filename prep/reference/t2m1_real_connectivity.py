"""Step 0 for coupled sources: how much lagged connectivity is there in REAL resting EEG?

THIS PROBE CAN CANCEL A FORTNIGHT OF WORK, which is why it runs first.

The plan for source-level coupling exists to fix a discrepancy: our generator projects every
source instantaneously, so debiased wPLI across the montage sits at 0.002-0.016 (Finding 25).
Adding coupled sources means splitting every rhythm's patch by hemisphere, re-fitting the spatial
parameters, re-solving snr_nominal, and putting a genuinely validated number at risk -- effective
rank currently measures 5.43 against a real 5.36.

All of that is worth doing IF real resting EEG shows lagged connectivity the generator lacks. If
real dwPLI is also near zero, the generator already matches reality and the work would be adding
invented physiology to close a gap that is not there.

Nobody knows which without measuring. Real resting dwPLI is often low -- the entire reason the
measure exists is that most apparent EEG connectivity is volume conduction, and a metric built to
reject volume conduction applied to a signal dominated by it may correctly return almost nothing.

THE NULL IS THE POINT. "dwPLI = 0.05" means nothing on its own; the debiased estimator is centred
near zero for uncoupled data but scatters, and the scatter depends on epoch count. So every value
here is reported against a matched surrogate: each channel circularly shifted by an independent
random offset, which destroys phase relationships between channels while preserving every
channel's own spectrum exactly. Same recordings, same epochs, same estimator, no true coupling.

Anything not clearly above that surrogate is not evidence of connectivity, however large it looks.

HOMOTOPIC PAIRS ARE SINGLED OUT because they are the target the coupling plan would aim at:
left-right twins are the strongest connections in every human structural connectome, and callosal
conduction delays have real literature behind them. If real connectivity is anywhere, it should be
there.
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np

from prep.reference.t2m1_connectivity_probe import (
    BANDS, EPOCH_S, FS, SCALP, band_mean, connectivity, epoch_spectra,
)

ROOT = Path(__file__).resolve().parents[2]
REALDIR = ROOT / 'prep' / 'realdata'

#: Left-right twins in the 10-20 montage. Fz/Cz/Pz have no contralateral partner.
HOMOTOPIC = [('Fp1', 'Fp2'), ('F7', 'F8'), ('F3', 'F4'), ('T3', 'T4'),
             ('C3', 'C4'), ('T5', 'T6'), ('P3', 'P4'), ('O1', 'O2')]

#: Finding 25, our generator, average reference, same estimator.
OURS = {'delta': 0.002, 'theta': 0.002, 'alpha': 0.004, 'beta': 0.004}


def surrogate(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Each channel circularly shifted independently.

    Kills every between-channel phase relationship and leaves each channel's own spectrum
    untouched, so the only thing removed is the quantity being measured.
    """
    return np.stack([np.roll(c, int(rng.integers(x.shape[1] // 8, x.shape[1] * 7 // 8)))
                     for c in x])


def main() -> int:
    import mne
    mne.set_log_level('ERROR')

    files = sorted(REALDIR.glob('Subject*_1.edf'))
    if not files:
        print(f'no EEGMAT recordings under {REALDIR}')
        return 1

    rng = np.random.default_rng(11)
    obs = {b: [] for b in BANDS}
    nul = {b: [] for b in BANDS}
    homo = {b: [] for b in BANDS}
    hetero = {b: [] for b in BANDS}
    coh_obs = {b: [] for b in BANDS}
    alpha_mats = []
    n_used = 0

    for f in files:
        raw = mne.io.read_raw_edf(f, preload=True, verbose='ERROR')
        raw.rename_channels({c: c.replace('EEG ', '').split('-')[0].strip() for c in raw.ch_names})
        if any(c not in raw.ch_names for c in SCALP):
            continue
        raw.pick(SCALP).resample(FS, verbose='ERROR')
        x = raw.get_data()
        x = x - x.mean(axis=0, keepdims=True)          # average reference (D19.1)
        n_used += 1

        for tag, sig in (('obs', x), ('nul', surrogate(x, rng))):
            spec, freqs = epoch_spectra(sig, FS, EPOCH_S)
            coh, dw = connectivity(spec)
            iu = np.triu_indices(len(SCALP), 1)
            for band, (lo, hi) in BANDS.items():
                db = band_mean(dw, freqs, lo, hi)
                (obs if tag == 'obs' else nul)[band].append(float(np.median(db[iu])))
                if tag == 'obs':
                    if band == 'alpha':
                        alpha_mats.append(db.copy())
                    cb = band_mean(coh, freqs, lo, hi)
                    coh_obs[band].append(float(np.median(cb[iu])))
                    hi_idx = {c: i for i, c in enumerate(SCALP)}
                    hv = [db[hi_idx[a], hi_idx[b]] for a, b in HOMOTOPIC]
                    homo[band].append(float(np.median(hv)))
                    mask = np.ones_like(db, dtype=bool)
                    for a, b in HOMOTOPIC:
                        mask[hi_idx[a], hi_idx[b]] = mask[hi_idx[b], hi_idx[a]] = False
                    hetero[band].append(float(np.median(db[np.triu(mask, 1)])))
        print(f'  {f.stem} done')

    print(f'\nPhysioNet EEGMAT, {n_used} subjects, average reference, {EPOCH_S:g} s epochs.\n')
    print(f"  {'band':<7}{'coh':>7}{'dwPLI':>8}{'surrogate':>11}{'obs/null':>10}"
          f"{'homotopic':>11}{'other':>8}{'ours':>8}")
    print('  ' + '-' * 70)
    verdict = []
    for band in BANDS:
        o, n = float(np.median(obs[band])), float(np.median(nul[band]))
        ratio = o / n if n > 0 else float('inf')
        h, e = float(np.median(homo[band])), float(np.median(hetero[band]))
        print(f"  {band:<7}{np.median(coh_obs[band]):>7.3f}{o:>8.4f}{n:>11.4f}{ratio:>10.2f}"
              f"{h:>11.4f}{e:>8.4f}{OURS[band]:>8.4f}")
        verdict.append((band, o, n, ratio, h, e))

    print(f"""
  HOW TO READ IT.

  `obs/null` is the only column that carries evidence. The debiased estimator scatters around zero
  for uncoupled data, so a raw dwPLI is uninterpretable without the surrogate beside it. A ratio
  near 1 means the observed value is what independent channels produce -- no connectivity, however
  large the number looks.

  `homotopic` against `other` asks whether whatever is there sits where the anatomy says it should.
  Coupled sources would be aimed at homotopic pairs, so if those are not elevated, splitting the
  patches by hemisphere would be building toward the wrong target.

  `ours` is the generator, same estimator and reference (Finding 25). If real dwPLI is not clearly
  above its own surrogate, the generator already matches reality on this quantity and the coupled-
  source work closes a gap that does not exist.""")

    strong = [b for b, o, n, r, h, e in verdict if r > 2.0]
    homo_led = [b for b, o, n, r, h, e in verdict if h > e * 1.5]
    print(f"\n  bands where observed exceeds surrogate by >2x: {strong or 'NONE'}")
    print(f"  bands where homotopic exceeds other pairs by >1.5x: {homo_led or 'NONE'}")

    # ---------------------------------------------------------------- where is it, then?
    #
    # Homotopic pairs came back BELOW average, which kills the topology the coupling plan was
    # going to aim at. That is not a surprise once stated: homotopic electrodes sit symmetrically
    # about the midline, so a midline source reaches both with the same sign and no lag -- exactly
    # what wPLI is built to discard. The real lagged structure has to be somewhere else, and where
    # it is decides which connections a source model would need.
    print('\n  WHERE THE ALPHA CONNECTIVITY ACTUALLY IS. Median across subjects.\n')
    A = np.median(np.stack(alpha_mats), axis=0)
    idx = {c: i for i, c in enumerate(SCALP)}
    iu = np.triu_indices(len(SCALP), 1)
    order = np.argsort(A[iu])[::-1]
    print(f"   {'rank':<6}{'pair':<12}{'dwPLI':>8}{'AP sep':>9}{'LR sep':>9}{'dist':>8}")
    mont = __import__('json').loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    P = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    for r_i in range(8):
        k = order[r_i]
        a, b = SCALP[iu[0][k]], SCALP[iu[1][k]]
        ap = abs(P[a][1] - P[b][1])
        lr = abs(P[a][0] - P[b][0])
        d = float(np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]))
        print(f"   {r_i + 1:<6}{a + '-' + b:<12}{A[iu][k]:>8.4f}{ap:>9.2f}{lr:>9.2f}{d:>8.2f}")
    aps, lrs, ds, vs = [], [], [], []
    for i in range(len(SCALP)):
        for j in range(i + 1, len(SCALP)):
            a, b = SCALP[i], SCALP[j]
            aps.append(abs(P[a][1] - P[b][1]))
            lrs.append(abs(P[a][0] - P[b][0]))
            ds.append(float(np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])))
            vs.append(A[i, j])
    vs = np.asarray(vs)
    print(f"\n   correlation with anterior-posterior separation: "
          f"{np.corrcoef(aps, vs)[0, 1]:+.3f}")
    print(f"   correlation with left-right separation:         "
          f"{np.corrcoef(lrs, vs)[0, 1]:+.3f}")
    print(f"   correlation with scalp distance:                "
          f"{np.corrcoef(ds, vs)[0, 1]:+.3f}")
    print("""
   A model needs a topology, and this is what it would have to reproduce. Correlations near zero
   in every direction would mean the structure is not geometric at all -- which would make it
   anatomy rather than distance, and much harder to source.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
