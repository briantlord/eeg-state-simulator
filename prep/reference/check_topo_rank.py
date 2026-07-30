"""How many spatial dimensions do the topographies THEMSELVES span?

The joint sweep found N3 pinned near rank 1 in every configuration -- 1.10 to 1.46 -- while
wake_ec sat at 3.2-3.8 against a real 3.09. Shrinking the far-field pedestal did not rescue N3
and made the far-field correlation WORSE (0.323 -> 0.252 against a real 0.440). So the pedestal
is not what is collapsing N3, and more sweeping would only keep confirming that.

THE SIGNALS ARE INDEPENDENT BY CONSTRUCTION -- each source draws from its own substream -- so the
channel covariance is exactly

    C = sum_g var_g * w_g w_g^T

and referencing is a linear operator R, giving C_ref = R C R^T. The effective rank of THAT is an
exact property of the projection file and the amplitudes, computable in milliseconds with no
signal generated at all. If the topographies of the sources active in a state span only one
dimension, no amount of independent noise driving them can produce more.

This asks the question the sweep could only answer by guessing: is the ring of sub-sources
actually separable, or is its radius small compared with the width of the source it surrounds?
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
proj = json.loads((ROOT / 'data' / 'projection_10_20.json').read_text(encoding='utf8'))
LABELS = proj['channels']
SCALP = proj['scalp']
REFS = proj['reference']


def scalar(k):
    return R.scalar_value(k)


def prov(k):
    try:
        return scalar(k)
    except Exception:
        return R.provisional_value(k)


def ref_matrix():
    """Linked mastoid: v_i - (A1 + A2)/2, restricted to the scalp rows."""
    m = np.zeros((len(SCALP), len(LABELS)))
    ia = [LABELS.index(r) for r in REFS]
    for i, lab in enumerate(SCALP):
        m[i, LABELS.index(lab)] = 1.0
        for j in ia:
            m[i, j] -= 1.0 / len(ia)
    return m


Rm = ref_matrix()


def eff_rank(cov):
    lam = np.linalg.eigvalsh(cov)
    lam = lam[lam > 1e-12 * max(lam.max(), 1e-30)]
    if lam.size == 0:
        return 0.0, 1.0
    return float(lam.sum() ** 2 / (lam ** 2).sum()), float(lam.max() / lam.sum())


def cov_of(entries):
    """entries: list of (generator_id, variance). Referenced channel covariance."""
    c = np.zeros((len(LABELS), len(LABELS)))
    for gid, var in entries:
        w = np.asarray(proj['generators'][gid]['weights'], dtype=float)
        c += var * np.outer(w, w)
    return Rm @ c @ Rm.T


# --- what each state actually contains -------------------------------------------------------
# rms from peak-to-peak the way compose.ts does it: a band-limited oscillation's p-p is about
# 2*sqrt(2) rms if it were a pure sinusoid, and compose uses the same conversion for all bands, so
# the RATIO between generators -- which is all that matters for a covariance shape -- is right.
def rms(amp_key):
    """Amplitudes are uncertainty intervals; compose.ts takes their midpoint via
    pointFromUncertainty, then divides by amp_pp_to_rms. Only the RATIO between generators
    matters for a covariance shape, but reading them the same way the generator does keeps this
    from drifting away from the code it is measuring."""
    rec = R.record(amp_key)['value']
    pp = rec['v'] if rec['kind'] == 'scalar' else (rec['lo'] + rec['hi']) / 2.0
    return pp / scalar('amp_pp_to_rms')


# Read from compose.ts rather than restated here, because the point being measured is what the
# shipped generator actually puts in each state -- and a hand-copied table is exactly the kind of
# drift that would make this probe agree with an assumption instead of the code.
_src = (ROOT / 'src' / 'core' / 'generators' / 'compose.ts').read_text(encoding='utf8')
_block = _src[_src.index('STATE_OSCILLATIONS'):]
_block = _block[:_block.index('\n};')]
STATES = {}
for _line in _block.splitlines():
    if ':' not in _line or 'generator:' not in _line and '[' not in _line:
        continue
    _m = re.match(r"\s*(\w+):\s*\[", _line)
    if _m:
        _cur = _m.group(1)
        STATES.setdefault(_cur, [])
    for _g, _a in re.findall(r"generator:\s*'(\w+)'.*?ampKey:\s*'(\w+)'", _line):
        STATES[_cur].append((_g, _a))
STATES = {k: v for k, v in STATES.items() if v}
bgN = int(scalar('background_n_sources'))
bgGlobal = scalar('background_global_fraction')
oscN = int(scalar('osc_n_sources'))
oscCoh = scalar('osc_coherent_fraction')


def background_entries(total_var):
    out = [('background_0', total_var * bgGlobal)]
    each = total_var * (1 - bgGlobal) / (bgN - 1)
    for i in range(1, bgN):
        out.append((f'background_{i}', each))
    return out


# The ring radius this probe swept. `osc_source_spread` was REMOVED from the registry once the
# sweep in section 3 showed the ring cannot exceed rank 1.26 at any radius; it is kept here as a
# literal so the measurement that retired it still runs. Section 1 no longer describes the
# shipped model -- the sub-sources now sit on the background's regional centres -- and is left
# in place because it is the evidence for why they had to move.
RING_SPREAD = 0.45  # @lit-ok the retired osc_source_spread; this probe is the record of its refutation

print("Effective rank of the SOURCE COVARIANCE -- exact, no signal generated.\n")
print(f"  osc_n_sources {oscN}, osc_coherent_fraction {oscCoh}, "
      f"ring spread {RING_SPREAD} (retired)\n")

# --- 1. can a band's own family span more than one dimension? --------------------------------
print("  A BAND'S OWN FAMILY, equal variance per source, referenced:")
print(f"    {'band':>8} {'sigma':>6} {'spread':>7} {'rank':>6} {'PC1':>7}   "
      f"{'(1 = the ring is indistinguishable from its centre)'}")
for band in ('alpha', 'beta', 'theta', 'delta'):
    sig = prov(f'topo_sigma_{band}')
    fam = [(band, oscCoh)] + [(f'{band}_s{k}', (1 - oscCoh) / oscN) for k in range(oscN)]
    er, pc1 = eff_rank(cov_of(fam))
    print(f"    {band:>8} {sig:6.2f} {RING_SPREAD:7.2f} {er:6.2f} {pc1:7.3f}")

# --- 2. the full state, oscillation layer only ------------------------------------------------
print("\n  OSCILLATION LAYER ONLY, at the registered amplitudes:")
print(f"    {'state':>8} {'rank':>6} {'PC1':>7}   dominant band (share of oscillation variance)")
for st, specs in STATES.items():
    ent, shares = [], {}
    for gen, akey in specs:
        v = rms(akey) ** 2
        shares[gen] = v
        ent.append((gen, v * oscCoh))
        for k in range(oscN):
            ent.append((f'{gen}_s{k}', v * (1 - oscCoh) / oscN))
    er, pc1 = eff_rank(cov_of(ent))
    tot = sum(shares.values())
    top = max(shares, key=shares.get)
    print(f"    {st:>8} {er:6.2f} {pc1:7.3f}   {top} {shares[top] / tot:.1%}")

# --- 3. how far must the ring go? -------------------------------------------------------------
print("\n  RING RADIUS SWEEP for delta, the band that dominates N3:")
print(f"    {'spread':>7} {'rank':>6} {'PC1':>7}")
sig_d = prov('topo_sigma_delta')
cx, cy = prov('topo_centre_delta_x'), prov('topo_centre_delta_y')
mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
chans = mont['channels'] + mont['reference']
ffFrac, ffSig = scalar('topo_far_field_fraction'), prov('topo_sigma_far')
refFf = scalar('topo_reference_far_field')
refset = {c['label'] for c in mont['reference']}


def synth_family(spread, n):
    fam = []
    for k in range(n):
        a = 2 * np.pi * k / n
        sx, sy = cx + spread * np.cos(a), cy + spread * np.sin(a)
        w = []
        for ch in chans:
            d2 = (ch['x'] - sx) ** 2 + (ch['y'] - sy) ** 2
            near = np.exp(-d2 / (2 * sig_d ** 2))
            far = np.exp(-d2 / (2 * ffSig ** 2))
            share = ffFrac * refFf if ch['label'] in refset else ffFrac
            w.append((1 - share) * near + share * far)
        w = np.asarray(w) / max(w)
        fam.append(w)
    return fam


for spread in (0.30, 0.45, 0.60, 0.80, 1.00, 1.30):
    fam = synth_family(spread, oscN)
    c = np.zeros((len(LABELS), len(LABELS)))
    wc = np.asarray(proj['generators']['delta']['weights'], dtype=float)
    c += oscCoh * np.outer(wc, wc)
    for w in fam:
        c += (1 - oscCoh) / oscN * np.outer(w, w)
    er, pc1 = eff_rank(Rm @ c @ Rm.T)
    print(f"    {spread:7.2f} {er:6.2f} {pc1:7.3f}")

print(f"""
  sigma_delta is {sig_d}. If the ring radius is small compared with it, the sub-sources are
  near-copies of the source they surround and splitting the amplitude between them buys nothing
  -- which is exactly what the empirical sweep measured (1.07 -> 1.14).

  NOTE ON THE N3 TARGET. The real corpus is PhysioNet EEGMAT: resting WAKE. It contains no N3, so
  3.09 is a wake number and N3 has no fitted target here. Real slow-wave sleep genuinely is more
  globally synchronous than wake, so N3 SHOULD read lower -- but the rank-1 the simulator produces
  is a degenerate single source, not high synchrony, and the difference is visible on the trace.""")

