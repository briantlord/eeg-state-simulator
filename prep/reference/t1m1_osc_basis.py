"""Choose the oscillation layer's spatial basis, analytically -- and validate the model first.

WHAT check_topo_rank.py ESTABLISHED. The oscillation layer has effective rank ~1.1 in EVERY
state -- wake_ec 1.08, n3 1.10 -- because each state drives ONE band from ONE centre. It only
becomes visible in N3, where delta at 150 uV p-p swamps a background that measures 3.44 on its
own; in wake_ec the background dominates and hides it. One defect, one state showing it.

A ring of sub-sources around the band's centre does not fix it: swept from 0.30 to 1.30 the rank
tops out at 1.26, because at `topo_far_field_fraction` = 0.50 every source is half a near-flat
pedestal and they all share it. Widening the ring cannot beat the term they have in common.

THE BACKGROUND LAYER ALREADY SOLVED THIS and its solution is in the same file: Finding 11 gave
the aperiodic background six regional sources and measured 3.44. The bands can borrow that basis
-- `osc_coherent_fraction` of the variance on the band's registered centre (the entry G6 checks,
unchanged) and the rest over the same six regional centres.

WHY THIS IS EXACT. Every source draws from its own substream, so the sources are independent and
the channel covariance is C = sum_g var_g w_g w_g^T with referencing a linear operator R. No
signal is generated; a sweep that took eight minutes as a generate-and-measure loop runs in under
a second, which is what makes fitting four coupled parameters affordable at all.

AND WHY IT IS VALIDATED BEFORE IT IS USED. An analytic surrogate that disagrees with the
generator is worse than no surrogate -- it produces confident numbers about a model nobody ships.
The first thing this prints is its own prediction against the generate-and-measure figures for
the shipped configuration. A first draft of this file failed exactly there, predicting wake_ec
rank 1.16 against a measured 3.20, because it scaled background_rms_uv by amp_pp_to_rms when
compose.ts does not -- an 8x error in the background variance, which is the term that decides
whether a state looks like its background or like its band. The check caught it; without the
check the whole sweep below would have been fitted to a model that was wrong by 8x.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
CH = mont['channels'] + mont['reference']
SCALP = [c['label'] for c in mont['channels']]
LABELS = [c['label'] for c in CH]
REFSET = {c['label'] for c in mont['reference']}

#: PhysioNet EEGMAT resting wake, linked-mastoid. There is no N3 in this corpus.
REAL = {'rank': 3.09, 'pc1': 0.534, 'near': 0.767, 'far': 0.440}
#: Generate-and-measure, shipped config, seed 4242, 3 epochs -- what the surrogate must reproduce.
MEASURED_SHIPPED = {'wake_ec': (3.20, 0.799, 0.323), 'n3': (1.10, None, 0.919)}
#: Same six regional centres the background uses: left/right x frontal/central/posterior.
BG_CENTRES = [(-0.5, 0.5), (0.5, 0.5), (-0.6, 0.0), (0.6, 0.0), (-0.45, -0.55), (0.45, -0.55)]

FRONTAL = ['Fp1', 'Fp2', 'F3', 'Fz', 'F4']
OCCIPITAL = ['O1', 'O2', 'Pz']


def sc(k):
    try:
        return R.scalar_value(k)
    except Exception:
        return R.provisional_value(k)


def point(key):
    """pointFromUncertainty: an interval row contributes its midpoint."""
    rec = R.record(key)['value']
    return rec['v'] if rec['kind'] == 'scalar' else (rec['lo'] + rec['hi']) / 2.0


ffSig = sc('topo_sigma_far')
refFf = sc('topo_reference_far_field')
nBg, bgSigma = int(sc('background_n_sources')), sc('topo_sigma_background')
PP_TO_RMS = sc('amp_pp_to_rms')


def topo(cx, cy, sigma, ff, sfar=None):
    """The shipped near+far mixture, so this measures the model as built, not an idealisation."""
    sf = ffSig if sfar is None else sfar
    w = []
    for ch in CH:
        d2 = (ch['x'] - cx) ** 2 + (ch['y'] - cy) ** 2
        near = np.exp(-d2 / (2 * sigma ** 2))
        far = np.exp(-d2 / (2 * sf ** 2))
        share = ff * refFf if ch['label'] in REFSET else ff
        w.append((1 - share) * near + share * far)
    w = np.asarray(w)
    return w / w.max()


ia = [LABELS.index(r) for r in REFSET]
Rm = np.zeros((len(SCALP), len(LABELS)))
for i, lab in enumerate(SCALP):
    Rm[i, LABELS.index(lab)] = 1.0
    for j in ia:
        Rm[i, j] -= 1.0 / len(ia)

PAIR_NEAR = []
PAIR_FAR = []
for i, a in enumerate(SCALP):
    for j, b in enumerate(SCALP):
        if j <= i:
            continue
        pa = next(x for x in CH if x['label'] == a)
        pb = next(x for x in CH if x['label'] == b)
        (PAIR_NEAR if np.hypot(pa['x'] - pb['x'], pa['y'] - pb['y']) < 0.6 else PAIR_FAR
         ).append((i, j))


def stats(cov):
    c = Rm @ cov @ Rm.T
    lam = np.linalg.eigvalsh(c)
    lam = lam[lam > 1e-12 * max(lam.max(), 1e-30)]
    d = np.sqrt(np.diag(c))
    corr = c / np.outer(d, d)
    return (float(lam.sum() ** 2 / (lam ** 2).sum()), float(lam.max() / lam.sum()),
            float(np.median([abs(corr[i, j]) for i, j in PAIR_NEAR])),
            float(np.median([abs(corr[i, j]) for i, j in PAIR_FAR])))


def bg_cov():
    """Mirrors compose.ts EXACTLY: nBg sources each of rms background_rms_uv/sqrt(nBg).

    background_0 is the uniform common mode and 1..nBg-1 are Gaussians at topo_sigma_background
    with NO far-field mixture -- make_projection.mjs builds the background before the near+far
    block and does not apply it there.

    NOTE: `background_global_fraction` is registered at 0.35 and described in both the registry
    and make_projection.mjs as setting how much variance the common mode carries, but NOTHING
    READS IT -- every background source gets equal rms in compose.ts and peak-1 weights in the
    projection, so the common mode actually carries 1/nBg. Mirrored as built, not as documented,
    because this file's job is to predict the generator. Reported separately.
    """
    per = (point('background_rms_uv') / np.sqrt(nBg)) ** 2
    c = per * np.outer(np.ones(len(CH)), np.ones(len(CH)))
    for i in range(1, nBg):
        gx, gy = BG_CENTRES[(i - 1) % len(BG_CENTRES)]
        w = topo(gx, gy, bgSigma, 0.0)
        c += per * np.outer(w, w)
    return c


def sensor_cov():
    """Per-channel independent, so it lands on the diagonal and RAISES rank. Omitting it would
    bias every prediction downward."""
    try:
        v = point('sensor_noise_rms_uv') ** 2
    except Exception:
        return np.zeros((len(CH), len(CH)))
    return v * np.eye(len(CH))


def band_cov(band, ff, coh, sfar=None, centres=BG_CENTRES):
    """Coherent centre + regional basis, at the band's registered amplitude and sigma."""
    sig = sc(f'topo_sigma_{band}')
    cx, cy = sc(f'topo_centre_{band}_x'), sc(f'topo_centre_{band}_y')
    var = (point(f'{band}_amp') / PP_TO_RMS) ** 2
    w = topo(cx, cy, sig, ff, sfar)
    c = var * coh * np.outer(w, w)
    if coh < 1.0:
        for gx, gy in centres:
            wr = topo(gx, gy, sig, ff, sfar)
            c += var * (1 - coh) / len(centres) * np.outer(wr, wr)
    return c


