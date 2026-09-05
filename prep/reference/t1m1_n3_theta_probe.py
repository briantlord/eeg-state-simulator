"""Does retaining the existing theta process fix delta-only N3 without another amplitude row?"""
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

from prep.reference.t1m1_sleep_events import FS, detect, summarize_detection
from prep.reference.t1m1_state_realism import metrics
from prep.reference.t1m1_hmc_aasm import fraction as aasm_fraction

SEEDS = (4242, 4555, 4888, 5221, 5554, 5887)
TARGET = {"rms_uv": 20.935, "delta_rel": 0.836, "theta_rel": 0.086}

HARNESS = r"""
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
const seed = Number(process.argv[2]), enabled = process.argv[3] === 'true';
const gain = Number(process.argv[4]), fs = 256;
const r = composeState(seed, 'n3', fs * 600, fs, {
  snrDb: -2.7559, n3Theta: enabled, backgroundGain: gain,
});
const at = (label) => ALL_CHANNELS.indexOf(label);
const pairs = [['F4','A1'],['C4','A1'],['O2','A1'],['C3','A2']];
const out = pairs.map(([a,b]) => {
  const x=r.channels[at(a)], y=r.channels[at(b)], d=new Array(x.length);
  for(let i=0;i<d.length;i++) d[i]=x[i]-y[i]; return d;
});
process.stdout.write(JSON.stringify(out));
"""


def run(script: Path, enabled: bool, gain: float):
    spectral, slow, aasm_pass = [], [], []
    for seed in SEEDS:
        p = subprocess.run(
            ["node", "--experimental-strip-types", "--no-warnings", str(script), str(seed),
             str(enabled).lower(), str(gain)], cwd=ROOT, capture_output=True, check=True,
        )
        x = np.asarray(json.loads(p.stdout), dtype=float)
        spectral.append(metrics(x, FS))
        aasm_pass.append(float(np.mean([
            aasm_fraction(x[3, a:a + 30 * FS], FS) >= 0.20
            for a in range(0, x.shape[-1], 30 * FS)
        ])))
        hyp = np.full(x.shape[-1], 3, dtype=np.int8)
        _, sw = detect(x, FS, hyp, (3,))
        slow.append(summarize_detection(None, sw, hyp, FS, 3)["slow_wave"])
    sm = {k: float(np.median([r[k] for r in spectral])) for k in spectral[0]}
    wm = {k: float(np.median([r[k] for r in slow])) for k in slow[0]}
    return sm, wm, float(np.median(aasm_pass))


def main() -> int:
    script = ROOT / ".n3-theta-probe.mts"
    script.write_text(HARNESS, encoding="utf8")
    try:
        for enabled, gain in ((False, 1.0), (True, 1.0), (True, 1.5), (True, 1.7), (True, 2.0)):
            sm, wm, aasm = run(script, enabled, gain)
            err = np.mean([abs(sm[k] - v) / v for k, v in TARGET.items()])
            print(f"theta {'ON ' if enabled else 'OFF'}, bg gain {gain:.1f}: "
                  f"rms={sm['rms_uv']:.2f} uV, "
                  f"delta={sm['delta_rel']:.3f}, theta={sm['theta_rel']:.3f}, "
                  f"spectral error={err:.3f}; SW rate={wm['rate_min_ch']:.2f}/min, "
                  f"dur={wm.get('duration_s', np.nan):.3f}s, "
                  f"freq={wm.get('frequency_hz', np.nan):.3f}Hz; AASM pass={aasm:.3f}")
    finally:
        script.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
