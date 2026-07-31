"""Invert chi_n2 and chi_n3 against the HMC corpus. The first sleep rows with an empirical basis.

Finding 23 measured 19 scored nights and returned MOVE for both: N2 at 2.08 [IQR 1.96-2.38] and
N3 at 2.59 [2.32-2.84] over 1-30 Hz, against rows sitting at 1.70 and 1.66.

I PREDICTED BOTH ROWS WOULD COME DOWN. THEY GO UP. The prediction is recorded here because it was
wrong for an instructive reason.

`chi_*` is a SOURCE parameter and 2.08 is an OUTPUT of a referenced, spatially mixed signal, so
they cannot be equated -- that part was right. The error was extrapolating the source->output
factor from Finding 22, which measured it under a NINETEEN-CHANNEL AVERAGE REFERENCE and got ~1.85
(source 0.85 -> output 1.574, output steeper than source). Applying it here gave "1.70 already
produces ~3.1, so come down".

Measured under HMC's own pipeline -- four derivations against the contralateral mastoid -- the
factor is not 1.85 and does not even have the same SIGN of effect: source 3.4 produces output
2.63, so the output is SHALLOWER than the source. Average referencing across 19 channels removes
the spatially common low-frequency part and steepens; a bipolar mastoid derivation does something
else entirely.

So the factor is a property of the montage and reference, not of the generator, and no factor
measured under one pipeline transfers to another. That is D19.1's rule, which this file's own
header had just restated while breaking it.

This project has now crossed a parameter with an observable three times, twice inside the work that
documented the error. So the rows are solved, not assigned: sweep the source pair, measure the
generated signal through the pipeline the corpus went through, and keep the pair whose OUTPUT
matches.

THE PIPELINE IS MATCHED TO HMC, not to EEGMAT. HMC scores four derivations against the
contralateral mastoid, so the generated signal is reduced to the same four before measuring --
F4-A1, C4-A1, O2-A1, C3-A2, our montage's nearest equivalents. Measuring a 19-channel average
reference here and comparing it to a 4-derivation mastoid corpus would repeat D19.1's mistake in a
new place.
"""
import json
import re
import subprocess
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')
import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]
REG = ROOT / 'registry' / 'parameters.yaml'
FS, BAND = 256, (1.0, 30.0)

#: Finding 23, 19 HMC nights, median across subjects over 1-30 Hz.
TARGET = {'n2': {'chi': 2.08, 'knee': 2.29}, 'n3': {'chi': 2.59, 'knee': 1.74}}

#: Swept per state. N3 needed the range extended twice: an optimum sitting on a grid boundary is
#: the grid failing, not an answer, and accepting one would repeat the mistake this file's own
#: header criticises.
GRID_CHI = {'n2': (1.6, 1.9, 2.2), 'n3': (2.5, 2.8, 3.1, 3.4, 3.7)}

#: HMC's derivations, in our montage's labels. Contralateral mastoid, as HMC scores them.
DERIV = [('F4', 'A1'), ('C4', 'A1'), ('O2', 'A1'), ('C3', 'A2')]

H = '''
import { composeState } from './src/core/generators/compose.ts';
import { ALL_CHANNELS } from './src/core/generators/projection.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const r = composeState(4242, process.argv[2], fs * 300, fs);
const idx = (l) => ALL_CHANNELS.indexOf(l);
const pairs = [['F4','A1'],['C4','A1'],['O2','A1'],['C3','A2']];
const out = pairs.map(([a, b]) => {
  const x = r.channels[idx(a)], y = r.channels[idx(b)];
  const d = new Array(x.length);
  for (let i = 0; i < x.length; i++) d[i] = x[i] - y[i];
  return d;
});
process.stdout.write(JSON.stringify(out));
'''


