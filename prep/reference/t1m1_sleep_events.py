"""Compare detected spindle and slow-wave morphology with 19 scored HMC nights.

YASA sees the same four contralateral-mastoid derivations in both arms. Each real scored epoch
retains five seconds of its actual neighboring signal on both sides; those margins are marked
excluded in the sample-level hypnogram. Concatenation joins therefore sit five seconds outside
the intervals in which detections are accepted, avoiding artificial event edges while skipping
irrelevant hours. Results are summarized within subject first and generated values within seed.

K-complexes are intentionally absent from this detector comparison: YASA has no dedicated
K-complex detector, and calling every N2 slow wave a K-complex would manufacture an empirical
anchor that the corpus does not contain.
"""
from __future__ import annotations

import os
import sys
import tempfile
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))
warnings.filterwarnings("ignore")

import mne
import numpy as np
import yasa

from prep import registry as R
from prep.epochio import generate

HMC = ROOT / "prep" / "realdata" / "hmc"
FS = int(R.scalar_value("fs"))
STAGE_CODE = {
    "Sleep stage W": 0,
    "Sleep stage N1": 1,
    "Sleep stage N2": 2,
    "Sleep stage N3": 3,
    "Sleep stage R": 4,
}
DERIVATIONS = (("F4", "A1"), ("C4", "A1"), ("O2", "A1"), ("C3", "A2"))
GEN_NAMES = tuple(f"{a}-{b}" for a, b in DERIVATIONS)
SEEDS = (4242, 4555, 4888, 5221, 5554, 5887)
MAX_EPOCHS_PER_STAGE = 120
CONTEXT_S = 5.0


def hypnogram(annotations: mne.Annotations, n_samples: int, fs: float) -> np.ndarray:
    hyp = np.full(n_samples, -2, dtype=np.int8)
    for onset, duration, desc in zip(annotations.onset, annotations.duration, annotations.description):
        stage = STAGE_CODE.get(desc)
        if stage is None:
            continue
        a = max(0, int(round(onset * fs)))
        b = min(n_samples, int(round((onset + max(30.0, duration)) * fs)))
        hyp[a:b] = stage
    return hyp


def detect(x_uv: np.ndarray, fs: float, hyp: np.ndarray, include: tuple[int, ...]):
    sp = yasa.spindles_detect(
        x_uv, sf=fs, ch_names=list(GEN_NAMES), hypno=hyp, include=include,
        freq_sp=tuple(R.band_edges("spindle_band")), verbose=False,
    )
    sw = yasa.sw_detect(x_uv, sf=fs, ch_names=list(GEN_NAMES), hypno=hyp, include=include,
                        verbose=False)
    return (None if sp is None else sp.summary(), None if sw is None else sw.summary())


def summarize_table(table, minutes: float, kind: str) -> dict[str, float]:
    if table is None or len(table) == 0 or minutes <= 0:
        return {"rate_min_ch": 0.0}
    out = {"rate_min_ch": float(len(table) / len(GEN_NAMES) / minutes)}
    cols = (("Duration", "duration_s"), ("Frequency", "frequency_hz"))
    if kind == "spindle":
        cols += (("Amplitude", "amplitude_uv"), ("RMS", "rms_uv"),
                 ("RelPower", "relative_power"), ("Oscillations", "oscillations"))
    else:
        cols += (("ValNegPeak", "negative_peak_uv"), ("ValPosPeak", "positive_peak_uv"),
                 ("PTP", "ptp_uv"), ("Slope", "slope_uv_s"))
    for col, key in cols:
        if col in table:
            out[key] = float(np.nanmedian(np.asarray(table[col], dtype=float)))
    return out


def summarize_detection(sp, sw, hyp: np.ndarray, fs: float, stage: int) -> dict[str, dict[str, float]]:
    minutes = float(np.sum(hyp == stage) / fs / 60)
    return {
        "spindle": summarize_table(sp, minutes, "spindle"),
        "slow_wave": summarize_table(sw, minutes, "slow_wave"),
    }


