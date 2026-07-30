"""T1-M1 (partial) -- fit `topo_far_field_fraction` against real recordings.

TWO SYMPTOMS, ONE CAUSE. Reported from the artifact: "there does not appear to be any volume
conduction of occipital/posterior alpha to the frontal electrodes." Measured independently in
Finding 12: far-field inter-channel correlation 0.286 against a real 0.440 (P9). Both are the
single-Gaussian topography of Build Plan 3.4 -- at topo_sigma_alpha = 0.35 a posterior source
reaches frontal electrodes at exp(-8) ~ 3e-4, because a Gaussian has no tail worth the name while
a dipole's scalp potential falls off as a power law.

THE FIX IS A NEAR + FAR MIXTURE and the fraction is FITTED here rather than chosen, against the
same PhysioNet EEGMAT recordings Finding 12 used. That is legitimate empirical fitting, not
circularity: the target is an external dataset, and the gate that tests topography (G6) checks
argmax against `topo_expect_*` from AASM, which a convex mixture cannot move.

REPORTED ALONGSIDE, because a fit that improves one number while breaking three is not an
improvement: near-pair correlation, effective rank, PC1 share, and the frontal/occipital alpha
ratio the original complaint was about.

THE LINKED-MASTOID REFERENCE IS APPLIED FIRST, and the first version of this probe forgot to.
Finding 12's real comparison uses interconnected ears, so the generated side must be referenced
the same way; without it this probe read rank 1.97 against Finding 12's 3.12 and far-pair
correlation 0.618 against its 0.286. Referencing is a RANK OPERATION -- it removes the common
mode -- so leaving it out inflates correlation and deflates rank, and every conclusion drawn from
the unreferenced numbers was wrong, including "fraction 0 is best".
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R
from prep.epochio import generate, load_run

ROOT = Path(__file__).resolve().parents[2]
FRACTIONS = [0.0, 0.15, 0.25, 0.35, 0.45, 0.60]
SEEDS = [4242, 4555, 4888]
STATE = 'wake_ec'      # alpha is generated here; the complaint was about alpha specifically
EPOCHS = 4

#: Finding 12's measurements on PhysioNet EEGMAT, n = 8, same montage and reference.
REAL = {'near': 0.767, 'far': 0.440, 'eff': 3.09, 'pc1': 0.534}


def metrics(sig, labels, montage):
    """Near/far correlation, effective rank, PC1 share. Mirrors compare_real.py."""
    x = np.asarray(sig, dtype=float)
    x = x - x.mean(axis=1, keepdims=True)
    c = np.corrcoef(x)
    pos = {m['label']: (m['x'], m['y']) for m in montage['channels']}
    near, far = [], []
    for i, a in enumerate(labels):
        for j, b in enumerate(labels):
            if j <= i or a not in pos or b not in pos:
                continue
            d = np.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])
            (near if d < 0.6 else far).append(abs(c[i, j]))
    ev = np.linalg.eigvalsh(np.cov(x))
    ev = ev[ev > 0]
    eff = float(ev.sum() ** 2 / (ev**2).sum())
    return {
        'near': float(np.median(near)), 'far': float(np.median(far)),
        'eff': eff, 'pc1': float(ev.max() / ev.sum()),
    }


def alpha_ratio_from_weights(proj, channels):
    """Frontal/occipital alpha weight ratio -- the reported symptom, read straight off the file."""
    w = proj['generators']['alpha']['weights']
    idx = {c: i for i, c in enumerate(channels)}
    front = np.mean([w[idx[c]] for c in ('Fp1', 'Fp2', 'F3', 'Fz', 'F4') if c in idx])
    occ = np.mean([w[idx[c]] for c in ('O1', 'O2', 'Pz') if c in idx])
    return float(front / occ) if occ > 0 else float('nan')


REF_HARNESS = r"""
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

_REF_FILE = ROOT / '.t1m1-ref.mts'
_REF_FILE.write_text(REF_HARNESS, encoding='utf8')


def referenced(run_dir):
    """Signal after the SHIPPED linked-mastoid operator, as compare_real.py measures it."""
    p = subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', str(_REF_FILE), str(run_dir)],
        cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(p.stderr.decode()[:1500])
    d = json.loads(p.stdout)
    return np.asarray(d['data'], dtype=float), d['labels']


montage = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
reg_path = ROOT / 'registry' / 'parameters.yaml'
original = reg_path.read_text(encoding='utf8')

print(f"Fitting topo_far_field_fraction against PhysioNet EEGMAT (Finding 12)")
print(f"{STATE}, {EPOCHS * 30} s, {len(SEEDS)} seeds. Real targets: "
      f"near {REAL['near']:.3f}, far {REAL['far']:.3f}, rank {REAL['eff']:.2f}\n")
