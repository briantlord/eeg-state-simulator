"""Fit wake alpha's temporal texture against PhysioNet EEGMAT.

The topography and average prominence have already been handled elsewhere.  This probe asks
whether alpha comes and goes like real posterior alpha.  It uses Pz in the linked-ear view,
the full resting record per subject, and reports a distribution across subjects rather than
pooling them.  Generated values are a distribution across independent seeds of equal duration.

Burst threshold is each record's 75th envelope percentile.  That fixes occupancy by definition,
so occupancy is not reported; duration and crossing rate remain informative.  The envelope is
smoothed over 1 / bandwidth before thresholding so carrier beats are not counted as bursts.
"""
from __future__ import annotations

import os
import sys
import tempfile
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))
warnings.filterwarnings("ignore")

import mne
import numpy as np
from scipy import signal as sps
from scipy.stats import kurtosis, skew

from prep import registry as R
from prep.epochio import generate

REAL = ROOT / "prep" / "realdata"
FS = int(R.scalar_value("fs"))
LO, HI = R.band_edges("alpha_band")
SEEDS = (4242, 4555, 4888, 5221, 5554, 5887, 6220, 6553)


def alpha_metrics(x_uv: np.ndarray, fs: float) -> dict[str, float]:
    sos = sps.butter(4, (LO, HI), btype="bandpass", fs=fs, output="sos")
    band = sps.sosfiltfilt(sos, x_uv)
    env = np.abs(sps.hilbert(band))
    env_mean = float(env.mean())

    win = max(1, int(round(fs / (HI - LO))))
    smooth = np.convolve(env, np.ones(win) / win, mode="same")
    above = smooth > np.percentile(smooth, 75)
    edges = np.diff(above.astype(np.int8), prepend=0, append=0)
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    durations = (ends - starts) / fs

    # Envelope autocorrelation e-folding, capped at ten seconds. This measures amplitude-state
    # memory without being dominated by the 10 Hz carrier itself.
    z = env - env_mean
    nlag = min(len(z) - 1, int(10 * fs))
    ac = sps.fftconvolve(z, z[::-1], mode="full")[len(z) - 1:len(z) + nlag]
    ac = ac / ac[0] if ac[0] else ac
    below = np.flatnonzero(ac < 1 / np.e)
    tau = float(below[0] / fs) if below.size else float(nlag / fs)

    g, k = float(skew(env)), float(kurtosis(env))
    return {
        "env_cv": float(env.std() / env_mean),
        "env_robust_cv": float(1.4826 * np.median(np.abs(env - np.median(env))) / np.median(env)),
        "bimodality": float((g * g + 1) / (k + 3)),
        "burst_rate_min": float(len(durations) / (len(x_uv) / fs / 60)),
        "burst_dur_med_s": float(np.median(durations)),
        "burst_dur_iqr_s": float(np.subtract(*np.percentile(durations, (75, 25)))),
        "envelope_tau_s": tau,
    }


def real_metrics() -> list[dict[str, float]]:
    rows = []
    for edf in sorted(REAL.glob("Subject*_1.edf")):
        raw = mne.io.read_raw_edf(edf, preload=True, verbose="ERROR")
        raw.rename_channels({c: c.replace("EEG ", "").split("-")[0].strip() for c in raw.ch_names})
        if "Pz" not in raw.ch_names:
            continue
        x = raw.get_data(picks=["Pz"])[0] * 1e6
        rows.append(alpha_metrics(x, float(raw.info["sfreq"])))
        print(f"  real {edf.stem}: {len(x) / raw.info['sfreq']:.0f} s")
    return rows


def generated_metrics() -> list[dict[str, float]]:
    rows = []
    with tempfile.TemporaryDirectory(prefix="eegsim-alpha-temporal-") as td:
        for seed in SEEDS:
            run = generate(Path(td) / str(seed), seed=seed, state="wake_ec", epochs=6)
            x, channels = run.concatenated()
            pz = x[channels.index("Pz")]
            ears = (x[channels.index("A1")] + x[channels.index("A2")]) / 2
            rows.append(alpha_metrics(pz - ears, FS))
            print(f"  generated seed {seed}: {len(pz) / FS:.0f} s")
    return rows


def report(real: list[dict[str, float]], gen: list[dict[str, float]]) -> None:
    print(f"\nWake alpha temporal texture at Pz, linked-ear, {LO:g}-{HI:g} Hz")
    print(f"REAL EEGMAT n={len(real)} subjects; GENERATED n={len(gen)} seeds.\n")
    print(f"  {'metric':<20}{'real median [IQR]':>25}{'generated median [IQR]':>29}")
    for key in real[0]:
        rv = np.asarray([r[key] for r in real])
        gv = np.asarray([r[key] for r in gen])
        rq = np.percentile(rv, (25, 50, 75))
        gq = np.percentile(gv, (25, 50, 75))
        print(f"  {key:<20}{rq[1]:8.3f} [{rq[0]:6.3f}-{rq[2]:6.3f}]"
              f"{gq[1]:12.3f} [{gq[0]:6.3f}-{gq[2]:6.3f}]")


def main() -> int:
    mne.set_log_level("ERROR")
    real = real_metrics()
    gen = generated_metrics()
    if not real or not gen:
        print("no usable real or generated records")
        return 1
    report(real, gen)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
