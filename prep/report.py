"""Report emission: one JSON artifact and one human summary per run.

Harness section 8 requires every line to carry: gate ID, class (V/C/U), N seeds, median, IQR,
threshold, THRESHOLD STANDING (from the registry), pass/fail, and generator version.

Two things the format must not do, and which cost real care to avoid:

  It must not render a record-only result as a pass. A green tick beside G1a would convert a
  captured distribution into an apparent verdict.

  It must not let a class letter oversell a gate. G5's positive arm is calibrated, so it is
  "weaker than its class letter suggests, and the runner should say so". Each gate carries a
  `claim` line stating what a pass does and does not license, and the summary prints it.
"""
from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from .spec import (
    CategoricalMetric,
    CurveMetric,
    DigestMetric,
    GateResult,
    ScalarMetric,
    Status,
)

CLASS_MEANING = {
    "V": "recovery by an external, independently authored, published tool",
    "C": "recovery by code in this repository -- self-consistency only",
    "U": "no recovery check exists",
}

_STATUS_GLYPH = {
    Status.PASS: "PASS  ",
    Status.FAIL: "FAIL  ",
    Status.RECORD: "RECORD",
    Status.SKIPPED: "SKIP  ",
    Status.UNAVAILABLE: "N/A   ",
    Status.ERROR: "ERROR ",
}


def _metric_json(m: Any) -> dict[str, Any] | None:
    if m is None:
        return None
    if isinstance(m, ScalarMetric):
        return {
            "kind": "scalar",
            "unit": m.unit,
            "median": m.median,
            "iqr": m.iqr,
            "n_seeds": len(m.per_seed),
            "per_seed": m.per_seed,
        }
    if isinstance(m, DigestMetric):
        return {"kind": "digest", "n_seeds": len(m.per_seed), "per_seed": m.per_seed}
    if isinstance(m, CurveMetric):
        return {
            "kind": "curve",
            "x_label": m.x_label,
            "y_label": m.y_label,
            "x": list(m.x),
            "y_per_seed": {k: list(v) for k, v in m.y_per_seed.items()},
        }
    if isinstance(m, CategoricalMetric):
        return {
            "kind": "categorical",
            "expected": list(m.expected),
            "match_fraction": m.match_fraction,
            "per_seed": m.per_seed,
        }
    if is_dataclass(m):
        return asdict(m)
    return {"kind": "unknown", "repr": repr(m)}


def build_report(
    results: Sequence[GateResult],
    *,
    generator_version: str,
    registry_digest: str,
    toolchain_fingerprint: str,
    tools: dict[str, Any],
    runtime_tier: str,
) -> dict[str, Any]:
    return {
        "schema": 1,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator_version": generator_version,
        "registry_digest": registry_digest,
        "toolchain_fingerprint": toolchain_fingerprint,
        "runtime_tier": runtime_tier,
        "tools": {
            k: {
                "available": v.available,
                "installed": v.installed_version,
                "pinned": v.pinned_version,
                "prerelease": v.prerelease,
                "version_mismatch": v.version_mismatch,
            }
            for k, v in tools.items()
        },
        "gates": [
            {
                "id": r.spec.id,
                "arm": r.arm,
                "label": r.spec.id if r.arm == "positive" else f"{r.spec.id}~null",
                "title": r.spec.title,
                "class": r.spec.gate_class,
                "class_meaning": CLASS_MEANING[r.spec.gate_class],
                "runtime_tier": r.spec.runtime_tier,
                "failable": r.spec.failable,
                "status": r.status.value,
                "is_pass": r.status is Status.PASS,
                "threshold": r.threshold,
                "threshold_standing": r.threshold_standing,
                "criterion_key": r.spec.criterion_key,
                "provenance_provisional": r.provenance_provisional,
                "claim": r.spec.claim,
                "detail": r.detail,
                "duration_s": round(r.duration_s, 3),
                "metric": _metric_json(r.metric),
                "extras": r.extras,
            }
            for r in results
        ],
        "verdict": overall_verdict(results),
    }


def overall_verdict(results: Sequence[GateResult]) -> str:
    if any(r.status is Status.ERROR for r in results):
        return "ERROR"
    if any(r.status is Status.FAIL for r in results):
        return "FAIL"
    if any(r.status in (Status.SKIPPED, Status.UNAVAILABLE) for r in results):
        return "INCOMPLETE"
    return "PASS"


def human_summary(report: dict[str, Any]) -> str:
    out: list[str] = []
    w = out.append

    w("=" * 78)
    w(f"  VALIDATION HARNESS  --  {report['runtime_tier']} tier")
    w(f"  generator {report['generator_version']}   registry {report['registry_digest']}")
    w(f"  {report['created']}")
    w("=" * 78)
    w("")

    w("  Toolchain")
    for name, t in report["tools"].items():
        mark = "ok " if t["available"] else "MISSING"
        extra = ""
        if t["version_mismatch"]:
            extra = f"  !! registry pins {t['pinned']}"
        elif t["prerelease"] and t["available"]:
            extra = "  (pre-release)"
        w(f"    {mark:8} {name:12} {t['installed'] or '-':12}{extra}")
    w("")

    w(f"  {'GATE':9} {'CLS':4} {'STATUS':7} {'N':>3}  {'METRIC':34} {'THRESHOLD STANDING'}")
    w("  " + "-" * 74)
    for g in report["gates"]:
        m = g["metric"]
        n = str(m.get("n_seeds", len(m.get("per_seed", {})))) if m else "-"
        if m is None:
            metric_s = "--"
        elif m["kind"] == "scalar":
            metric_s = f"median {m['median']:.6g}  IQR {m['iqr']:.4g}"
        elif m["kind"] == "digest":
            metric_s = f"{len(set(m['per_seed'].values()))} distinct digest(s)"
        elif m["kind"] == "curve":
            metric_s = f"curve {m['y_label']} vs {m['x_label']}"
        elif m["kind"] == "categorical":
            metric_s = f"{m['match_fraction']:.0%} match {'/'.join(m['expected'])}"
        else:
            metric_s = "--"

        std = g["threshold_standing"] or "--"
        w(f"  {g['label']:9} {g['class']:4} {_STATUS_GLYPH[Status(g['status'])]} {n:>3}  "
          f"{metric_s:34} {std}")
        if g["threshold"]:
            w(f"        threshold: {g['threshold']}")
        if g["detail"]:
            w(f"        -> {g['detail']}")
    w("")

    # The honesty block. Without it a class letter oversells.
    w("  What these results do and do not license")
    w("  " + "-" * 74)
    for g in report["gates"]:
        if not g["claim"]:
            continue
        w(f"    {g['label']} [{g['class']}] {CLASS_MEANING[g['class']]}")
        for line in _wrap(g["claim"], 68):
            w(f"        {line}")
        if not g["failable"]:
            w("        RECORD-ONLY at Tier 0: captures a distribution, not a verdict.")
        if g["provenance_provisional"]:
            w("        Depends on a pending or invented registry row -- no comparability")
            w("        claim against published magnitudes may be made from this number.")
        w("")

    v = report["verdict"]
    w("=" * 78)
    w(f"  VERDICT: {v}")
    if v == "INCOMPLETE":
        w("  A skipped or unavailable gate is NOT a passing gate.")
    w("=" * 78)
    return "\n".join(out)


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        if len(cur) + len(word) + 1 > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines


def write_report(out_dir: Path, report: dict[str, Any]) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    j = out_dir / "report.json"
    t = out_dir / "report.txt"
    j.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    t.write_text(human_summary(report) + "\n", encoding="utf8")
    return j, t
