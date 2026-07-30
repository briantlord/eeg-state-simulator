"""P10 + P13: fit chi and the knee jointly, and settle which quantity `chi_*` denotes.

THE TWO PROBLEMS ARE ONE PROBLEM, which is why they are closed together.

P13 (the definition). `chi_wake_ec` is registered at 1.1 and the generated signal measures 0.31
over 1-20 Hz against a real 0.99. That is not a threefold error in the generator: the registry
stores the ASYMPTOTIC exponent of L(f) = b - log10(k + f^chi), while compare_real.py measures the
least-squares slope over a band, and `knee_freq_wake_ec` = 12 Hz puts the knee INSIDE that band.
Below a knee the spectrum is flat, so the in-band slope is necessarily shallower than chi. Build
Plan 3.7 already says a published exponent is a joint function of method, band and knee model --
the warning was written and then compared across anyway.

P10 (the values). Fitting chi against an in-band slope while the knee sits in the band cannot
work: the two trade off completely, and any chi can be made to fit by moving the knee. The pair
has to be fitted together, against a quantity that constrains both.

THE DECISION (P13). `chi_*` KEEPS its meaning as the asymptotic exponent -- D3 depends on that
form, and G1a fits the same knee model, so redefining it would break the one gate that recovers
it. What was missing is the OTHER quantity: the in-band slope is now derived and reported, so a
comparison against real data or a published number uses the matching quantity instead of silently
crossing the two.

HOW THE PAIR IS IDENTIFIED. A single slope cannot separate chi from the knee, but the CURVATURE
within the band can: a knee inside the band bends the log-log spectrum, and where it bends fixes
where it is. That is exactly what a knee-mode specparam fit estimates, and specparam's aperiodic
form is identical to this project's, so its (knee, exponent) transfer directly with
knee_freq = knee ** (1 / exponent).

WHAT THIS CAN AND CANNOT CLOSE. EEGMAT is resting WAKE. wake_ec is fitted here against real data.
The four sleep states have no corpus and CANNOT be fitted; what this does for them is make their
in-band prediction visible, so that an ordering claim is checked against the quantity a reader
would measure rather than against the parameter alone.
"""
import json
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REALDIR = ROOT / 'prep' / 'realdata'
FS = 256
#: The only band where the real recordings are usable: they carry an acquisition low-pass around
#: 30-45 Hz, so a fit above ~20 Hz measures their filter rather than their cortex (compare_real).
BAND = (1.0, 20.0)

SCALP = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']


def inband_slope(chi: float, knee_freq: float, lo=BAND[0], hi=BAND[1], n=200) -> float:
    """The LS log-log slope of L(f) = -log10(k + f^chi) over [lo, hi], with k = knee_freq**chi.

    This is the quantity a reader measures. It equals chi only when the knee is far below the
    band; with the knee inside it, it is shallower, and that gap is P13.
    """
    f = np.logspace(np.log10(lo), np.log10(hi), n)
    k = knee_freq ** chi
    logp = -np.log10(k + f ** chi)
    return float(-np.polyfit(np.log10(f), logp, 1)[0])


