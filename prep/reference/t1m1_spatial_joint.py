"""Fit the spatial model against ALL the real targets at once.

Reported: the EEG looks far too correlated. Measured, it is -- N3 effective rank 1.07 against a
real 3.09, PC1 0.967, median |corr| 0.950.

TWO PARTIAL FIXES ALREADY FAILED, and understanding why is what makes this probe the right shape.

  Splitting each band rhythm across `osc_n_sources` independent sub-sources took N3 from 1.07 to
  only 1.14. The reason is that the FAR-FIELD PEDESTAL is itself common mode: at
  topo_sigma_far = 2.5 the far term varies barely 27% across a montage two units wide, so every
  source carries a near-uniform component -- and independent realisations sharing one uniform
  topography still occupy exactly ONE spatial dimension. Adding sources cannot fix a rank problem
  that lives in the topography they share.

  Attenuating the pedestal at the mastoids (topo_reference_far_field) was added so frontal alpha
  would survive linked-mastoid referencing (Finding 18). It works, and it also stops the reference
  from removing the common mode -- which is the same common mode now inflating the correlation.

SO THE PARAMETERS ARE COUPLED AND CANNOT BE FITTED ONE AT A TIME. Fitting the pedestal against
alpha prominence alone drives correlation up; fitting it against correlation alone drives frontal
alpha to zero. Every previous sweep in this project moved one of them and measured one target.
This scores a configuration against five real quantities simultaneously and reports the trade
rather than hiding it.

The five targets, all from the same PhysioNet EEGMAT recordings under the same linked-mastoid
reference: effective rank, PC1 share, near-pair and far-pair correlation, and the
frontal/occipital alpha prominence ratio.
"""
import json
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np
from scipy import signal as sps

from prep import registry as R
from prep.epochio import generate

ROOT = Path(__file__).resolve().parents[2]
FS = int(R.scalar_value('fs'))

#: Measured in Finding 12 and Finding 18, same corpus, same reference.
REAL = {'rank': 3.09, 'pc1': 0.534, 'near': 0.767, 'far': 0.440, 'alpha_ratio': 0.271}

FRONTAL = ['Fp1', 'Fp2', 'F3', 'Fz', 'F4']
OCCIPITAL = ['O1', 'O2', 'Pz']

#: (far_field_fraction, sigma_far, reference_far_field, osc_coherent_fraction)
#
# The first pass swept the pedestal (fraction, width, reference attenuation) and found N3 pinned
# between 1.10 and 1.46 in every configuration while shrinking the pedestal moved far-field
# correlation AWAY from real, 0.323 -> 0.252. The pedestal was not the cause, and
# prep/reference/check_topo_rank.py then showed why: the oscillation layer is rank ~1.1 in every
# state because each state drives one band from one centre.
#
# So the pedestal is now HELD at the values Finding 18 fitted for alpha prominence, and the sweep
# is over `osc_coherent_fraction` alone -- the split between the band's coherent centre and the
# six regional sub-sources that replaced the failed ring. The analytic surrogate
# (t1m1_osc_basis.py) narrowed this to 0.45-0.70; these rows confirm it against the generator,
# because the surrogate underestimates wake_ec rank by ~0.7 and should not pick the value itself.
#
# THE SECOND PASS added topo_sigma_far and that is what finally moved N3. At the registered 2.5
# the far Gaussian is flat across the montage, so after the mastoids are subtracted every source
# keeps an IDENTICAL residual pedestal of ff*(1 - refFf) = 0.35 -- a rank-1 term common to all of
# them, which no basis downstream can break up. Narrowing sigma_far makes the pedestal a gradient
# centred on each source instead, which is also what a dipolar far field actually looks like.
#
# The surrogate is biased -- it under-predicts wake_ec rank by ~0.7 and over-predicts far
# correlation by ~0.13 -- so it is used to narrow the region, never to pick the value. These rows
# take its three best candidates to the generator.
GRID = [
    (0.50, 2.5, 0.30, 1.00),   # one source per band: what the complaint was about
    (0.50, 2.5, 0.30, 0.70),   # regional basis only, pedestal untouched
    (0.50, 1.6, 0.30, 0.45),
    (0.50, 1.2, 0.30, 0.35),
    (0.50, 0.9, 0.30, 0.35),
]
SEED = 4242
EPOCHS = 3

