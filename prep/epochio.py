"""Read seam-9 epoch directories — the harness's only input (DECISIONS D7).

The harness reads `signal.f64`, never `signal.csv`. G2's bit-identity check run through a
lossy serializer would test the serializer rather than the generator.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent


class EpochIOError(RuntimeError):
    pass


@dataclass(frozen=True)
class Epoch:
    index: int
    t_start: float
    duration: float
    fs: float
    channels: list[str]
    state: str
    truth: dict[str, Any]
    events: list[dict[str, Any]]
    #: shape (n_channels, n_samples), float64, microvolts
    signal: np.ndarray

    def channel(self, label: str) -> np.ndarray:
        try:
            return self.signal[self.channels.index(label)]
        except ValueError:
            raise EpochIOError(f"no channel {label!r}; have {self.channels}") from None


@dataclass(frozen=True)
class Run:
    path: Path
    manifest: dict[str, Any]
    events: dict[str, Any]

    @property
    def seed(self) -> int:
        return int(self.manifest["seed"])

    @property
    def generator_version(self) -> str:
        return str(self.manifest["generatorVersion"])

    @property
    def registry_digest(self) -> str:
        return str(self.manifest["registryDigest"])

    @property
    def n_epochs(self) -> int:
        return int(self.manifest["nEpochs"])

    def epoch(self, index: int) -> Epoch:
        d = self.path / f"epoch_{index:05d}"
        if not d.is_dir():
            raise EpochIOError(f"missing epoch directory {d}")
        side = json.loads((d / "sidecar.json").read_text(encoding="utf8"))

        if side["dtype"] != "float64":
            raise EpochIOError(f"unexpected dtype {side['dtype']!r}")
        if side["byteOrder"] != "little":
            raise EpochIOError(f"unexpected byte order {side['byteOrder']!r}")

        n_ch, n_samp = side["shape"]
        raw = np.fromfile(d / "signal.f64", dtype="<f8")
        if raw.size != n_ch * n_samp:
            raise EpochIOError(
                f"{d.name}: signal.f64 has {raw.size} values, sidecar declares "
                f"{n_ch}x{n_samp}={n_ch * n_samp}"
            )
        return Epoch(
            index=side["epochIndex"],
            t_start=side["tStart"],
            duration=side["duration"],
            fs=side["fs"],
            channels=list(side["channels"]),
            state=side["state"],
            truth=side["truth"],
            events=list(side["events"]),
            signal=raw.reshape(n_ch, n_samp),
        )

    def epochs(self) -> Iterator[Epoch]:
        for i in range(self.n_epochs):
            yield self.epoch(i)

    def concatenated(self) -> tuple[np.ndarray, list[str]]:
        """All epochs joined along time.

        G4 needs a 300 s record while epoch_display is 30 s, so it must stitch ten epochs.
        Contiguity is the generator's responsibility; this only concatenates and checks that
        the epochs are adjacent in time and agree on their channel set.
        """
        chunks: list[np.ndarray] = []
        channels: list[str] | None = None
        expect_t = None
        for ep in self.epochs():
            if channels is None:
                channels = ep.channels
            elif ep.channels != channels:
                raise EpochIOError(f"epoch {ep.index}: channel set differs from epoch 0")
            if expect_t is not None and abs(ep.t_start - expect_t) > 1e-9:
                raise EpochIOError(
                    f"epoch {ep.index}: starts at {ep.t_start}s, expected {expect_t}s — "
                    "epochs are not contiguous"
                )
            expect_t = ep.t_start + ep.duration
            chunks.append(ep.signal)
        if channels is None:
            raise EpochIOError("run has no epochs")
        return np.concatenate(chunks, axis=1), channels

    def digest(self) -> str:
        """SHA-256 over every epoch's raw bytes, in order. This is what G2 compares."""
        h = hashlib.sha256()
        for i in range(self.n_epochs):
            h.update((self.path / f"epoch_{i:05d}" / "signal.f64").read_bytes())
        return h.hexdigest()


def load_run(path: Path | str) -> Run:
    p = Path(path)
    manifest_path = p / "manifest.json"
    if not manifest_path.is_file():
        raise EpochIOError(f"no manifest.json in {p}")
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    events_path = p / "events.json"
    events = (
        json.loads(events_path.read_text(encoding="utf8"))
        if events_path.is_file()
        else {"events": [], "schemaVersion": 0}
    )
    return Run(path=p, manifest=manifest, events=events)


def generate(
    out: Path | str,
    *,
    seed: int,
    state: str,
    epochs: int = 1,
    node: str = "node",
) -> Run:
    """Invoke the headless TypeScript exporter and load what it wrote.

    This is the D7 boundary: the harness measures the shipped generator through the epoch
    directory, rather than reimplementing it in Python.
    """
    out = Path(out)
    cmd = [
        node,
        "--experimental-strip-types",
        "--no-warnings",
        str(_ROOT / "bin" / "eegsim-export.mts"),
        "--seed", str(seed),
        "--state", state,
        "--epochs", str(epochs),
        "--out", str(out),
    ]
    proc = subprocess.run(cmd, cwd=_ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise EpochIOError(
            f"exporter failed (exit {proc.returncode})\n"
            f"  cmd: {' '.join(cmd)}\n"
            f"  stdout: {proc.stdout.strip()}\n"
            f"  stderr: {proc.stderr.strip()}"
        )
    return load_run(out)


if __name__ == "__main__":
    run = load_run(sys.argv[1])
    print(f"run {run.path.name}: seed={run.seed} v{run.generator_version} "
          f"epochs={run.n_epochs} registry={run.registry_digest}")
    sig, ch = run.concatenated()
    print(f"  concatenated: {sig.shape} channels={len(ch)} digest={run.digest()[:16]}")
