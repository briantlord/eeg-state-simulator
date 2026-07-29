"""G4 -- respiration-chi off-frequency null. Class C, and the harness calls it the most
important gate in Tier 0.

"Modulate chi at f1 while respiration runs at f2 != f1. Recovered coupling must appear at f1
and not at f2."

This is the only check that the filter demonstration measures COUPLING rather than LEAKAGE.
Class C -- we wrote the estimator -- and still the gate to build first: self-consistency is
worth little in general, but here it is the difference between a demonstration and an artifact.

THE CRITERION IS PAIRED, WHICH IS WHAT MADE IT BUILDABLE (D14). Both of D8's percentile nulls
are withdrawn. Each seed is measured twice -- once with the mechanism under test on, once with
it off, everything else identical -- and the gate counts how often the pair orders correctly.
Under the null a paired difference is positive with probability 0.5, so the criterion is an
exact sign test and the 0.5 comes from the pairing rather than from anyone's choice. That is
the "derived, not invented" threshold section 1 demands, and it removes the defect D12 found in
the percentile construction: a percentile null's per-seed exceedance rate turned out to depend
on respiration regularity (0.317 at N3-like cv, against the 0.05 it was assumed to have).
Pairing makes the seed its own control, so seed-to-seed variance cancels instead of being
modelled.

TWO POSITIVE ARMS, because "appears at f1 and not at f2" is two claims:

  DETECTION    depth(f1) with chi modulation ON  >  depth(f1) with it OFF.
  SELECTIVITY  depth(f1)  >  depth(f2), within the same record.

Detection alone would pass an estimator that smears a real line across every low frequency.
Selectivity alone would pass one that reports nothing anywhere.

THE FIXTURE, and two choices in it that decide whether the gate means anything:

  Mechanism (a), the movement artifact, is ON. It is the confound the f2 arm must survive --
  ~11 uV at 0.25 Hz on Fz. Leaving it off is what made this arm vacuous until P11: there was
  no energy at f2 for anything to leak.

  Mechanism (c)-amplitude is OFF, and this one is easy to get wrong. It modulates 0.5-4 Hz
  power at the respiratory rate, and chi-hat's low band is 2-8 Hz. THE BANDS OVERLAP BY
  CONSTRUCTION, so it produces a genuine f2 line -- measured, 3.30x the empty floor -- and a
  fixture that left it on would fail the gate for doing exactly what it was built to do.
  Conflating the respiratory mechanisms is the standard error Build Plan 5.1 warns about; this
  would be that error committed in the gate rather than the generator.

WHAT THIS GATE DOES NOT ESTABLISH. It injects `g4_fixture_chi_mod_depth` = 2.0, which is 13x
the depth the generator ships. At the shipped 0.15 the recovered line is 1.02x its own null --
invisible. G4 asks whether the estimator attributes a DETECTABLE line to the RIGHT frequency,
and a line must be detectable before that question means anything; but it follows that G4 says
nothing about whether the shipped modulation is recoverable. It is not. That is a property of
the cheap two-band chi proxy, and replacing it is T1-M2 work.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R

_ROOT = Path(__file__).resolve().parent.parent.parent

SPEC = GateSpec(
    id="G4",
    title="Respiration–χ off-frequency null — coupling at f₁, not at f₂",
    gate_class="C",
    runtime_tier="fast",
    failable=True,
    depends_on=("G2",),
    criterion_key="gate_g4_criterion",
    criterion_inputs=("g4_fixture_chi_mod_depth", "g4_f1", "g4_f2", "g4_record_length"),
    requires_tools=(),
    provenance_keys=("chi_mod_depth", "resp_artifact_amp", "g4_fixture_chi_mod_depth"),
    claim="The only check that the filter demonstration measures coupling rather than leakage. "
    "Injects 13x the shipped modulation depth, so it does NOT establish that the shipped "
    "coupling is recoverable — measured, it is not.",
)


def _epochs() -> int:
    """g4_record_length as a whole number of exported epochs."""
    n = R.scalar_value("g4_record_length") / R.scalar_value("epoch_display")
    if abs(n - round(n)) > 1e-9:
        raise ValueError(
            f"g4_record_length ({R.scalar_value('g4_record_length')} s) is not a whole number "
            f"of epoch_display ({R.scalar_value('epoch_display')} s) epochs; the exporter "
            "cannot write a partial epoch and silently truncating would shorten 1/T"
        )
    return int(round(n))


def depths(work: Path, seed: int, *, chi_mod: bool, movement: bool, freqs: list[float]) -> dict:
    """Export one fixture record and run the SHIPPED estimator over it.

    Two subprocess hops, both deliberate. The exporter is the D7 boundary -- the harness
    measures an exported epoch directory rather than reaching into the generator. The estimator
    is `bin/eegsim-chi.mts` rather than a Python mirror because G4 is class C: the estimator IS
    the thing under test, and it is the same code the filter demonstration runs. A Python mirror
    that drifted would leave this gate green while covering nothing.
    """
    f1 = R.scalar_value("g4_f1")
    f2 = R.scalar_value("g4_f2")
    rmtree_robust(work)
    export = [
        "node", "--experimental-strip-types", "--no-warnings",
        str(_ROOT / "bin" / "eegsim-export.mts"),
        "--seed", str(seed), "--state", "n3", "--epochs", str(_epochs()),
        "--out", str(work),
        # Mechanism (a) is the confound; mechanism (c)-amplitude is never enabled here.
        "--movement-artifact", "true" if movement else "false",
        "--amplitude-modulation", "false",
        "--chi-modulation", "true" if chi_mod else "false",
        "--chi-mod-depth", str(R.scalar_value("g4_fixture_chi_mod_depth") if chi_mod else 0.0),
        "--resp-rate", str(f2 * 60.0),
        "--independent-chi-mod-freq", str(f1),
    ]
    p = subprocess.run(export, cwd=_ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"exporter failed: {p.stderr.strip()[:800]}")

    est = [
        "node", "--experimental-strip-types", "--no-warnings",
        str(_ROOT / "bin" / "eegsim-chi.mts"),
        "--run", str(work), "--channel", "Fz", "--reference", "linked-mastoid",
        "--freqs", ",".join(str(f) for f in freqs),
    ]
    p = subprocess.run(est, cwd=_ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"estimator failed: {p.stderr.strip()[:800]}")
    out = json.loads(p.stdout)

    # The record the estimator saw must be the record the gate asked for. A short read would
    # coarsen 1/T and move every bin, silently.
    want = R.scalar_value("g4_record_length")
    if abs(out["durationS"] - want) > 1e-6:
        raise RuntimeError(f"estimator saw {out['durationS']} s, expected {want} s")
    return out["depths"]


def sign_test(k: int, n: int, two_sided: bool = False) -> float:
    """Exact binomial tail against p = 0.5. No scipy dependency for four lines of Pascal."""
    from math import comb
    if n <= 0:
        return 1.0
    upper = sum(comb(n, i) for i in range(k, n + 1)) / 2**n
    if not two_sided:
        return upper
    lower = sum(comb(n, i) for i in range(0, k + 1)) / 2**n
    return min(1.0, 2 * min(upper, lower))


def paired_sign_test(a, b, two_sided: bool = False) -> tuple[int, int, float]:
    """Sign test on paired values, DISCARDING TIES. Returns (successes, non-tied pairs, p).

    TIES MUST NOT COUNT AS EVIDENCE, and getting this wrong is not hypothetical -- it produced a
    p of 0.000488 on two BIT-IDENTICAL records. Comparing with a bare `a > b` makes every tie a
    failure, so 12 ties read as 0/12, which is exactly as extreme as 12/12 and duly came out
    "highly significant" for two records that were the same array.

    The textbook sign test drops ties and tests the remainder, which is what this does. With no
    non-tied pairs there is no evidence in either direction and p = 1.
    """
    import numpy as _np
    av = _np.asarray(a, dtype=float)
    bv = _np.asarray(b, dtype=float)
    diff = av - bv
    nz = diff[diff != 0]
    n_eff = int(nz.size)
    k = int((nz > 0).sum())
    return k, n_eff, sign_test(k, n_eff, two_sided=two_sided)


def measure(seeds: list[int], out_root: Path) -> dict[str, Any]:
    """The paired measurements every G4 arm reads. Shared with the null module."""
    f1 = R.scalar_value("g4_f1")
    f2 = R.scalar_value("g4_f2")
    # The sidebands are intermodulation products of f1 and f2. They need energy at BOTH to
    # exist at all, which is why D12 called this arm vacuous before mechanism (a) was built.
    freqs = [f1, f2, f2 - f1, f2 + f1]

    # G4 FIXES ITS OWN SEED COUNT rather than consuming whatever the runner offers, and this
    # is a power requirement, not a preference. The criterion is an exact sign test, so the
    # smallest achievable p is 2^-n: at n = 6 (what `npm run verify` passes) a perfect 6/6
    # gives p = 0.016 and a SINGLE flipped seed gives 0.109, which fails. A gate decided by one
    # seed is not a gate. The smallest n at which one flip still passes is 8 — (n+1)/2^n < 0.05
    # — and g4_n_seeds = 12 leaves margin beyond that.
    #
    # Extending is safe because the seeds are only labels for independent realisations; the
    # runner's list is contiguous from 1000, so continuing it draws fresh ones without
    # colliding. Capping is reported in the detail line either way.
    n_want = int(R.scalar_value("g4_n_seeds"))
    used = list(seeds[:n_want])
    if len(used) < n_want:
        base = max(seeds) if seeds else 1000
        used += [base + 1 + i for i in range(n_want - len(used))]

    rows: dict[str, list[dict]] = {"observed": [], "null_detect": [], "null_leak": []}
    for s in used:
        base = out_root / "g4" / f"s{s}"
        rows["observed"].append(depths(base / "obs", s, chi_mod=True, movement=True, freqs=freqs))
        rows["null_detect"].append(depths(base / "nod", s, chi_mod=False, movement=True, freqs=freqs))
        rows["null_leak"].append(depths(base / "nol", s, chi_mod=True, movement=False, freqs=freqs))
    return {"seeds": used, "freqs": freqs, "rows": rows, "f1": f1, "f2": f2}


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    m = measure(seeds, Path(params["out_root"]))
    used, f1, f2 = m["seeds"], m["f1"], m["f2"]
    n = len(used)
    obs = m["rows"]["observed"]
    nod = m["rows"]["null_detect"]

    k1 = sum(1 for o, d in zip(obs, nod) if o[str(f1)] > d[str(f1)])
    k2 = sum(1 for o in obs if o[str(f1)] > o[str(f2)])
    p1 = sign_test(k1, n)
    p2 = sign_test(k2, n)
    passed = p1 < 0.05 and p2 < 0.05

    at_f1 = np.array([o[str(f1)] for o in obs])
    at_f2 = np.array([o[str(f2)] for o in obs])
    detail = (
        f"detection {k1}/{n} (p={p1:.2g}), selectivity {k2}/{n} (p={p2:.2g}); "
        f"median depth f1={np.median(at_f1):.4f} vs f2={np.median(at_f2):.4f}, "
        f"ratio {np.median(at_f1)/max(np.median(at_f2), 1e-12):.2f}x. "
        f"Injects g4_fixture_chi_mod_depth={R.scalar_value('g4_fixture_chi_mod_depth')}, "
        f"{R.scalar_value('g4_fixture_chi_mod_depth')/R.provisional_value('chi_mod_depth'):.0f}x "
        f"the shipped depth: says nothing about whether the SHIPPED coupling is recoverable."
    )
    if n < len(seeds):
        detail += f" Capped at g4_n_seeds={n} of {len(seeds)} available."
    elif n > len(seeds):
        detail += (
            f" Runner supplied {len(seeds)} seed(s); extended to g4_n_seeds={n} because the "
            f"sign test's smallest achievable p is 2^-n and at n={len(seeds)} one flipped seed "
            f"would decide the gate."
        )

    return (
        ScalarMetric(
            per_seed={s: float(o[str(f1)]) for s, o in zip(used, obs)},
            unit="chi modulation depth at f1",
        ),
        passed,
        detail,
        {
            "n_seeds": n,
            "detection": {"k": k1, "n": n, "p": p1},
            "selectivity": {"k": k2, "n": n, "p": p2},
            "median_depth_f1": float(np.median(at_f1)),
            "median_depth_f2": float(np.median(at_f2)),
            "fixture_chi_mod_depth": R.scalar_value("g4_fixture_chi_mod_depth"),
            "shipped_chi_mod_depth": R.provisional_value("chi_mod_depth"),
        },
    )
