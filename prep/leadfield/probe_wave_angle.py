"""Step 1c: which propagation ANGLE, and does it close the r(AP) residual?

Finding 28 left one statistic missing. A fixed anterior-posterior wave at 0.5 m/s reproduces the
real connectivity magnitude (0.074 against 0.068), the homotopic ratio (0.40 against 0.42) and the
left-right and distance correlations -- but gives r(AP) = -0.020 where the real recordings show
+0.131.

Only ONE direction was ever tried. Posterior-to-anterior was chosen because the literature names it,
not because anything measured selected it, and an oblique axis moves r(AP) and r(LR) together. So
the angle is swept before the residual is called a limit of the model.

GEOMETRY. Source positions are RAS millimetres: +x right, +y anterior, +z superior.

    khat = (sin(theta) cos(phi),  cos(theta) cos(phi),  sin(phi))

theta = 0 is posterior->anterior, theta = 90 is left->right, phi tilts out of the axial plane
toward the vertex. Only 0-180 degrees is swept: reversing the wave flips the sign of W_sin and
therefore of Im(S), and dwPLI-squared takes (sum Im S)^2, so k and -k are the same measurement.

Fixed directions only, because Finding 28 showed any direction variability averages the lag away
and collapses dwPLI to the uncoupled floor. That also makes this sweep cheap: the weights are
constant in time, so each configuration is two outer products rather than a per-sample array.
"""
import json
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np
from scipy import signal as sps

from prep import registry as R
from prep.reference.t2m1_connectivity_probe import EPOCH_S, FS, band_mean, connectivity, epoch_spectra

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'prep' / 'leadfield' / 'cache'

#: Finding 26, EEGMAT, average reference, same estimator.
REAL = {'dwpli': 0.0678, 'ratio': 0.0294 / 0.0694, 'ap': 0.131, 'lr': -0.190, 'dist': -0.104}

HOMOTOPIC = [('Fp1', 'Fp2'), ('F7', 'F8'), ('F3', 'F4'), ('T3', 'T4'),
             ('C3', 'C4'), ('T5', 'T6'), ('P3', 'P4'), ('O1', 'O2')]

AZIMUTHS = (0, 30, 60, 90, 120, 150)
ELEVATIONS = (0, 30)
SPEEDS = (0.4, 0.5, 0.6)


def sc(k):
    try:
        return R.scalar_value(k)
    except Exception:
        return R.provisional_value(k)


def point(key):
    rec = R.record(key)['value']
    return rec['v'] if rec['kind'] == 'scalar' else (rec['lo'] + rec['hi']) / 2.0


