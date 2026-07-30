"""Is the ECG a plausible ECG, and does respiratory sinus arrhythmia actually appear?

A displayable prefix of T1-M5. The risk register's mitigation for rebuilding solved generators is
"transcribe, cite, validate against the originals" -- the form is transcribed from McSharry et al.
(2003) and cited in `ecg_wave_shape`, and THE THIRD STEP IS NOT DONE. This is not that validation.
It checks the properties that would make the trace obviously wrong to anyone who has seen an ECG,
which is a different and weaker claim, and it is the one worth making before putting the channel
on screen.

RSA IS THE PART THAT MATTERS BEYOND COSMETICS. It is why respiration and ECG share a screen: the
instantaneous heart rate should track respiratory phase. If it does not, the two lanes are just
two unrelated rhythms drawn near each other.
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
const n = fs * 300;
const r = composeState(4242, 'n3', n, fs, {});
process.stdout.write(JSON.stringify({
  fs,
  ecg: [...r.ecg],
  rPeaks: r.rPeaks,
  phase: [...r.respirationPhase],
  meanHr: r.truth.meanHrBpm,
  respFreq: r.truth.respFreqHz,
  hrMeanRow: provisionalValue('hr_mean'),
  rAmpRow: provisionalValue('ecg_r_amp'),
  rsaRow: provisionalValue('rsa_depth'),
}));
'''
f = ROOT / '.cardiac.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(['node', '--experimental-strip-types', '--no-warnings',
                    '--max-old-space-size=4096', str(f)], cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:2500])
d = json.loads(p.stdout)

fs = d['fs']
ecg = np.asarray(d['ecg'], dtype=float)
rp = np.asarray(d['rPeaks'], dtype=float)
phase = np.asarray(d['phase'], dtype=float)

print(f"ECG, N3, {len(ecg)/fs:.0f} s, {len(rp)} beats\n")

# --- 1. rate and amplitude -----------------------------------------------------
rr = np.diff(rp)
inst_hr = 60.0 / rr
print("1. RATE AND AMPLITUDE\n")
print(f"   mean heart rate      {d['meanHr']:.1f} /min   (hr_mean row {d['hrMeanRow']})")
print(f"   RR interval          {rr.mean():.3f} +- {rr.std():.3f} s")
print(f"   R-wave peak          {ecg.max():.0f} uV   (ecg_r_amp row {d['rAmpRow']})")
print(f"   most negative        {ecg.min():.0f} uV   (the Q/S troughs)")

# --- 2. morphology: is there a PQRST at all? -----------------------------------
# Average the ECG time-locked to the R peaks. A real complex shows P before, Q/S either side of
# R, and a broad T after.
win = int(0.45 * fs)
pre = int(0.25 * fs)
segs = [ecg[i - pre:i + win] for i in (np.round(rp * fs).astype(int))
        if i - pre >= 0 and i + win < len(ecg)]
avg = np.mean(segs, axis=0)
t = (np.arange(len(avg)) - pre) / fs


def extremum(lo, hi, sign):
    m = (t >= lo) & (t <= hi)
    idx = np.argmax(sign * avg[m])
    return float(t[m][idx]), float(avg[m][idx])


print(f"\n2. BEAT-AVERAGED MORPHOLOGY over {len(segs)} beats\n")
print(f"   {'wave':>6} {'expected window':>18} {'found at':>10} {'amplitude uV':>13}")
print("   " + "-" * 54)
found = {}
for name, lo, hi, sign in (('P', -0.25, -0.08, +1), ('Q', -0.06, -0.005, -1),
                           ('R', -0.005, 0.005, +1), ('S', 0.005, 0.06, -1),
                           ('T', 0.12, 0.40, +1)):
    tt, aa = extremum(lo, hi, sign)
    found[name] = (tt, aa)
    print(f"   {name:>6} {f'{lo:+.3f}..{hi:+.3f}':>18} {tt:+10.3f} {aa:13.1f}")

ok_order = found['P'][0] < found['Q'][0] < found['R'][0] < found['S'][0] < found['T'][0]
ok_signs = (found['P'][1] > 0 and found['Q'][1] < 0 and found['R'][1] > 0
            and found['S'][1] < 0 and found['T'][1] > 0)
ok_r = found['R'][1] > 3 * abs(found['S'][1])
print(f"\n   ordering P<Q<R<S<T: {'ok' if ok_order else 'WRONG'}   "
      f"signs +-+-+: {'ok' if ok_signs else 'WRONG'}   "
      f"R dominant: {'ok' if ok_r else 'WRONG'}")

# --- 3. respiratory sinus arrhythmia -------------------------------------------
# Instantaneous rate against the respiratory phase at each beat.
beat_phase = phase[np.clip(np.round(rp[:-1] * fs).astype(int), 0, len(phase) - 1)]

# THE MEAN IS REMOVED FIRST, and the first version of this did not do it. Projecting the raw
# instantaneous rate onto a phase leaves the DC term -- 61.7 /min -- dominating everything, so
# both the statistic and its null came out at ~0.18 regardless of any modulation. The quantity
# wanted is the AC component: how much the rate SWINGS with respiratory phase.
hr_ac = inst_hr - inst_hr.mean()
amp = 2 * np.hypot((hr_ac * np.cos(beat_phase)).mean(),
                   (hr_ac * np.sin(beat_phase)).mean()) / inst_hr.mean()
rng = np.random.default_rng(0)
null = [2 * np.hypot((hr_ac * np.cos(ph)).mean(), (hr_ac * np.sin(ph)).mean()) / inst_hr.mean()
        for ph in (rng.uniform(0, 2 * np.pi, len(beat_phase)) for _ in range(200))]
p95 = float(np.percentile(null, 95))

print(f"\n3. RESPIRATORY SINUS ARRHYTHMIA (respiration at {d['respFreq']:.2f} Hz)\n")
print(f"   rate modulation locked to respiratory phase  {amp:.4f}  "
      f"(rsa_depth row {d['rsaRow']})")
print(f"   95th percentile of a phase-shuffled null     {p95:.4f}")
print(f"   -> RSA present: {'YES' if amp > p95 else 'NO'}")

print(f"""
  What this does and does not establish. The morphology check confirms a PQRST complex in the
  right order with the right signs and an R wave that dominates -- i.e. it will not look absurd
  beside a real trace. It does NOT validate the wave amplitudes or widths against
  neurokit2.ecg_simulate or a real recording, which is the third step of the risk register's
  mitigation and remains TODO(T1-M5).

  The RSA check is the one that matters for the display: it is why respiration and ECG belong on
  the same screen rather than being two rhythms drawn near each other.""")
