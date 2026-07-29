"""The gate runner. Built before any individual gate, because it is what makes them trustworthy.

    python -m prep.runner --tier fast
    python -m prep.runner --tier all --seeds 20 --out prep/out/report

Responsibilities, from harness sections 1, 7 and 8:

  * the dependency graph, with dependents of a failure refused rather than evaluated
  * runtime tiering (fast < 2 min every commit, slow < 30 min nightly)
  * V/C/U printed beside every result, and never conflated with run status
  * one JSON artifact and one human summary per run

PREFLIGHT REFUSALS. The runner will not start if:

  * a module under gates/ has no counterpart under nulls/ -- "never merge a gate without its
    null" is enforced rather than remembered;
  * a failable gate's criterion row has standing `invented` -- harness section 1 forbids a
    pass criterion that is not derived, definitional, or from published ranges;
  * the modules on disk disagree with the frozen ledger in gates/__init__.py.

"REPORT THE EARLIEST FAILURE ONLY" -- disambiguated. The instruction is ambiguous between
topological and temporal order, and silent on independent siblings. Read temporally it hides
real bugs depending on scheduling; read as "exactly one failure" it hides a second, unrelated
root cause. Resolution: failures are reported in TOPOLOGICAL order, and only the DEPENDENTS of
a failed gate are suppressed. Two gates that do not depend on one another are independent root
causes and both are reported.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import os
import pkgutil
import stat
import sys
import shutil
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Iterable

from . import registry as R
from . import report as report_mod
from . import toolprobe
from .gates import GATE_LEDGER, LEDGER_ORDER
from .spec import GateResult, GateSpec, Status

_ROOT = Path(__file__).resolve().parent.parent


class PreflightError(RuntimeError):
    """The runner refuses to start. Never downgraded to a warning."""


def default_work_root() -> Path:
    """Scratch root for generated epoch directories.

    Deliberately OUTSIDE the project tree. Gates generate hundreds of megabytes of binary
    epoch directories and delete them again; under a synced folder (OneDrive, Dropbox) the
    sync client holds handles and `rmtree` fails with a permission error mid-run, which
    surfaces as a gate ERROR that has nothing to do with the generator.

    Override with --work when you need to inspect what a gate actually generated.
    """
    env = os.environ.get("EEGSIM_WORK_ROOT")
    if env:
        return Path(env)
    return Path(tempfile.gettempdir()) / "eegsim-harness"


def rmtree_robust(path: Path) -> None:
    """`shutil.rmtree` that survives read-only files on Windows."""
    def on_error(func, p, _exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass

    if path.exists():
        shutil.rmtree(path, onerror=on_error)


# ------------------------------------------------------------------- preflight


def _modules_in(package: str) -> dict[str, Any]:
    """Import every gate/null module and index it by the gate id it declares."""
    pkg = importlib.import_module(f"prep.{package}")
    found: dict[str, Any] = {}
    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name.startswith("_"):
            continue
        mod = importlib.import_module(f"prep.{package}.{info.name}")
        spec = getattr(mod, "SPEC", None)
        if spec is None:
            raise PreflightError(
                f"prep/{package}/{info.name}.py declares no module-level SPEC"
            )
        if spec.id in found:
            raise PreflightError(f"two modules in prep/{package} claim gate {spec.id}")
        found[spec.id] = mod
    return found


def preflight(strict_ledger: bool = True) -> tuple[dict[str, Any], dict[str, Any]]:
    gates = _modules_in("gates")
    nulls = _modules_in("nulls")

    problems: list[str] = []

    for gid in gates:
        if gid not in nulls:
            problems.append(
                f"gate {gid} has no matched null in prep/nulls/ -- "
                "harness section 9: never merge a gate without its null"
            )
    for gid in nulls:
        if gid not in gates:
            problems.append(f"null {gid} has no gate in prep/gates/")

    for gid, mod in gates.items():
        spec: GateSpec = mod.SPEC
        if gid not in GATE_LEDGER:
            problems.append(f"gate {gid} is not in the frozen ledger")
            continue
        ledger = GATE_LEDGER[gid]
        if (spec.gate_class, spec.failable, spec.runtime_tier) != (
            ledger.gate_class,
            ledger.failable,
            ledger.runtime_tier,
        ):
            problems.append(
                f"gate {gid} module disagrees with the frozen ledger "
                f"(module: class={spec.gate_class} failable={spec.failable} tier={spec.runtime_tier}; "
                f"ledger: class={ledger.gate_class} failable={ledger.failable} tier={ledger.runtime_tier})"
            )

    # The circularity rule, mechanically -- over BOTH arms.
    #
    # Null modules were previously never checked at all, which under D9 means G5's only
    # failable arm escaped the check entirely. And checking a criterion's own standing is not
    # enough: `gate_g5_null_ordering` is `derived` yet consumes an `invented` -6 dB that sets
    # the whole discriminative power of the test.
    for kind, table in (("gate", gates), ("null", nulls)):
        for gid, mod in table.items():
            sp: GateSpec = mod.SPEC
            if not sp.failable or not sp.criterion_key:
                continue
            key = sp.criterion_key
            if R.is_absent(key):
                problems.append(
                    f"{kind} {gid} is failable but its criterion {key!r} has no value at all "
                    f"(absent: {R.absent_reason(key)[:80]}...) -- a failable gate with no "
                    f"criterion cannot fail for a stated reason"
                )
                continue
            if R.standing(key) == "invented":
                problems.append(
                    f"{kind} {gid} is failable but its criterion {key!r} has standing "
                    f"'invented' -- harness section 1 prohibits a pass criterion that is not "
                    f"derived, definitional, or from published inter-rater ranges"
                )
            for dep in sp.criterion_inputs:
                if R.standing(dep) == "invented" or R.record(dep)["value"]["kind"] == "pending":
                    problems.append(
                        f"{kind} {gid}'s criterion {key!r} consumes {dep!r}, standing "
                        f"'{R.standing(dep)}' -- the criterion's own standing does not "
                        f"launder an invented number it depends on"
                    )

    if strict_ledger:
        missing = set(GATE_LEDGER) - set(gates)
        if missing:
            problems.append(
                f"ledger declares {sorted(missing)} but no module implements them "
                "(use --allow-partial while the gates are still being written)"
            )

    if problems:
        raise PreflightError(
            "runner refuses to start:\n  " + "\n  ".join(problems)
        )
    return gates, nulls


# ------------------------------------------------------------- dependency graph


def _topological(ids: Iterable[str]) -> list[str]:
    """Ledger order, filtered. LEDGER_ORDER is already a valid topological order."""
    want = set(ids)
    ordered = [g for g in LEDGER_ORDER if g in want]
    leftover = sorted(want - set(ordered))
    return ordered + leftover


def _criterion_inputs(sp: GateSpec) -> tuple[str, ...]:
    return tuple(sp.criterion_inputs)


def _blocked_by(gid: str, results: dict[str, GateResult]) -> str | None:
    """The nearest upstream gate whose status blocks this one, or None."""
    for dep in GATE_LEDGER[gid].depends_on:
        r = results.get(dep)
        if r is None:
            return f"{dep} was not run"
        if r.status.blocks_dependents:
            return f"{dep} is {r.status.value}"
    return None


# --------------------------------------------------------------------- running


def _threshold_for(spec: GateSpec) -> tuple[str | None, str | None]:
    """Human-readable threshold and its registry standing, for the report line."""
    if not spec.criterion_key:
        return None, None
    key = spec.criterion_key
    standing = R.standing(key)
    if R.is_absent(key):
        return "(none at Tier 0)", standing
    rec = R.record(key)
    v = rec["value"]
    kind = v["kind"]
    if kind == "scalar":
        u = rec["units"]
        return f"{v['v']}{' ' + u if u else ''}", standing
    if kind == "bound":
        op = {"lt": "<", "gt": ">", "le": "<=", "ge": ">="}[v["op"]]
        return f"{op}{v['v']}", standing
    if kind == "interval":
        return f"{v['lo']}-{v['hi']}", standing
    if kind == "procedure":
        text = v["text"]
        return (text[:44] + "...") if len(text) > 47 else text, standing
    return kind, standing


def run_gate(
    gid: str,
    gate_mod: Any,
    null_mod: Any,
    seeds: list[int],
    params: dict[str, Any],
    results: dict[str, GateResult],
) -> tuple[GateResult, GateResult]:
    spec: GateSpec = GATE_LEDGER[gid]
    null_spec: GateSpec = null_mod.SPEC

    # Each ARM's own criterion, not the positive arm's stamped onto both. Under D9 the two
    # differ in standing as well as value: G5's positive criterion is definitional while its
    # null rests on an invented -6 dB -- and the null is the only arm carrying a verdict. One
    # shared lookup printed `definitional` on the line the whole gate hangs on.
    def meta(sp: GateSpec) -> tuple[str | None, str | None, bool]:
        thr, std = _threshold_for(sp)
        prov = R.provenance_is_provisional(
            tuple(sp.provenance_keys) + _criterion_inputs(sp)
        )
        return thr, std, prov

    def shell(sp: GateSpec, arm: str, status: Status, detail: str) -> GateResult:
        thr, std, prov = meta(sp)
        return GateResult(
            spec=sp,
            arm=arm,  # type: ignore[arg-type]
            status=status,
            detail=detail,
            threshold=thr,
            threshold_standing=std,
            provenance_provisional=prov,
        )

    blocker = _blocked_by(gid, results)
    if blocker:
        d = f"not evaluated: {blocker}"
        return (
            shell(spec, "positive", Status.SKIPPED, d),
            shell(null_spec, "null", Status.SKIPPED, d),
        )

    absent = toolprobe.missing(spec.requires_tools)
    if absent:
        d = f"requires {', '.join(absent)}, not installed -- this is NOT a pass"
        return (
            shell(spec, "positive", Status.UNAVAILABLE, d),
            shell(null_spec, "null", Status.UNAVAILABLE, d),
        )

    out: list[GateResult] = []
    for mod, sp, arm in ((gate_mod, spec, "positive"), (null_mod, null_spec, "null")):
        t0 = time.perf_counter()
        try:
            verdict = mod.run(seeds, params)
        except Exception:
            r = shell(
                sp, arm, Status.ERROR,
                traceback.format_exc(limit=3).strip().splitlines()[-1],
            )
            r.duration_s = time.perf_counter() - t0
            out.append(r)
            continue

        metric, passed, detail, extras = verdict
        # A record-only GATE still gets a failable NULL: harness section 5 makes G1/G3
        # record-only on the positive arm while section 9 forbids merging a gate without its
        # null, which implies the null is a real check. The null's own SPEC decides.
        if not sp.failable:
            status = Status.RECORD
        else:
            status = Status.PASS if passed else Status.FAIL

        thr, std, prov = meta(sp)
        r = GateResult(
            spec=sp,
            arm=arm,  # type: ignore[arg-type]
            status=status,
            metric=metric,
            threshold=thr,
            threshold_standing=std,
            detail=detail,
            duration_s=time.perf_counter() - t0,
            provenance_provisional=prov,
            extras=extras or {},
        )
        out.append(r)

    return out[0], out[1]


def registry_digest() -> str:
    return hashlib.sha256(
        (_ROOT / "gen" / "registry.json").read_bytes()
    ).hexdigest()[:16]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="prep.runner", description=__doc__)
    ap.add_argument("--tier", choices=["fast", "slow", "all"], default="fast")
    ap.add_argument("--seeds", type=int, default=None, help="defaults to registry n_seeds")
    ap.add_argument("--out", default="prep/out/report")
    ap.add_argument(
        "--work",
        default=None,
        help="scratch root for generated epoch directories "
        f"(default: {default_work_root()}, deliberately outside the project tree)",
    )
    ap.add_argument("--only", nargs="*", help="restrict to these gate ids")
    ap.add_argument(
        "--allow-partial",
        action="store_true",
        help="permit ledger entries with no implementing module (during the build-out)",
    )
    args = ap.parse_args(argv)

    try:
        gates, nulls = preflight(strict_ledger=not args.allow_partial)
    except PreflightError as e:
        print(f"\n{e}\n", file=sys.stderr)
        return 2

    n_seeds = args.seeds if args.seeds is not None else int(R.scalar_value("n_seeds"))
    seeds = [1000 + i for i in range(n_seeds)]

    selected = [
        g for g in gates
        if (args.tier == "all" or GATE_LEDGER[g].runtime_tier == args.tier)
        and (not args.only or g in args.only)
    ]
    order = _topological(selected)

    work_root = Path(args.work) if args.work else default_work_root()
    work_root.mkdir(parents=True, exist_ok=True)
    params: dict[str, Any] = {"out_root": work_root}

    results: dict[str, GateResult] = {}
    ordered_results: list[GateResult] = []
    for gid in order:
        gate_r, null_r = run_gate(gid, gates[gid], nulls[gid], seeds, params, results)
        results[gid] = gate_r
        ordered_results.append(gate_r)
        ordered_results.append(null_r)

    rep = report_mod.build_report(
        ordered_results,
        generator_version=R.GENERATOR_VERSION,
        registry_digest=registry_digest(),
        toolchain_fingerprint=toolprobe.fingerprint(),
        tools=toolprobe.probe_all(),
        runtime_tier=args.tier,
    )
    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = _ROOT / out_dir
    j, t = report_mod.write_report(out_dir, rep)

    print(report_mod.human_summary(rep))
    print(f"\n  wrote {j.relative_to(_ROOT)} and {t.relative_to(_ROOT)}\n")

    return 0 if rep["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
