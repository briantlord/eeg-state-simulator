"""G6 -- topography, structurally. Class C.

"Criteria are STRUCTURAL rather than ratio-based, so the gate needs no invented threshold:
argmax over electrode positions requires no tolerance. That matters because Tier 0 ships
hand-tuned sigma values, and a ratio gate would need an invented threshold to test invented
parameters."

THE GATE IS ONLY MEANINGFUL BECAUSE THE TWO SIDES ARE INDEPENDENT. The DATA is the projection
weight vector, read from the epoch sidecar, which is where seam 3 put it. The EXPECTATION is
`topo_expect_*`, standing `literature`, sourced to AASM. Read the expected electrode from the
same file that places the Gaussian and the gate tests that `argmax` works -- nothing more.
Every `topo_centre_*` and `topo_sigma_*` row carries `constrained_by: must not be derived from
topo_expect_*` for this reason, and the registry enforces it.

So G6 compares the projection file against clinical convention, which is a real comparison, and
it is the only Tier 0 gate that reaches outside the project for its expectation without needing
a tolerance to do it.

`gate_alpha_ratio` (> 3 posterior/frontal) is RECORDED AS A QUANTITY, NOT USED AS A CRITERION.
It is `invented` and routed to T1-M2. Reporting it beside a structural verdict is safe; letting
it decide one would put an invented number in charge of the gate that exists to avoid them.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R

SPEC = GateSpec(
    id="G6",
    title="Topography — argmax matches the literature expectation, not the projection file",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_topography",
    requires_tools=(),
    provenance_keys=("topo_expect_spindle_fast", "topo_expect_kc", "topo_expect_alpha"),
    claim="Compares the projection file against AASM's stated maxima — the two sides are "
    "independent by registry constraint. Structural: says the topography is centred in the "
    "right place, not that its width or shape is right. Every sigma is still invented.",
)

#: Generator -> the registry row holding its independent expectation. `alpha` is checked in
#: wake_ec and the rest in n2, because that is where each is generated.
EXPECTATIONS = {
    "spindle_fast": ("topo_expect_spindle_fast", "n2"),
    "spindle_slow": ("topo_expect_spindle_slow", "n2"),
    "kc": ("topo_expect_kc", "n2"),
    "alpha": ("topo_expect_alpha", "wake_ec"),
}


def weights_from_sidecar(run_dir: Path) -> tuple[dict[str, list[float]], list[str]]:
    """Read the weights the generator ACTUALLY APPLIED, from the epoch sidecar.

    Not from `data/projection_10_20.json`. The sidecar is D7's boundary and carries the
    injected truth precisely so the harness never has to reconstruct generator internals --
    and reading the source file instead would let the gate pass while the generator used
    something else.
    """
    epochs = sorted(p for p in run_dir.iterdir() if p.name.startswith("epoch_"))
    side = json.loads((epochs[0] / "sidecar.json").read_text(encoding="utf8"))
    return side["truth"]["projectionWeights"], side["channels"]


def argmax_channel(weights: list[float], channels: list[str]) -> str:
    return channels[int(np.argmax(np.asarray(weights)))]


def alpha_ratio(weights: list[float], channels: list[str]) -> float:
    """Posterior/frontal weight ratio. RECORDED, never a criterion (gate_alpha_ratio)."""
    w = np.asarray(weights)
    post = [c for c in ("O1", "O2", "Pz") if c in channels]
    front = [c for c in ("Fp1", "Fp2", "Fz", "F3", "F4") if c in channels]
    p = float(np.mean([w[channels.index(c)] for c in post]))
    f = float(np.mean([w[channels.index(c)] for c in front]))
    return p / f if f > 0 else float("inf")


def collect(work: Path, seed: int) -> tuple[dict[str, list[float]], list[str]]:
    """Read each generator's weights FROM THE STATE THAT GENERATES IT.

    One export per state, not one for everything. The sidecar records the weights ACTUALLY
    APPLIED, and a wake record does not apply a spindle topography — the tempting shortcut was
    to have the exporter list every generator unconditionally so a single record would satisfy
    the gate, which would have made the sidecar answer a question that record never asked.
    """
    by_state: dict[str, list[str]] = {}
    for gen, (_key, state) in EXPECTATIONS.items():
        by_state.setdefault(state, []).append(gen)

    weights: dict[str, list[float]] = {}
    channels: list[str] = []
    for state, gens in by_state.items():
        # The sidecar lists generators ACTUALLY used. At the empirically fitted 20% fast-spindle
        # share, a single 30 s N2 epoch can legitimately contain no fast spindle and therefore no
        # spindle_fast projection. Use ten minutes so this structural topography fixture exercises
        # both stochastic spindle systems; the weights themselves remain identical across events.
        run_ = generate(work / f"{state}_s{seed}", seed=seed, state=state, epochs=20)
        w, ch = weights_from_sidecar(run_.path)
        channels = channels or ch
        for g in gens:
            if g not in w:
                raise KeyError(
                    f"state '{state}' did not apply generator '{g}', so its topography is not "
                    f"in the sidecar. Either EXPECTATIONS routes it to the wrong state, or the "
                    f"generator stopped being produced there."
                )
            weights[g] = w[g]
    return weights, channels


def evaluate(
    weights: dict[str, list[float]], channels: list[str]
) -> tuple[dict[str, dict], bool]:
    """Structural comparison. Shared with the null, which feeds it perturbed weights."""
    results: dict[str, dict] = {}
    ok = True
    for gen, (key, _state) in EXPECTATIONS.items():
        expected = R.electrode_set(key)
        got = argmax_channel(weights[gen], channels)
        hit = got in expected
        results[gen] = {"argmax": got, "expected": expected, "ok": hit, "row": key}
        ok = ok and hit
    return results, ok


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g6"
    rmtree_robust(work)

    # ONE SEED IS ENOUGH, and saying why matters more than the saving. The projection weights
    # are read from a data file and are IDENTICAL across seeds by construction -- seam 3 exists
    # to make them a property of the montage rather than of a draw. Running twenty seeds would
    # produce twenty identical comparisons and misrepresent that as replication.
    seed = seeds[0]
    weights, channels = collect(work, seed)
    results, passed = evaluate(weights, channels)

    ratio = alpha_ratio(weights["alpha"], channels)
    bound_op, bound = R.bound_value("gate_alpha_ratio")
    detail = "; ".join(
        f"{gen} -> {r['argmax']} ({'ok' if r['ok'] else 'FAIL'}, expected one of "
        f"{'/'.join(r['expected'])})"
        for gen, r in results.items()
    )
    detail += (
        f". alpha posterior/frontal ratio {ratio:.2f} (gate_alpha_ratio {bound_op} {bound:g}) "
        f"RECORDED ONLY -- that row is invented and routed to T1-M2, so it does not decide "
        f"this verdict. 1 seed: the weights are a data file, identical across seeds."
    )

    return (
        ScalarMetric(per_seed={seed: float(sum(r["ok"] for r in results.values()))},
                     unit="generators with argmax in the expected set"),
        passed,
        detail,
        {"results": results, "alpha_posterior_frontal_ratio": ratio,
         "alpha_ratio_bound_recorded_only": [bound_op, bound]},
    )
