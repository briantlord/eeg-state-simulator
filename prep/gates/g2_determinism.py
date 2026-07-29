"""G2 -- determinism. Class C, pass/fail, and the root of the dependency graph.

"Same seed and parameter set produces bit-identical output within a platform and within a
version. That is the whole gate. There is no cross-platform tier and NO CROSS-IMPLEMENTATION
CLAUSE."

Note on why this is pass/fail and not record-only: Build Plan section 9 groups G2 with "gates
1-3 are record-only", but bit-identity has no distribution to record, and a determinism gate
that cannot fail is worthless. Everything downstream -- golden baselines above all --
presupposes it.

The comparison runs through the seam-9 epoch directory rather than in process, because that is
the artifact every other gate reads. Bytes are compared from `signal.f64`; the CSV projection
is never read, since a bit-identity check through a lossy serializer tests the serializer.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import DigestMetric, GateSpec

SPEC = GateSpec(
    id="G2",
    title="Determinism, bit-identical within platform and version",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=(),
    criterion_key="gate_determinism",
    requires_tools=(),
    claim="The implementation is self-consistent: one seed gives one output. Says nothing "
    "about whether that output resembles EEG.",
)

#: Determinism does not need the full seed budget -- it is a property of the mechanism, not a
#: distribution. Capping is declared in the report rather than applied silently.
MAX_SEEDS = 5
STATE = "n3"
EPOCHS = 2


def run(seeds: list[int], params: dict[str, Any]) -> tuple[DigestMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g2"
    rmtree_robust(work)

    used = seeds[:MAX_SEEDS]
    dropped = len(seeds) - len(used)

    digests: dict[int, str] = {}
    mismatches: list[int] = []

    for s in used:
        a = generate(work / f"s{s}_a", seed=s, state=STATE, epochs=EPOCHS)
        b = generate(work / f"s{s}_b", seed=s, state=STATE, epochs=EPOCHS)
        da, db = a.digest(), b.digest()
        digests[s] = da
        if da != db:
            mismatches.append(s)

    passed = not mismatches
    detail = (
        f"{len(used)} seed(s) generated twice each, {EPOCHS} epoch(s), state {STATE}"
        + (f"; capped from {len(seeds)} seeds, {dropped} not run" if dropped else "")
    )
    if mismatches:
        detail += f"; NOT bit-identical for seed(s) {mismatches}"

    return (
        DigestMetric(per_seed=digests),
        passed,
        detail,
        {"max_seeds": MAX_SEEDS, "seeds_dropped": dropped, "mismatched_seeds": mismatches},
    )
