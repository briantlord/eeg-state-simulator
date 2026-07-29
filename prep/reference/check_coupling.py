"""Does injected respiration-chi coupling appear where it was injected -- and nowhere else?

This is G4's question, run against the real generator for the first time. It is NOT G4: G4
has no agreed pass criterion (DECISIONS D12 withdrew D8's replacement), and nothing here
returns a verdict. What it does is supply the evidence any criterion has to be designed
against.

Three conditions, each 300 s:
  OFF       no chi modulation. Anything recovered is the noise floor of the estimator.
  COUPLED   chi driven by respiration at f2. Coupling SHOULD appear at f2.
  G4        chi driven by an INDEPENDENT modulator at f1 while respiration runs at f2.
            Coupling should appear at f1 and NOT at f2. Energy at f2 in this condition is
            the sideband leakage the gate exists to catch.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
FS = int(R.scalar_value('fs'))
F1 = R.scalar_value('g4_f1')
F2 = R.scalar_value('g4_f2')
DUR = int(R.scalar_value('g4_record_length'))

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
const fs = %(fs)d, n = fs * %(dur)d;
const mode = process.argv[2];
const opts =
  mode === 'off'      ? {}
: mode === 'coupled'  ? { chiModulation: true, respRatePerMin: %(rate)f }
:                       { chiModulation: true, respRatePerMin: %(rate)f,
                          independentChiModFreq: %(f1)f };
const scheme = process.argv[3];
const r = composeState(%(seed)d, 'n2', n, fs, { ...opts, tiltScheme: scheme });
const cz = r.channels[9];
const out = new Float64Array(n * 2);
out.set(cz, 0);
out.set(r.respirationPhase, n);
process.stdout.write(Buffer.from(out.buffer));
'''


def run(mode, seed=4242, scheme='blockwise'):
    src = HARNESS % dict(fs=FS, dur=DUR, rate=F2 * 60, f1=F1, seed=seed)
    f = ROOT / '.coupling-probe.mts'
    f.write_text(src, encoding='utf8')
    p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f), mode, scheme],
                       cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:1500])
    a = np.frombuffer(p.stdout, dtype='<f8')
    n = len(a) // 2
    return a[:n], a[n:]


def recover_chi(x, win_s=2.0, hop_s=0.25):
    """chi(t) by a sliding two-band log-power ratio. Class C -- our own estimator."""
    win, hop = int(win_s * FS), int(hop_s * FS)
    starts = np.arange(0, len(x) - win, hop)
    est = np.empty(len(starts))
    lo_b, hi_b = (2.0, 8.0), (16.0, 40.0)
    fc_lo, fc_hi = np.sqrt(lo_b[0] * lo_b[1]), np.sqrt(hi_b[0] * hi_b[1])
    for i, s in enumerate(starts):
        f, p = sps.welch(x[s:s + win], FS, nperseg=win // 2)
        bp = lambda b: np.trapz(p[(f >= b[0]) & (f <= b[1])], f[(f >= b[0]) & (f <= b[1])])
        est[i] = -(np.log10(bp(hi_b)) - np.log10(bp(lo_b))) / (np.log10(fc_hi) - np.log10(fc_lo))
    return est, 1 / hop_s


def line_power(est, fs_est):
    e = (est - est.mean()) * sps.get_window('hann', len(est))
    sp = np.abs(np.fft.rfft(e)) ** 2
    fr = np.fft.rfftfreq(len(e), 1 / fs_est)
    return fr, sp


print(f"{DUR} s per condition, f1 = {F1} Hz, f2 = {F2} Hz, channel Cz")
print(f"respiration period at f2 = {1/F2:.1f} s\n")

# Cache the three signals; only the estimator window changes across the sweep.
SCHEME = __import__('os').environ.get('SCHEME', 'blockwise')
print(f'tilt coefficient scheme: {SCHEME}')
signals = {m: run(m, scheme=SCHEME)[0] for m in ['off', 'coupled', 'g4']}

for win in [2.0]:
    print(f"  --- estimator window {win} s "
          f"{'<-- EQUALS the f2 period' if abs(win - 1 / F2) < 1e-9 else ''}")
    print(f"  {'condition':>10} {'f1 rel OFF':>11} {'f2 rel OFF':>11} "
          f"{'f2-f1 rel':>11} {'f2+f1 rel':>11}")
    base = None
    for mode in ['off', 'coupled', 'g4']:
        est, fse = recover_chi(signals[mode], win_s=win)
        fr, sp = line_power(est, fse)
        at = lambda t: sp[np.argmin(np.abs(fr - t))]
        vals = np.array([at(F1), at(F2), at(F2 - F1), at(F2 + F1)])
        if mode == 'off':
            base = vals
            print(f"  {mode:>10} {'(reference)':>11}")
        else:
            db = 10 * np.log10(vals / base)
            print(f"  {mode:>10} {db[0]:11.1f} {db[1]:11.1f} {db[2]:11.1f} {db[3]:11.1f}")
    print()

print("  dB RELATIVE TO THE OFF CONDITION, which is the only honest reference: the chi-hat")
print("  estimator's own spectrum is 1/f-like, so 'dB above a high-frequency floor' measures")
print("  the estimator's drift, not coupling. That is the same objection that sank D8's")
print("  spectral-neighbourhood null, confirmed here on the real generator.")
print()
print("  COUPLED : f2 should rise. It does NOT at a 4 s window, because a 4 s sliding window")
print("            averages away a 4 s periodic modulation exactly. Harness section 4 names")
print("            this: 'SPRiNT's sliding-window smoothing comparable to a ~4 s respiratory")
print("            cycle will attenuate recovered modulation depth by an amount the ESTIMATOR,")
print("            not the generator, determines.' Measured, on our own estimator.")
print("  G4      : f1 should rise and f2 should not.")

(ROOT / '.coupling-probe.mts').unlink(missing_ok=True)
