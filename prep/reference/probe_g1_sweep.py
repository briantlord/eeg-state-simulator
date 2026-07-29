"""Characterize G1a vs G1b recovery error across chi, on clean aperiodic signal.

DECISIONS.md D3 asserts: "G1a will show larger recovery error than G1b."
This tests that assertion against the generative model the plan specifies,
L(f) = b - log10(k + f^chi) with k encoding a ~20 Hz knee.

Also computes the ANALYTIC local slope of the generative form over 30-45 Hz,
to separate structural bias from estimator noise.
"""
import numpy as np
from scipy import signal as sps
from specparam import SpectralModel

FS = 256
DUR = 300.0
KNEE_HZ = 20.0
N_SEEDS = 8


def synth_knee(n, fs, chi, k, b, rng):
    f = np.fft.rfftfreq(n, 1.0 / fs)
    log_p = b - np.log10(k + np.power(np.maximum(f, 1e-12), chi))
    amp = np.sqrt(np.power(10.0, log_p))
    amp[0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, len(f))
    phase[0] = 0.0
    if n % 2 == 0:
        phase[-1] = 0.0
    return np.fft.irfft(amp * np.exp(1j * phase), n)


def analytic_slope(chi, k, lo, hi):
    """LS slope of log10 P vs log10 f over [lo,hi] for the generative form."""
    f = np.logspace(np.log10(lo), np.log10(hi), 400)
    y = -np.log10(k + f ** chi)
    x = np.log10(f)
    return -np.polyfit(x, y, 1)[0]


n = int(DUR * FS)
print(f"{'chi':>5} {'G1a chi':>9} {'G1a err':>8} {'G1a knee':>9} "
      f"{'G1b chi':>9} {'G1b err':>8} {'analytic':>9}")
print("-" * 66)

rows = []
for chi in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]:
    k = KNEE_HZ ** chi          # knee frequency fixed at 20 Hz for every chi
    a_chi, a_knee, b_chi = [], [], []
    for s in range(N_SEEDS):
        rng = np.random.default_rng(1000 + s)
        x = synth_knee(n, FS, chi, k, 1.0, rng)
        f, p = sps.welch(x, FS, nperseg=int(4 * FS), noverlap=int(2 * FS))

        ma = SpectralModel(aperiodic_mode='knee', verbose=False)
        ma.fit(f, p, [1, 45])
        pa = dict(zip(ma.modes.aperiodic.params.labels, ma.get_params('aperiodic')))
        a_chi.append(pa['exponent'])
        a_knee.append(pa['knee'])

        mb = SpectralModel(aperiodic_mode='fixed', verbose=False)
        mb.fit(f, p, [30, 45])
        pb = dict(zip(mb.modes.aperiodic.params.labels, mb.get_params('aperiodic')))
        b_chi.append(pb['exponent'])

    a_med, b_med = np.median(a_chi), np.median(b_chi)
    knee_med = np.median(a_knee)
    knee_hz = np.sign(knee_med) * np.abs(knee_med) ** (1.0 / max(a_med, 1e-6))
    ana = analytic_slope(chi, k, 30, 45)
    rows.append((chi, a_med - chi, b_med - chi, ana - chi))
    print(f"{chi:5.1f} {a_med:9.3f} {a_med - chi:+8.3f} {knee_hz:8.1f}H "
          f"{b_med:9.3f} {b_med - chi:+8.3f} {ana:9.3f}")

print("\nmedian |error| across chi:")
print(f"  G1a (knee, 1-45)  : {np.median([abs(r[1]) for r in rows]):.4f}")
print(f"  G1b (fixed, 30-45): {np.median([abs(r[2]) for r in rows]):.4f}")
print(f"  G1b analytic      : {np.median([abs(r[3]) for r in rows]):.4f}"
      "   <- structural, not estimator noise")
