"""Shared measurement path for G1a and G1b.

G1a and G1b are SEPARATE GATES in the frozen ledger, with separate criterion rows and separate
nulls, because they recover DIFFERENT QUANTITIES -- knee mode over 1-45 Hz versus fixed mode
over 30-45 Hz. Seam 7 enforces that distinction in the TypeScript with an exponent brand
carrying (value, band, mode); the ledger enforces it here by refusing to let them be one gate.

They do, however, read the same spectrum. This module holds the path they share -- export, PSD,
both fits -- so the two gates cannot drift into measuring different signals and calling the
difference an estimator property. It declares no SPEC and is skipped by module discovery.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal as sps

from ..epochio import generate
from ..runner import rmtree_robust
from .. import registry as R

CHANNEL = "Pz"
EPOCHS = 10

#: TWO STATES, because the knee is in the fit band in one and deliberately outside it in the
#: other, and reporting only one would misrepresent what G1a recovers.
#:
#:   rem  knee_freq 20 Hz, `knee_present: prominent`. This is the regime D3 describes and the
#:        only one in which "recover both chi and k" is answerable.
#:   n3   knee_freq 0.5 Hz, BELOW the 1-45 Hz band. Not an accident: D11 recorded that with one
#:        `k` per state the only way to express `knee_present: absent` is to MOVE the knee out
#:        of the band rather than weaken it. So G1a's knee arm cannot work in N3 by
#:        construction, and running N3 makes that visible in the harness instead of only in a
#:        decision document.
#:
#: The first version of this gate ran N3 alone and reported a knee of "-0.3+0.6j Hz" — a
#: negative fitted parameter raised to a fractional power. The complex number was the symptom;
#: the cause was asking a state with no in-band knee to produce one.
STATES = ("rem", "n3")


def welch_psd(x: np.ndarray, fs: float) -> tuple[np.ndarray, np.ndarray]:
    """Welch PSD at the resolution the fit bands need.

    4 s segments: the 1–45 Hz fit needs several bins below 2 Hz to constrain the knee, and 1 s
    segments leave it fitting a corner from two points.
    """
    nper = int(4 * fs)
    f, p = sps.welch(x, fs=fs, nperseg=nper, noverlap=nper // 2)
    return f, p


def fit_both(f: np.ndarray, p: np.ndarray) -> dict[str, float]:
    """G1a and G1b on one spectrum. Returns χ̂ for each, plus G1a's recovered knee.

    Always zip `get_params` against `modes.aperiodic.params.labels`: the knee-mode and
    fixed-mode arrays differ in length, and index 1 means `knee` in one and `exponent` in the
    other. That is seam 7's argument restated at the library boundary.
    """
    from specparam import SpectralModel

    out: dict[str, float] = {}

    knee = SpectralModel(aperiodic_mode="knee", verbose=False)
    knee.fit(f, p, [1, 45])
    kp = dict(zip(knee.modes.aperiodic.params.labels, knee.get_params("aperiodic")))
    out["g1a_chi"] = float(kp["exponent"])
    out["g1a_knee"] = float(kp["knee"])

    fixed = SpectralModel(aperiodic_mode="fixed", verbose=False)
    fixed.fit(f, p, [30, 45])
    fp = dict(zip(fixed.modes.aperiodic.params.labels, fixed.get_params("aperiodic")))
    out["g1b_chi"] = float(fp["exponent"])
    return out


def truth_from_sidecar(run_dir: Path) -> dict[str, float]:
    epochs = sorted(p for p in run_dir.iterdir() if p.name.startswith("epoch_"))
    t = json.loads((epochs[0] / "sidecar.json").read_text(encoding="utf8"))["truth"]
    return {"chi": float(t["chi"]), "knee": float(t["knee"])}


def knee_hz(knee_param: float, chi: float) -> float:
    """Knee frequency from specparam's knee PARAMETER: f = k^(1/chi).

    Returns NaN rather than a complex number when k <= 0. A negative fitted k means the model
    found no corner — which is the correct answer when the injected knee is outside the fit
    band — and `(-0.3) ** (1/1.66)` is a complex number that then propagates into a report as
    "-0.3+0.6j Hz". Python will do that silently; the guard is here so it cannot.
    """
    if knee_param <= 0 or chi <= 0:
        return float("nan")
    return float(knee_param ** (1.0 / chi))


def measure(seeds: list[int], out_root: Path, state: str) -> list[dict[str, float]]:
    work = out_root / "g1" / state
    rmtree_robust(work)
    fs = R.scalar_value("fs")

    rows: list[dict[str, float]] = []
    for s in seeds:
        run_ = generate(work / f"s{s}", seed=s, state=state, epochs=EPOCHS)
        sig, ch = run_.concatenated()
        f, p = welch_psd(sig[ch.index(CHANNEL)], fs)
        r = fit_both(f, p)
        r.update(truth_from_sidecar(run_.path))
        r["seed"] = s
        rows.append(r)
    return rows


#: Cache keyed by (state, seed tuple) so G1a and G1b share one set of exports instead of
#: generating the same records twice. They are separate gates measuring the same spectrum; the
#: separation is about what each RECOVERS, not about running the generator twice.
_CACHE: dict[tuple, list[dict[str, float]]] = {}


def rows_for(seeds: list[int], out_root: Path, state: str) -> list[dict[str, float]]:
    key = (state, tuple(seeds), str(out_root))
    if key not in _CACHE:
        _CACHE[key] = measure(seeds, out_root, state)
    return _CACHE[key]


def error_stats(rows: list[dict[str, float]], which: str) -> dict[str, float]:
    """Recovery error for one estimator. `which` is 'g1a_chi' or 'g1b_chi'."""
    err = np.array([r[which] - r["chi"] for r in rows])
    return {
        "median_error": float(np.median(err)),
        "iqr": float(np.subtract(*np.percentile(err, [75, 25]))),
        "injected_chi": float(rows[0]["chi"]),
    }


def white_noise_fits(seeds: list[int], n_seeds: int, fs: float) -> list[dict[str, float]]:
    """Both fits on synthetic white noise -- the shared body of G1a's and G1b's nulls.

    White noise is synthesised rather than exported because no generated state has chi = 0, and
    inventing one to satisfy a gate would be the circularity section 1 prohibits. It runs
    through this module's own `welch_psd` and `fit_both`, deliberately: a null that called
    specparam directly would test specparam, which needs no testing from us.
    """
    used = list(seeds[:n_seeds])
    if len(used) < n_seeds:
        base = max(seeds) if seeds else 1000
        used += [base + 1 + i for i in range(n_seeds - len(used))]

    out = []
    for s in used:
        rng = np.random.default_rng(s)
        f, p = welch_psd(rng.standard_normal(int(300 * fs)), fs)
        r = fit_both(f, p)
        r["seed"] = s
        out.append(r)
    return out
