"""Probe specparam 2.0 API: can we recover (chi, k) from a synthesized knee spectrum?

This is the exact operation G1a/G1b need. Establishes the working recipe.
"""
import numpy as np
from scipy import signal as sps
from specparam import SpectralModel

rng = np.random.default_rng(20260728)

FS = 256
DUR = 300.0
CHI_TRUE = 2.0
K_TRUE = 20.0 ** 2.0   # knee param such that knee freq = k**(1/chi) = 20 Hz
B_TRUE = 1.0


def synth_knee(n, fs, chi, k, b, rng):
    """FFT synthesis of L(f) = b - log10(k + f^chi)."""
    nf = n // 2 + 1
    f = np.fft.rfftfreq(n, 1.0 / fs)
    log_p = b - np.log10(k + np.power(np.maximum(f, 1e-12), chi))
    amp = np.sqrt(np.power(10.0, log_p))
    amp[0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, nf)
    phase[0] = 0.0
    if n % 2 == 0:
        phase[-1] = 0.0
    spec = amp * np.exp(1j * phase)
    return np.fft.irfft(spec, n)


n = int(DUR * FS)
x = synth_knee(n, FS, CHI_TRUE, K_TRUE, B_TRUE, rng)
print(f"signal: n={n} std={x.std():.4g}")

freqs, psd = sps.welch(x, FS, nperseg=int(4 * FS), noverlap=int(2 * FS))

# --- G1a: knee mode over 1-45 Hz ---
def report(model, tag):
    labels = model.modes.aperiodic.params.labels
    vals = model.get_params('aperiodic')
    print(f"  {tag}: " + "  ".join(f"{l}={v:+.4f}" for l, v in zip(labels, vals)))
    return dict(zip(labels, vals))


ma = SpectralModel(aperiodic_mode='knee', verbose=False)
ma.fit(freqs, psd, [1, 45])
print("\nG1a knee mode 1-45 Hz")
a = report(ma, "fit")
print(f"  TRUE chi={CHI_TRUE}  knee={K_TRUE:.1f} (knee freq {K_TRUE ** (1/CHI_TRUE):.1f} Hz)")
print(f"  chi error = {a['exponent'] - CHI_TRUE:+.4f}")

# --- G1b: fixed mode over 30-45 Hz ---
mb = SpectralModel(aperiodic_mode='fixed', verbose=False)
mb.fit(freqs, psd, [30, 45])
print("\nG1b fixed mode 30-45 Hz")
b = report(mb, "fit")
print(f"  chi error = {b['exponent'] - CHI_TRUE:+.4f}")

# --- null: white noise, chi = 0 ---
w = rng.standard_normal(n)
fw, pw = sps.welch(w, FS, nperseg=int(4 * FS), noverlap=int(2 * FS))
print("\nNULL white noise (chi=0)")
mn = SpectralModel(aperiodic_mode='fixed', verbose=False)
mn.fit(fw, pw, [1, 45])
report(mn, "fixed 1-45")
mnk = SpectralModel(aperiodic_mode='knee', verbose=False)
mnk.fit(fw, pw, [1, 45])
report(mnk, "knee  1-45")
