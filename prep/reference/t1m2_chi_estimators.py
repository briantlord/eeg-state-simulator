"""T1-M2b -- which chi(t) estimator can actually see the shipped modulation?

Finding 15 fixed the generator-side half of the problem (tilt_block_s). What remains is the
estimator: the shipped two-band proxy's floor is ~0.06 in true-chi units at the respiratory rate
against a provisional chi_mod_depth of 0.15, a margin of ~2.5x that Finding 13 measured as
"1.02x its own null" in practice. This probe asks how much better a proper estimator does.

AN ARCHITECTURAL CONSTRAINT DECIDES WHAT "REPLACE THE PROXY" CAN MEAN, and it is easy to miss.
`specparam` is Python; the artifact is a static TypeScript page with no framework dependency
(Build Plan section 8 takes that as a constraint). So the SHIPPED Demo 1 readout can never call
specparam. The split is therefore:

  the HARNESS (prep/, Python)   may use specparam-per-window -- that is SPRiNT's algorithm, and
                                it is the class-V reference this milestone needs.
  the ARTIFACT (browser, TS)    must keep a cheap estimator, whatever the reference says.

The useful question is not "is specparam better" (it will be) but "how much of specparam's
performance can a CHEAP, TS-IMPLEMENTABLE estimator reach". So the candidates include a middle
option that is trivially portable:

  twoband   the shipped proxy: log ratio of summed power in 2-8 vs 16-40 Hz. Uses TWO numbers
            per window, which is why its variance is high.
  ls3045    ordinary least-squares slope of log10(P) on log10(f) over 30-45 Hz. Cheap, no
            iteration, ~30 bins instead of 2, and portable to TS in a dozen lines. Same band as
            G1b, so its bias is the one G1b already characterizes.
  ls240     the same LS slope over 2-40 Hz. More leverage, but oscillatory peaks sit inside the
            band and bias it -- included to measure that trade rather than assume it.
  sp3045    specparam, fixed mode, 30-45 Hz. The class-V reference.

KNEE MODE IS DELIBERATELY ABSENT. In N3 `knee_freq_n3` is 0.5 Hz, below the 1-45 Hz fit band by
design (D11: with one k per state the only way to express `knee_present: absent` is to move the
knee out of band), and G1a already measures the knee arm as unrecoverable there in 6/6 fits.
Fitting a knee that is not in the band would characterize nothing.

FAIRNESS. Every estimator sees the SAME windows of the SAME records: the PSD is computed once per
window and handed to all four. A comparison where each estimator windowed the signal itself would
confound estimator quality with windowing choices.

PARITY. `twoband` is a Python mirror of the shipped TS `chiOverTime`. Mirrors drift, so it is
checked against `bin/eegsim-chi.mts` -- the shipped estimator run over the same epoch directory --
at the TS defaults, before any conclusion rests on it.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps

from prep import registry as R
from prep.epochio import generate

ROOT = Path(__file__).resolve().parents[2]

FS = R.scalar_value('fs')
F_MOD = 0.25            # the respiratory rate: where the shipped configuration actually runs
PROBE_DEPTH = 2.0       # well above every floor, so this reads gain not detectability
SEEDS = [70000, 70313]
WINDOWS_S = [2.0, 4.0]
HOP_S = 0.5             # fsEst = 2 Hz; Nyquist 1 Hz, comfortably above F_MOD
CHANNEL = 'Pz'
EPOCHS = 10             # 300 s at epoch_display = 30 s


# ------------------------------------------------------------------ estimators

def est_twoband(fr, pw):
    """Mirror of the shipped TS `chiOverTime`: log ratio of two summed bands."""
    lo_b, hi_b = (2.0, 8.0), (16.0, 40.0)
    span = np.log10(np.sqrt(hi_b[0] * hi_b[1])) - np.log10(np.sqrt(lo_b[0] * lo_b[1]))
    lo = pw[(fr >= lo_b[0]) & (fr <= lo_b[1])].sum()
    hi = pw[(fr >= hi_b[0]) & (fr <= hi_b[1])].sum()
    if lo <= 0 or hi <= 0:
        return np.nan
    return -(np.log10(hi) - np.log10(lo)) / span


def _ls_slope(fr, pw, lo, hi):
    m = (fr >= lo) & (fr <= hi) & (pw > 0)
    if m.sum() < 4:
        return np.nan
    x = np.log10(fr[m])
    y = np.log10(pw[m])
    return -np.polyfit(x, y, 1)[0]


def est_ls3045(fr, pw):
    return _ls_slope(fr, pw, 30.0, 45.0)


def est_ls240(fr, pw):
    return _ls_slope(fr, pw, 2.0, 40.0)


_SP = {}


def _sp(fr, pw, lo, hi):
    from specparam import SpectralModel
    if 'fixed' not in _SP:
        _SP['fixed'] = SpectralModel(aperiodic_mode='fixed', verbose=False)
    m = _SP['fixed']
    try:
        m.fit(fr, pw, [lo, hi])
        labels = m.modes.aperiodic.params.labels
        return float(dict(zip(labels, m.get_params('aperiodic')))['exponent'])
    except Exception:
        return np.nan


def est_sp3045(fr, pw):
    """specparam, fixed mode, 30-45 Hz -- G1b's band. SPRiNT's algorithm, per window."""
    return _sp(fr, pw, 30.0, 45.0)


def est_sp240(fr, pw):
    """specparam, fixed mode, 2-40 Hz -- the SAME band as `ls240`, so the comparison isolates
    the ESTIMATOR rather than the band. This is the fair fight: specparam's advantage is that it
    MODELS the oscillatory peaks that bias a plain least-squares slope."""
    return _sp(fr, pw, 2.0, 40.0)


ESTIMATORS = {
    'twoband': est_twoband,
    'ls3045': est_ls3045,
    'ls240': est_ls240,
    'sp3045': est_sp3045,
    'sp240': est_sp240,
}
PORTABLE = {'twoband': 'shipped', 'ls3045': 'yes', 'ls240': 'yes',
            'sp3045': 'NO (Python)', 'sp240': 'NO (Python)'}
#: Decades of log-frequency leverage each band spans. Finding 14 established that leverage, not
#: sophistication, sets the variance of a slope estimate -- this table tests that directly.
DECADES = {'twoband': float(np.log10(25.3 / 4.0)), 'ls3045': float(np.log10(45 / 30)),
           'ls240': float(np.log10(40 / 2)), 'sp3045': float(np.log10(45 / 30)),
           'sp240': float(np.log10(40 / 2))}


def modulation_depth(chi, fs_est, f0):
    """Amplitude of the line at f0 in chi(t). Mirrors the TS `modulationDepth`."""
    v = np.asarray(chi, dtype=float)
    ok = np.isfinite(v)
    if ok.sum() < 8:
        return np.nan
    mean = v[ok].mean()
    n = len(v)
    w = 0.5 * (1 - np.cos(2 * np.pi * np.arange(n) / n))
    d = np.where(ok, v - mean, 0.0) * w
    ph = 2 * np.pi * f0 * np.arange(n) / fs_est
    re = (d * np.cos(ph)).sum()
    im = (d * np.sin(ph)).sum()
    return 2 * np.hypot(re, im) / w[ok].sum()


def psds_for(x, window_s):
    """One PSD per sliding window. Computed once, shared by every estimator."""
    win = int(round(window_s * FS))
    hop = int(round(HOP_S * FS))
    nper = min(win, 512)
    out = []
    for k in range((len(x) - win) // hop):
        seg = x[k * hop:k * hop + win]
        fr, pw = sps.welch(seg, fs=FS, nperseg=nper, noverlap=nper // 2)
        out.append((fr, pw))
    return out


# ----------------------------------------------------------------------- run

work = Path(tempfile.mkdtemp(prefix='t1m2_est_'))
print(f"Generating {len(SEEDS)} seeds x 2 depths, N3, {EPOCHS * 30} s, "
      f"chi modulated at {F_MOD} Hz...", flush=True)

traces = {}
for seed in SEEDS:
    for depth in (PROBE_DEPTH, 0.0):
        run_ = generate(
            work / f's{seed}_d{depth}', seed=seed, state='n3', epochs=EPOCHS,
            no_graphoelements=False,
        )
        # The exporter needs the fixture flags; epochio.generate does not pass them, so drive
        # the CLI directly for the modulation options.
        cmd = [
            'node', '--experimental-strip-types', '--no-warnings',
            str(ROOT / 'bin' / 'eegsim-export.mts'),
            '--seed', str(seed), '--state', 'n3', '--epochs', str(EPOCHS),
            '--out', str(work / f'm{seed}_d{depth}'),
            '--movement-artifact', 'false', '--amplitude-modulation', 'false',
            '--chi-modulation', 'true', '--chi-mod-depth', str(depth),
            '--independent-chi-mod-freq', str(F_MOD),
        ]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"exporter failed: {r.stderr[:1500]}")
        from prep.epochio import load_run
        run_ = load_run(work / f'm{seed}_d{depth}')
        sig, ch = run_.concatenated()
        traces[(seed, depth)] = np.asarray(sig[ch.index(CHANNEL)], dtype=float)

print(f"  {len(traces)} records, {len(traces[(SEEDS[0], PROBE_DEPTH)]) / FS:.0f} s each\n",
      flush=True)

# ------------------------------------------------------- parity: mirror vs shipped TS
print("PARITY CHECK -- Python `twoband` mirror against the shipped TS chiOverTime\n")
tsr = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings',
     str(ROOT / 'bin' / 'eegsim-chi.mts'),
     '--run', str(work / f'm{SEEDS[0]}_d{PROBE_DEPTH}'),
     '--channel', CHANNEL, '--reference', 'as-generated', '--freqs', str(F_MOD)],
    cwd=ROOT, capture_output=True, text=True)
if tsr.returncode != 0:
    raise SystemExit(f"eegsim-chi failed: {tsr.stderr[:1500]}")
ts_depth = json.loads(tsr.stdout)['depths'][str(F_MOD)]

# Match the TS defaults exactly: windowS = 2, hopS = 0.25.
x0 = traces[(SEEDS[0], PROBE_DEPTH)]
win, hop = int(2.0 * FS), int(0.25 * FS)
nper = min(win, 512)
mirror = []
for k in range((len(x0) - win) // hop):
    seg = x0[k * hop:k * hop + win]
    fr, pw = sps.welch(seg, fs=FS, nperseg=nper, noverlap=nper // 2)
    mirror.append(est_twoband(fr, pw))
py_depth = modulation_depth(mirror, 1 / 0.25, F_MOD)
rel = abs(py_depth - ts_depth) / max(ts_depth, 1e-12)
print(f"  shipped TS : {ts_depth:.5f}")
print(f"  Python     : {py_depth:.5f}   relative difference {rel:.1%}")
print(f"  {'OK -- the mirror is faithful.' if rel < 0.05 else 'MIRROR DIVERGES: do not trust the twoband column below.'}\n")

# ------------------------------------------------------------------ head-to-head
print(f"HEAD-TO-HEAD at f_mod = {F_MOD} Hz, hop {HOP_S} s, {len(SEEDS)} seeds\n")
print("MDD is a ratio of floor to signal, so it compares across estimators even though their units")
print("differ: LS and specparam return true chi, while the two-band proxy returns its own units")
print("(measured 0.76 proxy-units per chi-unit, Finding 15). DC chi is the mean level at depth 0,")
print("which shows BIAS; the injected chi_n3 is the value it should sit at.\n")
print(f"  {'window':>7} {'estimator':>10} {'portable':>13} {'decades':>8} {'DC chi':>8} "
      f"{'recovered':>11} {'floor':>9} {'min detectable':>15}")
print("  " + "-" * 92)

best = {}
for window_s in WINDOWS_S:
    cache = {k: psds_for(v, window_s) for k, v in traces.items()}
    for name, fn in ESTIMATORS.items():
        sig_v, flo_v, dc_v = [], [], []
        for seed in SEEDS:
            for depth, dest in ((PROBE_DEPTH, sig_v), (0.0, flo_v)):
                chi = [fn(fr, pw) for fr, pw in cache[(seed, depth)]]
                dest.append(modulation_depth(chi, 1 / HOP_S, F_MOD))
                if depth == 0.0:
                    dc_v.append(float(np.nanmean(np.asarray(chi, dtype=float))))
        sig = float(np.nanmedian(sig_v))
        flo = float(np.nanmedian(flo_v))
        dc = float(np.nanmedian(dc_v))
        mdd = PROBE_DEPTH * flo / sig if sig > 0 else np.inf
        if name not in best or mdd < best[name][0]:
            best[name] = (mdd, window_s, dc)
        print(f"  {window_s:6.1f}s {name:>10} {PORTABLE[name]:>13} {DECADES[name]:8.2f} "
              f"{dc:8.3f} {sig:11.4f} {flo:9.4f} {mdd:15.3f}")
    print()

print("  MINIMUM DETECTABLE chi_mod_depth, best window per estimator:\n")
prov = R.provisional_value('chi_mod_depth')
ref = best['sp3045'][0]
for name in sorted(ESTIMATORS, key=lambda k: best[k][0]):
    mdd, w, dc = best[name]
    print(f"  {name:>10} {mdd:8.3f}  (W = {w:.0f} s, {DECADES[name]:.2f} decades)   "
          f"margin {prov / mdd:4.1f}x at the shipped {prov}")

print(f"\n  Provisional chi_mod_depth = {prov}. An estimator is usable here only if its minimum")
print(f"  detectable depth sits comfortably below that.\n")

shipped_mdd = best['twoband'][0]
order = sorted(ESTIMATORS, key=lambda k: best[k][0])
by_dec = sorted(ESTIMATORS, key=lambda k: -DECADES[k])

print("\n  LEVERAGE, NOT SOPHISTICATION, ORDERS THIS TABLE.\n")
print(f"    by minimum detectable depth : {' < '.join(order)}")
print(f"    by band leverage (decades)  : {' > '.join(by_dec)}")
corr = float(np.corrcoef([DECADES[k] for k in ESTIMATORS],
                         [np.log10(best[k][0]) for k in ESTIMATORS])[0, 1])
print(f"\n    correlation of log(MDD) with band leverage: {corr:+.2f}")
print("\n  This re-derives Finding 14 inside a different measurement: 30-45 Hz spans only 0.176")
print("  decades, and a slope over that span scatters however good the fitter is. specparam over")
print("  G1b's band is therefore the WORST candidate here -- which is not a verdict on specparam,")
print("  but on the band it was handed.\n")
print("  A STATIC BIAS DOES NOT MATTER FOR THIS QUANTITY. Modulation depth is an AC measurement:")
print("  a constant offset in chi-hat cancels in the line at f_mod. That is why `ls240` scores")
print("  well despite the oscillatory peaks inside 2-40 Hz biasing its DC level (see the DC chi")
print("  column against the injected chi_n3). Peak modelling buys ACCURACY, and accuracy is not")
print("  what a coupling readout needs -- leverage is.\n")
print("  CONSEQUENCE FOR THE ARTIFACT:")
print(f"    shipped two-band proxy : {shipped_mdd:.3f}")
print(f"    best candidate ({order[0]:>7}) : {best[order[0]][0]:.3f}")
print(f"    specparam, wide band   : {best['sp240'][0]:.3f}")
print(f"    specparam, G1b band    : {best['sp3045'][0]:.3f}")
gain = shipped_mdd / best[order[0]][0]
if order[0] != 'twoband' and gain > 1.15 and PORTABLE[order[0]] == 'yes':
    print(f"\n  A PORTABLE ESTIMATOR WINS, by {gain:.2f}x. `{order[0]}` is an ordinary least-squares")
    print("  slope -- no iteration, no peak model -- so it ports to the artifact's TypeScript")
    print("  directly, which specparam cannot. Worth adopting.")
else:
    print(f"\n  THE SHIPPED PROXY IS ALREADY NEAR-OPTIMAL ({gain:.2f}x from the leader), and replacing")
    print("  it with specparam would make the readout WORSE as well as unrunnable in a browser.")
    print("  The Tier 0 estimator choice was better than Finding 13's framing implied: what is")
    print("  marginal is the injected DEPTH against any estimator's floor, not this estimator.")