#: The bands each state actually drives, read from compose.ts's STATE_OSCILLATIONS.
STATE_BAND = {'wake_ec': ['alpha'], 'n2': ['theta'], 'n3': ['delta']}


def state_cov(state, ff, coh, sfar=None):
    c = bg_cov() + sensor_cov()
    for band in STATE_BAND[state]:
        c += band_cov(band, ff, coh, sfar)
    return c


# --- 0. VALIDATE THE SURROGATE ----------------------------------------------------------------
ffNow, cohNow = sc('topo_far_field_fraction'), 1.0
print("0. SURROGATE vs GENERATOR, shipped configuration (coherent = 1, i.e. one source per band).")
print(f"   {'state':>8} {'':>10} {'rank':>6} {'near':>6} {'far':>6}")
ok = True
for st, (mr, mn, mf) in MEASURED_SHIPPED.items():
    pr, _, pn, pf = stats(state_cov(st, ffNow, cohNow))
    print(f"   {st:>8} {'predicted':>10} {pr:6.2f} {pn:6.3f} {pf:6.3f}")
    print(f"   {'':>8} {'measured':>10} {mr:6.2f} "
          f"{(f'{mn:6.3f}' if mn is not None else '     -')} {mf:6.3f}")
    if abs(pr - mr) / mr > 0.25:
        ok = False
