"""Compare the generator against REAL scalp EEG.

Every other check in this project is a round trip through code we wrote. This is the first
that is not. Harness section 6 makes the point about the discriminator check at T1-M4: "every
gate above is a round trip; NONE TESTS WHETHER THE OUTPUT RESEMBLES EEG AT ALL." This is a
cheap, small-n precursor to that -- not the discriminator, and not a gate.

CORPUS: PhysioNet EEGMAT (Zyma et al. 2019), "EEG During Mental Arithmetic Tasks",
Open Data Commons Attribution License v1.0. The `_1` files are background EEG recorded BEFORE
the task -- resting adults, eyes closed per the protocol description.

WHY THIS ONE. It matches our scheme almost exactly, which is what makes the comparison mean
anything:
  * the same 19 channels of the 10-20 system, no more and no fewer
  * referenced to interconnected ears -- our `linked-mastoid` mode
  * awake resting adults, comparable to wake_ec

WHAT IT CANNOT SETTLE. n = 8 subjects, one condition, one lab, one amplifier. Any figure here
is an order-of-magnitude sanity check, not a fitted target. T1-M1 fits parameters from a
corpus with a staging-conditional pipeline; this is a smell test that the generator is not
producing something structurally unlike EEG.
"""
import subprocess
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np
from scipy import signal as sps

import mne

from prep import registry as R

ROOT = Path(__file__).resolve().parents[2]
FS = int(R.scalar_value('fs'))
REAL = ROOT / 'prep' / 'realdata'

# Our montage order. The real files carry the same 19 labels prefixed with "EEG ".
OUR = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
       'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']

POS = {c['label']: (c['x'], c['y'])
       for c in __import__('json').loads(
           (ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))['channels']}


# ------------------------------------------------------------------- metrics

def effective_rank(x):
    """Participation ratio of the channel covariance. Threshold-free."""
    xc = x - x.mean(axis=1, keepdims=True)
    c = np.cov(xc)
    lam = np.linalg.eigvalsh(c)
    lam = lam[lam > 0]
    return (lam.sum() ** 2) / (lam ** 2).sum(), lam[::-1] / lam.sum()


def spectral(x, fs=FS):
    f, p = sps.welch(x, fs, nperseg=4 * fs, noverlap=2 * fs)
    return f, p


def chi_fixed(f, p, lo, hi):
    m = (f >= lo) & (f <= hi) & (p > 0)
    return -np.polyfit(np.log10(f[m]), np.log10(p[m]), 1)[0]


def alpha_peak(f, p):
    """Height of the alpha bump above the aperiodic fit, and its frequency."""
    m_fit = ((f >= 2) & (f <= 7)) | ((f >= 16) & (f <= 35))
    coef = np.polyfit(np.log10(f[m_fit]), np.log10(p[m_fit]), 1)
    with np.errstate(divide='ignore', invalid='ignore'):
        resid = p / 10 ** np.polyval(coef, np.log10(f))
    m = (f >= 7) & (f <= 14)
    return f[m][np.nanargmax(resid[m])], float(np.nanmax(resid[m]))


def corr_vs_distance(x, labels):
    """Median |correlation| for near vs far electrode pairs -- the spatial structure test."""
    c = np.corrcoef(x - x.mean(axis=1, keepdims=True))
    near, far = [], []
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            pi, pj = np.array(POS[labels[i]]), np.array(POS[labels[j]])
            d = np.hypot(*(pi - pj))
            (near if d < 0.6 else far).append(abs(c[i, j]))
    iu = np.triu_indices(len(labels), 1)
    return float(np.median(np.abs(c[iu]))), float(np.median(near)), float(np.median(far))


def summarize(x, labels, tag):
    eff, spec = effective_rank(x)
    med, near, far = corr_vs_distance(x, labels)
    pz = x[labels.index('Pz')]
    f, p = spectral(pz)
    apk, aamp = alpha_peak(f, p)
    return dict(
        tag=tag, eff=eff, pc1=spec[0],
        med=med, near=near, far=far,
        rms=float(np.sqrt((pz ** 2).mean())),
        # 1-20 Hz ONLY. The EEGMAT recordings carry an acquisition low-pass in the 30-45 Hz
        # region -- measured local slope 6.7 over 20-30 Hz, 50 Hz sitting BELOW its neighbours
        # (a mains notch), and a flat instrument floor above 80 Hz. Fitting 30-45 Hz there
        # measures their filter, not their cortex: it returns chi ~ 3.5, which is not a
        # neural exponent.
        #
        # This is Build Plan 3.7 demonstrated on real data: "a published exponent is a joint
        # function of PSD method, fit band, knee model, reference, artifact rejection and
        # electrode. IT DOES NOT TRANSFER." The narrowband comparison is therefore not made
        # at all rather than made and caveated.
        chi_low=chi_fixed(f, p, 1, 20),
        chi_broad=chi_fixed(f, p, 1, 45),
        alpha_hz=apk, alpha_x=aamp,
    )


