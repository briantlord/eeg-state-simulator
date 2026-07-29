"""G1a -- chi recovery in KNEE MODE over 1-45 Hz. Class V, RECORD-ONLY.

"Generate at known (chi, k); fit knee mode over 1-45 Hz with specparam; recover both chi and k."

Class V because `specparam` is external, independently authored and published. G1a, G1b and G3
are the only Tier 0 gates with that letter, and it is worth more than the rest of the ledger
put together -- which is also why this file must not quietly become class C. Every quantity
here comes out of `SpectralModel`; the moment we substitute our own fit the letter changes.

RECORD-ONLY: "Tier 0 is explicitly record-only -- it captures the recovery error distribution
rather than passing or failing." `gate_chi_tol_knee` is `absent` with a reason, and deriving a
tolerance from the spread measured here would read a threshold off our own generator.

G1a AND G1b ARE SEPARATE GATES, and the ledger enforces it. They recover different quantities
over different bands in different modes; they are not two estimates of one number and their
errors are never differenced. Seam 7 makes the same argument in the TypeScript with an exponent
brand carrying (value, band, mode).

TWO STATES, because the knee is in the fit band in one and deliberately outside it in the
other -- see `_g1_common.STATES`. Reporting only N3 would have hidden that G1a's knee arm cannot
work there at all.

WHAT THE NUMBERS DO NOT SETTLE. Finding 2's correction established that G1a's error is strongly
regime-dependent: on model-exact signal it wins by two orders of magnitude, and once oscillatory
peaks sit inside 1-45 Hz the ordering reverses to the one D3 predicts. This gate runs on the full
generator, peaks included, so it measures the regime that matters -- but the distribution is a
property of that regime and does not transfer.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..spec import GateSpec, ScalarMetric
from ._g1_common import CHANNEL, EPOCHS, STATES, error_stats, knee_hz, rows_for

SPEC = GateSpec(
    id="G1a",
    title="χ round-trip, knee mode over 1–45 Hz",
    gate_class="V",
    runtime_tier="fast",
    failable=False,
    depends_on=("G2",),
    criterion_key="gate_chi_tol_knee",
    requires_tools=("specparam",),
    provenance_keys=("chi_n2", "k_n2", "fit_band_broad"),
    claim="Records the recovery error distribution for chi and k. Sets no tolerance at "
    "Tier 0; the tolerance is derived at T1-M2 from specparam bias and variance at our "
    "SNR and window.",
)


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    out_root = Path(params["out_root"])
    per_state: dict[str, dict] = {}
    parts = []

    for st in STATES:
        rows = rows_for(seeds, out_root, st)
        stats = error_stats(rows, "g1a_chi")
        recovered = np.array([knee_hz(r["g1a_knee"], r["g1a_chi"]) for r in rows])
        # All-NaN is the DESIGNED outcome in N3, whose knee sits below the fit band, so the
        # numpy warning would be noise in the log rather than a signal. The count of
        # unrecoverable fits is reported instead, which says the same thing on purpose.
        injected_knee = knee_hz(rows[0]["knee"], stats["injected_chi"])
        in_band = 1.0 < injected_knee < 45.0
        unrecoverable = int(np.sum(~np.isfinite(recovered)))
        median_knee = float(np.nanmedian(recovered)) if unrecoverable < len(recovered) else float("nan")

        stats.update({
            "injected_knee_hz": injected_knee,
            "knee_in_fit_band": bool(in_band),
            "median_knee_hz": median_knee,
            "n_knee_unrecoverable": unrecoverable,
            "band": [1, 45], "mode": "knee",
        })
        per_state[st] = stats

        knee_txt = (
            f"knee {injected_knee:.1f} Hz -> {median_knee:.1f} Hz"
            if in_band
            else f"knee OUT OF BAND by design ({injected_knee:.2f} Hz), unrecoverable in "
            f"{unrecoverable}/{len(rows)} fits"
        )
        parts.append(
            f"[{st}] injected χ={stats['injected_chi']:.3f}: err "
            f"{stats['median_error']:+.3f} (IQR {stats['iqr']:.3f}), {knee_txt}"
        )

    detail = (
        f"{CHANNEL}, {EPOCHS} epochs x {len(seeds)} seeds. " + " | ".join(parts) + ". "
        f"RECORD-ONLY: no tolerance exists and none may be derived from this spread. "
        f"A DIFFERENT QUANTITY from G1b — never differenced against it."
    )

    head = rows_for(seeds, out_root, STATES[0])
    return (
        ScalarMetric(
            per_seed={int(r["seed"]): float(r["g1a_chi"] - r["chi"]) for r in head},
            unit=f"χ recovery error, knee mode 1–45 Hz ({STATES[0]})",
        ),
        True,
        detail,
        {"channel": CHANNEL, "epochs": EPOCHS, "states": per_state},
    )
