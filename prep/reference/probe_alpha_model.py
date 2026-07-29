"""Is bandpass-filtered noise the right generative model for alpha?

Three claims from the literature, tested against three candidate generators.

  1. Liley/Zhao (PLOS Comput Biol 2022): resting EEG is well described as a sum of
     stochastically driven DAMPED LINEAR OSCILLATORS. A single such process has a LORENTZIAN
     spectral peak. Butterworth-bandpassed noise does not -- it has a flat passband and steep
     skirts, i.e. a box, not a peak.
  2. Freyer et al. (J Neurosci 2009, 2011): alpha amplitude is BISTABLE, bursting between
     high- and low-amplitude modes. Not the Rayleigh envelope of a Gaussian process.
  3. Cole & Voytek (TiCS 2017): alpha is NON-SINUSOIDAL -- peak/trough asymmetry -- and that
     asymmetry manufactures spurious phase-amplitude coupling.

Candidates:
  A. bandpass-filtered white noise           <- what the generator does now
  B. AR(2) damped stochastic oscillator      <- the Liley form, discretized
  C. AR(2) with bistable damping             <- B plus the Freyer mechanism
"""
import numpy as np
from scipy import signal as sps

FS = 256.0
N = int(600 * FS)
F0 = 10.0
rng = np.random.default_rng(11)


def bandpass_noise(n, lo=8.0, hi=12.0, fs=FS, rng=rng):
    x = rng.standard_normal(n)
    b, a = sps.butter(4, [lo / (fs / 2), hi / (fs / 2)], 'bandpass')
    return sps.filtfilt(b, a, x)


def ar2(n, f0, bandwidth, fs=FS, rng=rng, r_series=None):
    """Damped stochastic oscillator: x'' + 2*gamma*x' + w0^2 x = xi(t), discretized as AR(2).

    Pole radius r = exp(-pi*B/fs) sets the damping; B is the -3 dB bandwidth in Hz.
    r -> 1 is a sharp resonance with long phase memory (a genuine oscillation);
    smaller r is broad and noise-like. One parameter spans both regimes.
    """
    w0 = 2 * np.pi * f0 / fs
    x = np.zeros(n)
    xi = rng.standard_normal(n)
    if r_series is None:
        r_series = np.full(n, np.exp(-np.pi * bandwidth / fs))
    for i in range(2, n):
        r = r_series[i]
        x[i] = 2 * r * np.cos(w0) * x[i - 1] - r * r * x[i - 2] + xi[i]
    return x


def ar2_bistable(n, f0, fs=FS, rng=rng, dwell_s=1.25):
    """Freyer's picture: switch between a weakly damped (high-amplitude) and a strongly
    damped (low-amplitude) mode. A subcritical Hopf system bursts between two modes rather
    than diffusing Gaussian-ly about one."""
    r_hi = np.exp(-np.pi * 1.0 / fs)    # sharp  -> high amplitude
    r_lo = np.exp(-np.pi * 6.0 / fs)    # broad  -> low amplitude
    r = np.empty(n)
    i, hi = 0, True
    while i < n:
        dur = int(rng.exponential(dwell_s * fs))
        r[i:i + dur] = r_hi if hi else r_lo
        i += dur
        hi = not hi
    return ar2(n, f0, None, fs, rng, r_series=r)


def analyse(name, x, fs=FS):
    x = x / x.std()
    f, p = sps.welch(x, fs, nperseg=int(8 * fs), noverlap=int(4 * fs))

    # --- peak shape: how boxy is it? Compare width at -3 dB vs at -10 dB.
    m = (f > 5) & (f < 16)
    fp, pp = f[m], p[m]
    pk = pp.max()

    def width_at(frac):
        above = pp >= pk * frac
        return fp[above].max() - fp[above].min() if above.any() else np.nan

    w3, w10 = width_at(10 ** -0.3), width_at(0.1)
    shape = w10 / w3  # Lorentzian ~3.0; a boxcar approaches 1.0

    # --- envelope distribution: Rayleigh or bimodal?
    b, a = sps.butter(4, [7 / (fs / 2), 14 / (fs / 2)], 'bandpass')
    env = np.abs(sps.hilbert(sps.filtfilt(b, a, x)))
    env = env / env.mean()
    # Rayleigh has skew 0.631 and CV 0.523 exactly.
    from scipy.stats import skew
    cv, sk = env.std() / env.mean(), skew(env)
    # bimodality coefficient: >0.555 suggests bimodality
    from scipy.stats import kurtosis
    g, k = skew(env), kurtosis(env)
    bc = (g ** 2 + 1) / (k + 3)

    # --- phase memory: how many cycles does the autocorrelation survive?
    ac = np.correlate(x[:int(60 * fs)], x[:int(60 * fs)], 'full')
    ac = ac[len(ac) // 2:]
    ac /= ac[0]
    env_ac = np.abs(sps.hilbert(ac))
    below = np.flatnonzero(env_ac < 1 / np.e)
    tau_cycles = (below[0] / fs * F0) if len(below) else np.nan

    print(f"  {name:32} {shape:6.2f} {cv:7.3f} {sk:7.3f} {bc:7.3f} {tau_cycles:8.1f}")
    return dict(shape=shape, cv=cv, skew=sk, bc=bc, tau=tau_cycles)


print("Comparing generative models for alpha, 600 s at 256 Hz\n")
print(f"  {'model':32} {'shape':>6} {'env CV':>7} {'skew':>7} {'bimod':>7} {'tau/cyc':>8}")
print("  " + "-" * 72)
analyse("A. bandpass noise (current)", bandpass_noise(N))
analyse("B. AR(2) damped osc, B=2 Hz", ar2(N, F0, 2.0))
analyse("B'. AR(2) damped osc, B=1 Hz", ar2(N, F0, 1.0))
analyse("C. AR(2) bistable damping", ar2_bistable(N, F0))
print()
print("  shape   = width at -10 dB / width at -3 dB.  Lorentzian ~3.0, boxcar -> 1.0")
print("  env CV  = 0.523 exactly for a Rayleigh envelope (i.e. filtered Gaussian noise)")
print("  skew    = 0.631 exactly for Rayleigh")
print("  bimod   = bimodality coefficient; >0.555 suggests two modes (Freyer)")
print("  tau/cyc = autocorrelation e-folding, in cycles: phase memory")
