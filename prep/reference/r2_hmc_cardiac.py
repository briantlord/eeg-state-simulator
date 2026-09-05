"""R2 empirical anchor: stage-conditioned cardiac timing in the 19 scored HMC nights.

HMC has ECG and AASM stage annotations but no respiration channel. It can therefore anchor mean
RR and non-respiratory/total HRV by state, but it CANNOT identify RSA magnitude or phase. Those
remain separately literature constrained.

R peaks are detected from a 8-25 Hz squared-energy envelope. RR intervals are retained only when
physiological and within 25% of an 11-interval local median; this removes missed/double detections
without silently calling clinical ectopy normal sinus variability. Each subject is summarized
first, then the distribution across subjects is reported.
"""
from __future__ import annotations

import json
import os
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))
warnings.filterwarnings("ignore")

import mne
import numpy as np
from scipy import signal as sps

HMC = ROOT / "prep" / "realdata" / "hmc"
OUT = ROOT / "prep" / "out" / "r2_hmc_cardiac.json"
STAGE_MAP = {
    "Sleep stage W": "wake_ec",
    "Sleep stage N1": "n1",
    "Sleep stage N2": "n2",
    "Sleep stage N3": "n3",
    "Sleep stage R": "rem",
}
STATES = tuple(STAGE_MAP.values())


def qrs_peaks(ecg: np.ndarray, fs: float) -> np.ndarray:
    sos = sps.butter(3, (8.0, 25.0), btype="bandpass", fs=fs, output="sos")
    qrs = sps.sosfiltfilt(sos, ecg)
    width = max(1, int(round(0.12 * fs)))
    envelope = sps.convolve(qrs * qrs, np.ones(width) / width, mode="same")
    center = float(np.median(envelope))
    mad = float(np.median(np.abs(envelope - center)))
    peaks, _ = sps.find_peaks(
        envelope,
        distance=int(round(0.45 * fs)),
        height=center + 8 * mad,
        prominence=8 * mad,
    )
    return peaks


def quality_mask(rr: np.ndarray) -> np.ndarray:
    if rr.size < 11:
        return np.zeros(rr.size, dtype=bool)
    local = sps.medfilt(rr, kernel_size=11)
    # medfilt zero-pads its edges; replace those local estimates with the nearest valid median.
    local[:5] = local[5]
    local[-5:] = local[-6]
    return (rr >= 0.45) & (rr <= 2.0) & (np.abs(rr - local) <= 0.25 * local)


def one_subject(rec: Path) -> dict[str, dict[str, float]]:
    raw = mne.io.read_raw_edf(rec, preload=True, verbose="ERROR")
    fs = float(raw.info["sfreq"])
    ecg = raw.get_data(picks=["ECG"])[0]
    peaks = qrs_peaks(ecg, fs)
    rr = np.diff(peaks) / fs
    valid = quality_mask(rr)
    mid = ((peaks[:-1] + peaks[1:]) // 2).astype(int)

    stage = np.full(ecg.size, -1, dtype=np.int8)
    ann = mne.read_annotations(rec.with_name(rec.stem + "_sleepscoring.edf"))
    for onset, duration, description in zip(ann.onset, ann.duration, ann.description):
        name = STAGE_MAP.get(description)
        if name is None:
            continue
        a = max(0, int(round(onset * fs)))
        b = min(stage.size, int(round((onset + max(30.0, duration)) * fs)))
        stage[a:b] = STATES.index(name)

    out: dict[str, dict[str, float]] = {}
    for code, name in enumerate(STATES):
        keep = valid & (stage[mid] == code)
        values = rr[keep]
        if values.size < 300:
            continue
        # RMSSD only across adjacent retained intervals in the same state. Joining separated
        # bouts would turn a stage transition or rejected detector interval into variability.
        indices = np.flatnonzero(keep)
        adjacent = indices[1:] == indices[:-1] + 1
        differences = np.diff(rr[indices])[adjacent]
        out[name] = {
            "beats": int(values.size + 1),
            "mean_hr_bpm": float(60 / np.mean(values)),
            "median_hr_bpm": float(np.median(60 / values)),
            "sdnn_ms": float(np.std(values) * 1000),
            "rmssd_ms": float(np.sqrt(np.mean(differences * differences)) * 1000),
            "retained_fraction": float(values.size / max(1, np.sum(stage[mid] == code))),
        }
    return out


def summary(values: list[float]) -> dict[str, float | int]:
    q1, median, q3 = np.percentile(values, (25, 50, 75))
    return {"n": len(values), "median": float(median), "q1": float(q1), "q3": float(q3)}


def main() -> None:
    records = sorted(p for p in HMC.glob("SN*.edf") if "sleepscoring" not in p.name)
    records = [p for p in records if p.with_name(p.stem + "_sleepscoring.edf").exists()]
    per_subject: dict[str, dict[str, dict[str, float]]] = {}
    for rec in records:
        result = one_subject(rec)
        per_subject[rec.stem] = result
        print(f"{rec.stem}: " + ", ".join(
            f"{state} {metrics['mean_hr_bpm']:.1f}" for state, metrics in result.items()
        ))

    aggregate = {}
    for state in STATES:
        rows = [subject[state] for subject in per_subject.values() if state in subject]
        aggregate[state] = {
            key: summary([row[key] for row in rows])
            for key in ("mean_hr_bpm", "median_hr_bpm", "sdnn_ms", "rmssd_ms", "retained_fraction")
        }

    report = {
        "probe": "R2 HMC cardiac timing",
        "records": len(records),
        "limitation": "HMC has no respiration channel; these values cannot identify RSA",
        "aggregate": aggregate,
        "per_subject": per_subject,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")

    print("\nHMC per-subject medians [IQR]")
    print("state       HR bpm          SDNN ms          RMSSD ms        n")
    for state in STATES:
        row = aggregate[state]
        def fmt(key: str) -> str:
            item = row[key]
            return f"{item['median']:.1f} [{item['q1']:.1f}-{item['q3']:.1f}]"
        print(f"{state:<10} {fmt('mean_hr_bpm'):<15} {fmt('sdnn_ms'):<16} "
              f"{fmt('rmssd_ms'):<15} {row['mean_hr_bpm']['n']:>2}")
    print(f"\nMachine-readable result: {OUT}")


if __name__ == "__main__":
    main()