def real_rows() -> dict[int, list[dict[str, dict[str, float]]]]:
    rows = {2: [], 3: []}
    recs = sorted(p for p in HMC.glob("SN*.edf") if "sleepscoring" not in p.name)
    for rec in recs:
        score = rec.with_name(rec.stem + "_sleepscoring.edf")
        if not score.exists():
            continue
        raw = mne.io.read_raw_edf(rec, preload=True, verbose="ERROR")
        picks = [c for c in raw.ch_names if c.startswith("EEG ")]
        raw.pick(picks)
        x = raw.get_data() * 1e6
        fs = float(raw.info["sfreq"])
        annotations = mne.read_annotations(score)
        for stage in (2, 3):
            chunks, hyps = [], []
            for onset, duration, desc in zip(
                annotations.onset, annotations.duration, annotations.description
            ):
                if STAGE_CODE.get(desc) != stage or len(chunks) >= MAX_EPOCHS_PER_STAGE:
                    continue
                core_a = int(round(onset * fs))
                core_b = core_a + int(round(max(30.0, duration) * fs))
                pad = int(round(CONTEXT_S * fs))
                a, b = core_a - pad, core_b + pad
                if a < 0 or b > x.shape[-1]:
                    continue
                chunk = x[:, a:b]
                chyp = np.full(chunk.shape[-1], -2, dtype=np.int8)
                chyp[pad:pad + (core_b - core_a)] = stage
                chunks.append(chunk)
                hyps.append(chyp)
            if len(chunks) >= 20:
                sx, sh = np.concatenate(chunks, axis=-1), np.concatenate(hyps)
                sp, sw = detect(sx, fs, sh, (stage,))
                rows[stage].append(summarize_detection(sp, sw, sh, fs, stage))
        n2 = len([d for d in annotations.description if STAGE_CODE.get(d) == 2])
        n3 = len([d for d in annotations.description if STAGE_CODE.get(d) == 3])
        print(f"  real {rec.stem}: N2={min(n2, MAX_EPOCHS_PER_STAGE)} epochs, "
              f"N3={min(n3, MAX_EPOCHS_PER_STAGE)} epochs")
        del raw, x
    return rows


def generated_rows() -> dict[int, list[dict[str, dict[str, float]]]]:
    rows = {2: [], 3: []}
    with tempfile.TemporaryDirectory(prefix="eegsim-sleep-events-") as td:
        for stage, state in ((2, "n2"), (3, "n3")):
            for seed in SEEDS:
                run = generate(Path(td) / f"{state}-{seed}", seed=seed, state=state, epochs=20)
                x, channels = run.concatenated()
                deriv = np.stack([x[channels.index(a)] - x[channels.index(b)]
                                  for a, b in DERIVATIONS])
                hyp = np.full(deriv.shape[-1], stage, dtype=np.int8)
                sp, sw = detect(deriv, FS, hyp, (stage,))
                rows[stage].append(summarize_detection(sp, sw, hyp, FS, stage))
                print(f"  generated {state} seed {seed}: 10 min")
    return rows


def print_group(label: str, rows: list[dict[str, dict[str, float]]]) -> None:
    print(f"\n{label} (n={len(rows)})")
    for kind in ("spindle", "slow_wave"):
        keys = sorted(set().union(*(r[kind].keys() for r in rows)))
        print(f"  {kind}")
        for key in keys:
            values = np.asarray([r[kind].get(key, np.nan) for r in rows], dtype=float)
            values = values[np.isfinite(values)]
            if values.size:
                q = np.percentile(values, (25, 50, 75))
                print(f"    {key:<18}{q[1]:8.3f} [{q[0]:6.3f}-{q[2]:6.3f}]")


def compare(real, gen) -> None:
    for stage, name in ((2, "N2"), (3, "N3")):
        print(f"\n{'=' * 72}\n{name}: real subjects then generated seeds")
        print_group("REAL HMC", real[stage])
        print_group("GENERATED", gen[stage])


def main() -> int:
    mne.set_log_level("ERROR")
    print("Detecting events in continuous HMC nights...")
    real = real_rows()
    print("\nDetecting events in generated matched derivations...")
    gen = generated_rows()
    compare(real, gen)
    print("\nK-complexes are not reported: HMC has sleep stages but no event labels, and YASA has no "
          "dedicated K-complex detector.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
