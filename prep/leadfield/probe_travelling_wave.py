"""Step 1: would a travelling wave produce the lagged connectivity real EEG has?

Finding 26 measured a real gap. Alpha dwPLI in resting EEG is 0.068 against a 0.006 surrogate
floor; our generator produces 0.004, indistinguishable from uncoupled channels, because every
patch activates synchronously and instantaneous mixing has a real-valued cross-spectrum.

The proposed fix is not new physiology. Alpha and theta ARE travelling waves in human neocortex
(Zhang et al. 2018; Halgren et al. 2019), propagating at 0.7-2.1 m/s along cortex, and this
project already models exactly that mechanism for slow oscillations -- `so_travel_v`, standing
`literature`. Patches that fire as one are the omission.

THIS PROBE ASKS WHETHER THE FIX WOULD WORK, BEFORE ANY OF IT IS BUILT. It reaches into the lead
field directly and synthesises what the generator WOULD emit, so a negative answer costs a day
rather than a week.

THE MATHS, because it is what makes the change cheap. A wave across a patch is
s(r, t) = A(r) cos(wt - k.r) with k = (w/v) khat. Projecting through the lead field and separating:

    scalp(t) = W_cos * s(t)  +  W_sin * shat(t)
    W_cos = sum_r L(r) A(r) cos(k.r)      W_sin = sum_r L(r) A(r) sin(k.r)

Two real topographies and a quadrature signal -- no hemisphere split, no patch restructuring, no
re-fit of the spatial parameters. And the complex amplitude at channel i is Z_i = a_i - i b_i, so

    Im(S_ij) = a_i b_j - b_i a_j

which is non-zero exactly where the wave arrives at different phase, and identically zero when
v -> infinity. That is the quantity dwPLI measures.

THREE THINGS HAVE TO HOLD, and any one of them failing kills the approach:

  1. dwPLI reaches ~0.068 at a speed inside the published range.
  2. Its pattern is NOT geometric -- correlations with anterior-posterior, left-right and scalp
     distance all near zero, as Finding 26 measured in the real recordings.
  3. Homotopic pairs are LOW, also as measured. A wave crossing the midline reaches symmetric
     electrodes at similar times, so this should follow -- but it is a prediction, not a given.

The signal is built at the registry's own amplitudes, because dwPLI depends on the ratio of the
lagged component to everything instantaneous around it. A wave measured against no background
would report a number this generator could never produce.
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
from prep.reference.t2m1_connectivity_probe import (
    EPOCH_S, FS, SCALP, band_mean, connectivity, epoch_spectra,
)

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'prep' / 'leadfield' / 'cache'

#: Finding 26, EEGMAT, average reference, same estimator.
REAL_ALPHA_DWPLI = 0.0678
REAL_SURROGATE = 0.0060
REAL_HOMOTOPIC = 0.0294
REAL_OTHER = 0.0694
OURS_NOW = 0.0040

HOMOTOPIC = [('Fp1', 'Fp2'), ('F7', 'F8'), ('F3', 'F4'), ('T3', 'T4'),
             ('C3', 'C4'), ('T5', 'T6'), ('P3', 'P4'), ('O1', 'O2')]

#: Published cortical propagation speeds, m/s. The 5-15 m/s figures in the same literature are
#: SCALP speeds -- a different measurement of a different thing, and using them here would put the
#: lags out by an order of magnitude. This project has crossed a parameter with an observable four
#: times; the units are named to make the fifth harder.
SPEEDS = (0.5, 0.7, 1.0, 1.4, 2.1, 3.0, 5.0)


def sc(k):
    try:
        return R.scalar_value(k)
    except Exception:
        return R.provisional_value(k)


def point(key):
    rec = R.record(key)['value']
    return rec['v'] if rec['kind'] == 'scalar' else (rec['lo'] + rec['hi']) / 2.0


def main() -> int:
    if not (CACHE / 'fsaverage_leadfield.npz').exists():
        print('lead field cache absent; run: python -m prep.leadfield.make_projection')
        return 1
    d = np.load(CACHE / 'fsaverage_leadfield.npz', allow_pickle=True)
    lab = np.load(CACHE / 'fsaverage_labels.npz', allow_pickle=True)
    L, names, pos = d['L'], [str(s) for s in d['names']], d['pos']

    from prep.leadfield.make_projection import PATCHES, SCALP as PROD_SCALP, REFS
    order = [names.index(c) for c in PROD_SCALP + REFS]
    L = L[order]
    chan = PROD_SCALP + REFS
    src = np.unique(np.concatenate([lab[r] for r in PATCHES['alpha']]))
    Lp, pp = L[:, src], pos[src]
    print(f'alpha patch: {len(src)} sources, extent {pp.ptp(axis=0).round(0)} mm\n')

    # Average reference over the scalp only, matching Finding 26.
    ns = len(PROD_SCALP)
    Ravg = np.eye(len(chan))[:ns] - np.ones((ns, len(chan))) / ns * 0
    Ravg = np.zeros((ns, len(chan)))
    for i in range(ns):
        Ravg[i, i] = 1.0
    Ravg -= Ravg.mean(axis=0, keepdims=True)

    mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    P = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    idx = {c: i for i, c in enumerate(PROD_SCALP)}

    fs = FS
    dur = 300
    n = fs * dur
    rng = np.random.default_rng(5)
    f0 = float(np.mean(R.record('alpha_band')['value']['lo':] if False else [8, 12]))
    lam = sc('cortical_coherence_mm')
    alpha_rms = point('alpha_amp') / sc('amp_pp_to_rms')
    bg_rms = point('background_rms_uv')
    share = sc('channel_local_share')

    # Source amplitude across the patch: the same coherence-weighted profile the producer uses,
    # reduced to a per-source weight so the wave is carried by the patch as it is modelled.
    A = np.ones(len(src))

    # Narrowband alpha and its exact quadrature, via the analytic signal.
    b, a = sps.butter(4, [8 / (fs / 2), 12 / (fs / 2)], btype='band')
    s_raw = sps.filtfilt(b, a, rng.normal(0, 1, n))
    s_raw /= s_raw.std()
    analytic = sps.hilbert(s_raw)
    s, shat = analytic.real, analytic.imag

    # Background: instantaneous, so it contributes nothing to Im(S) but everything to the
    # denominator. Without it the wave would be measured against silence.
    bg = np.stack([sps.filtfilt(*sps.butter(2, 40 / (fs / 2)), rng.normal(0, 1, n))
                   for _ in range(6)])
    bg /= bg.std(axis=1, keepdims=True)
    bgw = rng.normal(0, 1, (len(chan), 6))

    print(f"  {'v (m/s)':>8}{'phase span':>12}{'dwPLI med':>11}{'homotopic':>11}{'other':>8}"
          f"{'r(AP)':>8}{'r(LR)':>8}{'r(dist)':>9}")
    print('  ' + '-' * 76)
    print(f"  {'REAL':>8}{'':>12}{REAL_ALPHA_DWPLI:>11.4f}{REAL_HOMOTOPIC:>11.4f}"
          f"{REAL_OTHER:>8.4f}{0.131:>8.3f}{-0.190:>8.3f}{-0.104:>9.3f}")
    print(f"  {'ours now':>8}{'':>12}{OURS_NOW:>11.4f}")

    # DIRECTION IS NOT ONE AXIS. A plane wave along a fixed axis reaches left and right twins at
    # IDENTICAL phase, so Im(S) = a_i b_j - b_i a_j vanishes for every homotopic pair by
    # construction -- 50x suppression against 2.4x in the real recordings. Propagation direction is
    # documented as variable and task-dependent, and rotating waves organise sleep spindles, so the
    # variability is better supported than the fixed axis was.
    #
    # Anchors every `DIR_BLOCK_S` seconds with smooth interpolation between them, rather than
    # jumps: a discontinuity in the weights is a broadband click, and dwPLI would read it as
    # structure.
    DIR_BLOCK_S = 3.0

    def direction_series(mode: str, rng) -> np.ndarray:
        """(n_samples, 3) unit vectors, smoothly varying."""
        n_anchor = int(np.ceil(dur / DIR_BLOCK_S)) + 2
        if mode == 'fixed-ap':
            anch = np.tile([0.0, 1.0, 0.0], (n_anchor, 1))
        elif mode == 'rotating':
            # Constant-rate rotation in the axial plane: the spindle literature's rotating wave.
            th = np.linspace(0, 2 * np.pi * (dur / 30.0), n_anchor)
            anch = np.stack([np.sin(th), np.cos(th), np.zeros_like(th)], axis=1)
        elif mode == 'ap-biased':
            # Predominantly anterior-posterior with spread, which is what the literature reports:
            # PA and AP dominate, but direction is not fixed.
            th = rng.normal(0, 0.9, n_anchor)
            anch = np.stack([np.sin(th), np.cos(th) * rng.choice([-1, 1], n_anchor),
                             np.zeros(n_anchor)], axis=1)
        else:                                            # 'uniform'
            anch = rng.normal(0, 1, (n_anchor, 3))
            anch[:, 2] *= 0.3                            # cortex is flatter than it is tall
        anch /= np.linalg.norm(anch, axis=1, keepdims=True)
        t_anchor = np.arange(n_anchor) * DIR_BLOCK_S * fs
        out = np.empty((n, 3))
        for d in range(3):
            out[:, d] = np.interp(np.arange(n), t_anchor, anch[:, d])
        out /= np.linalg.norm(out, axis=1, keepdims=True)
        return out

    print(f"  {'direction':<12}{'v':>5}{'dwPLI':>9}{'homo':>8}{'other':>8}{'h/o':>7}"
          f"{'r(AP)':>8}{'r(LR)':>8}{'r(dist)':>9}{'err':>7}")
    print('  ' + '-' * 79)
    print(f"  {'REAL':<12}{'':>5}{REAL_ALPHA_DWPLI:>9.4f}{REAL_HOMOTOPIC:>8.4f}"
          f"{REAL_OTHER:>8.4f}{REAL_HOMOTOPIC / REAL_OTHER:>7.2f}"
          f"{0.131:>8.3f}{-0.190:>8.3f}{-0.104:>9.3f}")

    best = None
    for mode in ('fixed-ap', 'ap-biased', 'rotating', 'uniform'):
        khat_t = direction_series(mode, np.random.default_rng(3))
        for v in (0.5, 0.7, 1.0, 1.4, 2.1):
            kmag = 2 * np.pi * f0 / (v * 1000.0)
            # Per-sample weights: the wave's direction at that instant. Computed by projecting the
            # patch onto the current direction, which is a (n_src,) dot product per sample -- so it
            # is done on the ANCHOR directions and interpolated, not per sample.
            n_anchor = int(np.ceil(dur / DIR_BLOCK_S)) + 2
            t_anchor = np.arange(n_anchor) * DIR_BLOCK_S * fs
            anch = khat_t[np.clip(t_anchor.astype(int), 0, n - 1)]
            Wc_a = np.stack([(Lp * (A * np.cos((pp @ kh) * kmag))).sum(1) for kh in anch])
            Ws_a = np.stack([(Lp * (A * np.sin((pp @ kh) * kmag))).sum(1) for kh in anch])
            nrm = np.sqrt(Wc_a ** 2 + Ws_a ** 2).max()
            Wc_a, Ws_a = Wc_a / nrm, Ws_a / nrm
            Wc_t = np.stack([np.interp(np.arange(n), t_anchor, Wc_a[:, c])
                             for c in range(len(chan))])
            Ws_t = np.stack([np.interp(np.arange(n), t_anchor, Ws_a[:, c])
                             for c in range(len(chan))])

            x = (Wc_t * s + Ws_t * shat) * alpha_rms
            x += (bgw @ bg) * bg_rms / np.sqrt(6)
            x += np.random.default_rng(9).normal(0, 1, (len(chan), n)) * bg_rms * np.sqrt(
                share / max(1e-9, 1 - share))
            xr = Ravg @ x

            spec, freqs = epoch_spectra(xr, fs, EPOCH_S)
            _, dw = connectivity(spec)
            db = band_mean(dw, freqs, 8, 13)
            iu = np.triu_indices(ns, 1)
            hv = [db[idx[q1], idx[q2]] for q1, q2 in HOMOTOPIC]
            mask = np.ones_like(db, dtype=bool)
            for q1, q2 in HOMOTOPIC:
                mask[idx[q1], idx[q2]] = mask[idx[q2], idx[q1]] = False
            aps, lrs, ds, vs = [], [], [], []
            for i in range(ns):
                for j in range(i + 1, ns):
                    A_, B_ = PROD_SCALP[i], PROD_SCALP[j]
                    aps.append(abs(P[A_][1] - P[B_][1]))
                    lrs.append(abs(P[A_][0] - P[B_][0]))
                    ds.append(float(np.hypot(P[A_][0] - P[B_][0], P[A_][1] - P[B_][1])))
                    vs.append(db[i, j])
            vs = np.asarray(vs)
            med = float(np.median(db[iu]))
            h = float(np.median(hv))
            o = float(np.median(db[np.triu(mask, 1)]))
            rap = float(np.corrcoef(aps, vs)[0, 1])
            rlr = float(np.corrcoef(lrs, vs)[0, 1])
            rds = float(np.corrcoef(ds, vs)[0, 1])
            err = float(np.mean([abs(med - REAL_ALPHA_DWPLI) / REAL_ALPHA_DWPLI,
                                 abs(h / o - REAL_HOMOTOPIC / REAL_OTHER)
                                 / (REAL_HOMOTOPIC / REAL_OTHER),
                                 abs(rap - 0.131), abs(rlr + 0.190), abs(rds + 0.104)]))
            print(f"  {mode:<12}{v:>5.1f}{med:>9.4f}{h:>8.4f}{o:>8.4f}{h / o:>7.2f}"
                  f"{rap:>8.3f}{rlr:>8.3f}{rds:>9.3f}{err:>7.3f}")
            if best is None or err < best[0]:
                best = (err, mode, v)
        print()
    print(f"  BEST: {best[1]} at {best[2]} m/s, mean relative error {best[0]:.3f}\n")

    print("""
  THREE THINGS HAD TO HOLD. Does dwPLI reach the real 0.068 at a speed inside the published
  0.7-2.1 m/s? Is the pattern non-geometric, with all three correlations near zero as the real
  recordings show? Are homotopic pairs below the rest, as measured?

  `phase span` is the total phase difference across the patch in radians. Near zero means the wave
  is too fast to lag anything and the approach cannot work at that speed; far above 2*pi means the
  wave wraps within the patch and the topography starts cancelling itself.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
