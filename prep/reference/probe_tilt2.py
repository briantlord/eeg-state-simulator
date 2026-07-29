"""P2 + P3, corrected: SOS-form cascaded tilt filter.

Fixes from the first pass:
  - sign: g = +dchi/2 yields PSD tilt f^(+dchi). The earlier g = -dchi/2 gave the
    opposite sense. Recorded because this is exactly the sign that would silently
    invert the wake/sleep phase reversal in Build-Plan 5.2.
  - numerics: transfer-function form (zpk2tf + lfilter) OVERFLOWS for these cascades
    (n up to 24 poles). Second-order sections are mandatory, not a preference.
"""
import numpy as np
from scipy import signal as sps

FS = 256.0
BAND = (1.0, 45.0)


def design_tilt_sos(dchi, poles_per_decade=4, fs=FS, band=BAND, pad=1.0):
    """SOS for a PSD tilt of f^(+dchi) across `band`, unity gain at band centre."""
    g = dchi / 2.0
    f_lo = band[0] * 10 ** (-pad)
    f_hi = min(band[1] * 10 ** pad, 0.45 * fs)
    n = max(2, int(round(np.log10(f_hi / f_lo) * poles_per_decade)))
    D = (f_hi / f_lo) ** (1.0 / (n - 1))

    pf = f_lo * D ** np.arange(n)
    zf = pf * D ** g
    p = -2 * np.pi * pf
    z = -2 * np.pi * zf
    fc = np.sqrt(band[0] * band[1])
    w = 2j * np.pi * fc
    k = float(np.abs(np.prod(1 - w / p) / np.prod(1 - w / z)))

    zd, pd, kd = sps.bilinear_zpk(z, p, k, fs)
    return sps.zpk2sos(zd, pd, kd), pf


def slope_profile(sos, dchi, nfreq=400):
    f = np.logspace(np.log10(BAND[0]), np.log10(BAND[1]), nfreq)
    _, h = sps.sosfreqz(sos, worN=2 * np.pi * f / FS)
    slope = np.gradient(2 * np.log10(np.abs(h)), np.log10(f))
    return slope, slope - dchi


print("P2 - achieved PSD tilt across 1-45 Hz  (SOS form, target = +dchi)")
print(f"{'dchi':>6} {'ppd':>5} {'n':>4} {'mean':>9} {'ripple p-p':>11} {'max|err|':>9}")
print("-" * 48)
for dchi in [0.2, 0.5, 1.0]:
    for ppd in [1, 2, 3, 4, 6, 8]:
        sos, pf = design_tilt_sos(dchi, ppd)
        slope, err = slope_profile(sos, dchi)
        print(f"{dchi:6.1f} {ppd:5d} {len(pf):4d} {slope.mean():+9.4f} "
              f"{np.ptp(slope):11.4f} {np.abs(err).max():9.4f}")
    print()

print("\nP3 - settling time (SOS), and stability check")
print(f"{'ppd':>5} {'n':>4} {'t99 (s)':>9} {'stable':>8} {'10s mod / t99':>14}")
print("-" * 44)
for ppd in [1, 2, 3, 4, 6, 8]:
    sos, pf = design_tilt_sos(0.5, ppd)
    imp = sps.sosfilt(sos, np.concatenate([[1.0], np.zeros(int(240 * FS))]))
    stable = np.all(np.isfinite(imp)) and np.abs(imp[-1]) < np.abs(imp).max() * 1e-3
    e = np.cumsum(imp ** 2)
    e = e / e[-1]
    t99 = np.searchsorted(e, 0.99) / FS
    print(f"{ppd:5d} {len(pf):4d} {t99:9.3f} {str(stable):>8} {10.0 / max(t99, 1e-9):14.2f}")

print("\nSettling is set by the LOWEST pole, which the 1-decade pad puts at 0.1 Hz.")
print("Sweep the low pad to see what settling costs in band accuracy:")
print(f"\n{'pad(dec)':>9} {'lowest pole':>12} {'t99 (s)':>9} {'ripple p-p':>11} {'mean err':>9}")
print("-" * 54)
for pad in [0.25, 0.5, 0.75, 1.0, 1.5]:
    sos, pf = design_tilt_sos(0.5, 4, pad=pad)
    slope, err = slope_profile(sos, 0.5)
    imp = sps.sosfilt(sos, np.concatenate([[1.0], np.zeros(int(240 * FS))]))
    e = np.cumsum(imp ** 2)
    e = e / e[-1]
    t99 = np.searchsorted(e, 0.99) / FS
    print(f"{pad:9.2f} {pf.min():12.4f} {t99:9.3f} {np.ptp(slope):11.4f} "
          f"{err.mean():+9.4f}")
