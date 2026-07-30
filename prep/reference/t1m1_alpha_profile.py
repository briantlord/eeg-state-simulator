"""Does the alpha topography match electrode by electrode, or only on average?

Finding 18 fitted a frontal/occipital RATIO and matched it (0.256 against a real 0.271). A ratio
of two group means is a coarse target: many different topographies share it, including wrong ones.
This compares the full 19-electrode profile.

SHAPE IS COMPARED, NOT LEVEL. Our absolute prominence runs several times real -- that is
`alpha_amp` against the background, a different parameter -- so each profile is normalised by its
own maximum. Otherwise the comparison would be dominated by a scale factor nobody is asking about
and the topography would be invisible underneath it.

WHAT WOULD COUNT AS A MISMATCH: a profile that is too flat (alpha everywhere, a pedestal rather
than a posterior source), too peaked (no volume conduction, the original defect), or wrong in its
LATERAL structure -- our topography is a symmetric Gaussian about the midline, and real alpha
need not be.
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

ORDER = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']
SEEDS = [4242, 4555, 4888]
EPOCHS = 4


def prominence(x, fs=FS):
    f, p = sps.welch(x, fs, nperseg=4 * fs, noverlap=2 * fs)
    ok = (f > 1) & (f < 45) & (p > 0)
    f, p = f[ok], p[ok]
    fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 35))
    coef = np.polyfit(np.log10(f[fit]), np.log10(p[fit]), 1)
    resid = p / 10 ** np.polyval(coef, np.log10(f))
    return float(np.nanmax(resid[(f >= 8) & (f <= 12)]))


# ------------------------------------------------------------------ real
real = {c: [] for c in ORDER}
n_sub = 0
for edf in sorted(REAL_DIR.glob('*.edf')):
    raw = mne.io.read_raw_edf(edf, preload=True, verbose=False)
    raw.rename_channels({c: c.replace('EEG ', '').split('-')[0].strip() for c in raw.ch_names})
    have = [c for c in ORDER if c in raw.ch_names]
    if len(have) < len(ORDER):
        continue
    raw.pick(have)
    raw.resample(FS, verbose=False)
    d = raw.get_data() * 1e6
    for c in have:
        real[c].append(prominence(d[list(raw.ch_names).index(c)]))
    n_sub += 1

# ------------------------------------------------------------------ ours
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
ref_file = ROOT / '.alpha-profile-ref.mts'
ref_file.write_text(REF, encoding='utf8')
work = Path(tempfile.mkdtemp(prefix='alpha_prof_'))

ours = {c: [] for c in ORDER}
try:
    for sd in SEEDS:
        out = work / f's{sd}'
        generate(out, seed=sd, state='wake_ec', epochs=EPOCHS)
        p = subprocess.run(
            ['node', '--experimental-strip-types', '--no-warnings', str(ref_file), str(out)],
            cwd=ROOT, capture_output=True)
        d = json.loads(p.stdout)
        arr = np.asarray(d['data'], dtype=float)
        for c in ORDER:
            if c in d['labels']:
                ours[c].append(prominence(arr[d['labels'].index(c)]))
finally:
    ref_file.unlink(missing_ok=True)

# --------------------------------------------------------------- compare
rv = np.array([np.median(real[c]) for c in ORDER])
ov = np.array([np.median(ours[c]) for c in ORDER])
# Excess above 1.0 is the alpha; normalise each profile by its own maximum so SHAPE is compared.
rn = (rv - 1) / (rv - 1).max()
on = (ov - 1) / (ov - 1).max()

print(f"Alpha prominence profile, {len(ORDER)} electrodes, linked-mastoid, eyes-closed wake.")
print(f"REAL: PhysioNet EEGMAT, n = {n_sub}.  OURS: {len(SEEDS)} seeds x {EPOCHS * 30} s.\n")
print(f"  {'chan':>5} {'real':>8} {'ours':>8}   {'real norm':>9} {'ours norm':>9} {'diff':>7}")
print("  " + "-" * 54)
for i, c in enumerate(ORDER):
    print(f"  {c:>5} {rv[i]:8.2f} {ov[i]:8.2f}   {rn[i]:9.3f} {on[i]:9.3f} {on[i]-rn[i]:+7.3f}")

r_pearson = float(np.corrcoef(rn, on)[0, 1])
rms = float(np.sqrt(np.mean((on - rn) ** 2)))
print(f"\n  profile correlation {r_pearson:+.3f}   RMS difference {rms:.3f}")

# Where does each profile put its mass? A pedestal shows as a high floor.
print(f"\n  {'region':>12} {'real norm':>10} {'ours norm':>10}")
print("  " + "-" * 36)
for name, chans in (('frontopolar', ['Fp1', 'Fp2']), ('frontal', ['F7', 'F3', 'Fz', 'F4', 'F8']),
                    ('temporal', ['T3', 'T4', 'T5', 'T6']),
                    ('central', ['C3', 'Cz', 'C4']), ('parietal', ['P3', 'Pz', 'P4']),
                    ('occipital', ['O1', 'O2'])):
    idx = [ORDER.index(c) for c in chans]
    print(f"  {name:>12} {rn[idx].mean():10.3f} {on[idx].mean():10.3f}")

lat_r = abs(rn[ORDER.index('O1')] - rn[ORDER.index('O2')])
lat_o = abs(on[ORDER.index('O1')] - on[ORDER.index('O2')])
print(f"\n  left/right asymmetry at O1 vs O2:  real {lat_r:.3f}   ours {lat_o:.3f}")

print(f"""
  READ THE NORMALISED COLUMNS, not the raw ones: our absolute prominence runs high because
  alpha_amp sits high against the background, which is a different parameter from topography.

  Correlation {r_pearson:+.3f} over 19 electrodes with RMS {rms:.3f} is the headline. A profile
  that matched only on the frontal/occipital average would show a good ratio and a poor
  correlation here, which is exactly what this probe exists to catch.""")
