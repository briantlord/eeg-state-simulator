"""G3 -- spindle detection. Class V, and RECORD-ONLY: a curve, not a threshold.

"Run YASA's spindle detector against the GRADED ground-truth event list (seam 1). Report F1 as
a function of inclusion threshold on the prominence field -- i.e. how agreement varies as
marginal events are included or excluded."

TIER 0 SETS NO PASS BAND, and the spec is unusually direct about why the obvious one is wrong:

    "The reasoning in the previous plan -- 'experts reach ~0.75, so above 0.9 means
    over-stereotyped' -- was wrong: it conflated morphological realism with gold-standard LABEL
    NOISE. Our ground truth has no label noise, so a realistic generator should score ABOVE the
    human ceiling, and forcing F1 down means injecting events too marginal to be spindles."

So a high F1 here is not suspicious and a low one is not automatically a failure; only the SHAPE
of the roll-off carries information, and comparing shape against shape needs MODA's per-event
agreement counts, which is T1 work.

THE PROMINENCE SWEEP IS THE POINT, not a robustness check. `prominence` is a graded field in
[0, 1] -- "how canonical an exemplar of its type" -- and seam 1 exists so that this curve can be
drawn at all. A generator emitting only textbook spindles gives a flat curve and says nothing
about marginal cases; the roll-off is where the morphology claim lives.

MATCHING IS BY TEMPORAL OVERLAP, which needs stating because F1 is not defined without it. An
injected event counts as detected when a detection overlaps it by more than 20% of its duration,
greedily, one detection per event. The 20% is a matching convention, not a criterion: it decides
what "the same spindle" means, and every value in a wide range gives the same qualitative curve.
It is NOT registered as a threshold, because registering it would present a bookkeeping choice
as a scientific one.

DETECTIONS OF EXCLUDED EVENTS ARE EXCUSED, NOT COUNTED AGAINST PRECISION. See the comment in
`curve()`: charging them conflates "found a marginal spindle" with "fired on noise", and inverts
the curve. The false-positive question belongs to the null, which asks it on a background
containing no events at all.
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
    title="Spindle detection — F1 against YASA as a function of prominence, record-only",
    gate_class="V",
    runtime_tier="slow",
    failable=False,
    depends_on=("G2",),
    criterion_key="gate_spindle_f1",
    requires_tools=("yasa",),
    provenance_keys=("spindle_rate_n2", "spindle_amp", "spindle_dur_min"),
    claim="YASA is external and published, so agreement is genuine recovery. RECORD-ONLY: the "
    "curve carries the information and no pass band exists at Tier 0 — a high F1 is expected, "
    "not suspicious, because our ground truth has no label noise.",
)

CHANNEL = "Cz"
EPOCHS = 20
#: Inclusion thresholds on the graded prominence field. The curve, not any one point.
THRESHOLDS = (0.0, 0.2, 0.4, 0.6, 0.8)
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
    """F1 versus prominence-inclusion threshold, plus the raw detection count."""
    sig, ch = run_.concatenated()
    x = sig[ch.index(CHANNEL)]
    detections = detect(x, fs)
    events = injected_spindles(run_)

    out = []
    for thr in THRESHOLDS:
        keep = [e for e in events if e["prominence"] >= thr]
        drop = [e for e in events if e["prominence"] < thr]
        inj = [(e["onset"], e["onset"] + e["duration"]) for e in keep]
        if not inj:
            out.append({"threshold": thr, "n_injected": 0, "f1": float("nan")})
            continue

        tp, used = match(inj, detections)

        # DETECTIONS OF EXCLUDED EVENTS ARE "DON'T CARE", NOT FALSE POSITIVES, and this is the
        # difference between a curve that means something and one that inverts.
        #
        # The first version counted every unmatched detection against precision. Raising the
        # threshold then shrank the ground truth while leaving the detection count fixed, so F1
        # FELL monotonically -- 0.604 at p>=0.0 down to 0.143 at p>=0.8 -- which reads as "the
        # detector is worse at canonical spindles", the opposite of the truth. What it actually
        # measured was the detector correctly finding the marginal events we had just decided
        # not to ask about.
        #
        # Charging those to precision conflates "found a marginal spindle" with "fired on
        # noise". Those are exactly the two things this gate exists to tell apart, and the
        # false-positive question belongs to the null, which asks it on a background with no
        # events at all.
        _, excused = match([(e["onset"], e["onset"] + e["duration"]) for e in drop],
                           [d for j, d in enumerate(detections) if j not in used])
        considered = len(detections) - len(excused)

        prec = tp / considered if considered else 0.0
        rec = tp / len(inj)
        f1 = 2 * prec * rec / max(prec + rec, 1e-9)
        out.append({"threshold": thr, "n_injected": len(inj), "n_detected": len(detections),
                    "n_excused": len(excused), "tp": tp,
                    "precision": prec, "recall": rec, "f1": f1})
    return out, len(detections)


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
        # The headline number is F1 with every injected event included -- the hardest point on
        # the curve, since it demands the marginal events be found too.
        per_seed[s] = float(c[0]["f1"])

    by_thr = {
        t: float(np.nanmedian([curves[s][i]["f1"] for s in seeds]))
        for i, t in enumerate(THRESHOLDS)
    }
    shape = ", ".join(f"p>={t:.1f}: {f:.3f}" for t, f in by_thr.items())
    n_inj = int(np.median([curves[s][0]["n_injected"] for s in seeds]))
    n_det = int(np.median([curves[s][0].get("n_detected", 0) for s in seeds]))

    detail = (
        f"n2 @ {CHANNEL}, {EPOCHS} epochs x {len(seeds)} seeds, median {n_inj} injected vs "
        f"{n_det} detected. F1 by prominence-inclusion threshold — {shape}. "
        f"RECORD-ONLY: the CURVE is the output and no pass band exists at Tier 0. A high F1 is "
        f"EXPECTED, not suspicious: our ground truth has no label noise, so a realistic "
        f"generator should score above the ~0.75 human ceiling. T1 compares roll-off shape "
        f"against MODA's per-event agreement counts."
    )

    return (
        ScalarMetric(per_seed=per_seed, unit="F1 vs YASA, all injected events included"),
        True,
        detail,
        {"channel": CHANNEL, "epochs": EPOCHS, "min_overlap": MIN_OVERLAP,
         "f1_by_threshold": by_thr, "curves": curves},
    )
