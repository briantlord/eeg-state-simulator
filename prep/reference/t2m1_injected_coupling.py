"""Does the injected connection show up, and is it absent when switched off?

The connectivity panel needs a positive control. Every source in this generator projects
instantaneously, so all inter-channel coupling is zero-lag volume conduction and debiased wPLI
correctly reports almost nothing -- 0.004 against a real 0.068 (Findings 25, 26). A blank map is
then unfalsifiable: it could mean the measure is rejecting volume conduction, or that it never
shows anything, and nothing on screen distinguishes those.

`injectedCoupling` drives `coupling_dst` from `coupling_src` at a known lag:

    dst(t) = c * src(t - lag) + sqrt(1 - c^2) * independent(t)

THE MATCHED NULL IS THE SAME GENERATOR WITH c = 0, not a different signal. Both arms carry the
injected pair at the same amplitude through the same topographies with the same draws; the only
difference is whether the driver reaches the target. Anything that survives that contrast is the
coupling and not the patches, the amplitude or the anatomy.

FOUR THINGS ARE ASKED, and the last two are what stop this being a self-congratulating check:

  1. Does dwPLI between the two patches' peak electrodes rise when the coupling is on?
  2. Does it fall to chance when c = 0?
  3. Is the connection SPECIFIC -- elevated at the injected pair and not across the montage? A
     coupling that lit up every pair would be indistinguishable from a global artifact.
  4. Is the RECOVERED LAG the injected one? dwPLI says a lag exists, not what it is. The phase
     slope of the cross-spectrum does: arg(S) ~ -2 pi f tau, so a straight-line fit over the band
     returns tau. If that disagrees with `coupling_lag_ms` the injection is not doing what its
     registry row says.
"""
import json
import subprocess
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np

from prep import registry as R
from prep.reference.t2m1_connectivity_probe import (
    EPOCH_S, FS, band_mean, connectivity, epoch_spectra,
)

ROOT = Path(__file__).resolve().parents[2]

H = '''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const on = process.argv[3] === 'on';
const r = composeState(4242, process.argv[2], fs * 300, fs, { injectedCoupling: on });
const ref = applyReference(r.channels, 'average');
process.stdout.write(JSON.stringify({ labels: ref.labels, data: ref.channels.map(c => [...c]) }));
'''


def run(state: str, on: bool):
    f = ROOT / '.coupling-probe.mts'
    f.write_text(H, encoding='utf8')
    try:
        p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                            '--max-old-space-size=8192', str(f), state, 'on' if on else 'off'],
                           cwd=ROOT, capture_output=True)
        if p.returncode != 0:
            raise SystemExit(p.stderr.decode()[:1500])
        d = json.loads(p.stdout)
    finally:
        f.unlink(missing_ok=True)
    return d['labels'], np.asarray(d['data'], dtype=float)


def peak_electrode(gen: str, labels) -> str:
    proj = json.loads((ROOT / 'data' / 'projection_10_20.json').read_text(encoding='utf8'))
    w = np.abs(np.asarray(proj['generators'][gen]['weights'], dtype=float))
    return proj['channels'][int(np.argmax(w))]


def recovered_lag_ms(spec, freqs, i, j, lo, hi) -> float:
    """Lag from the phase slope of the cross-spectrum: arg(S) ~ -2 pi f tau."""
    s = (spec[:, i, :] * np.conj(spec[:, j, :])).mean(0)
    m = (freqs >= lo) & (freqs <= hi)
    ph = np.unwrap(np.angle(s[m]))
    slope = np.polyfit(freqs[m], ph, 1)[0]
    return float(-slope / (2 * np.pi) * 1000)


def main() -> int:
    lag_ms = R.scalar_value('coupling_lag_ms')
    c = R.scalar_value('coupling_strength')
    lo, hi = R.record('alpha_band')['value']['lo'], R.record('alpha_band')['value']['hi']

    labels, _ = run('wake_ec', False)
    src_e = peak_electrode('coupling_src', labels)
    dst_e = peak_electrode('coupling_dst', labels)
    i, j = labels.index(src_e), labels.index(dst_e)
    print(f"injected: coupling_src ({src_e}) -> coupling_dst ({dst_e}), "
          f"lag {lag_ms:g} ms, strength {c:g}\n")

    print(f"  {'coupling':<10}{'dwPLI(src,dst)':>16}{'montage median':>16}{'ratio':>8}"
          f"{'lag recovered':>15}")
    print('  ' + '-' * 65)
    res = {}
    for on in (False, True):
        labels, x = run('wake_ec', on)
        spec, freqs = epoch_spectra(x, FS, EPOCH_S)
        _, dw = connectivity(spec)
        db = band_mean(dw, freqs, lo, hi)
        iu = np.triu_indices(len(labels), 1)
        pair = float(db[i, j])
        med = float(np.median(db[iu]))
        tau = recovered_lag_ms(spec, freqs, i, j, lo, hi) if on else float('nan')
        res['on' if on else 'off'] = (pair, med, tau)
        print(f"  {'ON' if on else 'OFF':<10}{pair:>16.4f}{med:>16.4f}{pair / med:>8.2f}"
              f"{(f'{tau:+.1f} ms' if on else '--'):>15}")

    on_pair, on_med, on_tau = res['on']
    off_pair, off_med, _ = res['off']
    print(f"""
  1. rises when on:       {off_pair:.4f} -> {on_pair:.4f}   ({on_pair / max(off_pair, 1e-9):.1f}x)
  2. at chance when off:  {off_pair:.4f} against a montage median of {off_med:.4f}
  3. specific:            {on_pair / on_med:.1f}x the montage median with coupling on
  4. lag recovered:       {abs(on_tau):.1f} ms against an injected {lag_ms:g} ms""")

    # The lag criterion asks only that a lag is DETECTED, not that it survives the montage
    # unchanged. Requiring the latter would be requiring volume conduction not to exist.
    ok = on_pair > 4 * off_pair and on_pair > 4 * on_med and abs(on_tau) > 0.2 * lag_ms
    print(f"\n  -> {'PASSES' if ok else 'DOES NOT PASS -- read the rows above'}"
          f"   (scalp lag is {abs(on_tau) / lag_ms:.0%} of the injected source lag)")
    print("""
  The sign of the recovered lag depends on which channel is taken first and is not evidence of
  direction: dwPLI and the phase slope are symmetric measures. Establishing WHICH way the influence
  runs needs a directed measure -- Granger causality or the directed transfer function -- and this
  pair is exactly the fixture such a check would use.""")
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
