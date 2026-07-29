"""Does the filter demonstration demonstrate anything?

The Tier 0 shipping test names it the artifact's thesis: "injected coupling, a user-movable
cutoff, and the ground-truth line visibly diverging from the recovered estimate."

Finding 10 recorded that it did not: coupling retained went 93% -> 91% across the whole
clinical range, because only respiratory mechanism (c)'s EXPONENT half was implemented and
that is the one component a clinical high-pass cannot reach.

This measures all three mechanisms separately, which is the point Build Plan 5.1 insists on:
they have "different origins, different topographies, different implications. Conflating them
is the standard error in this literature."
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { applyHighpass } from './src/core/filters/hpf.ts';
import { bandAmplitudeCoupling, chiOverTime, modulationDepth } from './src/analysis/coupling.ts';

const fs = 256, n = fs * 180;
const r = composeState(4242, 'n3', n, fs, {
  movementArtifact: true, amplitudeModulation: true, chiModulation: true, respRatePerMin: 15,
});
const phase = r.respirationPhase;
const rows: unknown[] = [];
for (const cut of [0.01, 0.1, 0.5, 1.0]) {
  const hp = r.channels.map((c) => applyHighpass(c, cut, 'zeroPhase', fs));
  const rf = applyReference(hp, 'linked-mastoid');
  const fz = rf.channels[rf.labels.indexOf('Fz')]!;
  const { chi, fsEst } = chiOverTime(fz, fs);
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { re += fz[i]! * Math.cos(phase[i]!); im += fz[i]! * Math.sin(phase[i]!); }
  rows.push({
    cut,
    ampMod: bandAmplitudeCoupling(fz, phase, 0.5, 4, fs),
    chiMod: modulationDepth(chi, fsEst, r.truth.respFreqHz),
    artifactUv: 2 * Math.hypot(re / n, im / n),
  });
}
process.stdout.write(JSON.stringify({ truth: r.truth, rows }));
'''

f = ROOT / '.demo-probe.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f)],
                   cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:1500])

import json
d = json.loads(p.stdout)
t, rows = d['truth'], d['rows']

print("All three respiratory mechanisms on, N3, 180 s, Fz, linked mastoid\n")
print(f"  injected: artifact {t['respArtifactAmpUv']:.0f} uV at the respiratory rate")
print(f"            amplitude-modulation depth {t['respAmpModDepth']:.2f} on 0.5-4 Hz")
print(f"            exponent-modulation depth  {t['chiModDepth']:.2f}\n")

base = rows[0]
print(f"  {'cutoff':>8} {'(a) artifact':>14} {'(c) amp-mod':>13} {'retained':>9} "
      f"{'(c) chi-mod':>13} {'retained':>9}")
print("  " + "-" * 70)
for r_ in rows:
    print(f"  {r_['cut']:6.2f} Hz {r_['artifactUv']:11.2f} uV {r_['ampMod']:13.4f} "
          f"{100 * r_['ampMod'] / base['ampMod']:8.0f}% {r_['chiMod']:13.4f} "
          f"{100 * r_['chiMod'] / base['chiMod']:8.0f}%")

print("""
  (a) MOVEMENT ARTIFACT sits AT the respiratory rate, so every cutoff above it removes the
      lot. "Genuine artifact; high-passing it out is correct" -- this is the filter working.

  (c) AMPLITUDE half modulates the 0.5-4 Hz envelope, and the high-pass eats that band. This
      is the loss the demonstration exists to show, and it is a real loss: the coupling was
      there and the filter took it.

  (c) EXPONENT half is estimated from 2-40 Hz, entirely above the stopband, and survives every
      clinical cutoff. Alone, it is why Demo 1 was flat (Finding 10).

  The honest lesson the artifact carries: high-pass filtering trades a KNOWN ARTIFACT for a
  KNOWN DISTORTION. Not that filtering is a mistake.""")
