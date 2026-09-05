"""Fit the fast/slow spindle source mixture through matched YASA output."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from prep.reference.t1m1_sleep_events import FS, detect, summarize_detection

SEEDS = (4242, 4888, 5554, 6220)
FRACTIONS = (0.2, 0.3, 0.4, 0.5)
TARGET = {"n2": 12.789, "n3": 12.732}

HARNESS = r"""
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
const seed=Number(process.argv[2]), state=process.argv[3], frac=Number(process.argv[4]), fs=256;
const r=composeState(seed,state,fs*600,fs,{snrDb:-2.7559,spindleFastFraction:frac});
const at=(l)=>ALL_CHANNELS.indexOf(l), pairs=[['F4','A1'],['C4','A1'],['O2','A1'],['C3','A2']];
const out=pairs.map(([a,b])=>{const x=r.channels[at(a)],y=r.channels[at(b)],d=new Array(x.length);
for(let i=0;i<d.length;i++)d[i]=x[i]-y[i];return d;}); process.stdout.write(JSON.stringify(out));
"""


def measure(script: Path, state: str, fraction: float) -> float:
    vals = []
    stage = 2 if state == "n2" else 3
    for seed in SEEDS:
        p = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", str(script),
                            str(seed), state, str(fraction)], cwd=ROOT, capture_output=True, check=True)
        x = np.asarray(json.loads(p.stdout), dtype=float)
        hyp = np.full(x.shape[-1], stage, dtype=np.int8)
        sp, _ = detect(x, FS, hyp, (stage,))
        row = summarize_detection(sp, None, hyp, FS, stage)["spindle"]
        vals.append(row.get("frequency_hz", np.nan))
    return float(np.nanmedian(vals))


def main() -> int:
    script = ROOT / ".spindle-mix-sweep.mts"
    script.write_text(HARNESS, encoding="utf8")
    rows = []
    try:
        for fraction in FRACTIONS:
            got = {state: measure(script, state, fraction) for state in TARGET}
            err = float(np.mean([abs(got[s] - TARGET[s]) / TARGET[s] for s in TARGET]))
            rows.append((err, fraction, got))
            print(f"fast fraction {fraction:.2f}: N2 {got['n2']:.3f} Hz, "
                  f"N3 {got['n3']:.3f} Hz, error {err:.4f}")
    finally:
        script.unlink(missing_ok=True)
    best = min(rows)
    print(f"Best: {best[1]:.2f}, output={best[2]}, error={best[0]:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
