"""Invert for the SOURCE chi and knee, so the OUTPUT matches the real recordings.

THE MISTAKE THIS EXISTS TO FIX, made one step earlier in the same session.

t1m1_chi_knee_fit.py measured the real recordings and got chi = 0.850, knee = 9.87 Hz, then wrote
those numbers straight into `chi_wake_ec` and `knee_freq_wake_ec`. Measured back out of the
generator through the identical pipeline, they returned chi = 2.173 and knee = 16.58 Hz.

The registry rows are SOURCE parameters -- they describe the aperiodic process each background
mode is synthesised from. The fitted numbers are OUTPUT quantities -- properties of a
19-channel, average-referenced, spatially-mixed scalp signal. Setting one equal to the other
assumes the montage is transparent, and it is not: average referencing removes the spatially
common part of the signal, that part is low-frequency dominated, and removing it flattens the low
end and pushes the apparent knee up.

THAT IS THE SAME ERROR P13 EXISTS TO NAME, committed while closing P13. A parameter and an
observable are different quantities even when they share a symbol, and the fact that this one got
past someone who had just written a decision entry about it is the argument for inverting rather
than assigning.

So the source pair is SOLVED, not assigned: sweep (chi_source, knee_source), measure the generated
signal through exactly the pipeline the real recordings went through, and choose the pair whose
OUTPUT matches the real output. The registry then holds a source parameter whose consequence is
the measured target, which is what `snr_nominal` already does for amplitude.
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
FS, BAND = 256, (1.0, 20.0)

#: Measured from 8 EEGMAT recordings, average reference, knee-mode specparam over 1-20 Hz.
REAL_CHI, REAL_KNEE = 0.850, 9.87

H = '''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const r = composeState(4242, 'wake_ec', fs * 180, fs);
const ref = applyReference(r.channels, 'linked-mastoid');
process.stdout.write(JSON.stringify(ref.channels.map((c) => [...c])));
'''


def measure_output():
    from specparam import SpectralModel
    f = ROOT / '.invert-probe.mts'
    f.write_text(H, encoding='utf8')
    try:
        p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                            '--max-old-space-size=8192', str(f)], cwd=ROOT, capture_output=True)
        if p.returncode != 0:
            raise SystemExit(p.stderr.decode()[:1200])
        x = np.asarray(json.loads(p.stdout), dtype=float)
    finally:
        f.unlink(missing_ok=True)
    x = x - x.mean(axis=0, keepdims=True)           # the SAME average reference as the real side
    fr, pw = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS, axis=-1)
    sm = SpectralModel(aperiodic_mode='knee', verbose=False)
    sm.fit(fr, pw.mean(axis=0), list(BAND))
    ap = sm.get_params('aperiodic')
    chi, knee = float(ap[-1]), float(ap[1])
    kf = float(knee ** (1.0 / chi)) if knee > 0 and chi > 0 else float('nan')
    return chi, kf


def set_source(chi, kf):
    s = REG.read_text(encoding='utf8')
    s = re.sub(r"(  chi_wake_ec: \{value: \{kind: pending\}, provisional: \{v: )[\d.]+",
               rf"\g<1>{chi:.4g}", s, count=1)
    s = re.sub(r"(  knee_freq_wake_ec: \{value: \{kind: pending\}, provisional: \{v: )[\d.]+",
               rf"\g<1>{kf:.4g}", s, count=1)
    s = re.sub(r"(  k_wake_ec: \{value: \{kind: pending\}, provisional: \{v: )[\d.]+",
               rf"\g<1>{kf ** chi:.4f}", s, count=1)
    REG.write_text(s, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)


def current():
    s = REG.read_text(encoding='utf8')
    c = float(re.search(r"  chi_wake_ec: .*?provisional: \{v: ([\d.]+)", s).group(1))
    k = float(re.search(r"  knee_freq_wake_ec: .*?provisional: \{v: ([\d.]+)", s).group(1))
    return c, k


orig = current()
print(f"target OUTPUT (real, average ref): chi {REAL_CHI:.3f}, knee {REAL_KNEE:.2f} Hz")
print(f"source now: chi {orig[0]}, knee {orig[1]}\n")
print(f"  {'src chi':>9}{'src knee':>10} ->{'out chi':>10}{'out knee':>10}{'err':>9}")

rows = []
try:
    for cs in (0.85, 1.2, 1.6, 2.0):
        for ks in (1.0, 3.0, 6.0, 10.0):
            set_source(cs, ks)
            oc, ok = measure_output()
            e = float(np.mean([abs(oc - REAL_CHI) / REAL_CHI, abs(ok - REAL_KNEE) / REAL_KNEE]))
            rows.append((e, cs, ks, oc, ok))
            print(f"  {cs:9.2f}{ks:10.2f}   {oc:10.3f}{ok:10.2f}{e:9.3f}")
    best = min(rows)
    set_source(best[1], best[2])
    print(f"\n  SOLVED: chi_wake_ec = {best[1]}, knee_freq_wake_ec = {best[2]} Hz")
    print(f"    output chi {best[3]:.3f} (real {REAL_CHI}), knee {best[4]:.2f} Hz "
          f"(real {REAL_KNEE}); mean relative error {best[0]:.3f}")
    print("""
  THE REGISTRY NOW HOLDS A SOURCE PARAMETER WHOSE CONSEQUENCE IS THE MEASURED TARGET, not a copy
  of the target. `chi_wake_ec` is still the asymptotic exponent of the synthesised process, and
  `chi_inband_slope` is still the derived quantity a reader measures -- what changed is that the
  source value is now solved rather than assigned, so the two agree at the output instead of
  agreeing only in name.""")
except BaseException:
    set_source(*orig)
    raise
