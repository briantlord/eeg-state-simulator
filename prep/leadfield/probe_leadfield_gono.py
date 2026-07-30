"""GO / NO-GO for P9: can a real lead field reproduce the spatial statistics at all?

D19 decided to replace the Gaussian-mixture projection with a published lead field. THIS PROBE IS
THE PRECONDITION, and it runs before anything is built.

The lesson is Finding 19's: an analytic surrogate that disagrees with reality is worse than none,
because it produces confident numbers about a model nobody should ship. There, the first draft of
the covariance surrogate was wrong by 8x and the self-check caught it. Here the same discipline
applies one level up -- do not spend a milestone replacing 31 registry rows with a forward model
until the forward model is shown to produce the numbers the 31 rows could not.

WHAT MAKES THIS A FAIR TEST: IT HAS NO FREE PARAMETERS.

The source model is white on the cortex -- every dipole independent, unit variance, oriented normal
to the surface. That is the standard "aperiodic activity everywhere" assumption and it is
parameter-free, so

    C_channel = L L^T

with L the lead field. Referenced, that predicts effective rank, PC1 share, and near- and far-pair
correlation with NOTHING fitted. If those land near the real values, the physics is carrying the
spatial structure and D19's plan is sound. If they do not, the plan is wrong and the cheapest place
to discover it is here.

For contrast the probe also reports a spatially-coherent source model,
C_s(i,j) = exp(-d(i,j)/lambda), which has exactly ONE parameter -- a cortical coherence length in
mm, a physiologically meaningful quantity -- against the 31 invented rows it would replace.

Distances between sources are Euclidean rather than geodesic. That is an approximation and it makes
the coherent model slightly too coherent across sulci; it does not affect the parameter-free result,
which is the one this decision turns on.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np

ROOT = Path(__file__).resolve().parents[2]

#: PhysioNet EEGMAT, 8 resting adults, linked-ear reference. Finding 12.
REAL = {'rank': 3.09, 'pc1': 0.534, 'near': 0.767, 'far': 0.440, 'all': 0.482}
REAL_IQR = {'rank': (2.88, 3.28), 'pc1': (0.503, 0.556),
            'near': (0.745, 0.798), 'far': (0.402, 0.486), 'all': (0.452, 0.525)}

#: What the Gaussian mixture achieves after four parameters were fitted against these same targets.
SHIPPED = {'rank': 3.17, 'pc1': 0.473, 'near': 0.812, 'far': 0.303, 'all': 0.379}
#: The SAME recordings under AVERAGE reference -- probe_real_farfield_origin.py. Far-pair
#: correlation swings 0.437 -> 0.257 and effective rank 3.07 -> 5.36 from the reference alone,
#: which is a larger change than any difference between the models compared here.
REAL_AVG = {'rank': 5.36, 'pc1': 0.369, 'near': 0.413, 'far': 0.257}

SCALP = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']
REFS = ['A1', 'A2']


def main() -> int:
    import mne
    mne.set_log_level('ERROR')

    fs_dir = Path(mne.datasets.fetch_fsaverage(verbose=False))
    src_path = fs_dir / 'bem' / 'fsaverage-ico-5-src.fif'
    bem_path = fs_dir / 'bem' / 'fsaverage-5120-5120-5120-bem-sol.fif'
    print(f"fsaverage: {fs_dir}")
    print(f"  src {src_path.name}  bem {bem_path.name}\n")

    info = mne.create_info(SCALP + REFS, sfreq=256.0, ch_types='eeg')
    info.set_montage('standard_1005', on_missing='raise')

    fwd = mne.make_forward_solution(info, trans='fsaverage', src=str(src_path),
                                    bem=str(bem_path), eeg=True, meg=False,
                                    mindist=5.0, verbose=False)
    # Fixed orientation = dipoles normal to the cortical surface, which is the physiological
    # assumption for pyramidal cells and removes the free orientation parameters.
    fwd = mne.convert_forward_solution(fwd, force_fixed=True, surf_ori=True, use_cps=True,
                                       verbose=False)
    L = fwd['sol']['data']                      # n_channels x n_sources
    names = fwd['info']['ch_names']
    pos = np.vstack([s['rr'][s['vertno']] for s in fwd['src']]) * 1000.0  # mm
    print(f"lead field: {L.shape[0]} channels x {L.shape[1]} sources, "
          f"cortex extent {pos.ptp(axis=0).round(0)} mm\n")

    # TWO REFERENCE OPERATORS, because the choice turned out to dominate the comparison.
    #
    # probe_real_farfield_origin.py measured the real recordings under both: far-pair correlation
    # is 0.437 under linked-ear and 0.257 under average reference, with effective rank 3.07 against
    # 5.36. A 70% swing in the metric this project has been fitting, from the reference alone.
    #
    # That matters because the generator's linked-mastoid behaviour is itself set by an INVENTED
    # number -- topo_reference_far_field, 0.30, how much cortical signal the mastoids see (D18). So
    # fitting spatial parameters against the linked-ear far-pair correlation fits them against that
    # invented number as much as against the head. Average reference is defined by the montage
    # alone and depends on no modelled electrode, so it is the comparison that can be trusted.
    idx = {n: i for i, n in enumerate(names)}
    R_link = np.zeros((len(SCALP), len(names)))
    for i, lab in enumerate(SCALP):
        R_link[i, idx[lab]] = 1.0
        for r in REFS:
            R_link[i, idx[r]] -= 0.5
    R_avg = np.zeros((len(SCALP), len(names)))
    for i, lab in enumerate(SCALP):
        R_avg[i, idx[lab]] = 1.0
    R_avg -= R_avg.mean(axis=0, keepdims=True)
    Rm = R_link

    # Electrode positions for the near/far split, in the SAME units the montage file uses, so the
    # 0.6 threshold means what it means everywhere else in this project.
    mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    P = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    near, far = [], []
    for i, a in enumerate(SCALP):
        for j, b in enumerate(SCALP):
            if j <= i:
                continue
            d = np.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1])
            (near if d < 0.6 else far).append((i, j))

    def stats(C, R=None):
        RR = Rm if R is None else R
        c = RR @ C @ RR.T
        lam = np.linalg.eigvalsh(c)
        lam = lam[lam > 1e-12 * lam.max()]
        d = np.sqrt(np.diag(c))
        r = c / np.outer(d, d)
        iu = np.triu_indices(len(SCALP), 1)
        return {'rank': float(lam.sum() ** 2 / (lam ** 2).sum()),
                'pc1': float(lam.max() / lam.sum()),
                'near': float(np.median([abs(r[i, j]) for i, j in near])),
                'far': float(np.median([abs(r[i, j]) for i, j in far])),
                'all': float(np.median(np.abs(r[iu])))}

    def row(label, s, mark=True):
        cells = []
        for k in ('rank', 'pc1', 'near', 'far', 'all'):
            lo, hi = REAL_IQR[k]
            flag = '' if not mark else ('*' if lo <= s[k] <= hi else ' ')
            cells.append(f"{s[k]:6.3f}{flag}")
        print(f"  {label:<34}" + " ".join(cells))

    print("  * = inside the real interquartile range\n")
    print(f"  {'model':<34}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}{'all':>8}")
    print("  " + "-" * 74)
    row('REAL (EEGMAT median)', REAL, mark=False)
    row('shipped Gaussian mixture', SHIPPED)
    print("  " + "-" * 74)

    # --- the parameter-free prediction --------------------------------------------------------
    white = stats(L @ L.T)
    row('LEAD FIELD, white cortex  [0 par]', white)

    # --- one parameter, for contrast ----------------------------------------------------------
    # Subsample the cortex: the coherent model needs an n x n kernel and ico-5 is ~20k sources.
    rs = np.random.default_rng(0)
    sub = rs.choice(L.shape[1], size=4000, replace=False)
    Ls, ps = L[:, sub], pos[sub]
    D = np.linalg.norm(ps[:, None, :] - ps[None, :, :], axis=-1)
    for lam_mm in (10.0, 20.0, 40.0, 80.0):
        Cs = np.exp(-D / lam_mm)
        row(f'  + coherence length {lam_mm:>4.0f} mm  [1 par]', stats(Ls @ Cs @ Ls.T))

    # --- the same thing under AVERAGE reference, which depends on no invented electrode --------
    print("\n  === AVERAGE REFERENCE: no modelled reference electrode, so nothing invented ===\n")
    print(f"  {'model':<36}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}")
    print("  " + "-" * 68)
    print(f"  {'REAL (EEGMAT median)':<36}{REAL_AVG['rank']:7.2f}{REAL_AVG['pc1']:8.3f}"
          f"{REAL_AVG['near']:8.3f}{REAL_AVG['far']:8.3f}")
    wa = stats(L @ L.T, R_avg)
    print(f"  {'LEAD FIELD, white cortex  [0 par]':<36}{wa['rank']:7.2f}{wa['pc1']:8.3f}"
          f"{wa['near']:8.3f}{wa['far']:8.3f}")
    for lam_mm in (20.0, 40.0, 80.0):
        s2 = stats(Ls @ np.exp(-D / lam_mm) @ Ls.T, R_avg)
        print(f"  {'  + coherence length %4.0f mm' % lam_mm:<36}{s2['rank']:7.2f}{s2['pc1']:8.3f}"
              f"{s2['near']:8.3f}{s2['far']:8.3f}")

    # --- how much INDEPENDENT per-channel signal does real EEG carry? -------------------------
    #
    # Real average-referenced EEG is LESS spatially correlated than white-cortex-through-a-lead-
    # field (near 0.413 against 0.553) and has HIGHER effective rank (5.36 against 4.32). No source
    # coherence model can do that: coherence only ever raises correlation. The only thing that
    # lowers it is signal that is independent PER ELECTRODE.
    #
    # That is not amplifier noise. `sensor_noise_rms_uv` is 1.5 uV against a ~15 uV signal, which is
    # 1% of the variance and moves none of these numbers. It is the non-neural contribution real
    # scalp recordings carry at each site independently -- local muscle, skin potential, electrode
    # drift, contact impedance. This sweep asks what fraction of total variance it must be.
    print("\n  === INDEPENDENT PER-CHANNEL FRACTION, average reference ===\n")
    print(f"  {'independent share of variance':<36}{'rank':>7}{'PC1':>8}{'near':>8}{'far':>8}"
          f"{'err':>8}")
    print("  " + "-" * 76)
    print(f"  {'REAL (EEGMAT median)':<36}{REAL_AVG['rank']:7.2f}{REAL_AVG['pc1']:8.3f}"
          f"{REAL_AVG['near']:8.3f}{REAL_AVG['far']:8.3f}")
    Cn = L @ L.T
    Cn = Cn / np.trace(Cn) * len(names)      # unit mean channel variance, so the share is a share
    best = None
    for frac in (0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60):
        sN = stats((1 - frac) * Cn + frac * np.eye(len(names)), R_avg)
        e = float(np.mean([abs(sN[k] - REAL_AVG[k]) / REAL_AVG[k]
                           for k in ('rank', 'pc1', 'near', 'far')]))
        print(f"  {frac:<36.2f}{sN['rank']:7.2f}{sN['pc1']:8.3f}{sN['near']:8.3f}"
              f"{sN['far']:8.3f}{e:8.3f}")
        if best is None or e < best[0]:
            best = (e, frac, sN)
    print(f"\n  BEST: independent share {best[1]:.2f}, mean relative error {best[0]:.3f}"
          f"  -- against 0.250 for the fitted Gaussian mixture on 31 invented rows,")
    print(f"  and this has ONE free parameter and a reference that invents nothing.")

    keys = ('rank', 'pc1', 'near', 'far')
    err_link = np.mean([abs(white[k] - REAL[k]) / REAL[k] for k in keys])
    err_avg = np.mean([abs(wa[k] - REAL_AVG[k]) / REAL_AVG[k] for k in keys])
    print("\n  parameter-free lead field, mean relative error against real:")
    print(f"    linked-ear / linked-mastoid   {err_link:.3f}")
    print(f"    average reference             {err_avg:.3f}")

    print()
    hits = sum(REAL_IQR[k][0] <= white[k] <= REAL_IQR[k][1] for k in REAL_IQR)
    ship_hits = sum(REAL_IQR[k][0] <= SHIPPED[k] <= REAL_IQR[k][1] for k in REAL_IQR)
    print(f"  PARAMETER-FREE lead field lands inside the real IQR on {hits}/5 metrics.")
    print(f"  The fitted Gaussian mixture lands inside on {ship_hits}/5, using 31 invented rows.")
    print(f"""
  READ THE near/far RELATIONSHIP, not the individual numbers. The Gaussian mixture's failure was
  structural: near-pair AT OR ABOVE real while far-pair and PC1 BELOW it, in all 21 configurations
  swept, because a separable model admits only one function of distance. The question here is
  whether real head geometry produces the real relationship without being asked to.

  near/far ratio -- real {REAL['near'] / REAL['far']:.2f}, "
  shipped {SHIPPED['near'] / SHIPPED['far']:.2f}, lead field {white['near'] / white['far']:.2f}.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
