"""Does the generated alpha come in characteristic bursts?

Real posterior alpha waxes and wanes: bursts of roughly 0.5-2 s separated by intervals where
the rhythm is largely absent. A constant-amplitude narrowband signal reads as synthetic even
when its spectrum is right, which is the same failure mode as a pure sinusoid one level up.

Measured on the Hilbert envelope of the alpha band at Pz.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps
from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))
LO, HI = R.band_edges('alpha_band')


def alpha_envelope(x, fs=FS):
    b, a = sps.butter(4, [LO / (fs / 2), HI / (fs / 2)], 'bandpass')
    return np.abs(sps.hilbert(sps.filtfilt(b, a, x)))


def burst_stats(env, fs=FS, thresh_pct=75):
    """Bursts = runs above the given percentile of the envelope."""
    thr = np.percentile(env, thresh_pct)
    above = env > thr
    edges = np.diff(above.astype(int))
    starts = np.flatnonzero(edges == 1) + 1
    ends = np.flatnonzero(edges == -1) + 1
    if len(starts) == 0 or len(ends) == 0:
        return dict(n=0, dur=np.array([]), gap=np.array([]))
    if ends[0] < starts[0]:
        ends = ends[1:]
    if len(starts) > len(ends):
        starts = starts[:len(ends)]
    dur = (ends - starts) / fs
    gap = (starts[1:] - ends[:-1]) / fs
    return dict(n=len(dur), dur=dur, gap=gap)


run = generate(tempfile.mkdtemp(), seed=20260728, state='wake_ec', epochs=20)
sig, ch = run.concatenated()
x = sig[ch.index('Pz')]
env = alpha_envelope(x)

print(f"600 s of wake_ec at Pz, alpha band {LO}-{HI} Hz\n")
print("ENVELOPE STATISTICS")
print(f"  mean                    {env.mean():8.2f} uV")
print(f"  coefficient of variation{env.std()/env.mean():8.3f}")
print(f"  min / mean              {env.min()/env.mean():8.3f}   <- how close alpha gets to absent")
print(f"  p05 / p95               {np.percentile(env,5)/np.percentile(env,95):8.3f}")
print(f"  max / min ratio         {env.max()/env.min():8.1f}")

s = burst_stats(env)
print(f"\nBURSTS — raw envelope above its 75th percentile")
print(f"  count over 600 s        {s['n']:8d}   ({s['n']/10:.1f} per minute)")
print(f"  median duration         {np.median(s['dur']):8.2f} s")
print(f"  IQR duration            {np.percentile(s['dur'],25):.2f} - {np.percentile(s['dur'],75):.2f} s")
print(f"  median gap              {np.median(s['gap']):8.2f} s")

# The raw envelope of narrowband noise crosses any threshold repeatedly on the ~1/B timescale,
# so it fragments a real burst into many short runs. Every practical detector (YASA included)
# smooths first. The window is set to 1/B -- the intrinsic beat period, derived from the
# bandwidth -- rather than tuned until the answer looks right.
win = int(round(FS / (HI - LO)))
smooth = np.convolve(env, np.ones(win) / win, mode='same')

# Threshold at the INJECTED duty cycle, not at a fixed 75th percentile.
#
# A fixed percentile is degenerate when it coincides with the duty cycle: the threshold then
# sits exactly on the burst edge, where any wobble fragments one real burst into several
# detected ones. That is a property of the measurement, not of the signal, and it cost an hour
# of chasing the generator for a defect in the probe.
duty = R.uncertainty('alpha_burst_dur')[0:2]
rate = R.uncertainty('alpha_burst_rate')[0:2]
duty_cycle = (np.mean(duty) * np.mean(rate)) / 60
print(f"\ninjected duty cycle = {duty_cycle:.0%}  "
      f"(dur {np.mean(duty):.2f} s x rate {np.mean(rate):.0f}/min)")
ss = burst_stats(smooth, thresh_pct=100 * (1 - duty_cycle))
print(f"BURSTS — envelope smoothed over 1/B = {win/FS:.2f} s, threshold at half the duty cycle")
print(f"  count over 600 s        {ss['n']:8d}   ({ss['n']/10:.1f} per minute)")
print(f"  median duration         {np.median(ss['dur']):8.2f} s")
print(f"  IQR duration            {np.percentile(ss['dur'],25):.2f} - {np.percentile(ss['dur'],75):.2f} s")
print(f"  median gap              {np.median(ss['gap']):8.2f} s")

print(f"\nWHAT REAL ALPHA LOOKS LIKE (for comparison, not a gate)")
print(f"  burst duration          0.5 - 2 s")
print(f"  envelope CV             ~0.5 or higher; alpha nearly vanishes between bursts")
print(f"  min/mean                near 0")

# Where is the envelope's own energy? A burst rhythm has envelope power at 0.5-2 Hz.
f, p = sps.welch(env - env.mean(), FS, nperseg=8 * FS)
band = lambda lo, hi: np.trapz(p[(f >= lo) & (f <= hi)], f[(f >= lo) & (f <= hi)])
tot = band(0.01, 5)
print(f"\nENVELOPE SPECTRUM — where the waxing and waning lives")
for lo, hi in [(0.01, 0.1), (0.1, 0.3), (0.3, 1.0), (1.0, 3.0)]:
    print(f"  {lo:5.2f} - {hi:4.1f} Hz   {100*band(lo,hi)/tot:5.1f}%")
