"""Does the tilt filter do what it claims, and does modulating it manufacture sidebands?

This is the measurement Finding 5 said could not be made before the filter existed. It is not
G4 -- G4 has no agreed pass criterion yet -- but it is the evidence G4's criterion has to be
designed against, and it settles which coefficient scheme to ship.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
FS = int(R.scalar_value('fs'))

HARNESS = r'''
import { synthesizeAperiodic } from './src/core/generators/aperiodic.ts';
import { applyTimeVaryingTilt } from './src/core/filters/tilt.ts';
import { Rng } from './src/core/rng/xoshiro128pp.ts';

const fs = %(fs)d, n = fs * %(dur)d;
const mode = process.argv[2];
const x = synthesizeAperiodic(Rng.substream(5, 'tilt-probe'), n,
  { chi: 1.5, k: 50, rmsUv: 20 }, fs);

let dchi = new Float64Array(n);
if (mode === 'static') {
  dchi.fill(%(static)f);
} else {
  const f1 = %(f1)f, depth = %(depth)f;
  for (let i = 0; i < n; i++) dchi[i] = depth * Math.cos(2 * Math.PI * f1 * i / fs);
}
const y = applyTimeVaryingTilt(x, dchi, fs, { scheme: process.argv[3] });
process.stdout.write(Buffer.from(new Float64Array(y).buffer));
'''


def run_ts(mode, scheme, dur=300, static=0.0, f1=0.10, depth=0.5):
    src = HARNESS % dict(fs=FS, dur=dur, static=static, f1=f1, depth=depth)
    # Written inside the project tree so the relative imports in HARNESS resolve.
    f = ROOT / '.tilt-probe.mts'
    f.write_text(src, encoding='utf8')
    p = subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', str(f), mode, scheme],
        cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:1500])
    return np.frombuffer(p.stdout, dtype='<f8')


def slope(x, lo=1, hi=45):
    f, p = sps.welch(x, FS, nperseg=8 * FS, noverlap=4 * FS)
    m = (f >= lo) & (f <= hi)
    return -np.polyfit(np.log10(f[m]), np.log10(p[m]), 1)[0]


print("1. STATIC TILT — does a requested delta-chi arrive, and with which sign?")
base = run_ts('static', 'filterbank', dur=120, static=0.0)
s0 = slope(base)
print(f"   {'requested':>10} {'measured chi':>13} {'delta from 0':>13}")
for d in [-0.5, -0.2, 0.0, 0.2, 0.5]:
    y = run_ts('static', 'filterbank', dur=120, static=d)
    print(f"   {d:+10.2f} {slope(y):13.3f} {slope(y) - s0:+13.3f}")
print("   (generated at chi=1.5; a POSITIVE requested tilt must make the spectrum FLATTER,")
print("    i.e. lower chi, if `PSD ~ f^(+delta)` means what the module says)")

# ---- 2. modulated: sidebands? --------------------------------------------------
F1 = R.scalar_value('g4_f1')
print(f"\n2. MODULATED at f1 = {F1} Hz — does the coefficient scheme manufacture sidebands?")
print(f"   {'scheme':>12} {'f1 SNR dB':>10} {'2f1 rel dB':>11} {'3f1 rel dB':>11}")

for scheme in ['filterbank', 'blockwise']:
    y = run_ts('mod', scheme, dur=300, f1=F1, depth=0.5)
    # Track chi(t) by a sliding two-band log-power ratio, then look at ITS spectrum.
    win, hop = 4 * FS, FS // 4
    starts = np.arange(0, len(y) - win, hop)
    est = np.empty(len(starts))
    for i, s in enumerate(starts):
        f, p = sps.welch(y[s:s + win], FS, nperseg=win // 2)
        b1 = np.trapz(p[(f >= 2) & (f <= 8)], f[(f >= 2) & (f <= 8)])
        b2 = np.trapz(p[(f >= 16) & (f <= 40)], f[(f >= 16) & (f <= 40)])
        est[i] = np.log10(b1 / b2)
    fe = 1 / (hop / FS)
    e = (est - est.mean()) * sps.get_window('hann', len(est))
    sp = np.abs(np.fft.rfft(e)) ** 2
    fr = np.fft.rfftfreq(len(e), 1 / fe)
    at = lambda t: sp[np.argmin(np.abs(fr - t))]
    floor = np.median(sp[(fr > 0.4) & (fr < 1.5)])
    print(f"   {scheme:>12} {10*np.log10(at(F1)/floor):10.1f} "
          f"{10*np.log10(at(2*F1)/at(F1)):11.1f} {10*np.log10(at(3*F1)/at(F1)):11.1f}")

print("\n   Lower harmonic levels mean the modulation is applied more linearly. Harmonics of")
print("   f1 are what become intermodulation sidebands at f2 +/- f1 once respiration is")
print("   present, and those are what G4 exists to catch.")
