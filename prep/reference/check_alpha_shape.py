"""Is the generated alpha non-sinusoidal, and in the way real alpha is?

Uses the cycle-by-cycle framework (bycycle, Cole & Voytek): each cycle is bounded by zero
crossings, and shape is summarized by rise-decay symmetry and peak-trough symmetry, both 0.5
for a sinusoid. Sharpness is the voltage difference across a few samples either side of an
extremum.

Also re-checks the properties D13 established, because a waveform change must not undo them.
"""
import sys
import tempfile

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps
from scipy.stats import skew, kurtosis

from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))
LO, HI = R.band_edges('alpha_band')


def cycle_shape(band, fs=FS, sharp_n=3):
    """rdsym, ptsym and log sharpness ratio, cycle by cycle."""
    # Segment TROUGH TO TROUGH, the bycycle definition. Bounding cycles by rising zero
    # crossings instead makes `rise` a quarter-cycle and `decay` a half-cycle, forcing a
    # baseline near 1/3 for ANY waveform -- a symmetric oscillator measured 0.316 that way,
    # and the bias swamped the effect being measured.
    troughs = [i for i in range(1, len(band) - 1)
               if band[i] < band[i - 1] and band[i] <= band[i + 1] and band[i] < 0]

    rd, pt, sharp_p, sharp_t = [], [], [], []
    for a, b in zip(troughs[:-1], troughs[1:]):
        seg = band[a:b]
        if len(seg) < 6:
            continue
        pk = a + int(np.argmax(seg))
        tr = a
        rise, decay = pk - a, b - pk
        if rise <= 0 or decay <= 0:
            continue
        rd.append(rise / (rise + decay))

        # peak-trough symmetry: fraction of the cycle spent above zero
        pt.append(float(np.sum(seg > 0)) / len(seg))

        if sharp_n <= pk < len(band) - sharp_n and sharp_n <= tr < len(band) - sharp_n:
            sharp_p.append(abs(band[pk] - band[pk - sharp_n]) + abs(band[pk] - band[pk + sharp_n]))
            sharp_t.append(abs(band[tr] - band[tr - sharp_n]) + abs(band[tr] - band[tr + sharp_n]))

    return (np.array(rd), np.array(pt),
            np.log(np.mean(sharp_p) / np.mean(sharp_t)) if sharp_p else np.nan)


def harmonic_ratios(x, f0, fs=FS):
    """Harmonic power relative to the fundamental, ABOVE the aperiodic background.

    Measured on the full signal, not the 8-12 Hz band: the harmonics live at 2*f0 and 3*f0,
    i.e. 20 and 30 Hz, and a bandpass filter around the fundamental removes the very thing
    being measured. An earlier version of this probe filtered first and reported exactly
    0.0000 harmonic content for a visibly non-sinusoidal waveform.

    The aperiodic component is divided out first, or the 1/f background dominates at 20-30 Hz
    and swamps the harmonic.
    """
    f, p = sps.welch(x, fs, nperseg=int(8 * fs), noverlap=int(4 * fs))
    fit = ((f >= 2) & (f <= 7)) | ((f >= 34) & (f <= 45))
    coef = np.polyfit(np.log10(f[fit]), np.log10(p[fit]), 1)
    with np.errstate(divide='ignore', invalid='ignore'):
        resid = p / 10 ** np.polyval(coef, np.log10(f))

    def excess(target):
        sel = np.abs(f - target) < 0.75
        return max(0.0, float(np.nanmax(resid[sel])) - 1.0)

    fund = excess(f0)
    return excess(2 * f0) / fund, excess(3 * f0) / fund


run = generate(tempfile.mkdtemp(), seed=20260728, state='wake_ec', epochs=20)
sig, ch = run.concatenated()
x = sig[ch.index('Pz')]

f0 = R.scalar_value('alpha_peak')

# WIDE band: keeps the harmonics, so the waveform shape survives to be measured.
bw, aw = sps.butter(4, [5 / (FS / 2), 35 / (FS / 2)], 'bandpass')
wide = sps.filtfilt(bw, aw, x)

