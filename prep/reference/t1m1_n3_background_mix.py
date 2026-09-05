"""Fit a two-component N3 aperiodic background against HMC output spectra.

The model under test is deliberately small:

    P_N3(f) = (1-q) P_slow,N3(f) + q P_fast,N3(f)

The two components are independent, so the generator applies sqrt(1-q) and sqrt(q) to their
RMS amplitudes.  Both reuse the fitted N3 asymptotic exponent, but have different knees: adding
the tail therefore does not redefine chi_n3.  The fast knee and q are swept jointly here.
This gives the summed PSD a high-frequency tail without one amplitude parameter per canonical
band.  This N3-specific timescale is not identified with the project's separate, poorly sourced
and still-unmodelled 45 Hz claim.

The target was fixed before the sweep: the per-subject medians from the same 19 HMC nights and
four contralateral-mastoid derivations used by t1m1_state_realism.py and
t1m1_sleep_corpus.py.  Generated records pass through that identical 0.3--35 Hz filter and
spectral pipeline.  No AASM threshold or generator event list enters the objective.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))

from prep.reference.t1m1_sleep_corpus import fit_one
from prep.reference.t1m1_state_realism import FS_OUT, metrics

SEEDS = (4242, 4888)
VALIDATION_SEEDS = (4555, 5221, 5554, 5887, 6220, 6553)
SHARES = (0.0, 0.03, 0.06, 0.10, 0.15, 0.20, 0.30, 0.40)
FAST_KNEES_HZ = (3.0, 5.0, 8.0, 12.0, 20.0, 45.0)
DURATION_S = 180

# Per-subject HMC medians, not parameters copied into the source model.
TARGET = {
    "rms_uv": 20.935,
    "delta_rel": 0.836,
    "theta_rel": 0.086,
    "alpha_rel": 0.044,
    "sigma_rel": 0.020,
    "beta_rel": 0.010,
    "chi": 2.59,
    "knee_hz": 1.74,
}

HARNESS = r"""
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
const seed = Number(process.argv[2]), share = Number(process.argv[3]);
const fs = 256, n = fs * Number(process.argv[4]);
const r = composeState(seed, 'n3', n, fs, {
  snrDb: -2.7559,
  n3FastBackgroundFraction: share,
  n3FastBackgroundKneeHz: Number(process.argv[5]),
});
const at = (label) => ALL_CHANNELS.indexOf(label);
const pairs = [['F4','A1'],['C4','A1'],['O2','A1'],['C3','A2']];
const out = pairs.map(([a,b]) => {
  const x=r.channels[at(a)], y=r.channels[at(b)], d=new Array(x.length);
  for(let i=0;i<d.length;i++) d[i]=x[i]-y[i];
  return d;
});
process.stdout.write(JSON.stringify(out));
"""


def evaluate(
    script: Path,
    share: float,
    knee_hz: float,
    seeds=SEEDS,
    duration_s=DURATION_S,
) -> dict[str, float]:
    rows: list[dict[str, float]] = []
    for seed in seeds:
        p = subprocess.run(
            ["node", "--experimental-strip-types", "--no-warnings",
             "--max-old-space-size=8192", str(script), str(seed), str(share), str(duration_s),
             str(knee_hz)],
            cwd=ROOT, capture_output=True, check=True,
        )
        x = np.asarray(json.loads(p.stdout), dtype=float)
        row = metrics(x, FS_OUT)
        filtered = sps.sosfiltfilt(
            sps.butter(4, (0.3, 35.0), btype="bandpass", fs=FS_OUT, output="sos"),
            x, axis=-1,
        )
        fr, pw = sps.welch(
            filtered, FS_OUT, nperseg=int(4 * FS_OUT), noverlap=int(2 * FS_OUT), axis=-1,
        )
        row["chi"], row["knee_hz"] = fit_one(fr, pw.mean(axis=0), (1.0, 30.0))
        rows.append(row)
    return {key: float(np.nanmedian([r[key] for r in rows])) for key in TARGET}


def error(row: dict[str, float]) -> float:
    # Six direct scale/allocation observables carry equal weight.  Chi and knee are reported and
    # guarded, but not put into the scalar objective: both are model fits to the same PSD and
    # counting them again would silently triple-weight spectral shape.
    direct = ("rms_uv", "delta_rel", "theta_rel", "alpha_rel", "sigma_rel", "beta_rel")
    return float(np.mean([abs(row[k] - TARGET[k]) / TARGET[k] for k in direct]))


def main() -> int:
    script = ROOT / ".n3-background-mix.mts"
    script.write_text(HARNESS, encoding="utf8")
    try:
        print("N3 two-component aperiodic sweep -- HMC four-derivation output pipeline\n")
        print("  target: " + ", ".join(f"{k}={v:g}" for k, v in TARGET.items()))
        print(f"\n  {'knee':>6}{'q':>6}{'RMS':>8}{'delta':>8}{'theta':>8}{'alpha':>8}"
              f"{'sigma':>8}{'beta':>8}{'chi':>8}{'knee':>8}{'error':>9}")
        scored = []
        for knee_hz in FAST_KNEES_HZ:
            for share in SHARES:
                row = evaluate(script, share, knee_hz)
                e = error(row)
                scored.append((e, share, knee_hz, row))
                print(f"  {knee_hz:6.1f}{share:6.2f}{row['rms_uv']:8.2f}"
                      f"{row['delta_rel']:8.3f}{row['theta_rel']:8.3f}"
                      f"{row['alpha_rel']:8.3f}{row['sigma_rel']:8.3f}"
                      f"{row['beta_rel']:8.3f}{row['chi']:8.3f}"
                      f"{row['knee_hz']:8.2f}{e:9.3f}", flush=True)
        best = min(scored, key=lambda x: x[0])
        print(f"\n  best direct-observable fit: q={best[1]:.2f}, fast knee={best[2]:.1f} Hz, "
              f"mean relative error={best[0]:.3f}")
        validated = evaluate(
            script, best[1], best[2], seeds=VALIDATION_SEEDS, duration_s=600,
        )
        ve = error(validated)
        print("\n  HELD-OUT VALIDATION -- six new seeds, 600 s each")
        print("  " + ", ".join(f"{k}={v:.3f}" for k, v in validated.items()))
        print(f"  mean direct-observable error={ve:.3f}")
        chi_ok = 2.32 <= validated["chi"] <= 2.84
        knee_ok = 0.88 <= validated["knee_hz"] <= 2.60
        print(f"  HMC guards: chi IQR {'PASS' if chi_ok else 'FAIL'}, "
              f"knee IQR {'PASS' if knee_ok else 'FAIL'}")
        print("  q is a VARIANCE share. The AASM threshold and generator event list were not used "
              "for selection or validation.")
    finally:
        script.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