# ---------------------------------------------------------------- real data

def load_real(path):
    raw = mne.io.read_raw_edf(path, preload=True, verbose='ERROR')
    picks = [f'EEG {c}' for c in OUR]
    raw.pick(picks)
    raw.resample(FS, verbose='ERROR')
    x = raw.get_data() * 1e6  # volts -> microvolts
    # Drop the first and last 5 s: filter edges and settling.
    return x[:, 5 * FS:-5 * FS]


# ----------------------------------------------------------- generated data

HARNESS = '''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
const fs = %(fs)d, n = fs * %(dur)d;
const r = composeState(%(seed)d, '%(state)s', n, fs, {});
const ref = applyReference(r.channels, 'linked-mastoid');
const order = %(order)s;
const out = new Float64Array(order.length * n);
order.forEach((lbl, k) => out.set(ref.channels[ref.labels.indexOf(lbl)], k * n));
process.stdout.write(Buffer.from(out.buffer));
'''


def load_generated(state, seed, dur):
    import json
    src = HARNESS % dict(fs=FS, dur=dur, seed=seed, state=state, order=json.dumps(OUR))
    f = ROOT / '.cmp-probe.mts'
    f.write_text(src, encoding='utf8')
    p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', str(f)],
                       cwd=ROOT, capture_output=True)
    f.unlink(missing_ok=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:1200])
    a = np.frombuffer(p.stdout, dtype='<f8')
    return a.reshape(len(OUR), -1)


# ---------------------------------------------------------------------- run

files = sorted(REAL.glob('Subject*_1.edf'))
real_rows = []
for fp in files:
    x = load_real(fp)
    real_rows.append(summarize(x, OUR, fp.stem))
dur = int(min(r for r in [x.shape[1] / FS]))

gen_rows = [summarize(load_generated(s, 3000 + i, dur), OUR, s)
            for i, s in enumerate(['wake_ec', 'wake_eo', 'n2', 'n3'])]


def agg(rows, keys=('eff', 'pc1', 'med', 'near', 'far', 'rms',
                    'chi_low', 'chi_broad', 'alpha_hz', 'alpha_x')):
    return {k: (np.median([r[k] for r in rows]),
                np.percentile([r[k] for r in rows], 25),
                np.percentile([r[k] for r in rows], 75)) for k in keys}


rm = agg(real_rows)
print(f"REAL: PhysioNet EEGMAT, {len(files)} subjects, resting, linked-ear reference, "
      f"{dur:.0f} s each, resampled to {FS} Hz")
print("GEN : our generator, linked-mastoid reference, same 19 channels, same duration\n")

LABELS = [
    ('eff', 'effective rank', '{:.2f}'),
    ('pc1', 'PC1 variance frac', '{:.3f}'),
    ('med', 'median |corr| all', '{:.3f}'),
    ('near', 'median |corr| near', '{:.3f}'),
    ('far', 'median |corr| far', '{:.3f}'),
    ('rms', 'Pz RMS (uV)', '{:.1f}'),
    ('chi_low', 'chi 1-20 Hz  *', '{:.2f}'),
    ('chi_broad', 'chi 1-45 Hz  +', '{:.2f}'),
    ('alpha_hz', 'alpha peak (Hz)', '{:.1f}'),
    ('alpha_x', 'alpha x aperiodic', '{:.2f}'),
]

hdr = f"  {'metric':20} {'REAL median [IQR]':>26}"
for g in gen_rows:
    hdr += f" {g['tag']:>10}"
print(hdr)
print("  " + "-" * (len(hdr) - 2))
for key, name, fmt in LABELS:
    med, q1, q3 = rm[key]
    real = f"{fmt.format(med)} [{fmt.format(q1)}-{fmt.format(q3)}]"
    line = f"  {name:20} {real:>26}"
    for g in gen_rows:
        line += f" {fmt.format(g[key]):>10}"
    print(line)

print("\n  'near' pairs are <0.6 montage units apart, 'far' beyond it. A generator with")
print("  realistic spatial structure shows near > far, as volume conduction produces.")
print()
print("  * 1-20 Hz is the only band where the real recordings are usable. They carry an")
print("    acquisition low-pass around 30-45 Hz: local slope 6.7 over 20-30 Hz, a 50 Hz mains")
print("    notch, and a flat instrument floor above 80 Hz. Fitting 30-45 Hz there returns")
print("    chi ~ 3.5, which measures their filter and not their cortex.")
print("  + 1-45 Hz is shown for completeness and is CONTAMINATED for the real column above")
print("    ~20 Hz. Do not read the real 1-45 value as a neural exponent.")
print()
print("  Build Plan 3.7 on real data: a published exponent is a joint function of PSD method,")
print("  fit band, knee model, reference and acquisition. IT DOES NOT TRANSFER.")