# NARROW band: the conventional 8-12 Hz alpha filter.
bn, an = sps.butter(4, [LO / (FS / 2), HI / (FS / 2)], 'bandpass')
narrow = sps.filtfilt(bn, an, x)

rd_w, pt_w, sharp_w = cycle_shape(wide)
rd_n, pt_n, sharp_n = cycle_shape(narrow)

print("WAVEFORM SHAPE  (a sinusoid gives 0.5, 0.5, 0.0)")
print(f"  registry rdsym target    {R.scalar_value('alpha_shape_rdsym'):6.3f}")
print(f"\n  measured on 5-35 Hz (harmonics retained) -- what the generator injected:")
print(f"    cycles analysed        {len(rd_w):6d}")
print(f"    rise-decay symmetry    {np.median(rd_w):6.3f}")
print(f"    peak-trough symmetry   {np.median(pt_w):6.3f}")
print(f"    log sharpness ratio    {sharp_w:+6.3f}")
print(f"\n  measured on {LO:.0f}-{HI:.0f} Hz (conventional alpha filter):")
print(f"    cycles analysed        {len(rd_n):6d}")
print(f"    rise-decay symmetry    {np.median(rd_n):6.3f}")
print(f"    peak-trough symmetry   {np.median(pt_n):6.3f}")
print(f"    log sharpness ratio    {sharp_n:+6.3f}")
print("""
  BOTH READ 0.500, AND NEITHER IS EVIDENCE THE WAVEFORM IS SYMMETRIC. Two separate
  reasons, worth keeping apart:

    Narrowband filtering REMOVES the harmonics that carry the asymmetry, so 8-12 Hz
    reports a sinusoid whatever the true waveform. That is Cole & Voytek's own point
    and the reason bycycle segments broadband signals.

    Widening the band does not rescue it HERE, because alpha sits at ~12 uV RMS against
    a ~20 uV aperiodic background. Cycle detection then segments background wiggles
    rather than alpha cycles -- note the cycle count above, ~18/s against a 10 Hz
    rhythm. bycycle guards this with a burst-detection step; this probe does not.

  The generator's waveform shape is pinned instead by test/oscillations.test.ts, which
  measures the alpha source directly, and by the harmonic content below, which is the
  quantity a PAC estimator actually responds to and which DOES survive mixing.""")

h2, h3 = harmonic_ratios(x, f0)
print("\nHARMONIC CONTENT  (the mechanism by which shape manufactures spurious PAC)")
print(f"  2*f0 / f0   ({2*f0:.0f} Hz)     {h2:6.4f}   even harmonic <- rise-decay asymmetry")
print(f"  3*f0 / f0   ({3*f0:.0f} Hz)     {h3:6.4f}   odd harmonic  <- triangularity")

# --- D13's properties must survive the waveform change --------------------------
f, p = sps.welch(x, FS, nperseg=int(8 * FS), noverlap=int(4 * FS))
m_fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 40))
coef = np.polyfit(np.log10(f[m_fit]), np.log10(p[m_fit]), 1)
resid = p / 10 ** np.polyval(coef, np.log10(f))
m = (f > 6) & (f < 16)
fp, rp = f[m], resid[m]
pk = rp.max()


def width_at(frac):
    sel = rp >= 1 + (pk - 1) * frac
    return fp[sel].max() - fp[sel].min() if sel.any() else np.nan


env = np.abs(sps.hilbert(narrow))
env = env / env.mean()
g, k = skew(env), kurtosis(env)

print("\nDID D13's PROPERTIES SURVIVE?")
print(f"  peak shape ratio         {width_at(0.1)/width_at(10**-0.3):6.2f}   Lorentzian ~3")
print(f"  envelope CV              {env.std():6.3f}   Rayleigh = 0.523")
print(f"  bimodality coefficient   {(g**2 + 1)/(k + 3):6.3f}   >0.555 = two modes")
