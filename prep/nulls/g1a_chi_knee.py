"""G1a's matched null -- and it carries the whole verdict, because the gate is record-only.

"Generate white noise (chi = 0); both fits must recover ~= 0 and G1a must not report a spurious
knee." The knee clause is G1a's alone; G1b has no knee to invent.

WHAT THIS TESTS, STATED PRECISELY, because it is easy to over-read. It is a check on the
MEASUREMENT PATH, not on the generator.

  IT CATCHES  a broken PSD path (wrong scaling, wrong detrend, mismatched frequency axis), a
              fit band that does not span what it claims, a specparam upgrade that changes the
              accessor contract, and G1a hallucinating a knee where none exists.

  IT CANNOT   say anything about whether our generator's chi is right, whether the recovery
              error the gate records is acceptable, or how the estimator behaves at the
              exponents and SNR we actually ship.

THE BOUNDS ARE NOT THE TOLERANCES G1 IS MISSING. `gate_chi_tol_knee` is `absent` because a
Tier 0 tolerance on RECOVERY ERROR would have to be invented or read from our own generator's
spread. These answer a different question -- "did the fit return zero", at the numerical
resolution of the estimate, on a signal whose correct answer is known analytically. They live in
`gate_g1_null_zero` so the difference is on the record rather than in a comment.

TESTED ON THE MEAN, NOT PER SEED, and that was a measured correction. The first version required
every seed to satisfy |chi_hat| < 0.10 and FAILED on its first real run at -0.2028. Measured over
12 white-noise seeds, the narrowband fit has sd ~0.18-0.23: unbiased and very noisy, because
30-45 Hz is only 0.176 decades of leverage. A per-seed bound at 0.10 rejects a correct estimator
about half the time.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from ..spec import GateSpec, ScalarMetric
from .. import registry as R
from ..gates._g1_common import white_noise_fits

SPEC = GateSpec(
    id="G1a",
    title="χ recovery null — white noise must return χ ≈ 0 and no spurious knee",
    gate_class="V",
    runtime_tier="fast",
    failable=True,
    depends_on=(),
    criterion_key="gate_g1_null_zero",
    requires_tools=("specparam",),
    claim="Checks the harness's own PSD-and-fit path against a signal whose answer is known "
    "analytically. Says NOTHING about whether our generator's chi is right, nor about the "
    "recovery error the gate records — it is a wiring check, and the gate it guards is "
    "record-only.",
)

#: From `gate_g1_null_zero`. Numerical resolution of "the fit returned zero", not a tolerance.
CHI_ZERO = 0.10
#: specparam reports the knee PARAMETER k, not a frequency. On true white noise there is no
#: corner, and a fit that invents one returns a large |k|. Finding 1 measured -0.024.
KNEE_ZERO = 1.0
N_SEEDS = 12


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    rows = white_noise_fits(seeds, N_SEEDS, R.scalar_value("fs"))
    a = np.array([r["g1a_chi"] for r in rows])
    k = np.array([r["g1a_knee"] for r in rows])

    a_ok = bool(abs(a.mean()) < CHI_ZERO)
    k_ok = bool(abs(k.mean()) < KNEE_ZERO)
    passed = a_ok and k_ok
    se = float(a.std(ddof=1) / np.sqrt(len(a)))

    detail = (
        f"white noise, {len(rows)} seeds x 300 s, MEANS tested (not per-seed): "
        f"chi_hat {a.mean():+.4f} +/- {se:.4f} (|mean| < {CHI_ZERO} "
        f"{'ok' if a_ok else 'FAIL'}), knee parameter {k.mean():+.4f} (|mean| < {KNEE_ZERO} "
        f"{'ok' if k_ok else 'FAIL - spurious knee'}). "
        f"Bounds are numerical resolution of 'returned zero', NOT the recovery tolerance the "
        f"gate is missing; that stays absent until T1-M2. Synthetic white noise, so this "
        f"checks the PSD-and-fit path, not the generator."
    )

    return (
        ScalarMetric(per_seed={int(r["seed"]): float(r["g1a_chi"]) for r in rows},
                     unit="chi_hat on white noise (should be ~ 0)"),
        passed,
        detail,
        {"chi": a.tolist(), "knee": k.tolist(), "mean": float(a.mean()),
         "sd": float(a.std(ddof=1)), "chi_zero_bound": CHI_ZERO, "knee_zero_bound": KNEE_ZERO},
    )
