"""G4's matched null -- does respiration reach chi-hat at f2?

This is the arm the harness spec is really about: "it catches the failure mode the generator is
most likely to produce: modulating filter coefficients at the respiratory rate creates
sidebands at f +- f_resp, which a coupling estimator will happily report as coupling."

THE NULL IS A MECHANISM TOGGLE, NOT A SURROGATE, and the spec's own sentence explains why a
depth-zero null cannot serve: "zeroing the depth also removes the sidebands." Zeroing
`chi_mod_depth` would leave the respiratory mechanisms running at f2 at full strength, so any
leakage they cause would appear in the null too and mask itself. This null instead removes the
CAUSE -- mechanism (a) off, chi modulation still on at f1 -- so the only thing that differs
between observed and null is whether respiration is running at f2 at all.

Three frequencies are checked, not one. The sidebands f2 +- f1 are intermodulation products and
need energy at BOTH frequencies to exist; D12 called this arm vacuous for exactly that reason,
because until P11 mechanism (a) was not built and there was nothing at f2 to intermodulate with.
This is the first run in which the arm can say anything.

TWO-SIDED, DELIBERATELY. A one-sided test would treat "the artifact SUPPRESSES the f2 line" as
a pass, and a suppression that large would be just as much evidence that the artifact is
reaching the estimator.

AND IT IS ABSENCE OF EVIDENCE, which the detail line states rather than implies. A sign test on
n paired seeds resolves a shift only when it flips most pairs. Measured, mechanism (a) moves the
f2 line by 0.2% of the null median -- so this arm establishes that leakage is not GROSS, not
that it is zero. The honest complement is the effect ratio, reported alongside the p-value.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..spec import GateSpec, ScalarMetric
from .. import registry as R
from ..gates.g4_offfreq import measure, paired_sign_test

SPEC = GateSpec(
    id="G4",
    title="Respiration–χ leakage null — respiration at f₂ must not reach χ̂",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_g4_seed_aggregation",
    # `resp_artifact_amp` is NOT listed, though it is quoted in the detail line. The preflight
    # rejected it when it was, and correctly: criterion_inputs declares what the CRITERION
    # consumes, and a sign test against p = 0.5 consumes nothing but the pairing. The artifact
    # amplitude sets how big the confound is, not where the pass boundary sits — listing it
    # would have made an invented row look load-bearing in a verdict it cannot move.
    criterion_inputs=("g4_f1", "g4_f2"),
    requires_tools=(),
    claim="Establishes that respiratory leakage into χ̂ is not gross. ABSENCE OF EVIDENCE: a "
    "paired sign test at this n cannot resolve a small leak, and the measured effect is 0.2% "
    "of the null median. Says nothing about the estimator's behaviour at other frequencies.",
)


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    m = measure(seeds, Path(params["out_root"]))
    used, f1, f2 = m["seeds"], m["f1"], m["f2"]
    n = len(used)
    obs = m["rows"]["observed"]
    nol = m["rows"]["null_leak"]

    # THE EFFECT-SIZE FLOOR, without which this arm tests resolution rather than consequence.
    # A paired sign test detects DIRECTION, not magnitude: pairing removes the variance, so with
    # a precise enough estimator any systematic difference -- however tiny -- clears p < 0.05.
    # That is not hypothetical. When Finding 16's estimator lowered the variance, the f2+f1
    # sideband went to 1/12 seeds (p = 0.0063) at an effect ratio of 0.999, and the gate reported
    # LEAKAGE and "none of it reaches chi-hat" in the same sentence.
    #
    # `chi_est_mdd_resp` is the smallest modulation depth this estimator can see at all, so a
    # difference below it cannot support or refute any claim about coupling. Leakage must be BOTH
    # statistically consistent AND at least that large.
    floor = R.scalar_value("chi_est_mdd_resp")

    checks: dict[str, dict] = {}
    passed = True
    for name, f in (("f2", f2), ("f2-f1", f2 - f1), ("f2+f1", f2 + f1)):
        o = np.array([r[str(f)] for r in obs])
        u = np.array([r[str(f)] for r in nol])
        # Ties discarded -- see `paired_sign_test`. A tied pair is no evidence in either
        # direction, and counting it as one made two identical records look significant.
        k, n_eff, p = paired_sign_test(o, u, two_sided=True)
        ratio = float(np.median(o) / max(np.median(u), 1e-12))
        # THE LEAKAGE AMPLITUDE, EXTRACTED INCOHERENTLY. `o` and `u` are magnitudes of a line at
        # the same frequency, and an added component of unknown relative phase combines in
        # QUADRATURE: |o|^2 ~ |u|^2 + |leak|^2. A linear `o - u` therefore understates it badly --
        # measured on a real leakage source, 0.017 by subtraction against 0.046 in quadrature,
        # which is the difference between "well below the floor" and "at it".
        leak = np.sqrt(np.maximum(o**2 - u**2, 0.0))
        effect = float(np.median(leak))
        material = effect > floor
        checks[name] = {"freq": f, "k": k, "n": n_eff, "p": p, "ratio": ratio,
                        "effect": effect, "material": material,
                        "median_obs": float(np.median(o)), "median_null": float(np.median(u))}
        if p < 0.05 and material:
            passed = False

    biggest = max(checks.values(), key=lambda c: c["effect"])
    lo_uv, hi_uv = R.uncertainty("resp_artifact_amp")
    detail = (
        "; ".join(
            f"{name} {c['k']}/{c['n']} (p={c['p']:.2g}, {c['ratio']:.3f}x, "
            f"effect {c['effect']:.4f}{'' if c['material'] else ' < floor'})"
            for name, c in checks.items()
        )
        + f". Mechanism (a) injects resp_artifact_amp ~{lo_uv:.0f}-{hi_uv:.0f} uV at f2. "
        f"Largest paired effect {biggest['effect']:.4f} against the estimator's detection floor "
        f"chi_est_mdd_resp = {floor:.3f}: leakage must be BOTH consistent (p < 0.05) and at least "
        f"that large, because a paired sign test detects direction rather than magnitude. "
        f"ABSENCE OF EVIDENCE either way -- this bounds leakage below the floor, it does not "
        f"show it is zero."
    )
    if not passed:
        offenders = ", ".join(
            f"{k} ({c['effect']:.4f} at p={c['p']:.2g})"
            for k, c in checks.items() if c["p"] < 0.05 and c["material"]
        )
        detail = f"MATERIAL LEAKAGE — {offenders}. " + detail

    return (
        ScalarMetric(
            per_seed={s: float(r[str(f2)]) for s, r in zip(used, obs)},
            unit="chi modulation depth at f2",
        ),
        passed,
        detail,
        {"n_seeds": n, "checks": checks},
    )
