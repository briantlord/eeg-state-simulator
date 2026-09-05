"""G3: external YASA recovery of all injected spindles, record-only.

The old prominence sweep is retired: its tag was random and independent of waveform quality.
Overall detection recovery and the matched mechanism-off null remain valid questions.
Overlap >20% of injected duration is an explicit matching convention, not physiology.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R

SPEC = GateSpec(
    id="G3",
    title="Spindle detection — F1 against YASA, all events, record-only",
    gate_class="V",
    runtime_tier="slow",
    failable=False,
    depends_on=("G2",),
    criterion_key="gate_spindle_f1",
    requires_tools=("yasa",),
    provenance_keys=("spindle_rate_n2", "spindle_amp", "spindle_dur_min"),
    claim="Recovery by the external YASA detector on all injected spindles. RECORD-ONLY; "
    "no acceptance tolerance or quality-stratified morphology claim is established.",
)

CHANNEL = "Cz"
EPOCHS = 20
THRESHOLDS = (0.0,)  # All events only; retain the report container for compatibility.
#: Fraction of an injected event a detection must overlap to count as the same spindle.
#: A matching convention; see the module docstring for why it is not a registry row.
MIN_OVERLAP = 0.2


def match(
    injected: list[tuple[float, float]], detected: list[tuple[float, float]]
) -> tuple[int, set[int]]:
    """Greedy overlap matching. Returns (true positives, indices of detections consumed)."""
    used: set[int] = set()
    tp = 0
    for a0, a1 in injected:
        best, best_ov = None, 0.0
        for j, (b0, b1) in enumerate(detected):
            if j in used:
                continue
            ov = min(a1, b1) - max(a0, b0)
            if ov > best_ov:
                best, best_ov = j, ov
        if best is not None and best_ov > MIN_OVERLAP * (a1 - a0):
            used.add(best)
            tp += 1
    return tp, used


def detect(x: np.ndarray, fs: float) -> list[tuple[float, float]]:
    """YASA detections as (start, end) seconds. Empty list when it finds nothing."""
    import yasa

    sp = yasa.spindles_detect(x, fs)
    if sp is None:
        return []
    df = sp.summary()
    return [(float(r.Start), float(r.End)) for r in df.itertuples()]


def injected_spindles(run_) -> list[dict]:
    return [
        e for e in run_.events["events"]
        if e["type"].startswith("spindle") and CHANNEL in e["channels"]
    ]


def curve(run_, fs: float) -> tuple[list[dict], int]:
    """All-event recovery; random inclusion tags never affect detection scores."""
    sig, ch = run_.concatenated()
    detections = detect(sig[ch.index(CHANNEL)], fs)
    events = injected_spindles(run_)
    inj = [(e["onset"], e["onset"] + e["duration"]) for e in events]
    tp, _ = match(inj, detections)
    precision = tp / len(detections) if detections else 0.0
    recall = tp / len(inj) if inj else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return [{"threshold": 0.0, "n_injected": len(inj), "n_detected": len(detections),
             "tp": tp, "precision": precision, "recall": recall,
             "f1": f1 if inj else float("nan")}], len(detections)


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g3"
    rmtree_robust(work)
    fs = R.scalar_value("fs")

    per_seed: dict[int, float] = {}
    curves: dict[int, list[dict]] = {}
    for s in seeds:
        run_ = generate(work / f"s{s}", seed=s, state="n2", epochs=EPOCHS)
        c, _ = curve(run_, fs)
        curves[s] = c
        # Score every injected event; do not stratify by the arbitrary tag.
        per_seed[s] = float(c[0]["f1"])

    by_thr = {
        t: float(np.nanmedian([curves[s][i]["f1"] for s in seeds]))
        for i, t in enumerate(THRESHOLDS)
    }

    n_inj = int(np.median([curves[s][0]["n_injected"] for s in seeds]))
    n_det = int(np.median([curves[s][0].get("n_detected", 0) for s in seeds]))

    detail = (
        f"n2 @ {CHANNEL}, {EPOCHS} epochs x {len(seeds)} seeds, median {n_inj} injected vs "
        f"{n_det} detected. All-event median F1 {by_thr[0.0]:.3f}. "
        "RECORD-ONLY: no acceptance tolerance exists. Quality stratification is unavailable; "
        "the former random prominence field is now an explicitly arbitrary inclusionTag."
    )

    return (
        ScalarMetric(per_seed=per_seed, unit="F1 vs YASA, all injected events included"),
        True,
        detail,
        {"channel": CHANNEL, "epochs": EPOCHS, "min_overlap": MIN_OVERLAP,
         "f1_by_threshold": by_thr, "curves": curves, "quality_stratification": "unavailable"},
    )
