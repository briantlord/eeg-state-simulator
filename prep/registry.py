"""Registry accessors for the harness (seam 6), mirroring src/core/registry.ts.

The harness reads thresholds AND their standing, because every report line must carry the
threshold standing (harness section 8). A gate that prints a threshold without its standing
lets an invented number read as a measurement.

Source of truth: registry/parameters.yaml -> gen/registry.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Iterable, Literal

_ROOT = Path(__file__).resolve().parent.parent
_REG = json.loads((_ROOT / "gen" / "registry.json").read_text(encoding="utf8"))

GENERATOR_VERSION: str = _REG["generator_version"]
STATES: list[str] = _REG["states"]
TOOLCHAIN: dict[str, dict] = _REG["toolchain"]

Standing = Literal[
    "definitional", "chosen", "literature", "derived", "fitted", "invented", "absent"
]


class RegistryError(KeyError):
    """Raised for a missing row or a kind mismatch. Never silently coerced."""


def record(key: str) -> dict[str, Any]:
    try:
        return _REG["params"][key]
    except KeyError:
        raise RegistryError(f"registry: no row {key!r}") from None


def standing(key: str) -> str:
    return record(key)["standing"]


def units(key: str) -> str | None:
    return record(key)["units"]


def note(key: str) -> str | None:
    return record(key).get("note")


def is_invented(key: str) -> bool:
    return standing(key) == "invented"


def _expect(key: str, kind: str) -> dict[str, Any]:
    v = record(key)["value"]
    if v["kind"] != kind:
        raise RegistryError(
            f"registry: {key!r} is a {v['kind']} row, not {kind}. "
            "The kinds are not interchangeable."
        )
    return v


def scalar_value(key: str) -> float:
    return _expect(key, "scalar")["v"]


def band_edges(key: str) -> tuple[float, float]:
    """Both endpoints simultaneously in force — a passband."""
    v = _expect(key, "interval")
    if v["meaning"] != "band_edges":
        raise RegistryError(
            f"registry: {key!r} is an interval with meaning {v['meaning']!r}, not band_edges."
        )
    return v["lo"], v["hi"]


def uncertainty(key: str) -> tuple[float, float]:
    """A spread the generator reduces to a point plus Dv."""
    v = _expect(key, "interval")
    if v["meaning"] != "uncertainty":
        raise RegistryError(
            f"registry: {key!r} is an interval with meaning {v['meaning']!r}, not uncertainty."
        )
    return v["lo"], v["hi"]


def ui_domain(key: str) -> tuple[float, float]:
    v = _expect(key, "interval")
    if v["meaning"] != "ui_domain":
        raise RegistryError(
            f"registry: {key!r} is an interval with meaning {v['meaning']!r}, not ui_domain."
        )
    return v["lo"], v["hi"]


def enum_value(key: str) -> list:
    return _expect(key, "enum")["options"]


def bound_value(key: str) -> tuple[str, float]:
    v = _expect(key, "bound")
    return v["op"], v["v"]


def electrode_set(key: str) -> list[str]:
    return _expect(key, "electrodes")["labels"]


def ordering(key: str) -> tuple[str, list[list[str]]]:
    v = _expect(key, "ordering")
    return v["text"], v["relations"]


def provisional_value(key: str) -> float:
    """The ONLY path to a pending row's number. Named so call sites admit it."""
    r = record(key)
    if r["value"]["kind"] != "pending":
        raise RegistryError(f"registry: {key!r} is not pending — use its own accessor.")
    prov = r.get("provisional")
    if not prov:
        raise RegistryError(f"registry: pending row {key!r} has no provisional value")
    return prov["v"]


def solved_value(key: str, artifact_lookup: Callable[[str], float]) -> float:
    v = _expect(key, "solved")
    return artifact_lookup(v["artifact"])


def is_absent(key: str) -> bool:
    """True for rows deliberately carrying no value. Distinct from an invented guess."""
    return record(key)["value"]["kind"] == "absent"


def absent_reason(key: str) -> str:
    return _expect(key, "absent")["reason"]


def applies_to(key: str, state: str) -> bool:
    s = record(key)["states"]
    return s == "all" or state in s


def keys_with_standing(*wanted: str) -> list[str]:
    return [k for k, p in _REG["params"].items() if p["standing"] in wanted]


def gate_rows(gate_id: str) -> dict[str, dict[str, Any]]:
    """Every registry row belonging to a gate, keyed by param key."""
    return {
        k: p for k, p in _REG["params"].items()
        if p.get("gate", {}).get("id") == gate_id
    }


def threshold_standing(key: str) -> str:
    """What the runner prints beside a threshold. Harness section 8 requires it on every line."""
    return standing(key)


def provenance_is_provisional(keys: Iterable[str]) -> bool:
    """True if any key in a metric's dependency closure is pending or invented.

    The runner uses this to suppress comparability claims: a metric that depends on a
    provisional number must not be printed next to a published magnitude.
    """
    for k in keys:
        p = record(k)
        if p["standing"] == "invented" or p["value"]["kind"] == "pending":
            return True
    return False
