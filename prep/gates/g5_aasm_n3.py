"""G5 -- the AASM N3 criterion. Class C, and RECORD-ONLY on this arm.

"Generated N3 satisfies the scoring rule: >=20% of a 30 s epoch occupied by 0.5-2 Hz activity
at >=75 uV peak-to-peak, referenced to contralateral mastoid."

Class C because we compute it, but the rule is entirely external -- which is what makes it
usable without derivation. It is the one threshold in the project needing none.

RECORD-ONLY, per DECISIONS D9's replacement. The spec asks for a PASS FRACTION but never says
what fraction passes, and every candidate number would be invented or read from our own
generator's spread -- both prohibited by harness section 1. So this arm reports the fraction
and returns no verdict. The NULL carries the verdict.

WHAT THIS DOES NOT SHOW. `snr_nominal` was calibrated so that N3 meets this criterion on a
fixture seed. So a high pass fraction here is largely a REGRESSION CHECK on the amplitude
relationship -- it detects when a change elsewhere breaks it. It is NOT evidence that our N3
resembles real N3, and the runner prints it that way.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal as sps

from ..epochio import generate
from ..runner import rmtree_robust
from ..spec import GateSpec, ScalarMetric
from .. import registry as R

SPEC = GateSpec(
    id="G5",
    title="AASM N3 criterion, on held-out seeds",
    gate_class="C",
    runtime_tier="fast",
    failable=False,
    depends_on=("G2",),
    criterion_key="gate_aasm_n3_min_fraction",
    requires_tools=(),
    provenance_keys=("delta_amp", "so_amp", "background_rms_uv"),
    claim="Post-calibration this is largely a REGRESSION CHECK on the amplitude relationship. "
    "It is not evidence that our N3 resembles real N3. The null carries the discriminative "
    "weight.",
)

CAL = Path(__file__).resolve().parent.parent / "fixtures" / "snr_calibration.json"
EPOCHS = 6


def calibration() -> dict[str, Any]:
    if not CAL.is_file():
        raise FileNotFoundError(
            f"{CAL} missing. Run: node --experimental-strip-types bin/eegsim-calibrate.mts. "
            "SNR calibration is a NODE, not a gate -- harness section 7 -- and G5 cannot be "
            "evaluated before it exists."
        )
    return json.loads(CAL.read_text(encoding="utf8"))


SCORER_VERSION = "central-halfwave-cascade-v2"


def aasm_filtered(x: np.ndarray, fs: float) -> np.ndarray:
    """Independent SciPy implementation of docs/Scoring-Contract.md."""
    lo, hi = R.band_edges("gate_aasm_n3_band")
    order = int(R.scalar_value("filter_order"))
    sos = np.vstack([
        sps.butter(order, lo, "highpass", fs=fs, output="sos"),
        sps.butter(order, hi, "lowpass", fs=fs, output="sos"),
    ])
    padlen = 3 * (2 * len(sos) + 1)
    if len(x) <= padlen or not np.all(np.isfinite(x)):
        raise ValueError(f"scoring requires more than {padlen} finite samples")
    return sps.sosfiltfilt(sos, x, padtype="odd", padlen=padlen)


def aasm_fraction(sig: np.ndarray, channels: list[str], fs: float, scalp: str = "C3") -> float:
    """AASM N3 occupancy on a contralateral-mastoid derivation.

    Mirrors src/analysis/aasm.ts. The reference is not a detail: harness section 5 warns that
    evaluating under average reference gives a different number and would silently
    miscalibrate everything downstream.
    """
    refs = R.electrode_set("reference_channels")
    ref = refs[1] if scalp[-1] in "13579" else refs[0]
    if ref not in channels:
        raise KeyError(
            f"no reference channel {ref!r}; the AASM criterion cannot be evaluated without a "
            "mastoid, and a 19-channel 10-20 montage has none"
        )
    x = sig[channels.index(scalp)] - sig[channels.index(ref)]

    y = aasm_filtered(x, fs)

    min_pp = R.scalar_value("gate_aasm_n3_min_amp")
    crossings = np.flatnonzero(np.diff(y < 0))
    bounds = np.concatenate([[0], crossings + 1, [len(y)]])
    occupied = 0
    for s, e in zip(bounds[:-1], bounds[1:]):
        if e - s < 2:
            continue
        if 2 * np.max(np.abs(y[s:e])) >= min_pp:
            occupied += e - s
    return occupied / len(y)


def run(seeds: list[int], params: dict[str, Any]) -> tuple[ScalarMetric, bool, str, dict]:
    cal = calibration()
    held_out = [s for s in seeds if s != cal["fixture"]["seed"]]
    if not held_out:
        raise ValueError("every seed is the calibration seed; G5 must run on held-out seeds")

    work = Path(params["out_root"]) / "g5"
    rmtree_robust(work)
    fs = R.scalar_value("fs")

    per_seed: dict[int, float] = {}
    for s in held_out:
        run_ = generate(work / f"s{s}", seed=s, state="n3", epochs=EPOCHS)
        sig, ch = run_.concatenated()
        n = int(fs * R.scalar_value("epoch_display"))
        fracs = [
            aasm_fraction(sig[:, e * n:(e + 1) * n], ch, fs)
            for e in range(EPOCHS)
        ]
        per_seed[s] = float(np.mean([f >= R.scalar_value("gate_aasm_n3_min_fraction") for f in fracs]))

    overall = float(np.mean(list(per_seed.values())))
    detail = (
        f"pass fraction {overall:.2f} over {len(held_out)} held-out seed(s) x {EPOCHS} epochs; "
        f"calibration seed {cal['fixture']['seed']} excluded; "
        f"snr_nominal = {cal['value_db']} dB. RECORD-ONLY: no threshold on this fraction "
        f"exists that would not be invented."
    )
    return (
        ScalarMetric(per_seed=per_seed, unit="pass fraction"),
        True,
        detail,
        {"snr_nominal_db": cal["value_db"], "calibration_seed": cal["fixture"]["seed"],
         "epochs_per_seed": EPOCHS},
    )