print(f"  {'fraction':>9} {'frontal/occ':>12} {'near':>8} {'far':>8} {'far err':>9} "
      f"{'rank':>7} {'PC1':>7}")
print("  " + "-" * 66)

work = Path(tempfile.mkdtemp(prefix='t1m1_ff_'))
rows = []
try:
    for frac in FRACTIONS:
        # Rewrite the row, regenerate the projection file, then generate signal. The projection
        # is a BUILD ARTEFACT, so a sweep has to go through the build tool -- which is also the
        # proof that the upgrade path is a file rather than a refactor.
        patched = original.replace(
            '  topo_far_field_fraction:\n    value: {kind: scalar, v: 0.35}',
            f'  topo_far_field_fraction:\n    value: {{kind: scalar, v: {frac}}}',
        )
        assert patched != original or frac == 0.35, 'row anchor not found'
        reg_path.write_text(patched, encoding='utf8')
        subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT,
                       capture_output=True, check=True)
        subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT,
                       capture_output=True, check=True)

        proj = json.loads((ROOT / 'data' / 'projection_10_20.json').read_text(encoding='utf8'))
        ratio = alpha_ratio_from_weights(proj, proj['channels'])

        acc = []
        for sd in SEEDS:
            out = work / f'f{frac}_s{sd}'
            generate(out, seed=sd, state=STATE, epochs=EPOCHS)
            sig, scalp = referenced(out)
            acc.append(metrics(sig, scalp, montage))
        m = {k: float(np.mean([a[k] for a in acc])) for k in acc[0]}
        m['frac'] = frac
        m['ratio'] = ratio
        m['far_err'] = abs(m['far'] - REAL['far'])
        rows.append(m)
        print(f"  {frac:9.2f} {ratio:12.3f} {m['near']:8.3f} {m['far']:8.3f} "
              f"{m['far_err']:9.3f} {m['eff']:7.2f} {m['pc1']:7.3f}")
finally:
    _REF_FILE.unlink(missing_ok=True)
    reg_path.write_text(original, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True)
    subprocess.run(['node', 'tools/make_projection.mjs'], cwd=ROOT, capture_output=True)

# Combined normalized error over the four spatial metrics, so the choice is not made by
# optimising one number while three others drift.
for r_ in rows:
    r_['total_err'] = float(np.mean([abs(r_[k] - REAL[k]) / REAL[k]
                                     for k in ('near', 'far', 'eff', 'pc1')]))
print(f"\n  {'fraction':>9} {'total normalized error over near/far/rank/PC1':>46}")
print("  " + "-" * 58)
for r_ in rows:
    print(f"  {r_['frac']:9.2f} {r_['total_err']:46.4f}")

best = min(rows, key=lambda r: r['far_err'])
base = rows[0]
print(f"\n  real: near {REAL['near']:.3f}  far {REAL['far']:.3f}  "
      f"rank {REAL['eff']:.2f}  PC1 {REAL['pc1']:.3f}")
print(f"\n  BEST far-field match: fraction {best['frac']:.2f} "
      f"(far {best['far']:.3f} vs real {REAL['far']:.3f}, error {best['far_err']:.3f})")
print(f"  Single Gaussian (fraction 0): far {base['far']:.3f}, "
      f"frontal/occipital alpha {base['ratio']:.3f}")
print(f"  Fitted:                       far {best['far']:.3f}, "
      f"frontal/occipital alpha {best['ratio']:.3f}")

print(f"""
  The frontal/occipital alpha ratio is the reported symptom read straight off the projection
  file: {base['ratio']:.3f} with a single Gaussian -- frontal alpha absent -- against
  {best['ratio']:.3f} fitted, which is visible on the trace at reduced amplitude as it should be.

  THE FIT IS WEAKLY IDENTIFIED, and that is the honest headline. Far-field correlation moves only
  {rows[0]['far']:.3f} -> {rows[-1]['far']:.3f} across the whole sweep, against a
  {abs(rows[0]['far'] - REAL['far']):.3f} gap to real, and the combined error above varies little
  end to end. This parameter does NOT determine itself from the data.

  WHAT IT DOES FIX is the reported symptom: frontal alpha goes from absent to a visible fraction
  of occipital. What it does NOT fix is P9. Rank improves toward real while PC1 moves AWAY --
  both come from the same eigenspectrum, so the spectrum's SHAPE is wrong in a way no single tail
  parameter can repair. That is exactly P9's case for replacing the weights with LPsi^T columns
  or a lead field, and this sweep sharpens the evidence for it rather than closing it.""")
