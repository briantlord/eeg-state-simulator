"""G2's matched null.

"Two different seeds must produce different output. Trivial, and it catches a seed that is not
actually threaded through."

Trivial is the point. Without it, a generator that ignored its seed entirely would sail through
G2's positive arm -- every run identical, bit-for-bit, perfectly deterministic, and completely
insensitive to the one input that is supposed to control it.

The null also checks the property one level down: that distinct SUBSTREAMS differ. A seed
threaded to the root but not to the per-generator substreams would pass the seed check while
silently making every generator draw the same numbers.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import DigestMetric, GateSpec

SPEC = GateSpec(
    id="G2",
    title="Determinism null -- different seeds must differ",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=(),
    criterion_key="gate_determinism",
    requires_tools=(),
    claim="Catches a seed that is not actually threaded through, and channels that share a "
    "substream. Says nothing about the quality of the randomness.",
)

MAX_SEEDS = 5
STATE = "n3"


def run(seeds: list[int], params: dict[str, Any]) -> tuple[DigestMetric, bool, str, dict]:
    work = Path(params["out_root"]) / "g2_null"
    rmtree_robust(work)

    used = seeds[:MAX_SEEDS]
    digests: dict[int, str] = {}
    for s in used:
        digests[s] = generate(work / f"s{s}", seed=s, state=STATE, epochs=1).digest()

    distinct = len(set(digests.values()))
    seeds_differ = distinct == len(used)

    # One level down: distinct channels must come from distinct substreams. A seed threaded to
    # the root but not to the substreams passes the check above and fails this one.
    run0 = generate(work / "substream_probe", seed=used[0], state=STATE, epochs=1)
    sig = run0.epoch(0).signal
    identical_pairs = [
        (i, j)
        for i in range(sig.shape[0])
        for j in range(i + 1, sig.shape[0])
        if np.array_equal(sig[i], sig[j])
    ]
    substreams_differ = not identical_pairs

    passed = seeds_differ and substreams_differ
    detail = f"{len(used)} seeds -> {distinct} distinct digests; {sig.shape[0]} channels all distinct"
    if not seeds_differ:
        detail = (
            f"{len(used)} seeds produced only {distinct} distinct digest(s) -- "
            "the seed is not threaded through"
        )
    elif not substreams_differ:
        detail = (
            f"{len(identical_pairs)} channel pair(s) are bit-identical, e.g. "
            f"{identical_pairs[0]} -- channels share a substream"
        )

    return (
        DigestMetric(per_seed=digests),
        passed,
        detail,
        {"distinct_digests": distinct, "identical_channel_pairs": len(identical_pairs)},
    )
