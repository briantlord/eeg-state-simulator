"""Phase 0 for the real-time analysis demo: is the wPLI story true, and is our estimator right?

THE DEMO BEING PLANNED rests on a claim: in this simulator every source is projected
INSTANTANEOUSLY through the lead field, so essentially all inter-channel coupling is zero-lag
volume conduction -- which is exactly what the weighted phase lag index is built to reject. The
intended panel puts coherence and dwPLI side by side, one glowing and one dark, with ground truth
saying there is no true connectivity here except the travelling slow wave.

That is a prediction, and this project has recently been wrong twice predicting a direction before
measuring one. So it is measured before anything is designed around it.

THREE QUESTIONS, IN THE ONLY ORDER THAT MAKES SENSE.

  1. IS OUR ESTIMATOR CORRECT? Tested on constructed pairs whose answer is known by trigonometry
     rather than by simulation: identical signals, quadrature, anti-phase, and independent noise.
     A connectivity result from an unvalidated estimator says nothing about the generator.

     This also tests the specific claim the demo leans on -- that wPLI rejects BOTH 0 and 180
     degrees. Vinck et al. (2011) weight each phase difference by its distance from the REAL axis,
     so anti-phase is rejected as firmly as in-phase. That matters here because a dipolar field
     projects with opposite sign either side of the source, and plain coherence reports that as
     perfect coupling.

  2. DOES IT AGREE WITH AN EXTERNAL IMPLEMENTATION? Compared against mne_connectivity's
     `spectral_connectivity_epochs`, independently authored and published. Without this the demo
     would ship a connectivity metric whose only warrant is our own arithmetic -- class C in this
     project's vocabulary. Agreement makes it class V.

  3. ONLY THEN: WHAT DOES THE GENERATOR ACTUALLY PRODUCE? Coherence and dwPLI across the montage
     for a state with no travelling waves (wake_ec) and one with them (n3).

Debiased rather than plain wPLI throughout, and that is not a detail. Vinck shows the direct
estimator is positively biased by sample size, and Haartsen et al. (2020) found dbWPLI more
reliable across many short epochs while plain PLI is confounded by segment count. A sliding
real-time window IS many short epochs, so a biased estimator would make connectivity appear to
GROW as the buffer fills -- an artefact that would look exactly like a finding.
"""
import json
import subprocess
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FS = 256
EPOCH_S = 2.0
BANDS = {'delta': (1, 4), 'theta': (4, 8), 'alpha': (8, 13), 'beta': (13, 30)}

SCALP = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']


# --------------------------------------------------------------------- our estimator
def epoch_spectra(x: np.ndarray, fs: int, epoch_s: float, overlap: float = 0.5):
    """(n_ch, n_times) -> (n_epochs, n_ch, n_freqs) complex, Hann-tapered.

    This is deliberately the arithmetic a Web Worker would do: one real FFT per channel per
    epoch, nothing clever. If the shipped worker and this disagree later, the difference is a
    bug rather than a modelling choice.
    """
    n = int(round(epoch_s * fs))
    hop = int(round(n * (1 - overlap)))
    win = np.hanning(n)
    starts = range(0, x.shape[1] - n + 1, hop)
    segs = np.stack([x[:, s:s + n] * win for s in starts])       # (n_ep, n_ch, n)
    return np.fft.rfft(segs, axis=-1), np.fft.rfftfreq(n, 1 / fs)


def connectivity(spec: np.ndarray):
    """Coherence and debiased wPLI-squared for every channel pair, per frequency bin.

    dwPLI^2 = ( (sum Im S)^2 - sum (Im S)^2 ) / ( (sum |Im S|)^2 - sum (Im S)^2 )

    The three running sums are exactly what the worker will keep incrementally, which is what
    makes the real-time cost per hop one segment rather than the whole buffer.
    """
    n_ep, n_ch, n_f = spec.shape
    coh = np.zeros((n_ch, n_ch, n_f))
    dwpli = np.zeros((n_ch, n_ch, n_f))
    for i in range(n_ch):
        for j in range(i + 1, n_ch):
            s = spec[:, i, :] * np.conj(spec[:, j, :])           # (n_ep, n_f)
            im = s.imag
            sum_im, sum_abs, sum_sq = im.sum(0), np.abs(im).sum(0), (im ** 2).sum(0)
            den = sum_abs ** 2 - sum_sq
            val = np.where(den > 0, (sum_im ** 2 - sum_sq) / np.where(den > 0, den, 1), 0.0)
            dwpli[i, j] = dwpli[j, i] = np.clip(val, 0, 1)
            num = np.abs(s.mean(0))
            pi = (np.abs(spec[:, i, :]) ** 2).mean(0)
            pj = (np.abs(spec[:, j, :]) ** 2).mean(0)
            c = num / np.sqrt(np.where(pi * pj > 0, pi * pj, 1))
            coh[i, j] = coh[j, i] = c
    return coh, dwpli


