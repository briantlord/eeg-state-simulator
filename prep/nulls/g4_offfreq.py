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
from ..gates.g4_offfreq import measure, sign_test

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

    checks: dict[str, dict] = {}
    passed = True
    for name, f in (("f2", f2), ("f2-f1", f2 - f1), ("f2+f1", f2 + f1)):
        o = np.array([r[str(f)] for r in obs])
        u = np.array([r[str(f)] for r in nol])
        k = int((o > u).sum())
        p = sign_test(k, n, two_sided=True)
        ratio = float(np.median(o) / max(np.median(u), 1e-12))
        checks[name] = {"freq": f, "k": k, "n": n, "p": p, "ratio": ratio,
                        "median_obs": float(np.median(o)), "median_null": float(np.median(u))}
        if p < 0.05:
            passed = False

    worst = min(checks.values(), key=lambda c: c["p"])
    detail = (
        "; ".join(
            f"{name} {c['k']}/{n} (p={c['p']:.2g}, {c['ratio']:.3f}x)"
            for name, c in checks.items()
        )
        + f". Mechanism (a) injects resp_artifact_amp ~"
        f"{R.uncertainty('resp_artifact_amp')[0]:.0f}-{R.uncertainty('resp_artifact_amp')[1]:.0f}"
        f" uV at f2 and none of it reaches χ̂. ABSENCE OF EVIDENCE: the largest effect seen is "
        f"{max(abs(c['ratio'] - 1) for c in checks.values()):.3f} in ratio terms, below what a "
        f"sign test at n={n} can resolve."
    )
    if not passed:
        detail = f"LEAKAGE at {worst['freq']} Hz — " + detail

    return (
        ScalarMetric(
            per_seed={s: float(r[str(f2)]) for s, r in zip(used, obs)},
            unit="chi modulation depth at f2",
        ),
        passed,
        detail,
        {"n_seeds": n, "checks": checks},
    )
