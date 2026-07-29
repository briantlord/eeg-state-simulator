"""Does the generator produce what it claims? G1 and G6 in embryo, on real output."""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from scipy import signal as sps
from specparam import SpectralModel
from prep.epochio import generate
from prep import registry as R

FS = R.scalar_value('fs')

print(f"{'state':9} {'chi inj':>8} {'G1a chi':>8} {'err':>7} {'knee inj':>9} {'knee fit':>9} "
      f"{'G1b chi':>8} {'alpha pk':>9}")
print("-" * 78)

for state in ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem']:
    run = generate(tempfile.mkdtemp(), seed=20260728, state=state, epochs=10)
    sig, ch = run.concatenated()
    truth = run.epoch(0).truth
    x = sig[ch.index('Pz')]

    f, p = sps.welch(x, FS, nperseg=int(4 * FS), noverlap=int(2 * FS))

    ma = SpectralModel(aperiodic_mode='knee', verbose=False)
    ma.fit(f, p, [1, 45])
    pa = dict(zip(ma.modes.aperiodic.params.labels, ma.get_params('aperiodic')))

    mb = SpectralModel(aperiodic_mode='fixed', verbose=False)
    mb.fit(f, p, [30, 45])
    pb = dict(zip(mb.modes.aperiodic.params.labels, mb.get_params('aperiodic')))

    chi_inj, k_inj = truth['chi'], truth['knee']
    knee_hz_inj = k_inj ** (1 / chi_inj)
    knee_hz_fit = (abs(pa['knee']) ** (1 / pa['exponent'])) if pa['exponent'] > 0.1 else float('nan')

    # alpha peak: is there a bump at 8-12 Hz above the aperiodic fit?
    m = (f >= 7) & (f <= 13)
    alpha_pk = f[m][np.argmax(p[m])]

    print(f"{state:9} {chi_inj:8.2f} {pa['exponent']:8.3f} {pa['exponent']-chi_inj:+7.3f} "
          f"{knee_hz_inj:8.1f}H {knee_hz_fit:8.1f}H {pb['exponent']:8.3f} {alpha_pk:8.1f}H")

print()
print("=== G6 in embryo: does argmax land where the literature says? ===")
run = generate(tempfile.mkdtemp(), seed=1, state='wake_ec', epochs=4)
sig, ch = run.concatenated()
# Alpha band power per channel
b, a = sps.butter(4, [8 / (FS / 2), 12 / (FS / 2)], 'bandpass')
power = np.array([np.var(sps.filtfilt(b, a, sig[i])) for i in range(len(ch))])
argmax = ch[int(np.argmax(power))]
expected = R.electrode_set('topo_expect_alpha')
print(f"  alpha argmax = {argmax}  expected one of {expected}  "
      f"-> {'PASS' if argmax in expected else 'FAIL'}")
order = np.argsort(power)[::-1][:5]
print("  top 5 by alpha power:", ", ".join(f"{ch[i]}({power[i]:.0f})" for i in order))

print()
print("=== channel correlation (should NOT be 1.0 -- sensor noise is independent) ===")
c = np.corrcoef(sig[:, :20000])
iu = np.triu_indices(len(ch), 1)
print(f"  off-diagonal correlation: min {c[iu].min():.4f}  median {np.median(c[iu]):.4f}  max {c[iu].max():.4f}")
