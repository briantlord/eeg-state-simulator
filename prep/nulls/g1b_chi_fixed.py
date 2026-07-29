"""G1b's matched null -- white noise must return chi ~= 0 in fixed mode.

Same construction as G1a's null (see that file for what a white-noise null can and cannot
establish), minus the knee clause: fixed mode has no knee to invent.

THE INTERESTING NUMBER HERE IS THE SPREAD, NOT THE MEAN. G1b is unbiased on white noise and very
noisy: measured sd ~0.18-0.23 across 300 s realisations, because 30-45 Hz is only 0.176 decades
of leverage and a slope estimated over that span scatters however long the record.

That sd is worth more than this null's verdict. It is LARGER THAN THE CHI DIFFERENCE BETWEEN
ADJACENT STATES in the registry -- wake_ec 1.10 against n1 1.40 -- so no state ordering is
supportable from narrowband chi on a single record, however clean. That is a constraint on P10
and on any comparability claim, not a defect in this gate. Recorded as Finding 14.

The null therefore reports the sd alongside the mean rather than only testing the mean, so the
limit is visible in every run instead of only in a document.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..spec import GateSpec, ScalarMetric
from .. import registry as R
from ..gates._g1_common import white_noise_fits

SPEC = GateSpec(
    id="G1b",
    title="Narrowband chi null — white noise must return chi ~= 0 over 30–45 Hz",
    gate_class="V",
    runtime_tier="fast",
    failable=True,
    depends_on=(),
    criterion_key="gate_g1b_null_zero",
    requires_tools=("specparam",),
    claim="Checks the fixed-mode fit path against a known-zero signal, and MEASURES the "
    "estimator's noise floor over 30–45 Hz. That floor exceeds the chi spacing between "
    "adjacent states, which constrains what any narrowband comparison can claim.",
)

CHI_ZERO = 0.10
N_SEEDS = 12


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    rows = white_noise_fits(seeds, N_SEEDS, R.scalar_value("fs"))
    b = np.array([r["g1b_chi"] for r in rows])

    mean = float(b.mean())
    sd = float(b.std(ddof=1))
    se = sd / np.sqrt(len(b))
    passed = bool(abs(mean) < CHI_ZERO)

    detail = (
        f"white noise, {len(rows)} seeds x 300 s, MEAN tested (not per-seed): "
        f"chi_hat {mean:+.4f} +/- {se:.4f} (|mean| < {CHI_ZERO} "
        f"{'ok' if passed else 'FAIL'}). "
        f"PER-SEED sd {sd:.3f} over only 0.176 decades of leverage — larger than the chi "
        f"spacing between adjacent states in the registry, so no state ordering is supportable "
        f"from narrowband chi on a single 300 s record (Finding 14, constrains P10). "
        f"Synthetic white noise: this checks the fit path, not the generator."
    )

    return (
        ScalarMetric(per_seed={int(r["seed"]): float(r["g1b_chi"]) for r in rows},
                     unit="chi_hat on white noise, 30-45 Hz (should be ~ 0)"),
        passed,
        detail,
        {"chi": b.tolist(), "mean": mean, "sd": sd, "chi_zero_bound": CHI_ZERO},
    )
