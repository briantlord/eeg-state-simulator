"""Measure G4's f2-arm per-seed false-exceedance rate over INDEPENDENT respiration draws.

D8 asserts the rate is 5% "by design". The review says it is a function of respiration
regularity, not of the percentile, and measured ~0.29 at cv=0.02. This checks that with the
probe's RNG bug fixed, so each seed genuinely sees a different respiration.
"""
import numpy as np

FS, DUR, F1, F2, N_SURR = 256.0, 300.0, 0.10, 0.25, 200
n = int(DUR * FS)
t = np.arange(n) / FS
chi = 0.5 * np.cos(2 * np.pi * F1 * t)


def resp_phase(f_mean, cv, n, fs, rng):
    onsets = [0.0]
    while onsets[-1] < n / fs + 20:
        onsets.append(onsets[-1] + (1.0 / f_mean) * np.exp(rng.normal(0, cv) - cv ** 2 / 2))
    onsets = np.array(onsets)
    return np.interp(np.arange(n) / fs, onsets, np.arange(len(onsets)) * 2 * np.pi)


def mi(chi, phase):
    return np.abs(np.mean(chi * np.exp(1j * phase)))


print("G4 f2-arm: per-seed exceedance rate over independent respiration realisations")
print(f"{'cv':>6} {'rate':>8} {'expected@20':>12} {'D8 assumes':>11}")
print("-" * 42)
for cv in [0.02, 0.05, 0.08, 0.10, 0.15, 0.25]:
    exceed = 0
    trials = 60
    for s in range(trials):
        rng = np.random.default_rng(5000 + s)
        ph = np.mod(resp_phase(F2, cv, n, FS, rng), 2 * np.pi)
        obs = mi(chi, ph)
        shifts = rng.integers(1, n, N_SURR)
        null = np.array([mi(chi, np.roll(ph, int(k))) for k in shifts])
        if obs > np.percentile(null, 95):
            exceed += 1
    rate = exceed / trials
    print(f"{cv:6.2f} {rate:8.3f} {rate*20:12.1f} {0.05:11.2f}")
