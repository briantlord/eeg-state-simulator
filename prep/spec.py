"""The gate module contract.

Harness section 9: "Build runner.py first -- dependency graph, tiering, V/C/U printing --
before any individual gate. The runner is what makes the gates trustworthy."

Two distinctions this module exists to keep apart, because collapsing either one is how a
gate comes to be read as more than it is:

  CLASS is a property of the gate's DESIGN and never changes between runs.
  STATUS is a property of THIS RUN.

A missing specparam install must not present as class U. Class U means "no recovery check
exists" -- a permanent statement about what the gate can ever establish. A missing install is
status UNAVAILABLE, which is a fact about this machine. Overloading one onto the other makes
an uninstalled dependency indistinguishable from a gate that can never validate anything.

  A RECORD-ONLY gate has no verdict. It is never PASS.

Harness section 5 makes G1a, G1b and G3 record-only at Tier 0: they capture a distribution or
a curve rather than passing or failing. The runner must render that so it cannot be misread as
success, because a green line beside a record-only gate is exactly the "unexamined assumption
presented as a measurement" the spec opens by warning about.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Literal, Protocol, Sequence

GateClass = Literal["V", "C", "U"]
RuntimeTier = Literal["fast", "slow"]


class Status(str, Enum):
    """What happened on THIS run. Distinct from GateClass, deliberately."""

    PASS = "PASS"
    FAIL = "FAIL"
    #: Record-only: a distribution or curve was captured. Carries no verdict.
    RECORD = "RECORD"
    #: An upstream dependency failed, so this was not evaluated. Not a pass.
    SKIPPED = "SKIPPED"
    #: A required third-party tool is not installed. Not a pass, not a design property.
    UNAVAILABLE = "UNAVAILABLE"
    #: The gate raised. A bug in the gate, not a verdict about the generator.
    ERROR = "ERROR"

    @property
    def is_green(self) -> bool:
        """Only PASS is green. RECORD is not a pass; nor is SKIPPED or UNAVAILABLE."""
        return self is Status.PASS

    @property
    def blocks_dependents(self) -> bool:
        return self in (Status.FAIL, Status.ERROR, Status.UNAVAILABLE, Status.SKIPPED)


# --------------------------------------------------------------------- metrics
#
# Not every gate produces a scalar. The report format required by harness section 8 assumes a
# median and an IQR, but G2 produces a digest, G3 a curve and G6 a categorical electrode
# label. Forcing those into a scalar would either fabricate a number or drop the result.


@dataclass(frozen=True)
class ScalarMetric:
    """Per-seed scalar. Reported as median and IQR, with per-seed values stored.

    Per-seed values are kept because "a gate passing on median while bimodal is a bug signal".
    """

    per_seed: dict[int, float]
    unit: str | None = None
    kind: Literal["scalar"] = "scalar"

    @property
    def median(self) -> float:
        return statistics.median(self.per_seed.values())

    @property
    def iqr(self) -> float:
        vals = sorted(self.per_seed.values())
        if len(vals) < 4:
            return float("nan")
        q = statistics.quantiles(vals, n=4)
        return q[2] - q[0]

    def summary(self) -> str:
        u = f" {self.unit}" if self.unit else ""
        return f"median {self.median:.6g}{u}  IQR {self.iqr:.4g}"


@dataclass(frozen=True)
class DigestMetric:
    """Per-seed content digest. G2's quantity: there is no distribution to summarize."""

    per_seed: dict[int, str]
    kind: Literal["digest"] = "digest"

    def summary(self) -> str:
        uniq = len(set(self.per_seed.values()))
        return f"{len(self.per_seed)} seed(s), {uniq} distinct digest(s)"


@dataclass(frozen=True)
class CurveMetric:
    """A curve, e.g. G3's F1 against inclusion threshold. Tier 0 records; Tier 1 sets a criterion."""

    x: Sequence[float]
    y_per_seed: dict[int, Sequence[float]]
    x_label: str
    y_label: str
    kind: Literal["curve"] = "curve"

    def summary(self) -> str:
        return f"curve {self.y_label} vs {self.x_label}, {len(self.x)} points, {len(self.y_per_seed)} seed(s)"


@dataclass(frozen=True)
class CategoricalMetric:
    """A label per seed against an expected label. G6's quantity: argmax electrode."""

    per_seed: dict[int, str]
    expected: Sequence[str]
    kind: Literal["categorical"] = "categorical"

    @property
    def match_fraction(self) -> float:
        if not self.per_seed:
            return float("nan")
        hits = sum(1 for v in self.per_seed.values() if v in self.expected)
        return hits / len(self.per_seed)

    def summary(self) -> str:
        return f"{self.match_fraction:.0%} of seeds in {{{', '.join(self.expected)}}}"


Metric = ScalarMetric | DigestMetric | CurveMetric | CategoricalMetric


# ----------------------------------------------------------------------- specs


@dataclass(frozen=True)
class GateSpec:
    """Declared by every module under gates/ and nulls/ as a module-level `SPEC`."""

    id: str
    title: str
    gate_class: GateClass
    runtime_tier: RuntimeTier
    #: False => record-only. The runner renders RECORD and never PASS.
    failable: bool
    #: Gate ids that must pass before this one is evaluated.
    depends_on: tuple[str, ...] = ()
    #: Registry key holding this gate's criterion. The runner prints its STANDING on every
    #: line, and refuses to start if a failable gate's criterion standing is `invented`.
    criterion_key: str | None = None
    #: Third-party tools required. Absent => status UNAVAILABLE, never a silent skip.
    requires_tools: tuple[str, ...] = ()
    #: Registry keys this gate's result depends on. If any is pending/invented the runner
    #: suppresses comparability claims beside the metric.
    provenance_keys: tuple[str, ...] = ()
    #: One line stating what a PASS here does and does not license. Printed in the report.
    claim: str = ""


class GateModule(Protocol):
    """The contract, matching the spec's `run(seed, params) -> metric`."""

    SPEC: GateSpec

    def run(self, seed: int, params: dict[str, Any]) -> Metric: ...


@dataclass
class GateResult:
    spec: GateSpec
    status: Status
    #: Which arm this is. A gate and its null share a gate id, so without this the report
    #: prints two identical-looking rows and the reader cannot tell which one passed.
    arm: Literal["positive", "null"] = "positive"
    metric: Metric | None = None
    #: Human-readable threshold actually applied, or None for record-only gates.
    threshold: str | None = None
    threshold_standing: str | None = None
    #: Why, when the status is not PASS/RECORD.
    detail: str = ""
    duration_s: float = 0.0
    #: Set when the runner suppressed a comparability claim.
    provenance_provisional: bool = False
    extras: dict[str, Any] = field(default_factory=dict)
