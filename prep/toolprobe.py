"""Third-party tool availability and version pinning.

Two obligations, both from harness section 1's class system:

  A missing tool must NEVER present as a silent skip or a pass. It becomes status
  UNAVAILABLE, which is not green.

  A class-V claim has no meaning without a pinned version. "Recovery by an external,
  independently authored, published tool" identifies no particular behaviour unless the
  tool's version is recorded, and no source document pins one. The registry now does.

Probing uses `importlib.util.find_spec` and `importlib.metadata.version` rather than importing.
Importing yasa pulls mne, numba and lightgbm -- seconds of startup, in a runner whose fast tier
has a two-minute budget for everything.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
from dataclasses import dataclass

from . import registry as R


@dataclass(frozen=True)
class ToolStatus:
    name: str
    available: bool
    installed_version: str | None
    pinned_version: str | None
    prerelease: bool
    #: True when installed and pinned versions disagree. Not fatal, but it invalidates goldens.
    version_mismatch: bool

    @property
    def note(self) -> str:
        if not self.available:
            return f"{self.name} is not installed"
        if self.version_mismatch:
            return (
                f"{self.name} {self.installed_version} installed but registry pins "
                f"{self.pinned_version} -- golden baselines keyed to the pinned version do not apply"
            )
        if self.prerelease:
            return f"{self.name} {self.installed_version} is a PRE-RELEASE; its API may move"
        return f"{self.name} {self.installed_version}"


def probe(name: str) -> ToolStatus:
    pinned = R.TOOLCHAIN.get(name, {})
    pinned_version = pinned.get("version")
    prerelease = bool(pinned.get("prerelease", False))

    spec = importlib.util.find_spec(name)
    if spec is None:
        return ToolStatus(name, False, None, pinned_version, prerelease, False)

    try:
        installed = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        installed = None

    mismatch = bool(installed and pinned_version and installed != pinned_version)
    return ToolStatus(name, True, installed, pinned_version, prerelease, mismatch)


def probe_all() -> dict[str, ToolStatus]:
    return {name: probe(name) for name in R.TOOLCHAIN}


def missing(required: tuple[str, ...]) -> list[str]:
    return [t for t in required if not probe(t).available]


def fingerprint() -> str:
    """Identity of the METRIC TOOLCHAIN, for keying golden baselines.

    Golden baselines keyed on generator version alone break twice. At Tier 2 the Python
    generator would be compared against TypeScript goldens and fail the build for a non-bug.
    Today, specparam sits at a release candidate, so an rc7 -> rc8 bump moves G1a/G1b per-seed
    values and would present as generator drift -- failing the build for something the
    generator did not do.
    """
    parts = []
    for name in sorted(R.TOOLCHAIN):
        st = probe(name)
        parts.append(f"{name}={st.installed_version or 'absent'}")
    return ";".join(parts)