montage = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
POS = {c['label']: (c['x'], c['y']) for c in montage['channels']}

REF = r"""
import { applyReference } from './src/analysis/referencing.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const runDir = process.argv[2];
const man = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'));
const eps = readdirSync(runDir).filter((d) => d.startsWith('epoch_')).sort();
const nCh = man.channels.length;
const per = eps.map((e) => {
  const buf = readFileSync(join(runDir, e, 'signal.f64'));
  const all = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const n = all.length / nCh;
  return Array.from({ length: nCh }, (_, c) => all.subarray(c * n, (c + 1) * n));
});
const total = per.reduce((s, p) => s + p[0].length, 0);
const chans = Array.from({ length: nCh }, (_, c) => {
  const out = new Float64Array(total); let at = 0;
  for (const ep of per) { out.set(ep[c], at); at += ep[c].length; }
  return out;
});
const r = applyReference(chans, 'linked-mastoid');
process.stdout.write(JSON.stringify({ labels: r.labels, data: r.channels.map((c) => [...c]) }));
"""
ref_file = ROOT / '.joint-ref.mts'
ref_file.write_text(REF, encoding='utf8')


def referenced(run_dir):
    p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                        str(ref_file), str(run_dir)], cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(p.stderr.decode()[:1500])
    d = json.loads(p.stdout)
    return np.asarray(d['data'], dtype=float), d['labels']


def spatial(x, labels):
    xc = x - x.mean(axis=1, keepdims=True)
    lam = np.linalg.eigvalsh(np.cov(xc))
    lam = lam[lam > 0]
    c = np.corrcoef(xc)
    near, far = [], []
    for i, a in enumerate(labels):
        for j, b in enumerate(labels):
            if j <= i or a not in POS or b not in POS:
                continue
            dd = np.hypot(POS[a][0] - POS[b][0], POS[a][1] - POS[b][1])
            (near if dd < 0.6 else far).append(abs(c[i, j]))
    return {'rank': float(lam.sum() ** 2 / (lam ** 2).sum()),
            'pc1': float(lam.max() / lam.sum()),
            'near': float(np.median(near)), 'far': float(np.median(far))}


def prominence(x):
    f, p = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS)
    ok = (f > 1) & (f < 45) & (p > 0)
    f, p = f[ok], p[ok]
    fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 35))
    coef = np.polyfit(np.log10(f[fit]), np.log10(p[fit]), 1)
    resid = p / 10 ** np.polyval(coef, np.log10(f))
    return float(np.nanmax(resid[(f >= 8) & (f <= 12)]))


reg_path = ROOT / 'registry' / 'parameters.yaml'
original = reg_path.read_text(encoding='utf8')
work = Path(tempfile.mkdtemp(prefix='joint_'))


def patch_scalar(text, key, val):
    a = f'  {key}:\n    value: {{kind: scalar, v: '
    i = text.index(a) + len(a)
    j = text.index('}', i)
    return text[:i] + str(val) + text[j:]


def patch_prov(text, anchor, val):
    i = text.index(anchor) + len('provisional: {v: ')
    j = text.index(',', i)
    return text[:i] + str(val) + text[j:]


print("Joint spatial fit. Real targets from PhysioNet EEGMAT, linked-mastoid.\n")
print(f"  {'ffFrac':>7} {'s_far':>6} {'refFF':>6} {'oscCoh':>7} | "
      f"{'n3 rank':>8} {'n3 |corr|':>10} {'ec rank':>8} {'near':>6} {'far':>6} "
      f"{'alphaR':>7} | {'error':>6}")
