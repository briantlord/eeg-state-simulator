"""G6's matched null -- a deliberately mis-centred projection must FAIL.

"This confirms the gate reads the DATA from the projection file (seam 3) while comparing
against the INDEPENDENT expectation, rather than comparing the file to itself."

That is the only thing standing between G6 and a tautology, and it is not a hypothetical
worry: `topo_expect_*` and `topo_centre_*` describe the same physical fact from two sources, so
a gate wired to the wrong one would agree with itself perfectly and forever. Every
`topo_centre_*`/`topo_sigma_*` row carries `constrained_by: must not be derived from
topo_expect_*`; this null is the runtime check that the wiring matches the constraint.

THE PERTURBATION IS A TRANSPOSITION OF WEIGHT VECTORS BETWEEN GENERATORS, applied in memory
rather than by editing the shipped projection file.

The first attempt was an anterior-posterior mirror, and it FAILED FOR AN INSTRUCTIVE REASON:
`spindle_fast`'s argmax is **Cz**, which lies on the AP midline, so a mirror maps it to itself.
3 of 4 comparisons broke and the fourth was a fixed point of the perturbation. A null with a
fixed point does not test the generator sitting on it — and `spindle_fast` is the generator
whose expectation (`C3/C4/Cz`) is hardest to miss by accident, so it is exactly the one that
most needs testing. Rolling the channel order instead would have removed the fixed point but
introduced a free offset, and choosing the offset that breaks all four comparisons is fishing.

A transposition needs no geometry and has no fixed points by construction. It also targets a
failure mode that could really occur: a projection file with two entries transposed. The pairing
sends each topography somewhere its own expectation rejects:

    spindle_fast <-> kc            central <-> frontal
    alpha        <-> spindle_slow  posterior <-> frontal

`spindle_slow` is paired with `alpha` rather than with `kc` deliberately: `topo_expect_kc` is
`Fz/F3/F4` and `topo_expect_spindle_slow` is `F3/Fz/F4` — THE SAME THREE ELECTRODES — so
swapping those two would break neither comparison and the null would silently lose half its
coverage.

EVERY comparison must break, not merely the overall verdict. A generator whose argmax survives
mis-centring was never being tested, which is the whole thing this null exists to detect.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from ..gates.g6_topography import EXPECTATIONS, collect, evaluate

SPEC = GateSpec(
    id="G6",
    title="Topography null — a mis-centred projection must fail every comparison",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_topography",
    requires_tools=(),
    claim="Confirms G6 reads the projection file and compares it against an independent "
    "expectation, rather than comparing the file to itself. Says nothing about whether the "
    "topographies are the right SHAPE — only that they are centred somewhere the literature "
    "agrees with, and that moving them breaks the gate.",
)


#: Transpositions applied to the generator -> weights mapping. See the module docstring for why
#: `spindle_slow` pairs with `alpha` and not with `kc`.
SWAPS = (("spindle_fast", "kc"), ("alpha", "spindle_slow"))


def transpose(weights: dict[str, list[float]]) -> dict[str, list[float]]:
    """Give each generator another generator's topography. No fixed points."""
    out = dict(weights)
    for a, b in SWAPS:
        out[a], out[b] = weights[b], weights[a]
    return out


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g6_null"
    rmtree_robust(work)
    seed = seeds[0]
    weights, channels = collect(work, seed)

    swapped = transpose(weights)
    results, still_passes = evaluate(swapped, channels)

    # EVERY comparison must break, not just the verdict. See the module docstring.
    broken = [gen for gen, r in results.items() if not r["ok"]]
    passed = len(broken) == len(EXPECTATIONS)

    detail = "; ".join(
        f"{gen} -> {r['argmax']} ({'still in ' if r['ok'] else 'left '}"
        f"{'/'.join(r['expected'])})"
        for gen, r in results.items()
    )
    swap_txt = ", ".join(f"{a}<->{b}" for a, b in SWAPS)
    detail = (
        f"transposed topographies ({swap_txt}): {len(broken)}/{len(EXPECTATIONS)} comparisons "
        f"broke. " + detail
    )
    if still_passes:
        detail = (
            "MIS-CENTRED PROJECTION STILL PASSES G6 -- the gate is reading its expectation "
            "from the same source as its data. " + detail
        )
    elif not passed:
        detail += (
            ". Not every comparison broke: a generator whose argmax survives mis-centring was "
            "never being tested, which leaves the gate partly tautological on that generator."
        )

    return (
        ScalarMetric(per_seed={seed: float(len(broken))}, unit="comparisons broken by mis-centring"),
        passed,
        detail,
        {"results": results, "n_broken": len(broken), "n_total": len(EXPECTATIONS)},
    )