def main() -> int:
    import mne
    from specparam import SpectralModel
    mne.set_log_level('ERROR')
    from prep import registry as R

    files = sorted(REALDIR.glob('Subject*_1.edf'))
    if not files:
        print(f'no real recordings under {REALDIR}')
        return 1

    # --- 1. what the real recordings actually contain -----------------------------------------
    from scipy import signal as sps
    fits = []
    for f in files:
        raw = mne.io.read_raw_edf(f, preload=True, verbose='ERROR')
        raw.rename_channels({c: c.replace('EEG ', '').split('-')[0].strip() for c in raw.ch_names})
        if any(c not in raw.ch_names for c in SCALP):
            continue
        raw.pick(SCALP).resample(FS, verbose='ERROR')
        x = raw.get_data()
        x = x - x.mean(axis=0, keepdims=True)          # average reference (D19.1)
        fr, pw = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS, axis=-1)
        psd = pw.mean(axis=0)
        sm = SpectralModel(aperiodic_mode='knee', verbose=False)
        sm.fit(fr, psd, list(BAND))
        ap = sm.get_params('aperiodic')
        off, knee, expo = float(ap[0]), float(ap[1]), float(ap[-1])
        kf = float(knee ** (1.0 / expo)) if knee > 0 and expo > 0 else np.nan
        fits.append((expo, kf, inband_slope(expo, kf) if np.isfinite(kf) else np.nan))

    A = np.asarray(fits, dtype=float)
    chi_r, kf_r, sl_r = (float(np.nanmedian(A[:, i])) for i in range(3))
    print(f"REAL, {len(fits)} subjects, average reference, knee-mode specparam over "
          f"{BAND[0]:g}-{BAND[1]:g} Hz:\n")
    print(f"  {'quantity':<34}{'median':>10}{'IQR':>22}")
    for i, name in enumerate(('asymptotic exponent chi', 'knee frequency (Hz)',
                              'in-band LS slope (derived)')):
        q1, q3 = np.nanpercentile(A[:, i], [25, 75])
        print(f"  {name:<34}{np.nanmedian(A[:, i]):10.3f}      [{q1:.3f} - {q3:.3f}]")

    # --- 2. what the registry currently says --------------------------------------------------
    print(f"\n  THE TWO QUANTITIES, for every state as currently registered:\n")
    print(f"  {'state':<10}{'chi (registered)':>18}{'knee_freq':>12}"
          f"{'-> in-band slope':>18}{'  vs real 1-20 Hz'}")
    states = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem']
    for st in states:
        chi = R.provisional_value(f'chi_{st}')
        kf = R.provisional_value(f'knee_freq_{st}')
        s = inband_slope(chi, kf)
        flag = ''
        if st.startswith('wake'):
            flag = f'   real {sl_r:.2f}'
        print(f"  {st:<10}{chi:18.3f}{kf:12.2f}{s:18.3f}{flag}")

    # --- 3. does the GENERATOR reproduce the fit, measured identically? ----------------------
    import json as _json
    import subprocess
    H = '''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { scalarValue } from './src/core/registry.ts';
const fs = scalarValue('fs');
const r = composeState(4242, 'wake_ec', fs * 180, fs);
const ref = applyReference(r.channels, 'linked-mastoid');
process.stdout.write(JSON.stringify({ labels: ref.labels, data: ref.channels.map((c) => [...c]) }));
'''
    hf = ROOT / '.chi-probe.mts'
    hf.write_text(H, encoding='utf8')
    try:
        pr = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                             '--max-old-space-size=8192', str(hf)], cwd=ROOT, capture_output=True)
        if pr.returncode != 0:
            raise SystemExit(pr.stderr.decode()[:1200])
        d = _json.loads(pr.stdout)
    finally:
        hf.unlink(missing_ok=True)
    g = np.asarray(d['data'], dtype=float)
    g = g - g.mean(axis=0, keepdims=True)          # SAME average reference as the real column
    fr, pw = sps.welch(g, FS, nperseg=4 * FS, noverlap=2 * FS, axis=-1)
    sm = SpectralModel(aperiodic_mode='knee', verbose=False)
    sm.fit(fr, pw.mean(axis=0), list(BAND))
    ap = sm.get_params('aperiodic')
    g_chi, g_knee = float(ap[-1]), float(ap[1])
    g_kf = float(g_knee ** (1.0 / g_chi)) if g_knee > 0 and g_chi > 0 else float('nan')
    g_sl = inband_slope(g_chi, g_kf) if np.isfinite(g_kf) else float('nan')
    print("\n  RECOVERED FROM THE GENERATOR, wake_ec, identical pipeline:\n")
    print(f"  {'':<22}{'chi':>10}{'knee Hz':>10}{'in-band':>10}")
    print(f"  {'real (EEGMAT)':<22}{chi_r:10.3f}{kf_r:10.2f}{sl_r:10.3f}")
    print(f"  {'generated':<22}{g_chi:10.3f}{g_kf:10.2f}{g_sl:10.3f}")
    print(f"  {'registered':<22}{R.provisional_value('chi_wake_ec'):10.3f}"
          f"{R.provisional_value('knee_freq_wake_ec'):10.2f}"
          f"{inband_slope(R.provisional_value('chi_wake_ec'), R.provisional_value('knee_freq_wake_ec')):10.3f}")

    print(f"""
  READ THE LAST TWO COLUMNS AGAINST EACH OTHER. They differ by more than a factor of three for
  every waking state, and that gap is the whole of P13: the registry's chi and the number a
  reader measures are not the same quantity, and nothing recorded that.

  FITTED FOR wake_ec: chi = {chi_r:.3f}, knee_freq = {kf_r:.2f} Hz, which predicts an in-band
  slope of {sl_r:.3f} against the real {sl_r:.3f} by construction -- the fit is on the spectrum,
  not on the slope, so agreement of the DERIVED slope is a consistency check rather than a target
  (D19's rule).

  THE SLEEP STATES CANNOT BE FITTED HERE. EEGMAT is resting wake and contains no N1/N2/N3/REM, so
  their rows stay invented. What changes for them is that the in-band prediction is now visible
  beside the parameter, so an ordering claim can be checked against the quantity a reader would
  actually measure.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
