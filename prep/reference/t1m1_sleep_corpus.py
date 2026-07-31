"""P17: should the sleep rows move? Twenty scored nights, per-subject, with a criterion set first.

Four of six arousal states were validated against nothing. One night of HMC (Finding 22's
follow-up) gave a first look and was explicitly not acted on: 23 N3 epochs is under twelve minutes
of N3, and one night is a subject rather than a distribution. This is twenty.

THE CRITERION IS FIXED BEFORE THE NUMBERS ARE SEEN, because "does this disagree enough to act on"
is exactly the question a person answers differently after looking:

    MOVE  if the registry's provisional value falls OUTSIDE the interquartile range across
          subjects, and at least `MIN_EPOCHS` epochs contributed in at least `MIN_SUBJECTS`
          subjects.
    HOLD  otherwise -- including when the corpus is too thin to say, which is a different thing
          from agreement and is printed as such.

PER SUBJECT, THEN MEDIAN AND IQR. Pooling twenty nights into one spectrum would give a tight-looking
number with no spread attached, and the spread is the entire reason for going from one night to
twenty. Each subject is fitted alone; the distribution across subjects is what gets reported.

THE FIT BAND IS REPORTED AT TWO WIDTHS, deliberately. P13's whole lesson is that a band-limited
exponent is a joint function of the band, and this corpus has an acquisition low-pass above ~35 Hz
(measured, section 1). A row that moves at one band and not the other is not a fact about sleep.

WHAT THIS CANNOT ANCHOR: effective rank, PC1, near/far correlation. Four derivations cannot
constrain a 19-channel covariance. HMC is also a clinical referral population rather than healthy
sleepers, which belongs beside every number taken from it.
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

STAGE_MAP = {
    'Sleep stage W': 'wake', 'Sleep stage N1': 'n1', 'Sleep stage N2': 'n2',
    'Sleep stage N3': 'n3', 'Sleep stage R': 'rem',
}
#: HMC stage -> the registry row it would inform. `wake` maps to wake_ec because the eyes-closed
#: row is the one EEGMAT already anchors; the eyes-open row has no counterpart in scored sleep.
REG_STATES = {'wake': 'wake_ec', 'n1': 'n1', 'n2': 'n2', 'n3': 'n3', 'rem': 'rem'}

#: Decided before looking. A stage needs this many 30 s epochs in a subject to be fitted at all...
MIN_EPOCHS = 20
#: ...and this many subjects contributing before any row is allowed to move.
MIN_SUBJECTS = 8
BANDS = ((1.0, 30.0), (1.0, 40.0))


def inband_slope(chi, knee_freq, lo, hi, n=200):
    if not (np.isfinite(chi) and np.isfinite(knee_freq)) or knee_freq <= 0:
        return float('nan')
    f = np.logspace(np.log10(lo), np.log10(hi), n)
    return float(-np.polyfit(np.log10(f), -np.log10(knee_freq ** chi + f ** chi), 1)[0])


def fit_one(fr, psd, band):
    """Returns (chi, knee_freq). knee_freq is NaN when the fitted knee is not physical.

    A NEGATIVE knee parameter is common here and is not a numerical hiccup: k < 0 in
    L = b - log10(k + f^chi) makes knee_freq = k^(1/chi) complex, and means the model found no
    knee in this band at all. Sampled on waking HMC epochs, every subject returned k between
    -0.90 and -1.00 -- the waking spectrum over 1-30 Hz is a power law, with nothing for a knee
    term to fit. Discarding those as NaN is right; reporting a median over the handful that
    survive as though it were the corpus is not, which is why the caller now prints the knee
    count separately."""
    from specparam import SpectralModel
    sm = SpectralModel(aperiodic_mode='knee', verbose=False)
    try:
        sm.fit(fr, psd, list(band))
        ap = sm.get_params('aperiodic')
    except Exception:
        return float('nan'), float('nan')
    chi, knee = float(ap[-1]), float(ap[1])
    kf = float(knee ** (1.0 / chi)) if knee > 0 and chi > 0 else float('nan')
    return chi, kf


def main() -> int:
    import mne
    mne.set_log_level('ERROR')
    from prep import registry as R

    recs = sorted(p for p in HMC.glob('SN*.edf') if 'sleepscoring' not in p.name)
    recs = [r for r in recs if r.with_name(r.stem + '_sleepscoring.edf').exists()]
    if not recs:
        print(f'no scored HMC recordings under {HMC}')
        return 1

    # per band -> per stage -> list of (chi, knee) one entry per subject
    acc = {b: {s: [] for s in REG_STATES} for b in BANDS}
    epoch_counts = {s: [] for s in REG_STATES}
    pooled_psd, pooled_fr, fs, n_eeg = None, None, None, 0

    for rec in recs:
        raw = mne.io.read_raw_edf(rec, preload=True, verbose='ERROR')
        eeg = [c for c in raw.ch_names if c.upper().startswith('EEG')]
        if not eeg:
            continue
        raw.pick(eeg)
        n_eeg = len(eeg)
        fs = float(raw.info['sfreq'])
        ann = mne.read_annotations(rec.with_name(rec.stem + '_sleepscoring.edf'))
        x = raw.get_data()
        by_stage: dict[str, list[np.ndarray]] = {}
        for onset, dur, desc in zip(ann.onset, ann.duration, ann.description):
            st = STAGE_MAP.get(desc)
            if st is None:
                continue
            a, b = int(onset * fs), int((onset + max(dur, 30.0)) * fs)
            if b <= x.shape[1]:
                by_stage.setdefault(st, []).append(x[:, a:b])
        for st, segs in by_stage.items():
            epoch_counts[st].append(len(segs))
            if len(segs) < MIN_EPOCHS:
                continue
            seg = np.concatenate(segs, axis=1)
            fr, pw = sps.welch(seg, fs, nperseg=int(4 * fs), noverlap=int(2 * fs), axis=-1)
            psd = pw.mean(axis=0)
            if pooled_psd is None:
                pooled_psd, pooled_fr = psd.copy(), fr
            for band in BANDS:
                acc[band][st].append(fit_one(fr, psd, band))
        counts = ', '.join(f'{k} {len(v)}' for k, v in sorted(by_stage.items()))
        print(f'  {rec.stem}: {counts}')
        del raw, x, by_stage

    if fs is None or pooled_psd is None:
        print('no usable recordings: no EEG channels, or no stage reached MIN_EPOCHS')
        return 1
    print(f'\n{len(recs)} scored nights, {n_eeg} EEG derivations @ {fs:g} Hz.\n')

    # --- 1. usable band ------------------------------------------------------------------------
    print('1. USABLE BAND (first subject, all stages pooled). Local log-log slope:')
    row = []
    for lo, hi in ((1, 4), (4, 8), (8, 15), (15, 25), (25, 35), (35, 45), (45, 60)):
        if hi > fs / 2:
            continue
        m = (pooled_fr >= lo) & (pooled_fr <= hi) & (pooled_psd > 0)
        if m.sum() >= 4:
            s = -np.polyfit(np.log10(pooled_fr[m]), np.log10(pooled_psd[m]), 1)[0]
            row.append(f'{lo}-{hi}: {s:.2f}')
    print('   ' + ' | '.join(row))
    print('   Steepening that does not recover is an acquisition low-pass, not cortex.\n')

    # --- 2. the decision -----------------------------------------------------------------------
    for band in BANDS:
        print(f'2. PER-SUBJECT FITS over {band[0]:g}-{band[1]:g} Hz. '
              f'MOVE if the registry value falls outside the IQR.\n')
        hdr = f'   {"stage":<6}{"n":>4}{"epochs":>8}   ' + f'{"chi median [IQR]":<26}'
        hdr += f'{"kn":>3} {"knee median [IQR]":<22}{"registry":>9}  verdict'
        print(hdr)
        for st in ('wake', 'n1', 'n2', 'n3', 'rem'):
            vals = [v for v in acc[band][st] if np.isfinite(v[0])]
            n = len(vals)
            med_ep = int(np.median(epoch_counts[st])) if epoch_counts[st] else 0
            key = REG_STATES[st]
            rc = R.provisional_value(f'chi_{key}')
            if n == 0:
                print(f'   {st:<6}{n:>4}{med_ep:>8}   {"--":<26}{"--":<24}{rc:9.2f}  '
                      f'HOLD (no fit converged)')
                continue
            chis = np.array([v[0] for v in vals])
            knees = np.array([v[1] for v in vals if np.isfinite(v[1])])
            q1, q3 = np.percentile(chis, [25, 75])
            kq = np.percentile(knees, [25, 50, 75]) if knees.size else [np.nan] * 3
            inside = q1 <= rc <= q3
            enough = n >= MIN_SUBJECTS
            verdict = ('HOLD (thin: %d < %d subjects)' % (n, MIN_SUBJECTS) if not enough
                       else 'HOLD (inside IQR)' if inside else 'MOVE')
            chi_s = f'{np.median(chis):.2f} [{q1:.2f}-{q3:.2f}]'
            # THE KNEE COUNT IS PRINTED BESIDE THE KNEE. Subjects whose fit returned an
            # unphysical (negative) knee are dropped, and without this column a median over the
            # one or two survivors reads as a tight corpus-wide agreement. It did exactly that in
            # the first run: wake showed "3.45 [3.45-3.45]", which was a single subject.
            knee_s = (f'{kq[1]:.2f} [{kq[0]:.2f}-{kq[2]:.2f}]' if knees.size >= MIN_SUBJECTS
                      else f'unusable (n={knees.size})' if knees.size
                      else 'no knee in band')
            print(f'   {st:<6}{n:>4}{med_ep:>8}   {chi_s:<26}{knees.size:>3} {knee_s:<22}'
                  f'{rc:9.2f}  {verdict}')
        print()

    print("""   READ THE TWO BANDS TOGETHER. A row that moves at one width and not the other is a fact
   about the fit band, not about sleep -- which is P13's lesson applied to its own follow-up.

   NOT ANCHORED HERE: effective rank, PC1, near/far correlation. Four derivations cannot
   constrain a 19-channel covariance, and this is a clinical referral population.""")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
