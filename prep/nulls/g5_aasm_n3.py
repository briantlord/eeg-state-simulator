"""G5's matched null -- and under D9's replacement this is the arm that carries the verdict.

"Generated N2 must FAIL the N3 criterion, and generated N3 at snr_nominal - 6 dB must also
fail. A criterion everything passes is not a criterion, and after calibration the null is the
only arm that can genuinely fail."

The verdict is a strict ORDERING rather than a threshold:

    pass_fraction(N3 @ snr_nominal) > pass_fraction(N2)
    pass_fraction(N3 @ snr_nominal) > pass_fraction(N3 @ snr_nominal + snr_null_offset)

An ordering needs no invented number of its own.

BUT IT IS NOT FREE OF ONE, and the review that withdrew D9 was right about this: the second
clause consumes `snr_null_offset` = -6 dB, standing `invented`, and the discriminative power
of that clause is set entirely by it -- hard at -1 dB, trivial at -20 dB. `criterion_inputs`
declares that dependency so the runner's preflight can see it, rather than letting a `derived`
criterion launder an invented number it rests on.

THE FIRST CLAUSE IS WEAKER THAN IT LOOKS, also per that review. N2 has no 0.5-2 Hz generator
assigned to it at all, so pass_fraction(N2) is near zero by the registry's state assignment
rather than by anything the generator does. It is retained because it would catch delta
leaking into N2 through a projection or scheduling change, which is a real regression, but it
is not the discriminative test it appears to be.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R
from ..gates.g5_aasm_n3 import aasm_fraction, calibration, EPOCHS

SPEC = GateSpec(
    id="G5",
    title="AASM N3 null -- N2 must fail, and N3 at -6 dB must fail",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_g5_null_ordering",
    criterion_inputs=("snr_null_offset",),
    requires_tools=(),
    claim="Carries G5's verdict. Catches a criterion that everything passes -- which is not a "
    "criterion. Says nothing about whether our N3 resembles real N3.",
)

def _pass_fraction(work: Path, seed: int, state: str, snr_db: float, fs: float) -> float:
    run_ = generate(work, seed=seed, state=state, epochs=EPOCHS, snr_db=snr_db)
    sig, ch = run_.concatenated()
    n = int(fs * R.scalar_value("epoch_display"))
    thr = R.scalar_value("gate_aasm_n3_min_fraction")
    return float(np.mean([
        aasm_fraction(sig[:, e * n:(e + 1) * n], ch, fs) >= thr for e in range(EPOCHS)
    ]))


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    cal = calibration()
    nominal = cal["value_db"]
    offset = R.scalar_value("snr_null_offset")
    fs = R.scalar_value("fs")

    work = Path(params["out_root"]) / "g5_null"
    rmtree_robust(work)

    # Use every held-out seed the runner supplies. The former cap at three was a runtime
    # shortcut that became statistically brittle once N3 was fitted to the real HMC pass-fraction
    # distribution (median 0.228, not near one): 18 epochs can easily contain zero passes and
    # turn a correct strict ordering into a tie. The positive arm already pays for all seeds.
    used = [s for s in seeds if s != cal["fixture"]["seed"]]
    n3, n2, quiet = [], [], []
    for s in used:
        n3.append(_pass_fraction(work / f"n3_{s}", s, "n3", nominal, fs))
        n2.append(_pass_fraction(work / f"n2_{s}", s, "n2", nominal, fs))
        quiet.append(_pass_fraction(work / f"lo_{s}", s, "n3", nominal + offset, fs))

    m_n3, m_n2, m_quiet = float(np.mean(n3)), float(np.mean(n2)), float(np.mean(quiet))
    beats_n2 = m_n3 > m_n2
    beats_quiet = m_n3 > m_quiet
    passed = beats_n2 and beats_quiet

    detail = (
        f"N3 {m_n3:.2f} vs N2 {m_n2:.2f} ({'ok' if beats_n2 else 'FAIL'}) and "
        f"vs N3{offset:+.0f}dB {m_quiet:.2f} ({'ok' if beats_quiet else 'FAIL'}), "
        f"{len(used)} seed(s) x {EPOCHS} epochs"
    )
    return (
        ScalarMetric(per_seed={s: v for s, v in zip(used, n3)}, unit="pass fraction"),
        passed,
        detail,
        {"n3": m_n3, "n2": m_n2, "n3_attenuated": m_quiet,
         "snr_null_offset_db": offset, "snr_nominal_db": nominal},
    )
