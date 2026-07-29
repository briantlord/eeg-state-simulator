"""Does the SHIPPED generator's alpha match what the literature says about real alpha?

Three testable claims, measured on generated wake_ec at Pz after subtracting nothing --
this is the composed signal a user would export, background and sensor noise included.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps
from scipy.stats import skew, kurtosis
from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))

run = generate(tempfile.mkdtemp(), seed=20260728, state='wake_ec', epochs=20)
sig, ch = run.concatenated()
x = sig[ch.index('Pz')]

f, p = sps.welch(x, FS, nperseg=int(8 * FS), noverlap=int(4 * FS))

# --- 1. peak SHAPE: Lorentzian resonance, or a boxcar? --------------------------
# Remove the aperiodic background first, so the peak is measured, not the 1/f.
m_fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 40))
coef = np.polyfit(np.log10(f[m_fit]), np.log10(p[m_fit]), 1)
resid = p / 10 ** np.polyval(coef, np.log10(f))

m = (f > 6) & (f < 16)
fp, rp = f[m], resid[m]
pk = rp.max()
f_peak = fp[np.argmax(rp)]


def width_at(frac):
    a = rp >= 1 + (pk - 1) * frac
    return fp[a].max() - fp[a].min() if a.any() else np.nan


w3, w10 = width_at(10 ** -0.3), width_at(0.1)
print("1. PEAK SHAPE  (Lorentzian resonance ~3.0; boxcar -> 1.0)")
print(f"     peak at                {f_peak:6.2f} Hz   (injected {R.scalar_value('alpha_peak'):.1f} Hz)")
print(f"     -3 dB width            {w3:6.2f} Hz")
print(f"     -10 dB width           {w10:6.2f} Hz")
print(f"     shape ratio            {w10/w3:6.2f}      <- was 1.26 with bandpass noise")

# --- 2. envelope DISTRIBUTION: Rayleigh, or bistable? ---------------------------
lo, hi = R.band_edges('alpha_band')
b, a = sps.butter(4, [lo / (FS / 2), hi / (FS / 2)], 'bandpass')
env = np.abs(sps.hilbert(sps.filtfilt(b, a, x)))
env = env / env.mean()
g, k = skew(env), kurtosis(env)
bc = (g ** 2 + 1) / (k + 3)
print("\n2. ENVELOPE DISTRIBUTION  (Rayleigh = filtered Gaussian noise, which real alpha is NOT)")
print(f"     coefficient of var     {env.std():6.3f}      Rayleigh is exactly 0.523")
print(f"     skew                   {g:6.3f}      Rayleigh is exactly 0.631")
print(f"     bimodality coefficient {bc:6.3f}      >0.555 suggests two modes (Freyer)")

# --- 3. phase memory ------------------------------------------------------------
seg = sps.filtfilt(b, a, x)[:int(60 * FS)]
ac = np.correlate(seg, seg, 'full')
ac = ac[len(ac) // 2:]
ac /= ac[0]
env_ac = np.abs(sps.hilbert(ac))
below = np.flatnonzero(env_ac < 1 / np.e)
tau = below[0] / FS if len(below) else np.nan
print("\n3. PHASE MEMORY")
print(f"     autocorr e-folding     {tau:6.2f} s   = {tau*f_peak:.1f} cycles")
print(f"     (bandpass noise gave 1.8 cycles; a genuine resonance keeps phase longer)")

# --- 4. waveform symmetry -- the KNOWN GAP -------------------------------------
band = sps.filtfilt(b, a, x)
pk_idx, _ = sps.find_peaks(band)
tr_idx, _ = sps.find_peaks(-band)
n = min(len(pk_idx), len(tr_idx))
print("\n4. WAVEFORM SYMMETRY  (known gap: AR(2) is linear, so it cannot be asymmetric)")
print(f"     mean peak amplitude    {band[pk_idx[:n]].mean():6.2f} uV")
print(f"     mean trough amplitude  {band[tr_idx[:n]].mean():6.2f} uV")
print(f"     asymmetry ratio        {abs(band[pk_idx[:n]].mean()/band[tr_idx[:n]].mean()):6.3f}"
      "      1.000 = perfectly symmetric; real alpha is not")