def band_mean(m: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    sel = (freqs >= lo) & (freqs <= hi)
    return m[..., sel].mean(-1)


# --------------------------------------------------------------------- 1. known answers
def constructed_pairs():
    """Pairs whose connectivity follows from trigonometry, not from any model."""
    rng = np.random.default_rng(7)
    n = FS * 120
    t = np.arange(n) / FS
    f = 10.0
    # A common band-limited carrier with a wandering phase, so coherence is high but the signal
    # is not a pure tone -- a pure tone makes every estimator look good.
    phase = 2 * np.pi * f * t + np.cumsum(rng.normal(0, 0.02, n))
    base = np.sin(phase)
    noise = lambda a: a * rng.normal(0, 1, n)
    return {
        'identical (0 deg)': (base + noise(0.3), base + noise(0.3)),
        'quadrature (90 deg)': (base + noise(0.3), np.sin(phase - np.pi / 2) + noise(0.3)),
        'anti-phase (180 deg)': (base + noise(0.3), -base + noise(0.3)),
        'independent': (base + noise(0.3), np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)
                                                  + np.cumsum(rng.normal(0, 0.02, n))) + noise(0.3)),
    }


def uncertainty_point():
    return 4.0


def main() -> int:
    from mne_connectivity import spectral_connectivity_epochs
    import mne
    mne.set_log_level('ERROR')

    print(__doc__.split('THREE QUESTIONS')[0].strip()[:0] or '', end='')
    print('1. KNOWN ANSWERS. Constructed pairs, 120 s, alpha band 8-13 Hz.\n')
    print(f"   {'pair':<24}{'coherence':>11}{'dwPLI^2':>10}   expectation")
    exp = {
        'identical (0 deg)': 'coh high, dwPLI ~0  (zero lag rejected)',
        'quadrature (90 deg)': 'coh high, dwPLI high (true lag kept)',
        'anti-phase (180 deg)': 'coh high, dwPLI ~0  (180 rejected too)',
        'independent': 'both ~0',
    }
    ok = True
    for name, (a, b) in constructed_pairs().items():
        spec, freqs = epoch_spectra(np.stack([a, b]), FS, EPOCH_S)
        coh, dw = connectivity(spec)
        c = float(band_mean(coh, freqs, 8, 13)[0, 1])
        d = float(band_mean(dw, freqs, 8, 13)[0, 1])
        print(f"   {name:<24}{c:>11.3f}{d:>10.3f}   {exp[name]}")
        if name == 'identical (0 deg)' and d > 0.1:
            ok = False
        if name == 'anti-phase (180 deg)' and d > 0.1:
            ok = False
        if name == 'quadrature (90 deg)' and d < 0.5:
            ok = False
    print(f"\n   -> estimator {'BEHAVES AS DESIGNED' if ok else 'FAILS ITS OWN PREMISE'}\n")
    if not ok:
        print('   Stopping: nothing below is worth reading if the estimator is wrong.')
        return 1

    # ---------------------------------------------------------------- 2. external agreement
    print('2. AGAINST mne_connectivity, same epochs, same band.\n')
    pairs = constructed_pairs()
    a, b = pairs['quadrature (90 deg)']
    n = int(EPOCH_S * FS)
    hop = n // 2
    ep = np.stack([np.stack([a[s:s + n], b[s:s + n]]) for s in range(0, len(a) - n + 1, hop)])
    print(f"   {'metric':<20}{'ours':>9}{'mne':>9}{'|diff|':>9}")
    agree = True
    for method, mine in (('coh', None), ('wpli2_debiased', None)):
        con = spectral_connectivity_epochs(
            ep, method=method, mode='fourier', sfreq=FS, fmin=8.0, fmax=13.0,
            faverage=True, verbose=False)
        theirs = float(np.asarray(con.get_data(output='dense')).squeeze()[1, 0])
        spec, freqs = epoch_spectra(np.stack([a, b]), FS, EPOCH_S)
        coh, dw = connectivity(spec)
        ours = float(band_mean(coh if method == 'coh' else dw, freqs, 8, 13)[0, 1])
        d = abs(ours - theirs)
        print(f"   {method:<20}{ours:>9.3f}{theirs:>9.3f}{d:>9.3f}")
        if d > 0.05:
            agree = False
    print(f"\n   -> {'AGREES within 0.05 -- class V' if agree else 'DISAGREES -- stays class C'}\n")

    # ---------------------------------------------------------------- 3. the generator
    H = '''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const r = composeState(4242, process.argv[2], fs * 300, fs);
const ref = applyReference(r.channels, 'average');
process.stdout.write(JSON.stringify({ labels: ref.labels, data: ref.channels.map(c => [...c]) }));
'''
    f = ROOT / '.conn-probe.mts'
    f.write_text(H, encoding='utf8')
    print('3. THE GENERATOR. Average reference (D19.1), 300 s, 19 scalp channels.\n')
    print(f"   {'state':<9}{'band':<7}{'coh med':>9}{'coh max':>9}{'dwPLI med':>11}"
          f"{'dwPLI max':>11}   strongest dwPLI pair")
    try:
        for state in ('wake_ec', 'n3'):
            p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                                '--max-old-space-size=8192', str(f), state],
                               cwd=ROOT, capture_output=True)
            if p.returncode != 0:
                raise SystemExit(p.stderr.decode()[:1200])
            d = json.loads(p.stdout)
            labels = d['labels']
            x = np.asarray(d['data'], dtype=float)
            spec, freqs = epoch_spectra(x, FS, EPOCH_S)
            coh, dw = connectivity(spec)
            iu = np.triu_indices(len(labels), 1)
            for band, (lo, hi) in BANDS.items():
                cb, db = band_mean(coh, freqs, lo, hi), band_mean(dw, freqs, lo, hi)
                k = int(np.argmax(db[iu]))
                pair = f'{labels[iu[0][k]]}-{labels[iu[1][k]]}'
                print(f"   {state:<9}{band:<7}{np.median(cb[iu]):>9.3f}{cb[iu].max():>9.3f}"
                      f"{np.median(db[iu]):>11.3f}{db[iu].max():>11.3f}   {pair}")
    finally:
        f.unlink(missing_ok=True)

    # ---------------------------------------------------------------- 4. is the travel there?
    #
    # The strongest dwPLI pairs in N3 are ADJACENT FRONTAL ones, which is not what an
    # anterior-posterior travelling wave predicts -- that would put the largest lag between the
    # most separated pairs. So the sub-claim gets its own test: does dwPLI in the delta band rise
    # with anterior-posterior separation, as a wave crossing the head at so_travel_v would
    # require?
    mont = json.loads((ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    POS = {c['label']: (c['x'], c['y']) for c in mont['channels']}
    f2 = ROOT / '.conn-probe2.mts'
    f2.write_text(H, encoding='utf8')
    try:
        p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                            '--max-old-space-size=8192', str(f2), 'n3'],
                           cwd=ROOT, capture_output=True)
        d = json.loads(p.stdout)
    finally:
        f2.unlink(missing_ok=True)
    labels = d['labels']
    x = np.asarray(d['data'], dtype=float)
    spec, freqs = epoch_spectra(x, FS, EPOCH_S)
    _, dw = connectivity(spec)
    db = band_mean(dw, freqs, 1, 4)
    ap, vals = [], []
    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            a, b = labels[i], labels[j]
            if a in POS and b in POS:
                ap.append(abs(POS[a][1] - POS[b][1]))
                vals.append(db[i, j])
    ap, vals = np.asarray(ap), np.asarray(vals)
    r = float(np.corrcoef(ap, vals)[0, 1])
    print('\n4. DOES dwPLI TRACK ANTERIOR-POSTERIOR SEPARATION? N3, delta band.\n')
    print(f"   {'AP separation':<22}{'n pairs':>9}{'dwPLI median':>14}")
    for lo, hi, name in ((0.0, 0.4, 'near  (< 0.4)'), (0.4, 0.9, 'mid   (0.4-0.9)'),
                         (0.9, 9.9, 'far   (> 0.9)')):
        m = (ap >= lo) & (ap < hi)
        if m.sum():
            print(f"   {name:<22}{int(m.sum()):>9}{np.median(vals[m]):>14.4f}")
    v = uncertainty_point()   # midpoint of so_travel_v's 1-7 m/s interval
    delay_ms = 0.20 / v * 1000
    print(f"\n   correlation(dwPLI, AP separation) = {r:+.3f}")
    print(f"   A wave crossing ~0.20 m at so_travel_v ~{v:g} m/s lags ~{delay_ms:.0f} ms, which at")
    print(f"   1 Hz is ~{360 * delay_ms / 1000:.0f} degrees -- detectable in principle.")

    print("""
   READ THE TWO MIDDLE COLUMNS AGAINST THE TWO RIGHT ONES. If the demo's premise holds, coherence
   is high across the montage while dwPLI sits near zero -- because instantaneous mixing has a
   real-valued cross-spectrum and contributes nothing to the imaginary part. Any dwPLI that
   survives is either a genuine lag (the slow oscillation travels anterior-posterior at
   so_travel_v) or spurious connectivity from source leakage, which no bivariate index escapes.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
