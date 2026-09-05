"""State realism v2: continuous preprocessing, explicit cohorts, subject/seed distributions.

HMC is a clinical referral population with four mastoid derivations. Scored wake does not
specify eye closure; its comparison with wake_ec is an approximation. This protocol neither
validates 19-channel sleep covariance nor establishes a pass tolerance. See the frozen manifest.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))

import mne
import numpy as np
import scipy
from scipy import signal as sps
from prep.epochio import generate

PROTOCOL_PATH = ROOT / "prep/fixtures/state_realism_protocol.json"
STAGE_MAP = {"Sleep stage W": "wake_ec", "Sleep stage N1": "n1", "Sleep stage N2": "n2",
             "Sleep stage N3": "n3", "Sleep stage R": "rem"}
STATES = tuple(STAGE_MAP.values())
BANDS = {"delta": (0.5, 4.0), "theta": (4.0, 8.0), "alpha": (8.0, 13.0),
         "sigma": (11.0, 16.0), "beta": (16.0, 30.0)}
DERIVATIONS = (("F4", "A1"), ("C4", "A1"), ("O2", "A1"), ("C3", "A2"))
REAL_LABELS = ("EEG F4-M1", "EEG C4-M1", "EEG O2-M1", "EEG C3-M2")


def preprocess(x_uv: np.ndarray, fs: float) -> np.ndarray:
    """Filter the continuous recording before stage selection; no artificial joins."""
    sos = sps.butter(4, (0.3, 35.0), btype="bandpass", fs=fs, output="sos")
    return sps.sosfiltfilt(sos, x_uv, axis=-1)


def metrics(epochs_uv: np.ndarray, fs: float) -> dict[str, float]:
    """Already-filtered epochs x channels x samples. No spectral window crosses an epoch edge."""
    if epochs_uv.ndim != 3 or epochs_uv.shape[-1] < 4 * fs:
        raise ValueError("metrics requires complete, preprocessed epochs x channels x samples")
    x = epochs_uv
    # Point statistics may pool samples; time-window estimators retain explicit epoch boundaries.
    pooled = x.transpose(1, 0, 2).reshape(x.shape[1], -1)
    robust_rms = float(np.median(1.4826 * np.median(
        np.abs(pooled - np.median(pooled, axis=-1, keepdims=True)), axis=-1)))
    fr, ps = sps.welch(x, fs, nperseg=int(4 * fs), noverlap=int(2 * fs), axis=-1)
    mean_ps = ps.mean(axis=(0, 1))
    total_mask = (fr >= 0.5) & (fr <= 30.0)
    total = float(np.trapz(mean_ps[total_mask], fr[total_mask]))
    out = {"rms_uv": robust_rms}
    for name, (lo, hi) in BANDS.items():
        mask = (fr >= lo) & (fr < hi)
        bp = float(np.trapz(mean_ps[mask], fr[mask]))
        out[f"{name}_uv2"] = bp
        out[f"{name}_rel"] = bp / total if total > 0 else np.nan
        n = int(2 * fs)
        windows = x[..., :x.shape[-1] // n * n].reshape(-1, n)
        wf, wp = sps.periodogram(windows, fs, axis=-1)
        wm = (wf >= lo) & (wf < hi)
        powers = np.trapz(wp[..., wm], wf[wm], axis=-1)
        med = float(np.median(powers))
        out[f"{name}_cv"] = float(1.4826 * np.median(np.abs(powers - med)) / med) if med > 0 else np.nan
    return out


def select_epochs(data_uv, annotations, fs, maximum):
    filtered = preprocess(data_uv, fs)
    selected = {state: [] for state in STATES}
    n = int(round(30 * fs))
    for onset, duration, description in zip(annotations.onset, annotations.duration, annotations.description):
        state = STAGE_MAP.get(description)
        if state is None:
            continue
        for offset in range(int(duration // 30)):
            a = int(round((onset + offset * 30) * fs))
            if 0 <= a and a + n <= filtered.shape[-1] and len(selected[state]) < maximum:
                selected[state].append(filtered[:, a:a + n])
    return selected


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def real_subjects(protocol, cohort, cache):
    subjects = protocol["heldout_subjects" if cohort == "holdout" else "development_subjects"]
    out = []
    for subject in subjects:
        rec = cache / f"{subject}.edf"
        score = cache / f"{subject}_sleepscoring.edf"
        if not rec.exists() or not score.exists():
            raise FileNotFoundError(f"Missing reserved input {rec}; no partial cohort is silently accepted")
        with mne.io.read_raw_edf(rec, preload=False, verbose="ERROR") as raw:
            if not all(label in raw.ch_names for label in REAL_LABELS):
                raise ValueError(f"{subject}: unexpected EEG derivations {raw.ch_names}")
            fs = float(raw.info["sfreq"])
            data = raw.get_data(picks=list(REAL_LABELS)) * 1e6
        epochs = select_epochs(data, mne.read_annotations(score), fs, protocol["maximum_real_epochs"])
        results = {state: metrics(np.stack(values), fs) for state, values in epochs.items()
                   if len(values) >= protocol["minimum_real_epochs"]}
        out.append({"subject": subject, "signal_sha256": digest(rec), "scoring_sha256": digest(score),
                    "epochs": {state: len(values) for state, values in epochs.items()}, "metrics": results})
        print(f"{cohort} {subject}: " + ", ".join(f"{state}={len(v)}" for state, v in epochs.items()), flush=True)
    return out


def generated(protocol):
    out = []
    for seed in protocol["generated_seeds"]:
        states = {}
        manifest = None
        for state in STATES:
            with tempfile.TemporaryDirectory(prefix="eegsim-realism-") as td:
                run = generate(Path(td) / state, seed=seed, state=state, epochs=protocol["generated_epochs"])
                x, channels = run.concatenated()
                derivations = np.stack([x[channels.index(a)] - x[channels.index(b)] for a, b in DERIVATIONS])
                fs = float(run.manifest["fs"])
                filtered = preprocess(derivations, fs)
                n = int(30 * fs)
                epochs = filtered.reshape(len(DERIVATIONS), -1, n).transpose(1, 0, 2)
                states[state] = metrics(epochs, fs)
                manifest = run.manifest
        out.append({"seed": seed, "metrics": states, "configuration": manifest["configuration"],
                    "provenance": manifest["provenance"], "generator_version": manifest["generatorVersion"]})
        print(f"generated seed {seed}: all {len(STATES)} states", flush=True)
    return out


def distribution(values):
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if not len(values):
        return {"n": 0, "q1": None, "median": None, "q3": None}
    q1, med, q3 = np.percentile(values, (25, 50, 75))
    return {"n": len(values), "q1": float(q1), "median": float(med), "q3": float(q3)}


def summarize(real, gen):
    summary = {}
    for state in STATES:
        summary[state] = {}
        for key in gen[0]["metrics"][state]:
            r = distribution([row["metrics"][state][key] for row in real if state in row["metrics"]])
            g = distribution([row["metrics"][state][key] for row in gen])
            summary[state][key] = {"real": r, "generated": g,
                                   "median_ratio": g["median"] / r["median"] if r["median"] else None}
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", choices=["development", "holdout"], default="holdout")
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    protocol = json.loads(PROTOCOL_PATH.read_text())
    cache = args.cache or ROOT / "prep/realdata" / ("hmc_holdout" if args.cohort == "holdout" else "hmc")
    output = args.output or ROOT / "prep/out" / f"state_realism_v2_{args.cohort}.json"
    real = real_subjects(protocol, args.cohort, cache)
    gen = generated(protocol)
    report = {"created_at": datetime.now(timezone.utc).isoformat(), "protocol": protocol,
              "protocol_sha256": digest(PROTOCOL_PATH), "analysis_sha256": digest(Path(__file__)),
              "cohort": args.cohort, "real": real, "generated": gen, "summary": summarize(real, gen),
              "toolchain": {"mne": mne.__version__, "numpy": np.__version__, "scipy": scipy.__version__},
              "verdict": "record-only; no acceptance tolerance established"}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
