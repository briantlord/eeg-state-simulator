"""Fit the alpha topography to the whole 19-electrode profile, not to a frontal/occipital ratio.

t1m1_alpha_profile.py answered "does the profile match?" with: the ratio does, the SHAPE does not.
Normalised to each profile's own maximum, ours sits far below real through the middle of the head
-- central 0.231 against 0.406, temporal 0.266 against 0.445 -- while overshooting at Pz (0.841
against 0.653). Correlation 0.883, RMS 0.169.

THAT PATTERN IS THE SIGNATURE OF THE MODEL, not of a bad parameter value. A narrow Gaussian plus a
near-uniform pedestal produces exactly "sharp posterior peak, flat floor everywhere else". Real
alpha falls off SMOOTHLY from occipital through parietal, central and temporal to frontal. The
pedestal can lift the far end, but it cannot bend the middle.

SO THE SWEEP MOVES THE SOURCE WIDTH, `topo_sigma_alpha`, and lets the pedestal come down. A single
broad Gaussian is a smooth monotonic gradient -- the right shape -- and needs less help from a
pedestal that was only ever a way of faking a tail.

The frontal/occipital ratio Finding 18 fitted is still reported, because a shape fit that lost it
would be trading one match for another rather than improving.
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
FRONTAL = ['Fp1', 'Fp2', 'F3', 'Fz', 'F4']
OCCIPITAL = ['O1', 'O2', 'Pz']

#: (topo_sigma_alpha, topo_far_field_fraction). refFF and sigma_far stay at their fitted values.
GRID = [(0.35, 0.50), (0.55, 0.35), (0.75, 0.20), (0.95, 0.10), (1.20, 0.05)]
SEEDS = [4242, 4555]
EPOCHS = 4


def prominence(x, fs=FS):
    f, p = sps.welch(x, fs, nperseg=4 * fs, noverlap=2 * fs)
    ok = (f > 1) & (f < 45) & (p > 0)
    f, p = f[ok], p[ok]
    fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 35))
    coef = np.polyfit(np.log10(f[fit]), np.log10(p[fit]), 1)
    resid = p / 10 ** np.polyval(coef, np.log10(f))
    return float(np.nanmax(resid[(f >= 8) & (f <= 12)]))


real = {c: [] for c in ORDER}
n_sub = 0
for edf in sorted(REAL_DIR.glob('*.edf')):
    raw = mne.io.read_raw_edf(edf, preload=True, verbose=False)
    raw.rename_channels({c: c.replace('EEG ', '').split('-')[0].strip() for c in raw.ch_names})
    if not all(c in raw.ch_names for c in ORDER):
        continue
    raw.pick(ORDER)
    raw.resample(FS, verbose=False)
    d = raw.get_data() * 1e6
    for c in ORDER:
        real[c].append(prominence(d[list(raw.ch_names).index(c)]))
    n_sub += 1

rv = np.array([np.median(real[c]) for c in ORDER])
rn = (rv - 1) / (rv - 1).max()
r_front = float(np.mean([rv[ORDER.index(c)] for c in FRONTAL]))
r_occ = float(np.mean([rv[ORDER.index(c)] for c in OCCIPITAL]))
r_ratio = (r_front - 1) / (r_occ - 1)

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
ref_file = ROOT / '.alpha-fit-ref.mts'
ref_file.write_text(REF, encoding='utf8')
reg_path = ROOT / 'registry' / 'parameters.yaml'
original = reg_path.read_text(encoding='utf8')
work = Path(tempfile.mkdtemp(prefix='alpha_fit_'))

print(f"Real: PhysioNet EEGMAT, n = {n_sub}. Frontal/occipital excess ratio {r_ratio:.3f}.\n")
print(f"  {'sigma_a':>8} {'far frac':>9} {'profile r':>10} {'RMS':>7} {'f/o ratio':>10} "
      f"{'central':>8} {'temporal':>9}")
print("  " + "-" * 66)
print(f"  {'REAL':>8} {'':>9} {'1.000':>10} {'0.000':>7} {r_ratio:10.3f} "
      f"{rn[[ORDER.index(c) for c in ['C3','Cz','C4']]].mean():8.3f} "
      f"{rn[[ORDER.index(c) for c in ['T3','T4','T5','T6']]].mean():9.3f}")

rows = []
try:
    for sa, ff in GRID:
        patched = original
        old = '  topo_far_field_fraction:\n    value: {kind: scalar, v: '
        i = patched.index(old) + len(old)
        j = patched.index('}', i)
        patched = patched[:i] + str(ff) + patched[j:]
        # topo_sigma_alpha is a pending row; patch its provisional value.
        anchor = 'topo_sigma_alpha:         {value: {kind: pending}, provisional: {v: '
        k = patched.index(anchor) + len(anchor)
        m = patched.index(',', k)
        patched = patched[:k] + str(sa) + patched[m:]
        reg_path.write_text(patched, encoding='utf8')
        subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)
        subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True, check=True)

        acc = []
        for sd in SEEDS:
            out = work / f'a{sa}_f{ff}_{sd}'
            generate(out, seed=sd, state='wake_ec', epochs=EPOCHS)
            p = subprocess.run(
                ['node', '--experimental-strip-types', '--no-warnings', str(ref_file), str(out)],
                cwd=ROOT, capture_output=True)
            d = json.loads(p.stdout)
            arr = np.asarray(d['data'], dtype=float)
            acc.append([prominence(arr[d['labels'].index(c)]) for c in ORDER])
        ov = np.median(np.array(acc), axis=0)
        on = (ov - 1) / (ov - 1).max()
        corr = float(np.corrcoef(rn, on)[0, 1])
        rms = float(np.sqrt(np.mean((on - rn) ** 2)))
        o_front = float(np.mean([ov[ORDER.index(c)] for c in FRONTAL]))
        o_occ = float(np.mean([ov[ORDER.index(c)] for c in OCCIPITAL]))
        ratio = (o_front - 1) / (o_occ - 1)
        cen = on[[ORDER.index(c) for c in ['C3', 'Cz', 'C4']]].mean()
        tem = on[[ORDER.index(c) for c in ['T3', 'T4', 'T5', 'T6']]].mean()
        rows.append({'sa': sa, 'ff': ff, 'corr': corr, 'rms': rms, 'ratio': ratio,
                     'cen': cen, 'tem': tem})
        print(f"  {sa:8.2f} {ff:9.2f} {corr:10.3f} {rms:7.3f} {ratio:10.3f} "
              f"{cen:8.3f} {tem:9.3f}")
finally:
    ref_file.unlink(missing_ok=True)
    reg_path.write_text(original, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True)
    subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True)

best = min(rows, key=lambda r: r['rms'])
base = rows[0]
print(f"\n  shipped (sigma_a {base['sa']}, far {base['ff']}): "
      f"r = {base['corr']:.3f}, RMS {base['rms']:.3f}, ratio {base['ratio']:.3f}")
print(f"  best     (sigma_a {best['sa']}, far {best['ff']}): "
      f"r = {best['corr']:.3f}, RMS {best['rms']:.3f}, ratio {best['ratio']:.3f}")
print(f"""
  Read RMS, not correlation. Correlation is insensitive to exactly the error here: a profile that
  is uniformly too steep through the middle still rises and falls in the right order, so it
  correlates well while looking wrong. RMS against the normalised real profile does not forgive
  that, and the central and temporal columns show where the difference lives.""")