verdict = ('AGREES within 25%; the sweep below is trustworthy.' if ok else
           'DISAGREES. Do not read the sweep below -- fix the model first.')
print(f"   -> {verdict}\n")

# --- 1. the sweep ------------------------------------------------------------------------------
#
# topo_sigma_far IS IN THE SWEEP, and it is the dimension the earlier passes were missing.
#
# At the registered 2.5 the far Gaussian is near-flat across a montage two units wide -- the
# registry row says so in as many words, "broad enough that the far Gaussian is near-flat across
# the montage, so the fraction alone sets the tail". Combined with topo_reference_far_field, that
# leaves EVERY source carrying an identical residual pedestal of ff*(1 - refFf) = 0.35 after the
# mastoids are subtracted. An identical component in every source is a rank-1 term nothing
# downstream can break up, which is why the regional basis alone moved measured N3 only
# 1.10 -> 1.31 and why every pedestal sweep before it found N3 pinned near 1.
#
# A real dipolar far field is not flat -- the potential falls as a power law, so it is a GRADIENT,
# and a gradient centred on one source differs from a gradient centred on another. Narrowing
# sigma_far is what makes the pedestal source-specific rather than common.
print("1. REGIONAL BASIS + FAR-FIELD WIDTH, swept against the wake targets.")
print(f"   {'coh':>5} {'ffFrac':>7} {'s_far':>6} | {'ec rank':>8} {'near':>6} {'far':>6} |"
      f" {'n3 rank':>8} {'n3 far':>7} | {'alphaFO':>8} | {'err':>6}")
print("   " + "-" * 86)
print(f"   {'REAL':>5} {'':>7} {'':>6} | {REAL['rank']:8.2f} {REAL['near']:6.3f}"
      f" {REAL['far']:6.3f} | {'':>8} {'':>7} | {0.271:8.3f} | {0.0:6.3f}")

rows = []
for coh in (1.00, 0.70, 0.55, 0.45, 0.35):
    for ff in (0.70, 0.60, 0.50):
        for sfar in (2.5, 1.6, 1.2, 0.9):
            er, _, en, ef = stats(state_cov('wake_ec', ff, coh, sfar))
            nr, _, _, nf = stats(state_cov('n3', ff, coh, sfar))
            # Frontal/occipital ALPHA prominence proxy: the excess variance the alpha family adds
            # over background, frontal against occipital. Finding 18 fitted the real value 0.271.
            av = np.diag(Rm @ band_cov('alpha', ff, coh, sfar) @ Rm.T)
            fo = float(np.mean([av[SCALP.index(c)] for c in FRONTAL])
                       / np.mean([av[SCALP.index(c)] for c in OCCIPITAL]))
            err = float(np.mean([abs(er - REAL['rank']) / REAL['rank'],
                                 abs(en - REAL['near']) / REAL['near'],
                                 abs(ef - REAL['far']) / REAL['far'],
                                 abs(fo - 0.271) / 0.271]))
            rows.append((err, coh, ff, sfar, er, en, ef, nr, nf, fo))
            print(f"   {coh:5.2f} {ff:7.2f} {sfar:6.1f} | {er:8.2f} {en:6.3f} {ef:6.3f} |"
                  f" {nr:8.2f} {nf:7.3f} | {fo:8.3f} | {err:6.3f}")

rows.sort()
print("\n   TOP 5 by mean relative error on the wake targets:")
for e, coh, ff, sfar, er, en, ef, nr, nf, fo in rows[:5]:
    print(f"     coh {coh:.2f}  ffFrac {ff:.2f}  sigma_far {sfar:.1f}  ->  ec rank {er:.2f},"
          f" near {en:.3f}, far {ef:.3f}, alphaFO {fo:.3f} | N3 rank {nr:.2f} | err {e:.3f}")
print("""
   N3 IS REPORTED, NOT FITTED. The reference corpus is PhysioNet EEGMAT -- resting wake -- so
   there is no real N3 to fit against and none of the error column comes from it. Slow-wave sleep
   genuinely is more globally synchronous than wake, so N3 SHOULD land below the wake rank; what
   it must not do is sit at 1.1, which is one degenerate source rather than high synchrony.""")
