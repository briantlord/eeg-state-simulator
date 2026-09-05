"""Does our exact G5 occupancy algorithm recognize real HMC N3 epochs?"""
from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))
warnings.filterwarnings("ignore")

import mne
import numpy as np
from scipy import signal as sps

from prep import registry as R

HMC = ROOT / "prep" / "realdata" / "hmc"
DESC = {"Sleep stage N2": "n2", "Sleep stage N3": "n3"}


def fraction(x_uv: np.ndarray, fs: float) -> float:
    lo, hi = R.band_edges("gate_aasm_n3_band")
    b, a = sps.butter(int(R.scalar_value("filter_order")), (lo, hi), btype="bandpass", fs=fs)
    y = sps.filtfilt(b, a, x_uv)
    crossings = np.flatnonzero(np.diff(np.signbit(y)))
    bounds = np.concatenate(([0], crossings + 1, [len(y)]))
    occupied = 0
    for s, e in zip(bounds[:-1], bounds[1:]):
        if e - s >= 2 and 2 * np.max(np.abs(y[s:e])) >= R.scalar_value("gate_aasm_n3_min_amp"):
            occupied += e - s
    return float(occupied / len(y))


def main() -> int:
    per = {"n2": [], "n3": []}
    recs = sorted(p for p in HMC.glob("SN*.edf") if "sleepscoring" not in p.name)
    for rec in recs:
        score = rec.with_name(rec.stem + "_sleepscoring.edf")
        if not score.exists():
            continue
        raw = mne.io.read_raw_edf(rec, preload=True, verbose="ERROR")
        name = next(c for c in raw.ch_names if c.startswith("EEG C3-"))
        x = raw.get_data(picks=[name])[0] * 1e6
        fs = float(raw.info["sfreq"])
        subject = {"n2": [], "n3": []}
        ann = mne.read_annotations(score)
        for onset, duration, desc in zip(ann.onset, ann.duration, ann.description):
            state = DESC.get(desc)
            if state is None:
                continue
            a = int(round(onset * fs))
            b = a + int(round(min(30.0, duration) * fs))
            if b <= len(x) and b - a == int(round(30 * fs)):
                subject[state].append(fraction(x[a:b], fs))
        for state in per:
            if len(subject[state]) >= 20:
                values = np.asarray(subject[state])
                per[state].append(float(np.mean(values >= R.scalar_value("gate_aasm_n3_min_fraction"))))
        print(f"  {rec.stem}: N2={len(subject['n2'])}, N3={len(subject['n3'])}")
    print("\nExact G5 pass fraction, real HMC C3-M2, median [IQR] across subjects")
    for state in ("n2", "n3"):
        q = np.percentile(per[state], (25, 50, 75))
        print(f"  {state}: {q[1]:.3f} [{q[0]:.3f}-{q[2]:.3f}] (n={len(per[state])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