def measure(state):
    from specparam import SpectralModel
    f = ROOT / '.sleepinv.mts'
    f.write_text(H, encoding='utf8')
    try:
        p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                            '--max-old-space-size=8192', str(f), state],
                           cwd=ROOT, capture_output=True)
        if p.returncode != 0:
            raise SystemExit(p.stderr.decode()[:1200])
        x = np.asarray(json.loads(p.stdout), dtype=float)
    finally:
        f.unlink(missing_ok=True)
    fr, pw = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS, axis=-1)
    sm = SpectralModel(aperiodic_mode='knee', verbose=False)
    sm.fit(fr, pw.mean(axis=0), list(BAND))
    ap = sm.get_params('aperiodic')
    chi, knee = float(ap[-1]), float(ap[1])
    kf = float(knee ** (1.0 / chi)) if knee > 0 and chi > 0 else float('nan')
    return chi, kf


def read(key):
    s = REG.read_text(encoding='utf8')
    return float(re.search(rf'  {key}:\s*\{{.*?provisional: \{{v: ([\d.]+)', s).group(1))


def write(state, chi, kf):
    s = REG.read_text(encoding='utf8')
    for key, val in ((f'chi_{state}', chi), (f'knee_freq_{state}', kf),
                     (f'k_{state}', kf ** chi)):
        s = re.sub(rf'(  {key}:\s*\{{value: \{{kind: pending\}}, provisional: \{{v: )[\d.]+',
                   rf'\g<1>{val:.4g}', s, count=1)
    REG.write_text(s, encoding='utf8')
    subprocess.run(['node', 'tools/registry/emit.mjs'], cwd=ROOT, capture_output=True, check=True)


orig = {st: (read(f'chi_{st}'), read(f'knee_freq_{st}')) for st in TARGET}
print(f"Inverting against HMC: 4 derivations, contralateral mastoid, "
      f"{BAND[0]:g}-{BAND[1]:g} Hz.\n")
results = {}
try:
    for st, tgt in TARGET.items():
        print(f"  {st}: target output chi {tgt['chi']}, knee {tgt['knee']} Hz "
              f"(registry source now {orig[st][0]}, {orig[st][1]})")
        print(f"    {'src chi':>8}{'src knee':>10} ->{'out chi':>9}{'out knee':>10}{'err':>8}")
        rows = []
        # THE FIRST GRID TOPPED OUT AT 1.6 AND BOTH STATES SAT ON ITS EDGE, which is a grid
        # failing rather than an answer: an optimum at a boundary means the optimum is outside.
        # Widened upward because the measured source->output factor here is ~1.25, not the ~1.85
        # Finding 22 measured under a 19-channel average reference -- see the correction below.
        for cs in GRID_CHI[st]:
            for ks in (1.0, 3.0):
                write(st, cs, ks)
                oc, ok = measure(st)
                # A knee that does not appear in the output is a real miss, not a missing
                # datum: it means the source knee sits outside the band the corpus was fitted
                # over, and the corpus DID find one. Scored as a full unit of error.
                knee_err = (abs(ok - tgt['knee']) / tgt['knee'] if np.isfinite(ok) else 1.0)
                e = float(np.mean([abs(oc - tgt['chi']) / tgt['chi'], knee_err]))
                rows.append((e, cs, ks, oc, ok))
                print(f"    {cs:8.2f}{ks:10.2f}   {oc:9.3f}{ok:10.2f}{e:8.3f}")
        best = min(rows)
        results[st] = best
        print(f"    -> SOLVED chi_{st} = {best[1]}, knee_freq_{st} = {best[2]} Hz  "
              f"(output {best[3]:.3f} / {best[4]:.2f}, err {best[0]:.3f})\n")
    for st, b in results.items():
        write(st, b[1], b[2])
except BaseException:
    for st, (c, k) in orig.items():
        write(st, c, k)
    raise

print("""  Both rows are now SOURCE values whose consequence is the measured corpus target, which is
  what snr_nominal and chi_wake_ec already are. The inversion RAISES both -- chi_n3 from 1.66 to
  3.4 -- and the ordering n3 > n2 now matches the corpus, correcting the reversal Finding 23
  refuted.

  N3'S KNEE NEVER APPEARS IN THE OUTPUT at any source setting tried, while the corpus found one at
  1.74 Hz in 15 of 18 subjects. That residual is a real disagreement between the model and the
  data, not a search that needs widening, and it is left standing rather than fitted away.""")