def main() -> int:
    d = np.load(CACHE / 'fsaverage_leadfield.npz', allow_pickle=True)
    lab = np.load(CACHE / 'fsaverage_labels.npz', allow_pickle=True)
    L, names, pos = d['L'], [str(s) for s in d['names']], d['pos']
    from prep.leadfield.make_projection import PATCHES, SCALP as SC_, REFS
    chan = SC_ + REFS
    L = L[[names.index(c) for c in chan]]
    src = np.unique(np.concatenate([lab[r] for r in PATCHES['alpha']]))
    Lp, pp = L[:, src], pos[src]

    ns = len(SC_)
    Ravg = np.zeros((ns, len(chan)))
    for i in range(ns):
        Ravg[i, i] = 1.0
    Ravg -= Ravg.mean(axis=0, keepdims=True)

    mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    P = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    idx = {c: i for i, c in enumerate(SC_)}
    aps, lrs, ds, pair_ij = [], [], [], []
    for i in range(ns):
        for j in range(i + 1, ns):
            a, b = SC_[i], SC_[j]
            aps.append(abs(P[a][1] - P[b][1]))
            lrs.append(abs(P[a][0] - P[b][0]))
            ds.append(float(np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])))
            pair_ij.append((i, j))

    fs, dur = FS, 300
    n = fs * dur
    rng = np.random.default_rng(5)
    f0, A = 10.0, np.ones(len(src))
    alpha_rms = point('alpha_amp') / sc('amp_pp_to_rms')
    bg_rms = point('background_rms_uv')
    share = sc('channel_local_share')

    b_, a_ = sps.butter(4, [8 / (fs / 2), 12 / (fs / 2)], btype='band')
    s_raw = sps.filtfilt(b_, a_, rng.normal(0, 1, n))
    s_raw /= s_raw.std()
    an = sps.hilbert(s_raw)
    s, shat = an.real, an.imag
    bg = np.stack([sps.filtfilt(*sps.butter(2, 40 / (fs / 2)), rng.normal(0, 1, n))
                   for _ in range(6)])
    bg /= bg.std(axis=1, keepdims=True)
    bgw = rng.normal(0, 1, (len(chan), 6))
    bgsig = (bgw @ bg) * bg_rms / np.sqrt(6)
    loc = np.random.default_rng(9).normal(0, 1, (len(chan), n)) * bg_rms * np.sqrt(
        share / max(1e-9, 1 - share))

    print(f"  {'az':>4}{'el':>4}{'v':>5}{'dwPLI':>9}{'h/o':>7}{'r(AP)':>8}{'r(LR)':>8}"
          f"{'r(dist)':>9}{'err':>7}")
    print('  ' + '-' * 61)
    print(f"  {'REAL':>4}{'':>4}{'':>5}{REAL['dwpli']:>9.4f}{REAL['ratio']:>7.2f}"
          f"{REAL['ap']:>8.3f}{REAL['lr']:>8.3f}{REAL['dist']:>9.3f}")

    rows = []
    for el in ELEVATIONS:
        for az in AZIMUTHS:
            th, ph = np.radians(az), np.radians(el)
            khat = np.array([np.sin(th) * np.cos(ph), np.cos(th) * np.cos(ph), np.sin(ph)])
            for v in SPEEDS:
                kmag = 2 * np.pi * f0 / (v * 1000.0)
                phase = (pp @ khat) * kmag
                Wc = (Lp * (A * np.cos(phase))).sum(1)
                Ws = (Lp * (A * np.sin(phase))).sum(1)
                nrm = np.sqrt(Wc ** 2 + Ws ** 2).max()
                x = (np.outer(Wc / nrm, s) + np.outer(Ws / nrm, shat)) * alpha_rms + bgsig + loc
                spec, freqs = epoch_spectra(Ravg @ x, fs, EPOCH_S)
                _, dw = connectivity(spec)
                db = band_mean(dw, freqs, 8, 13)
                vs = np.asarray([db[i, j] for i, j in pair_ij])
                hv = np.median([db[idx[p], idx[q]] for p, q in HOMOTOPIC])
                mask = np.ones_like(db, dtype=bool)
                for p, q in HOMOTOPIC:
                    mask[idx[p], idx[q]] = mask[idx[q], idx[p]] = False
                other = float(np.median(db[np.triu(mask, 1)]))
                got = {'dwpli': float(np.median(vs)), 'ratio': float(hv) / other,
                       'ap': float(np.corrcoef(aps, vs)[0, 1]),
                       'lr': float(np.corrcoef(lrs, vs)[0, 1]),
                       'dist': float(np.corrcoef(ds, vs)[0, 1])}
                err = float(np.mean([
                    abs(got['dwpli'] - REAL['dwpli']) / REAL['dwpli'],
                    abs(got['ratio'] - REAL['ratio']) / REAL['ratio'],
                    abs(got['ap'] - REAL['ap']), abs(got['lr'] - REAL['lr']),
                    abs(got['dist'] - REAL['dist'])]))
                rows.append((err, az, el, v, got))
                print(f"  {az:>4}{el:>4}{v:>5.1f}{got['dwpli']:>9.4f}{got['ratio']:>7.2f}"
                      f"{got['ap']:>8.3f}{got['lr']:>8.3f}{got['dist']:>9.3f}{err:>7.3f}")
        print()

    best = min(rows)
    e, az, el, v, g = best
    print(f"  BEST: azimuth {az} deg, elevation {el} deg, {v} m/s -- mean relative error {e:.3f}")
    print(f"    dwPLI {g['dwpli']:.4f} (real {REAL['dwpli']}), homo/other {g['ratio']:.2f} "
          f"(real {REAL['ratio']:.2f})")
    print(f"    r(AP) {g['ap']:+.3f} (real {REAL['ap']:+.3f}), r(LR) {g['lr']:+.3f} "
          f"(real {REAL['lr']:+.3f}), r(dist) {g['dist']:+.3f} (real {REAL['dist']:+.3f})")
    print("""
  Azimuth 0 is the posterior-anterior axis Finding 27 assumed. If the best angle is elsewhere, the
  r(AP) residual was a consequence of an unexamined choice rather than a limit of the model -- and
  the angle becomes a registry row that has to be fitted rather than named.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
