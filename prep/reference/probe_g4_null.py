"""Is G4's circular-shift surrogate null degenerate, as claimed?

CLAIM (from the critical-path analysis): with an alignment-sensitive coupling index
    MI = |<chi(t) * exp(i*phi(t))>|
and an ideal phase ramp phi(t) = 2*pi*f*t, circularly shifting phi by tau gives
    exp(i*phi(t+tau)) = exp(i*phi(t)) * exp(i*2*pi*f*tau)
so MI is multiplied by a UNIT-MAGNITUDE constant and is unchanged. The 200-surrogate
distribution then has ~zero spread and its 95th percentile equals the observed value,
so "coupling at f1 must exceed the 95th percentile" can never be satisfied.

Respiration is NOT an ideal ramp (breathmetrics: inspiration shorter than expiration,
plus state-dependent period jitter via resp_period_cv). So the practical question is:
how much spread does the null actually have for a REALISTIC respiration phase?
"""
import numpy as np

FS = 256.0
DUR = 300.0
F1 = 0.10
F2 = 0.25
N_SURR = 200
rng = np.random.default_rng(11)

n = int(DUR * FS)
t = np.arange(n) / FS


def mi_alignment(chi, phase):
    """Alignment-sensitive coupling index: magnitude of the mean resultant."""
    return np.abs(np.mean(chi * np.exp(1j * phase)))


def circ_shift_null(chi, phase, n_surr=N_SURR, rng=rng):
    shifts = rng.integers(1, len(phase), n_surr)
    return np.array([mi_alignment(chi, np.roll(phase, int(s))) for s in shifts])


def report(tag, chi, phase):
    obs = mi_alignment(chi, phase)
    null = circ_shift_null(chi, phase)
    p95 = np.percentile(null, 95)
    print(f"  {tag}")
    print(f"    observed MI      = {obs:.6e}")
    print(f"    null median      = {np.median(null):.6e}")
    print(f"    null 95th pct    = {p95:.6e}")
    print(f"    null spread(IQR) = {np.subtract(*np.percentile(null, [75, 25])):.6e}")
    print(f"    obs / p95        = {obs / p95:8.3f}   "
          f"{'PASSES' if obs > p95 else '*** CANNOT PASS ***'}")
    print()


print("=" * 68)
print("CASE A - ideal phase ramp (the analyst's stated case)")
print("=" * 68)
chi = 0.5 * np.cos(2 * np.pi * F1 * t)          # chi modulated at f1
phase_ideal = 2 * np.pi * F1 * t                 # phase reference AT f1, ideal ramp
report("chi at f1 vs ideal f1 ramp", chi, np.mod(phase_ideal, 2 * np.pi))

print("=" * 68)
print("CASE B - realistic respiration phase at f2, with period jitter")
print("=" * 68)


def resp_phase(f_mean, cv, n, fs, rng):
    """Phase of a breath series with lognormal period jitter (cv = resp_period_cv)."""
    ph = [0.0]
    tt = 0.0
    while tt < n / fs + 20:
        per = f_mean ** -1 * np.exp(rng.normal(0, cv) - cv ** 2 / 2)
        tt += per
        ph.append(ph[-1] + 2 * np.pi)
    ph = np.array(ph)
    times = np.concatenate([[0.0], np.cumsum(np.diff(ph) / (2 * np.pi) / f_mean)])
    # rebuild actual breath onset times consistent with drawn periods
    tt, onsets = 0.0, [0.0]
    rng2 = np.random.default_rng(99)
    while tt < n / fs + 20:
        tt += (1.0 / f_mean) * np.exp(rng2.normal(0, cv) - cv ** 2 / 2)
        onsets.append(tt)
    onsets = np.array(onsets)
    k = np.arange(len(onsets)) * 2 * np.pi
    return np.interp(np.arange(n) / fs, onsets, k)


for cv, label in [(0.02, "very regular  (cv=0.02, N3-like)"),
                  (0.10, "moderate      (cv=0.10)"),
                  (0.25, "irregular     (cv=0.25, REM-like)")]:
    ph2 = resp_phase(F2, cv, n, FS, rng)
    # chi still modulated at f1 only; respiration runs at f2 -> this is the f2 arm,
    # which SHOULD sit at chance
    report(f"chi at f1 vs respiration at f2, {label}",
           chi, np.mod(ph2, 2 * np.pi))

print("=" * 68)
print("CASE C - the f1 arm done properly: chi modulated BY the respiration phase")
print("=" * 68)
ph2 = resp_phase(F2, 0.10, n, FS, rng)
chi_coupled = 0.5 * np.cos(ph2)                  # genuine coupling to respiration
report("chi coupled to respiration vs that same respiration phase",
       chi_coupled, np.mod(ph2, 2 * np.pi))
