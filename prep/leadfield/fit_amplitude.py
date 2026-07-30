"""Re-fit `background_rms_uv` AND `alpha_amp` against two measured observables.

WHY BOTH, AND WHY IT TOOK A FAILED FIT TO SEE IT.

The first attempt fitted `background_rms_uv` alone against referenced Pz RMS and did not converge:
driving the background to 0.1 uV still left Pz at 16.7 uV, already above the real 14.8. In
wake_ec Pz is alpha's own peak electrode, so ALPHA dominates that channel, not the background. One
parameter cannot reach a target another parameter sets.

WHY THE AMPLITUDES MOVED AT ALL. Under the Gaussian mixture the mastoids saw the volume-conducted
pedestal, so a linked reference subtracted much of alpha along with it -- referenced Pz RMS
measured 10.0 uV against a real 14.8, and alpha was quietly being cancelled by its own reference.
That was Finding 18's defect, and topo_reference_far_field was invented to fight it. Under the
forward model the mastoids are real electrodes over bone and see little cortex, so alpha survives
referencing as it should, and the same registry amplitudes now measure 32.6 uV. Neither row
changed; what changed is that the reference stopped destroying the signal.

TWO OBSERVABLES, TWO PARAMETERS, so the fit is determined rather than a compromise:

  referenced Pz RMS         real 14.8 uV [12.5-16.8]   -- total amplitude
  alpha peak / aperiodic    real 16.15 [11.23-44.55]   -- alpha ABOVE its own background

These constrain the pair in different directions: raising the background raises Pz RMS and LOWERS
prominence, while raising alpha raises both. That is what makes the pair identifiable, and it is
why fitting either alone drifts.

Both rows are `invented` textbook intervals, so replacing their centres with a fit against
measured quantities is a strict improvement in standing. The relative width of each interval is
preserved: fitting a centre says nothing about how well that centre is known.
"""
import json
import re
import subprocess
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')
import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]
REG = ROOT / 'registry' / 'parameters.yaml'
FS = 256
TARGET_RMS = 14.8
TARGET_PROM = 16.15

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const r = composeState(4242, 'wake_ec', fs * 180, fs);
const ref = applyReference(r.channels, 'linked-mastoid');
const i = ref.labels.indexOf('Pz');
process.stdout.write(JSON.stringify({ pz: [...ref.channels[i]] }));
'''


def measure():
    f = ROOT / '.amp-probe.mts'
    f.write_text(HARNESS, encoding='utf8')
    try:
        p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                            str(f)], cwd=ROOT, capture_output=True)
        if p.returncode != 0:
            raise SystemExit(p.stderr.decode()[:1200])
        x = np.asarray(json.loads(p.stdout)['pz'], dtype=float)
    finally:
        f.unlink(missing_ok=True)
    rms = float(np.std(x))
    fr, pw = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS)
    ok = (fr > 1) & (fr < 45) & (pw > 0)
    fr, pw = fr[ok], pw[ok]
    fit = ((fr >= 2) & (fr <= 7)) | ((fr >= 16) & (fr <= 35))
    coef = np.polyfit(np.log10(fr[fit]), np.log10(pw[fit]), 1)
    resid = pw / 10 ** np.polyval(coef, np.log10(fr))
    prom = float(np.nanmax(resid[(fr >= 8) & (fr <= 12)]))
    return rms, prom


def read_interval(key):
    s = REG.read_text(encoding='utf8')
    m = re.search(rf"  {key}:\n    value: \{{kind: interval, lo: ([\d.]+), hi: ([\d.]+)", s)
    return float(m.group(1)), float(m.group(2))


def write_interval(key, lo, hi):
    s = REG.read_text(encoding='utf8')
    s2 = re.sub(rf"(  {key}:\n    value: \{{kind: interval, lo: )[\d.]+(, hi: )[\d.]+",
                rf"\g<1>{lo:.4g}\g<2>{hi:.4g}", s, count=1)
    assert s2 != s or (lo, hi) == read_interval(key), f'{key} row not matched'
    REG.write_text(s2, encoding='utf8')


def set_pair(bg_mid, al_mid, bw, aw):
    write_interval('background_rms_uv', bg_mid * (1 - bw / 2), bg_mid * (1 + bw / 2))
    write_interval('alpha_amp', al_mid * (1 - aw / 2), al_mid * (1 + aw / 2))
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)


bg0 = read_interval('background_rms_uv')
al0 = read_interval('alpha_amp')
bg_mid0, al_mid0 = sum(bg0) / 2, sum(al0) / 2
bw = (bg0[1] - bg0[0]) / bg_mid0
aw = (al0[1] - al0[0]) / al_mid0

print(f"start: background_rms_uv {bg0} (mid {bg_mid0:.2f}), alpha_amp {al0} (mid {al_mid0:.2f})")
print(f"target: Pz RMS {TARGET_RMS} uV, alpha/aperiodic {TARGET_PROM}\n")
print(f"  {'bg uV':>8}{'alpha pp':>10}{'Pz RMS':>9}{'alpha x':>9}{'err':>8}")

rows = []
try:
    for bg in (4.0, 6.0, 8.0, 10.0, 12.0):
        for al in (12.0, 18.0, 25.0, 35.0):
            set_pair(bg, al, bw, aw)
            rms, prom = measure()
            e = float(np.mean([abs(rms - TARGET_RMS) / TARGET_RMS,
                               abs(prom - TARGET_PROM) / TARGET_PROM]))
            rows.append((e, bg, al, rms, prom))
            print(f"  {bg:8.1f}{al:10.1f}{rms:9.2f}{prom:9.2f}{e:8.3f}")
    best = min(rows)
    set_pair(best[1], best[2], bw, aw)
    print(f"\n  FITTED: background_rms_uv mid {best[1]:.2f} uV, alpha_amp mid {best[2]:.1f} uV p-p")
    print(f"    Pz RMS {best[3]:.2f} (real {TARGET_RMS}), alpha/aperiodic {best[4]:.2f} "
          f"(real {TARGET_PROM});  mean relative error {best[0]:.3f}")
    print(f"    interval widths preserved at {bw:.0%} and {aw:.0%}")
    print("""
  snr_nominal MUST BE RE-SOLVED: it is the mix at which generated N3 meets the AASM criterion, and
  that criterion is measured against exactly the referenced amplitude just changed. `npm run
  calibrate`, then `npm run verify`.""")
except BaseException:
    write_interval('background_rms_uv', *bg0)
    write_interval('alpha_amp', *al0)
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True)
    raise
