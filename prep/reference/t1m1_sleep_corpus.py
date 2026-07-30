"""P17, first measurement: an empirical anchor for the sleep states.

Four of six arousal states -- N1, N2, N3, REM -- are validated against NOTHING. Every sleep row in
the registry is invented, and Finding 22 showed the wake rows are barely better off, because
PhysioNet EEGMAT carries an acquisition low-pass around 30-45 Hz that caps the usable fit band at
20 Hz. With a knee near 10 Hz that leaves half a decade to determine an asymptotic exponent from,
and the per-subject spread was 0.373-1.300.

So this probe asks TWO questions of a candidate sleep corpus, in order:

  1. HOW FAR UP IS IT USABLE? Reported before anything is fitted, because a corpus that stops at
     30 Hz cannot pin chi however many nights it contains, and there is no point fitting six
     states against a band that cannot support one. Measured the way compare_real.py measures
     EEGMAT's: local log-log slope in successive bands. An acquisition filter shows up as a slope
     that steepens sharply and then goes flat at an instrument floor.

  2. WHAT ARE chi AND THE KNEE, PER SLEEP STAGE? Knee-mode specparam, the same estimator and the
     same aperiodic form the registry uses, on epochs grouped by the expert hypnogram.

Haaglanden Medisch Centrum sleep staging database (PhysioNet, open): 4 EEG derivations
(F4/M1, C4/M1, O2/M1, C3/M2) at 256 Hz, AASM-scored by technicians.

WHAT IT CANNOT ANCHOR, said in advance. Four derivations cannot constrain effective rank, PC1, or
near/far correlation -- those need a full montage, which among open sleep corpora means MASS-SS3
and an ethics submission. This corpus anchors the SPECTRAL rows, and it is a clinical
referral population rather than healthy sleepers, which belongs beside any number taken from it.
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
warnings.filterwarnings('ignore')

import numpy as np
from scipy import signal as sps

ROOT = Path(__file__).resolve().parents[2]
HMC = ROOT / 'prep' / 'realdata' / 'hmc'

#: AASM labels as HMC writes them -> our StateId vocabulary.
STAGE_MAP = {
    'Sleep stage W': 'wake', 'Sleep stage N1': 'n1', 'Sleep stage N2': 'n2',
    'Sleep stage N3': 'n3', 'Sleep stage R': 'rem',
}
#: Our registry's provisional values, for the column that says what the anchor replaces.
REG_STATES = {'wake': 'wake_ec', 'n1': 'n1', 'n2': 'n2', 'n3': 'n3', 'rem': 'rem'}


def inband_slope(chi, knee_freq, lo, hi, n=200):
    f = np.logspace(np.log10(lo), np.log10(hi), n)
    logp = -np.log10(knee_freq ** chi + f ** chi)
    return float(-np.polyfit(np.log10(f), logp, 1)[0])


def main() -> int:
    import mne
    from specparam import SpectralModel
    mne.set_log_level('ERROR')
    from prep import registry as R

    recs = sorted(HMC.glob('SN*.edf'))
    recs = [r for r in recs if 'sleepscoring' not in r.name]
    if not recs:
        print(f'no HMC recordings under {HMC}')
        return 1

    per_stage: dict[str, list[np.ndarray]] = {}
    fs_out = None
    for rec in recs:
        ann_path = rec.with_name(rec.stem + '_sleepscoring.edf')
        if not ann_path.exists():
            print(f'  {rec.name}: no scoring file, skipped')
            continue
        raw = mne.io.read_raw_edf(rec, preload=True, verbose='ERROR')
        eeg = [c for c in raw.ch_names if c.upper().startswith('EEG')]
        if not eeg:
            print(f'  {rec.name}: no EEG channels ({raw.ch_names[:6]})')
            continue
        raw.pick(eeg)
        fs = float(raw.info['sfreq'])
        fs_out = fs
        ann = mne.read_annotations(ann_path)
        x = raw.get_data()
        for onset, dur, desc in zip(ann.onset, ann.duration, ann.description):
            st = STAGE_MAP.get(desc)
            if st is None:
                continue
            a, b = int(onset * fs), int((onset + max(dur, 30.0)) * fs)
            if b > x.shape[1]:
                continue
            per_stage.setdefault(st, []).append(x[:, a:b])
        print(f'  {rec.name}: {len(eeg)} EEG ch @ {fs:g} Hz, '
              f'{sum(len(v) for v in per_stage.values())} epochs so far')

    if not per_stage or fs_out is None:
        print('no scored epochs found')
        return 1
    fs = fs_out

    # --- 1. how far up is this corpus usable? -------------------------------------------------
    allx = np.concatenate([np.concatenate(v, axis=1) for v in per_stage.values()], axis=1)
    fr, pw = sps.welch(allx, fs, nperseg=int(4 * fs), noverlap=int(2 * fs), axis=-1)
    psd = pw.mean(axis=0)
    print(f'\n1. USABLE BAND. Local log-log slope in successive bands, all stages pooled.')
    print(f'   {"band (Hz)":<14}{"local slope":>13}')
    for lo, hi in ((1, 4), (4, 8), (8, 15), (15, 25), (25, 35), (35, 45), (45, 60), (60, 90)):
        if hi > fs / 2:
            continue
        m = (fr >= lo) & (fr <= hi) & (psd > 0)
        if m.sum() < 4:
            continue
        s = -np.polyfit(np.log10(fr[m]), np.log10(psd[m]), 1)[0]
        print(f'   {f"{lo}-{hi}":<14}{s:13.2f}')
    print("""   An acquisition low-pass reads as a slope that steepens sharply and then flattens at an
   instrument floor. EEGMAT does exactly that: 6.7 over 20-30 Hz, then flat above 80 Hz, which is
   why its usable band stops at 20 Hz and why chi could not be pinned from it.""")

    # --- 2. chi and knee per stage ------------------------------------------------------------
    FIT = (1.0, 40.0) if fs / 2 > 45 else (1.0, 20.0)
    print(f'\n2. PER-STAGE APERIODIC FIT, knee-mode specparam over {FIT[0]:g}-{FIT[1]:g} Hz.\n')
    hdr = f'   {"stage":<7}{"epochs":>8}{"chi":>8}{"knee Hz":>9}{"in-band":>9}'
    print(hdr + '   registry chi / knee -> in-band')
    order = ['wake', 'n1', 'n2', 'n3', 'rem']
    for st in order:
        if st not in per_stage:
            continue
        seg = np.concatenate(per_stage[st], axis=1)
        fr, pw = sps.welch(seg, fs, nperseg=int(4 * fs), noverlap=int(2 * fs), axis=-1)
        sm = SpectralModel(aperiodic_mode='knee', verbose=False)
        sm.fit(fr, pw.mean(axis=0), list(FIT))
        ap = sm.get_params('aperiodic')
        chi, knee = float(ap[-1]), float(ap[1])
        kf = float(knee ** (1.0 / chi)) if knee > 0 and chi > 0 else float('nan')
        sl = inband_slope(chi, kf, *FIT) if np.isfinite(kf) else float('nan')
        key = REG_STATES[st]
        rc = R.provisional_value(f'chi_{key}')
        rk = R.provisional_value(f'knee_freq_{key}')
        rs = inband_slope(rc, rk, *FIT)
        print(f'   {st:<7}{len(per_stage[st]):8d}{chi:8.3f}{kf:9.2f}{sl:9.3f}   '
              f'{rc:.2f} / {rk:.2f} -> {rs:.3f}')

    print(f"""
   THE REGISTRY COLUMN IS INVENTED for every sleep row, so a disagreement here is the anchor
   doing its job rather than a defect. What it cannot tell us is whether the ORDERING survives:
   these are {len(recs)} night(s) of a clinical referral population, and one night is a subject,
   not a distribution.

   NOT ANCHORED BY THIS CORPUS: effective rank, PC1 share, near/far correlation. Four derivations
   cannot constrain a 19-channel covariance. That needs a full-montage sleep corpus.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
