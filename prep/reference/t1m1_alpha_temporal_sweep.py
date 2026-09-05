"""Sweep alpha damping against EEGMAT temporal targets without changing amplitude/topography."""
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

from prep.reference.t1m1_alpha_temporal import FS, alpha_metrics, real_metrics

SEEDS = (4242, 4888, 5554, 6220)
CONFIGS = (
    (1.0, 6.0, 1.25),
    (1.0, 6.0, 2.5),
    (1.0, 6.0, 4.0),
    (0.7, 6.0, 2.5),
    (0.7, 8.0, 2.5),
    (0.7, 8.0, 4.0),
    (0.5, 8.0, 2.5),
    (0.5, 8.0, 4.0),
)

HARNESS = r"""
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
const seed = Number(process.argv[2]);
const sharp = Number(process.argv[3]);
const broad = Number(process.argv[4]);
const dwell = Number(process.argv[5]);
const fs = 256;
const r = composeState(seed, 'wake_ec', fs * 180, fs, {
  snrDb: -2.7559,
  alphaBandwidthSharpHz: sharp,
  alphaBandwidthBroadHz: broad,
  alphaModeDwellS: dwell,
});
const at = (label) => ALL_CHANNELS.indexOf(label);
const pz = r.channels[at('Pz')], a1 = r.channels[at('A1')], a2 = r.channels[at('A2')];
const x = new Array(pz.length);
for (let i = 0; i < x.length; i++) x[i] = pz[i] - (a1[i] + a2[i]) / 2;
process.stdout.write(JSON.stringify(x));
"""


def target() -> dict[str, float]:
    rows = real_metrics()
    return {k: float(np.median([r[k] for r in rows])) for k in rows[0]}


def generated(script: Path, config: tuple[float, float, float]) -> dict[str, float]:
    rows = []
    for seed in SEEDS:
        p = subprocess.run(
            ["node", "--experimental-strip-types", "--no-warnings", str(script), str(seed),
             *(str(v) for v in config)], cwd=ROOT, capture_output=True, check=True,
        )
        rows.append(alpha_metrics(np.asarray(json.loads(p.stdout), dtype=float), FS))
    return {k: float(np.median([r[k] for r in rows])) for k in rows[0]}


def main() -> int:
    real = target()
    keys = ("env_cv", "bimodality", "burst_rate_min", "burst_dur_med_s", "envelope_tau_s")
    script = ROOT / ".alpha-temporal-sweep.mts"
    script.write_text(HARNESS, encoding="utf8")
    print("\nTarget:", " ".join(f"{k}={real[k]:.3f}" for k in keys))
    print(f"\n{'sharp':>6}{'broad':>7}{'dwell':>7}{'error':>8}  " + "  ".join(keys))
    rows = []
    try:
        for config in CONFIGS:
            got = generated(script, config)
            # Relative error gives each distinct observable equal weight. Burst rate and duration
            # are correlated but not duplicates: together they expose threshold fragmentation.
            err = float(np.mean([abs(got[k] - real[k]) / real[k] for k in keys]))
            rows.append((err, config, got))
            print(f"{config[0]:6.2f}{config[1]:7.2f}{config[2]:7.2f}{err:8.3f}  " +
                  "  ".join(f"{got[k]:.3f}" for k in keys))
    finally:
        script.unlink(missing_ok=True)
    best = min(rows, key=lambda r: r[0])
    print(f"\nBest: sharp={best[1][0]}, broad={best[1][1]}, dwell={best[1][2]} s, "
          f"mean relative error={best[0]:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
