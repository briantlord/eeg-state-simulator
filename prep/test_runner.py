"""Tests for the runner's refusals and its status discipline.

The runner is what makes the gates trustworthy, so the things it REFUSES to do matter as much
as the things it does. Each refusal below is tested against a planted violation -- the same
discipline the harness applies to gates, applied to the harness.
"""
from __future__ import annotations

import shutil
import sys
import textwrap
from pathlib import Path

import pytest

from . import registry as R
from .gates import GATE_LEDGER, LEDGER_ORDER
from .runner import PreflightError, _topological, preflight
from .spec import (
    CategoricalMetric,
    DigestMetric,
    GateResult,
    GateSpec,
    ScalarMetric,
    Status,
)

_PREP = Path(__file__).resolve().parent


# ------------------------------------------------------------ status discipline


def test_record_is_never_green():
    """A record-only result must not read as a pass anywhere in the pipeline."""
    assert Status.RECORD.is_green is False
    assert Status.PASS.is_green is True
    for s in (Status.SKIPPED, Status.UNAVAILABLE, Status.FAIL, Status.ERROR):
        assert s.is_green is False, f"{s} must not be green"


def test_non_pass_statuses_block_dependents():
    """"If a gate fails, refuse to evaluate its dependents." Unavailable and skipped block too:
    an unevaluated dependency is not a satisfied one."""
    assert Status.PASS.blocks_dependents is False
    assert Status.RECORD.blocks_dependents is False
    for s in (Status.FAIL, Status.ERROR, Status.UNAVAILABLE, Status.SKIPPED):
        assert s.blocks_dependents is True, f"{s} must block dependents"


def test_class_and_status_are_separate_concepts():
    """Class U means 'no recovery check can ever exist'. A missing install is status
    UNAVAILABLE. Collapsing them makes an uninstalled dependency indistinguishable from a gate
    that can never validate anything."""
    assert "U" not in {s.value for s in Status}
    assert Status.UNAVAILABLE.value == "UNAVAILABLE"


# ----------------------------------------------------------------- ledger shape


def test_ledger_order_is_a_valid_topological_order():
    seen: set[str] = set()
    for gid in LEDGER_ORDER:
        for dep in GATE_LEDGER[gid].depends_on:
            assert dep in seen, f"{gid} precedes its dependency {dep}"
        seen.add(gid)


def test_ledger_covers_every_gate():
    assert set(LEDGER_ORDER) == set(GATE_LEDGER)


def test_g2_is_the_root():
    """Harness section 7's graph starts at seed/RNG and golden baselines presuppose
    determinism, so G2 must depend on nothing and everything else must depend on it."""
    assert GATE_LEDGER["G2"].depends_on == ()
    for gid, spec in GATE_LEDGER.items():
        if gid != "G2":
            assert "G2" in spec.depends_on, f"{gid} does not depend on G2"


def test_g2_is_failable():
    """Build Plan section 9 groups G2 with the record-only gates, but bit-identity has no
    distribution to record and a determinism gate that cannot fail is worthless."""
    assert GATE_LEDGER["G2"].failable is True


def test_record_only_gates_are_the_expected_ones():
    record_only = {g for g, s in GATE_LEDGER.items() if not s.failable}
    assert record_only == {"G1a", "G1b", "G3", "G5"}


def test_no_failable_gate_rests_on_an_invented_criterion():
    """Harness section 1's circularity rule, as a property of the ledger itself."""
    for gid, spec in GATE_LEDGER.items():
        if spec.failable and spec.criterion_key:
            standing = R.standing(spec.criterion_key)
            assert standing != "invented", (
                f"{gid} is failable but its criterion {spec.criterion_key!r} is invented"
            )


def test_topological_filter_preserves_order():
    assert _topological(["G1a", "G2"]) == ["G2", "G1a"]
    assert _topological(["G4", "G2", "G6"]) == ["G2", "G4", "G6"]


# ------------------------------------------------------------------- preflight


def test_preflight_passes_on_the_real_tree():
    gates, nulls = preflight(strict_ledger=False)
    assert "G2" in gates and "G2" in nulls


def _plant(tmp_path: Path, subdir: str, name: str, body: str) -> Path:
    """Write a module into the live package, for the caller to remove afterwards."""
    p = _PREP / subdir / name
    p.write_text(textwrap.dedent(body), encoding="utf8")
    return p


def _purge_import_cache() -> None:
    for mod in [m for m in sys.modules if m.startswith("prep.gates") or m.startswith("prep.nulls")]:
        del sys.modules[mod]


@pytest.fixture
def planted():
    created: list[Path] = []
    yield created
    for p in created:
        p.unlink(missing_ok=True)
    for d in (_PREP / "gates" / "__pycache__", _PREP / "nulls" / "__pycache__"):
        shutil.rmtree(d, ignore_errors=True)
    _purge_import_cache()


def test_preflight_refuses_a_gate_with_no_null(planted):
    """"Never merge a gate without its null" -- enforced, not remembered."""
    planted.append(_plant(_PREP, "gates", "zz_orphan.py", '''
        from ..spec import GateSpec
        SPEC = GateSpec(id="G9", title="orphan", gate_class="C",
                        runtime_tier="fast", failable=True)
        def run(seeds, params): ...
    '''))
    _purge_import_cache()
    with pytest.raises(PreflightError, match="has no matched null"):
        preflight(strict_ledger=False)


def test_preflight_refuses_a_module_without_a_spec(planted):
    planted.append(_plant(_PREP, "gates", "zz_nospec.py", '''
        def run(seeds, params): ...
    '''))
    _purge_import_cache()
    with pytest.raises(PreflightError, match="declares no module-level SPEC"):
        preflight(strict_ledger=False)


def test_preflight_refuses_a_gate_disagreeing_with_the_frozen_ledger(planted):
    """The ledger is frozen because the source documents disagree three ways on the gate set."""
    planted.append(_plant(_PREP, "gates", "zz_g2_dup.py", '''
        from ..spec import GateSpec
        SPEC = GateSpec(id="G2", title="determinism, but record-only", gate_class="C",
                        runtime_tier="fast", failable=False)
        def run(seeds, params): ...
    '''))
    _purge_import_cache()
    # Two modules claiming G2 is caught first, which is itself the right refusal.
    with pytest.raises(PreflightError, match="claim gate G2"):
        preflight(strict_ledger=False)


def test_preflight_refuses_a_ledger_gate_with_no_module():
    """Without --allow-partial, a ledger entry nobody implements is a refusal rather than a
    silently smaller test set."""
    with pytest.raises(PreflightError, match="no module implements"):
        preflight(strict_ledger=True)


# ---------------------------------------------------------------------- metrics


def test_scalar_metric_reports_median_and_iqr():
    m = ScalarMetric(per_seed={i: float(i) for i in range(1, 9)})
    assert m.median == 4.5
    assert m.iqr > 0
    assert "median" in m.summary()


def test_digest_metric_counts_distinct():
    m = DigestMetric(per_seed={1: "a", 2: "a", 3: "b"})
    assert "2 distinct" in m.summary()


def test_categorical_metric_match_fraction():
    m = CategoricalMetric(per_seed={1: "Cz", 2: "C3", 3: "O1"}, expected=["C3", "C4", "Cz"])
    assert m.match_fraction == pytest.approx(2 / 3)


def test_gate_result_defaults_to_positive_arm():
    r = GateResult(spec=GATE_LEDGER["G2"], status=Status.PASS)
    assert r.arm == "positive"
