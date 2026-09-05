"""R4 external recovery: YASA detections phased against generated respiration truth.

YASA is not used to set a generator parameter or tolerance. It is an independently authored
readout of whether the timing mechanism survives the complete EEG mixture and detector. The
matched mechanism-off record has the same seed, event count and morphology.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "prep" / "out" / "r4_external"
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))

import yasa


def circular(phases: np.ndarray) -> dict[str, float | int]:
    if phases.size == 0:
        return {"n": 0, "angle": float("nan"), "length": float("nan")}
    z = np.mean(np.exp(1j * phases))
    return {"n": int(phases.size), "angle": float(np.angle(z)), "length": float(abs(z))}


def phases_at(phase: np.ndarray, times: np.ndarray, fs: float) -> np.ndarray:
    indices = np.clip(np.rint(times * fs).astype(int), 0, phase.size - 1)
    return phase[indices]


def spindle_table(signal: np.ndarray, fs: float):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = yasa.spindles_detect(signal, sf=fs, verbose=False)
    if result is None:
        return None
    return result.summary()


def slow_wave_table(signal: np.ndarray, fs: float):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = yasa.sw_detect(signal, sf=fs, verbose=False)
    if result is None:
        return None
    return result.summary()


def matched_markers(injected: list[dict], table, marker: str) -> np.ndarray:
    """Greedily match detections by overlap, then return the external detector's marker time."""
    if table is None or len(table) == 0 or not injected:
        return np.empty(0)
    starts = np.asarray(table["Start"], dtype=float)
    ends = np.asarray(table["End"], dtype=float)
    markers = np.asarray(table[marker], dtype=float)
    used: set[int] = set()
    out = []
    for event in injected:
        a0 = float(event["onset"])
        a1 = a0 + float(event["duration"])
        best, best_overlap = None, 0.0
        for index, (b0, b1) in enumerate(zip(starts, ends)):
            if index in used:
                continue
            overlap = min(a1, b1) - max(a0, b0)
            if overlap > best_overlap:
                best, best_overlap = index, overlap
        if best is not None and best_overlap > 0.2 * (a1 - a0):
            used.add(best)
            out.append(markers[best])
    return np.asarray(out, dtype=float)


def main() -> None:
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
    seeds = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    cmd = [
        "node", "--experimental-strip-types", "--no-warnings",
        str(ROOT / "prep" / "reference" / "r4_external_fixture.mts"),
        str(OUT), str(duration), str(seeds),
    ]
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True)
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf8"))
    fs = float(manifest["fs"])
    rows = []
    for row in manifest["rows"]:
        ident = row["id"]
        phase = np.fromfile(OUT / f"{ident}_phase.f64", dtype="<f8")
        fz = np.fromfile(OUT / f"{ident}_Fz.f64", dtype="<f8")
        c3 = np.fromfile(OUT / f"{ident}_C3.f64", dtype="<f8")
        fast_spindles = spindle_table(c3, fs)
        slow_spindles = spindle_table(fz, fs)
        slow_waves = slow_wave_table(fz, fs) if row["state"] == "n3" else None
        injected_fast = [e for e in row["events"] if e["type"] == "spindle_fast"]
        injected_slow = [e for e in row["events"] if e["type"] == "spindle_slow"]
        injected_so = [e for e in row["events"] if e["type"] == "slow_oscillation"]
        fast = matched_markers(injected_fast, fast_spindles, "Start")
        slow = matched_markers(injected_slow, slow_spindles, "Start")
        down = matched_markers(injected_so, slow_waves, "NegPeak")
        rows.append({
            **{key: value for key, value in row.items() if key != "events"},
            "slow_oscillation": circular(phases_at(phase, down, fs)),
            "spindle_fast": circular(phases_at(phase, fast, fs)),
            "spindle_slow": circular(phases_at(phase, slow, fs)),
        })

    summary = []
    for state in ("n2", "n3"):
        for kind in ("slow_oscillation", "spindle_fast", "spindle_slow"):
            for coupled in (False, True):
                selected = [
                    r[kind] for r in rows
                    if r["state"] == state and r["coupled"] == coupled and int(r[kind]["n"]) > 0
                ]
                n = sum(int(r["n"]) for r in selected)
                if n == 0:
                    continue
                z = sum(
                    int(r["n"]) * float(r["length"]) * np.exp(1j * float(r["angle"]))
                    for r in selected
                ) / n
                summary.append({
                    "state": state, "kind": kind, "coupled": coupled, "n": n,
                    "angle": float(np.angle(z)), "length": float(abs(z)),
                })

    output = {
        "generatorVersion": manifest["generatorVersion"],
        "durationS": duration,
        "nSeeds": seeds,
        "summary": summary,
        "rows": rows,
    }
    path = ROOT / "prep" / "out" / "r4_event_recovery.json"
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf8")
    print(f"R4 YASA recovery — {seeds} seed(s) x {duration}s")
    print("state kind                   arm       n   angle      R")
    for row in summary:
        print(
            f"{row['state']:<5} {row['kind']:<22} "
            f"{'on' if row['coupled'] else 'off':<4} {row['n']:7d} "
            f"{row['angle']:7.3f} {row['length']:6.3f}"
        )
    print(f"Machine-readable result: {path}")


if __name__ == "__main__":
    main()
