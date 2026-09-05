"""Separate continuous N3 delta from discrete slow oscillations using HMC output targets."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("_MNE_FAKE_HOME_DIR", str(ROOT))

from prep.reference.t1m1_sleep_events import FS, GEN_NAMES, detect, summarize_detection

SEEDS = (4242, 4888, 5554)
DELTA_PP = (0.0, 25.0, 50.0, 75.0)
SO_RATE = (3.0, 6.0, 9.0, 12.0)
TARGET = {
    "rate_min_ch": 2.971,
    "duration_s": 1.291,
    "frequency_hz": 0.775,
    "ptp_uv": 97.554,
    "slope_uv_s": 209.345,
}

HARNESS = r"""
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
const seed = Number(process.argv[2]), delta = Number(process.argv[3]), rate = Number(process.argv[4]);
const fs = 256;
const r = composeState(seed, 'n3', fs * 600, fs, {
  snrDb: -2.7559,
  deltaAmplitudePpUv: delta,
  slowOscRatePerMin: rate,
});
const at = (label) => ALL_CHANNELS.indexOf(label);
const pairs = [['F4','A1'],['C4','A1'],['O2','A1'],['C3','A2']];
const out = pairs.map(([a,b]) => {
  const x = r.channels[at(a)], y = r.channels[at(b)], d = new Array(x.length);
  for (let i = 0; i < d.length; i++) d[i] = x[i] - y[i];
  return d;
});
process.stdout.write(JSON.stringify(out));
"""


def measure(script: Path, delta: float, rate: float) -> dict[str, float]:
    rows = []
    for seed in SEEDS:
        p = subprocess.run(
            ["node", "--experimental-strip-types", "--no-warnings", str(script), str(seed),
             str(delta), str(rate)], cwd=ROOT, capture_output=True, check=True,
        )
        x = np.asarray(json.loads(p.stdout), dtype=float)
        hyp = np.full(x.shape[-1], 3, dtype=np.int8)
        _, sw = detect(x, FS, hyp, (3,))
        rows.append(summarize_detection(None, sw, hyp, FS, 3)["slow_wave"])
    keys = set.intersection(*(set(r) for r in rows))
    return {k: float(np.median([r[k] for r in rows])) for k in keys}


def main() -> int:
    script = ROOT / ".n3-slow-wave-sweep.mts"
    script.write_text(HARNESS, encoding="utf8")
    rows = []
    print(f"{'delta pp':>9}{'SO/min':>8}{'error':>8}{'rate':>8}{'dur':>8}"
          f"{'freq':>8}{'ptp':>9}{'slope':>9}")
    try:
        for delta in DELTA_PP:
            for rate in SO_RATE:
                got = measure(script, delta, rate)
                if not all(k in got for k in TARGET):
                    err = float("inf")
                else:
                    err = float(np.mean([abs(got[k] - v) / v for k, v in TARGET.items()]))
                rows.append((err, delta, rate, got))
                print(f"{delta:9.1f}{rate:8.1f}{err:8.3f}"
                      f"{got.get('rate_min_ch', 0):8.2f}{got.get('duration_s', 0):8.3f}"
                      f"{got.get('frequency_hz', 0):8.3f}{got.get('ptp_uv', 0):9.1f}"
                      f"{got.get('slope_uv_s', 0):9.1f}")
    finally:
        script.unlink(missing_ok=True)
    best = min(rows, key=lambda r: r[0])
    print(f"\nBest delta={best[1]:g} uV pp, scheduled rate={best[2]:g}/min, "
          f"mean relative error={best[0]:.3f}: {best[3]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
