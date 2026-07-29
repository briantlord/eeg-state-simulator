"""G1b -- chi recovery in FIXED MODE over 30-45 Hz. Class V, RECORD-ONLY.

"Same signal; fit fixed mode over 30-45 Hz; recover chi."

Same spectrum as G1a, different quantity. The two are separate gates in the frozen ledger and
their errors are never differenced -- see `g1a_chi_knee.py`.

G1b STRADDLES THE UPPER KNEE, AND THAT IS DELIBERATE. A fixed-mode fit across a knee is biased.
The published narrowband exponents this project compares against were fitted the same way with
the same knee present, so reproducing the bias is what makes our value comparable to theirs.
KEEP THE BIAS. Removing it yields a more correct number corresponding to nothing in the
literature.

THE COMPARABILITY ARGUMENT IS WEAKER THAN THE SPEC'S VERSION, and the ledger's own claim string
says so. D3 grounds it in an unmodelled ~45 Hz knee; our generator has none -- every bit of the
bias comes from the MODELLED knee, whose location is set by `knee_freq_*`, every one of which is
`invented` and pending T1-M1. So the bias is reproduced in form but not in mechanism, and its
magnitude is a free parameter we chose rather than one inherited from the literature's
measurement conditions.

AND ITS NOISE FLOOR IS LARGE. G1b's null measures sd 0.18-0.23 on white noise at 300 s, over
only 0.176 decades of leverage. That is bigger than the chi difference between adjacent states
in the registry, which is a constraint on P10 rather than on this gate. See Finding 14.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..spec import GateSpec, ScalarMetric
from ._g1_common import CHANNEL, EPOCHS, STATES, error_stats, rows_for

SPEC = GateSpec(
    id="G1b",
    title="χ round-trip, fixed mode over 30–45 Hz",
    gate_class="V",
    runtime_tier="fast",
    failable=False,
    depends_on=("G2",),
    criterion_key="gate_chi_tol_fixed",
    requires_tools=("specparam",),
    provenance_keys=("chi_n2", "k_n2", "fit_band_narrow"),
    claim="A DIFFERENT quantity from G1a, not a second estimate of the same one. Its bias "
    "is structural and originates in the modelled 20 Hz knee, so its magnitude is a "
    "function of the invented k_* rows -- not evidence of comparability with published "
    "narrowband exponents.",
)


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    out_root = Path(params["out_root"])
    per_state: dict[str, dict] = {}
    parts = []

    for st in STATES:
        rows = rows_for(seeds, out_root, st)
        stats = error_stats(rows, "g1b_chi")
        stats.update({"band": [30, 45], "mode": "fixed"})
        per_state[st] = stats
        parts.append(
            f"[{st}] injected χ={stats['injected_chi']:.3f}: err "
            f"{stats['median_error']:+.3f} (IQR {stats['iqr']:.3f})"
        )

    detail = (
        f"{CHANNEL}, {EPOCHS} epochs x {len(seeds)} seeds. " + " | ".join(parts) + ". "
        f"The bias is EXPECTED and kept: a fixed-mode fit across the modelled knee is what the "
        f"published narrowband exponents were fitted with. Its magnitude is set by the invented "
        f"knee_freq_* rows, so it is reproduced in form but not in mechanism. "
        f"RECORD-ONLY. A DIFFERENT QUANTITY from G1a — never differenced against it."
    )

    head = rows_for(seeds, out_root, STATES[0])
    return (
        ScalarMetric(
            per_seed={int(r["seed"]): float(r["g1b_chi"] - r["chi"]) for r in head},
            unit=f"χ recovery error, fixed mode 30–45 Hz ({STATES[0]})",
        ),
        True,
        detail,
        {"channel": CHANNEL, "epochs": EPOCHS, "states": per_state},
    )
