"""T1-M1 -- how prominent is frontal alpha in real recordings, and in ours?

Reported after the first far-field fix: "the alpha is still not very prominent at all in the
frontal electrodes ... when I do recordings and see posterior alpha that large it always shows up
quite prominently in the frontal electrodes."

THE FIRST FIX WAS FITTED AGAINST THE WRONG QUANTITY. It matched far-pair CORRELATION and reported
a frontal/occipital alpha BAND-POWER ratio of 0.225 -- which looked adequate and was not, because
at a frontal electrode most of the 8-12 Hz band power is aperiodic background rather than alpha.
Band power cannot distinguish "there is an alpha rhythm here" from "there is broadband activity
here", and prominence is exactly that distinction.

WHAT PROMINENCE ACTUALLY IS: the height of the alpha bump ABOVE the aperiodic fit, which is what
makes a rhythm visible on a trace and what `compare_real.py` already computes for Pz. Measured per
channel it gives a frontal/occipital ratio that means what the eye means.

THE TARGET IS THE REAL DATA, not a guess. The same cached PhysioNet EEGMAT recordings are
measured the same way, so the sweep has an external number to hit.

TWO PARAMETERS, and the first fix moved the wrong one. `topo_far_field_fraction` scales the far
Gaussian, but `topo_sigma_far` = 1.2 caps what that Gaussian delivers: at a frontal-from-occipital
distance of ~1.4 montage units it is exp(-1.4^2/(2*1.2^2)) = 0.51, so even fraction 1.0 could only
reach ~0.5 -- and fraction 1.0 would flatten every topography into a pedestal. Widening sigma_far
makes the far term a near-uniform pedestal, which is what "volume conduction spreads it
everywhere" physically means, and lets the fraction control the pedestal's height independently.
Both are swept here.
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
import mne

from prep import registry as R
from prep.epochio import generate

ROOT = Path(__file__).resolve().parents[2]
FS = int(R.scalar_value('fs'))
REAL_DIR = ROOT / 'prep' / 'realdata'

FRONTAL = ['Fp1', 'Fp2', 'F3', 'Fz', 'F4']
OCCIPITAL = ['O1', 'O2', 'Pz']

#: (far_field_fraction, sigma_far, reference_far_field). The first row is what shipped before the
#: reference attenuation existed, kept so the sweep shows why it could not work: with the pedestal
#: reaching A1/A2 in full, linked-mastoid referencing cancels the frontal alpha it creates.
GRID = [
    (0.35, 1.2, 1.00),
    (0.50, 2.5, 0.30),
    (0.60, 3.0, 0.15),
    (0.70, 3.0, 0.15),
    (0.70, 4.0, 0.05),
]
SEEDS = [4242, 4555]
EPOCHS = 4


def alpha_prominence(x, fs=FS):
    """Height of the 8-12 Hz bump above an aperiodic fit, as a ratio (1.0 = no bump).

    The fit band excludes 7-14 Hz so the alpha peak cannot pull the baseline it is measured
    against -- the same construction compare_real.py uses for Pz.
    """
    f, p = sps.welch(x, fs, nperseg=4 * fs, noverlap=2 * fs)
    ok = (f > 1) & (f < 45) & (p > 0)
    f, p = f[ok], p[ok]
    fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 35))
    coef = np.polyfit(np.log10(f[fit]), np.log10(p[fit]), 1)
    resid = p / 10 ** np.polyval(coef, np.log10(f))
    band = (f >= 8) & (f <= 12)
    return float(np.nanmax(resid[band]))


def ratio_for(sig, labels):
    """Frontal / occipital alpha prominence, both measured above their own aperiodic fits."""
    def mean_over(names):
        vals = [alpha_prominence(sig[labels.index(n)]) for n in names if n in labels]
        return float(np.mean(vals))
    fr, oc = mean_over(FRONTAL), mean_over(OCCIPITAL)
    return fr, oc, (fr - 1.0) / (oc - 1.0) if oc > 1.0 else float('nan')


# ------------------------------------------------------------------- real data

print("Alpha prominence -- height of the 8-12 Hz bump above each channel's own aperiodic fit.")
print("A ratio of 1.0 means no bump at all.\n")

real_rows = []
for edf in sorted(REAL_DIR.glob('*.edf')):
    raw = mne.io.read_raw_edf(edf, preload=True, verbose=False)
    raw.rename_channels({c: c.replace('EEG ', '').split('-')[0].strip() for c in raw.ch_names})
    keep = [c for c in FRONTAL + OCCIPITAL if c in raw.ch_names]
    if len(keep) < 6:
        continue
    raw.pick(keep)
    raw.resample(FS, verbose=False)
    real_rows.append(ratio_for(raw.get_data() * 1e6, list(raw.ch_names)))

rf = float(np.median([r[0] for r in real_rows]))
ro = float(np.median([r[1] for r in real_rows]))
rr = float(np.median([r[2] for r in real_rows]))
print(f"  REAL (PhysioNet EEGMAT, n = {len(real_rows)}):")
print(f"    frontal prominence   {rf:.2f}x above its aperiodic fit")
print(f"    occipital prominence {ro:.2f}x")
print(f"    frontal/occipital excess ratio  {rr:.3f}\n")

# --------------------------------------------------------------------- sweep

reg_path = ROOT / 'registry' / 'parameters.yaml'
original = reg_path.read_text(encoding='utf8')
work = Path(tempfile.mkdtemp(prefix='t1m1_alpha_'))

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
ref_file = ROOT / '.t1m1-alpha-ref.mts'
ref_file.write_text(REF, encoding='utf8')

print(f"  {'frac':>6} {'s_far':>6} {'refFF':>6} {'front prom':>11} {'occ prom':>10} "
      f"{'ratio':>8} {'vs real':>9} {'w(Fz-A)/(Pz-A)':>15}")
print("  " + "-" * 82)

rows = []
try:
    for frac, sfar, reff in GRID:
        patched = original
        for key, val in (('topo_far_field_fraction', frac),
                         ('topo_reference_far_field', reff)):
            old = f'  {key}:\n    value: {{kind: scalar, v: '
            i = patched.index(old) + len(old)
            j = patched.index('}', i)
            patched = patched[:i] + str(val) + patched[j:]
        # sigma_far is a pending row: patch its provisional.
        oldp = "provisional: {v: 1.2, basis: \"broad enough"
        k = patched.index(oldp) + len('provisional: {v: ')
        m = patched.index(',', k)
        patched = patched[:k] + str(sfar) + patched[m:]
        reg_path.write_text(patched, encoding='utf8')
        subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)
        subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True, check=True)

        proj = json.loads((ROOT / 'data' / 'projection_10_20.json').read_text(encoding='utf8'))
        w = proj['generators']['alpha']['weights']
        ch = proj['channels']
        # The ratio that survives REFERENCING, which is the only one the display shows. A raw
        # Fz/Pz ratio looked healthy while the referenced one was negative.
        mast = 0.5 * (w[ch.index('A1')] + w[ch.index('A2')])
        w_ratio = (w[ch.index('Fz')] - mast) / (w[ch.index('Pz')] - mast)

        acc = []
        for sd in SEEDS:
            out = work / f'f{frac}_s{sfar}_{sd}'
            generate(out, seed=sd, state='wake_ec', epochs=EPOCHS)
            p = subprocess.run(
                ['node', '--experimental-strip-types', '--no-warnings', str(ref_file), str(out)],
                cwd=ROOT, capture_output=True)
            d = json.loads(p.stdout)
            acc.append(ratio_for(np.asarray(d['data'], dtype=float), d['labels']))
        fr = float(np.mean([a[0] for a in acc]))
        oc = float(np.mean([a[1] for a in acc]))
        ra = float(np.mean([a[2] for a in acc]))
        rows.append({'frac': frac, 'sfar': sfar, 'reff': reff, 'fr': fr, 'oc': oc, 'ratio': ra,
                     'err': abs(ra - rr), 'w': w_ratio})
        print(f"  {frac:6.2f} {sfar:6.1f} {reff:6.2f} {fr:11.2f} {oc:10.2f} {ra:8.3f} "
              f"{abs(ra - rr):9.3f} {w_ratio:15.3f}")
finally:
    ref_file.unlink(missing_ok=True)
    reg_path.write_text(original, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True)
    subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True)

best = min(rows, key=lambda r: r['err'])
shipped = rows[0]
print(f"\n  real frontal/occipital excess ratio: {rr:.3f}")
print(f"  pedestal reaching A1/A2 in full (refFF 1.00): {shipped['ratio']:.3f}  "
      f"(error {shipped['err']:.3f})")
print(f"  best (frac {best['frac']}, sigma_far {best['sfar']}, refFF {best['reff']}): "
      f"{best['ratio']:.3f}  (error {best['err']:.3f})")
print(f"""
  THE REFERENCE ATTENUATION IS THE LOAD-BEARING PARAMETER, not the fraction or the width. With the
  pedestal reaching A1/A2 in full (first row) the referenced frontal/occipital weight ratio is
  NEGATIVE, because the mastoids sit closer to an occipital source than Fp1 does and a linked
  reference subtracts exactly the common mode the pedestal adds. Attenuating it at the reference
  sites -- physically, the mastoid is over bone with no cortex beneath, which is why it is used as
  a reference at all -- is what lets any frontal alpha survive.

  The referenced weight ratio column is the one to read. A raw Fz/Pz ratio looked healthy at 0.24
  while the referenced value was -0.02, which is how this went unnoticed through the first fix.""")
