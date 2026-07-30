"""Do injected events add a step where they are spliced in?

Reported from the artifact: "these types of jumps do not look very natural", with a screenshot
showing a hard vertical discontinuity in all 19 traces at once at each event boundary.

REAL, AND THE CAUSE WAS ONE CHARACTER OF TRIGONOMETRY. `slowOscWaveform` computed
`cos(2*PI*(w - 0.5))`, which is `-cos(2*PI*w)` and therefore -1 at BOTH endpoints, so every slow
oscillation began and ended at full negative amplitude. At so_amp 100-200 uV p-p that is a
50-100 uV step, added to every channel simultaneously through the projection. `-sin(2*PI*w)`
starts and ends at a zero crossing while keeping standard polarity and the rise-decay warp.

WHY NOTHING CAUGHT IT. No gate looks at continuity. G3 asks whether YASA finds spindles, G5 asks
about 0.5-2 Hz occupancy, G6 about topography. A step is broadband, so it barely moves a band
ratio; it is synchronous across channels, so it does not hurt effective rank either. It was
plainly visible and entirely unmeasured -- the argument for looking at the trace and not only at
the numbers.

TWO MEASUREMENTS, and the first version of this probe got the design wrong in a way worth keeping
on the record. It tried a per-waveform-type bar of "largest single-sample jump < 5% of peak", which
is ill-posed: a 13 Hz spindle carrier MUST step peak * 2*PI * 13 / 256 = 0.32 per sample, and a
sharp K-complex likewise. Measured, spindles read 0.24 and K-complexes 0.11 -- both exactly their
own bandwidth, neither a defect. A threshold that flags a correct 13 Hz oscillation is measuring
the wrong thing. What follows instead is:

  1. THE OPERATIONAL QUESTION. In the composed signal, is the jump at an event boundary
     distinguishable from ordinary sample-to-sample variation? That is what the eye is reacting to.
  2. THE FORMULA, DIRECTLY. Both the old and new slow-oscillation forms are evaluated side by
     side, so the fix is demonstrated rather than asserted.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { scalarValue, provisionalValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const n = fs * 180;
const out: Record<string, unknown> = {};

// --- 1. the composed signal: are event boundaries visible as discontinuities? ---------------
const r = composeState(4242, 'n3', n, fs, {});
const x = r.channels[4]!;   // Fz, where the slow oscillation is largest
const marks = r.events
  .flatMap((e) => [Math.round(e.onset * fs), Math.round((e.onset + e.duration) * fs)])
  .filter((i) => i > 2 && i < n - 3);

const atBoundary: number[] = [];
for (const i of marks) {
  let m = 0;
  for (let k = i - 2; k <= i + 2; k++) m = Math.max(m, Math.abs(x[k + 1]! - x[k]!));
  atBoundary.push(m);
}
const near = new Set(marks.flatMap((i) => [-4,-3,-2,-1,0,1,2,3,4].map((d) => i + d)));
const elsewhere: number[] = [];
for (let i = 1; i < n - 1; i++) if (!near.has(i)) elsewhere.push(Math.abs(x[i + 1]! - x[i]!));
out['atBoundary'] = atBoundary;
out['elsewhere'] = elsewhere;

// --- 2. the formula, old vs new, in isolation -----------------------------------------------
// Both forms written out here so the comparison needs no git archaeology. The generator ships
// the `-sin` form; `-cos` is what it replaced.
const amp = 100, nEv = Math.round(1.0 * fs), rd = scalarValue('so_rdsym');
const forms: Record<string, number[]> = { oldCos: [], newSin: [] };
for (let i = 0; i < nEv; i++) {
  const u = (i + 0.5) / nEv;
  const rr = Math.max(0.05, Math.min(0.95, rd));
  const w = u <= rr ? u / (2 * rr) : 0.5 + (u - rr) / (2 * (1 - rr));
  forms['oldCos']!.push(amp * Math.cos(2 * Math.PI * (w - 0.5)));
  forms['newSin']!.push(-amp * Math.sin(2 * Math.PI * w));
}
out['forms'] = forms;
out['amp'] = amp;
process.stdout.write(JSON.stringify(out));
'''

f = ROOT / '.event-steps.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f)],
                   cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:2500])
d = json.loads(p.stdout)

print("1. THE SLOW-OSCILLATION FORMULA, old against new, amplitude 100 uV over 1 s\n")
amp = d['amp']
for name, label in (('oldCos', 'cos(2pi(w-0.5))  [was]'), ('newSin', '-sin(2pi w)      [is]')):
    v = np.array(d['forms'][name], dtype=float)
    print(f"   {label}  first {v[0]:+8.2f} uV   last {v[-1]:+8.2f} uV   "
          f"step at splice {max(abs(v[0]), abs(v[-1])) / amp:5.1%} of amplitude")

print("\n2. COMPOSED N3 AT Fz -- is an event boundary distinguishable from the background?\n")
b = np.array(d['atBoundary'], dtype=float)
e = np.array(d['elsewhere'], dtype=float)
p999 = float(np.percentile(e, 99.9))
print(f"   {len(b)} event boundaries: median jump {np.median(b):6.2f} uV   max {b.max():6.2f} uV")
print(f"   {len(e)} other samples:   median jump {np.median(e):6.2f} uV   "
      f"99.9th pct {p999:6.2f} uV   max {e.max():6.2f} uV")
ratio = float(b.max() / p999)
print(f"\n   worst boundary jump / 99.9th pct elsewhere: {ratio:.2f}x")

if ratio < 2.0:
    print(f"""
   NOT DISTINGUISHABLE. The largest jump at any event boundary is {ratio:.2f}x the 99.9th
   percentile of jumps everywhere else, i.e. within the range the background already produces.
   With the old formula the splice step was 100% of the slow oscillation's amplitude -- 50-100 uV
   at so_amp, against a background 99.9th percentile of {p999:.1f} uV -- so it stood out by
   several-fold and did so in every channel at the same instant, which is what made it obvious.""")
else:
    print(f"""
   STILL DISTINGUISHABLE at {ratio:.2f}x. Something is discontinuous at event boundaries beyond
   the waveforms' own slopes; the formula check above is clean, so look at what else is keyed to
   event times.""")