print("  " + "-" * 96)
print(f"  {'REAL':>7} {'':>6} {'':>6} {'':>7} | {REAL['rank']:8.2f} {REAL['far']:10.3f} "
      f"{REAL['rank']:8.2f} {REAL['near']:6.3f} {REAL['far']:6.3f} "
      f"{REAL['alpha_ratio']:7.3f} | {0.0:6.3f}")

rows = []
try:
    for ff, sfar, reff, osc in GRID:
        t = original
        t = patch_scalar(t, 'topo_far_field_fraction', ff)
        t = patch_scalar(t, 'topo_reference_far_field', reff)
        t = patch_scalar(t, 'osc_coherent_fraction', osc)
        t = patch_prov(t, 'provisional: {v: 2.5, basis: "broad enough', sfar)
        reg_path.write_text(t, encoding='utf8')
        subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)
        subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True, check=True)

        out3 = work / f'n3_{ff}_{sfar}_{reff}_{osc}'
        generate(out3, seed=SEED, state='n3', epochs=EPOCHS)
        x3, l3 = referenced(out3)
        s3 = spatial(x3, l3)

        outw = work / f'ec_{ff}_{sfar}_{reff}_{osc}'
        generate(outw, seed=SEED, state='wake_ec', epochs=EPOCHS)
        xw, lw = referenced(outw)
        sw = spatial(xw, lw)
        fr = float(np.mean([prominence(xw[lw.index(c)]) for c in FRONTAL if c in lw]))
        oc = float(np.mean([prominence(xw[lw.index(c)]) for c in OCCIPITAL if c in lw]))
        aratio = (fr - 1) / (oc - 1) if oc > 1 else float('nan')

        # Relative error across five targets. N3's rank is included because it is the state that
        # failed; wake_ec carries the alpha and correlation targets.
        err = np.mean([
            abs(s3['rank'] - REAL['rank']) / REAL['rank'],
            abs(sw['rank'] - REAL['rank']) / REAL['rank'],
            abs(sw['near'] - REAL['near']) / REAL['near'],
            abs(sw['far'] - REAL['far']) / REAL['far'],
            abs(aratio - REAL['alpha_ratio']) / REAL['alpha_ratio'],
        ])
        rows.append({'ff': ff, 'sfar': sfar, 'reff': reff, 'osc': osc,
                     'n3rank': s3['rank'], 'n3corr': s3['far'], 'ecrank': sw['rank'],
                     'near': sw['near'], 'far': sw['far'], 'aratio': aratio, 'err': float(err)})
        print(f"  {ff:7.2f} {sfar:6.1f} {reff:6.2f} {osc:7.2f} | {s3['rank']:8.2f} "
              f"{s3['far']:10.3f} {sw['rank']:8.2f} {sw['near']:6.3f} {sw['far']:6.3f} "
              f"{aratio:7.3f} | {err:6.3f}")
finally:
    ref_file.unlink(missing_ok=True)
    reg_path.write_text(original, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True)
    subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True)

best = min(rows, key=lambda r: r['err'])
print(f"\n  BEST: ffFrac {best['ff']}, sigma_far {best['sfar']}, refFF {best['reff']}, "
      f"oscCoherent {best['osc']}  (mean relative error {best['err']:.3f})")
print(f"    N3 rank {best['n3rank']:.2f} (real {REAL['rank']:.2f}), "
      f"wake_ec rank {best['ecrank']:.2f}, near {best['near']:.3f} (real {REAL['near']:.3f}), "
      f"far {best['far']:.3f} (real {REAL['far']:.3f}), alpha ratio {best['aratio']:.3f} "
      f"(real {REAL['alpha_ratio']:.3f})")
print(f"""
  The first row is the configuration before sub-sources existed and the second is sub-sources
  alone -- together they show that adding sources to a shared uniform topography does almost
  nothing, which is why sigma_far and the reference attenuation had to move with it.""")
