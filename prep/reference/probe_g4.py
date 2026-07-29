"""What pass criterion can G4 actually carry?

D12 left G4 with none. D4's circular-shift null is degenerate (shifting a clean periodic phase
leaves a magnitude estimator invariant -- measured, zero IQR) and D8's spectral-neighbourhood
replacement is not implementable at its registered parameters: at 300 s and f1 = 0.10 Hz the
neighbourhood runs below DC, and 39% of the surviving bins sit in the drift band of the
sliding-window chi-hat estimator where the local spectrum is not flat.

D12 listed four options and refused to pick one without measurement. This probe measures the
three things that decide it:

  1. IS the chi-hat spectrum locally flat near f1 and f2? A neighbourhood null lives or dies
     on this, and D12's objection to it is empirical, not structural.

  2. Do MATCHED NULLS separate? The alternative to a neighbourhood null: toggle exactly the
     mechanism under test and hold everything else, which is the contract every other gate in
     this project already uses. Frequency-matched, so it assumes nothing about flatness.

  3. Is there leakage at f2 AT ALL, now that mechanism (a) exists? Until P11 the negative arm
     was vacuous -- no energy at f2 meant nothing to leak. This is the first run where the
     gate can fail, and a gate that cannot fail is not evidence.

Run configurations, all at N3, 300 s, Fz, linked mastoid, unfiltered (mechanism (a) at full
amplitude is the maximal-leakage condition, which is where a leakage gate belongs):

  FULL   chi modulated at f1 by an INDEPENDENT modulator; respiration at f2; all three
         respiratory mechanisms on.
  NULL1  identical, chi_mod_depth = 0. Nothing injected at f1.
  NULL2  identical to FULL, movement artifact and amplitude modulation off. Nothing at f2.

NULL2 is the construction the harness spec demands and a depth-zero null cannot supply:
"a depth-zero null cannot catch this, because zeroing the depth also removes the sidebands."
Zeroing chi_mod_depth leaves mechanisms (a) and (c)-amplitude running at f2 at full strength,
so any leakage they cause would appear in the null too and mask itself. Removing the
respiratory mechanisms instead removes the cause, not the symptom.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

N_SEEDS = 40

HARNESS = r'''
import { composeState } from './src/core/generators/compose.ts';
import { applyReference } from './src/analysis/referencing.ts';
import { chiOverTime, modulationDepth } from './src/analysis/coupling.ts';
import { scalarValue } from './src/core/registry.ts';

const fs = scalarValue('fs');
const T = scalarValue('g4_record_length');
const F1 = scalarValue('g4_f1');
const F2 = scalarValue('g4_f2');
const n = Math.round(T * fs);
const nSeeds = Number(process.argv[2]);

// f2 is a RATE, in breaths per minute, because that is the units the generator takes.
const RESP_RATE = F2 * 60;

const BASE = {
  movementArtifact: true, amplitudeModulation: true, chiModulation: true,
  respRatePerMin: RESP_RATE, independentChiModFreq: F1,
};
const CONFIGS = {
  full:  BASE,
  null1: { ...BASE, chiModDepth: 0 },
  null2: { ...BASE, movementArtifact: false, amplitudeModulation: false },
};

/** chi-hat(t) on referenced Fz. No filter: mechanism (a) at full amplitude. */
function chiHat(seed: number, opts: Record<string, unknown>) {
  const r = composeState(seed, 'n3', n, fs, opts);
  const ref = applyReference(r.channels, 'linked-mastoid');
  const fz = ref.channels[ref.labels.indexOf('Fz')]!;
  return chiOverTime(fz, fs);
}

const out: Record<string, { f1: number[]; f2: number[] }> = {};
for (const key of Object.keys(CONFIGS)) out[key] = { f1: [], f2: [] };

for (let s = 0; s < nSeeds; s++) {
  const seed = 90000 + s * 101;
  for (const [key, opts] of Object.entries(CONFIGS)) {
    const { chi, fsEst } = chiHat(seed, opts);
    out[key]!.f1.push(modulationDepth(chi, fsEst, F1));
    out[key]!.f2.push(modulationDepth(chi, fsEst, F2));
  }
}

// The spectrum of chi-hat over the whole low-frequency range, one seed, for the flatness
// question. 1/T resolution, so the bin index is round(f * T) regardless of the hop rate.
const { chi, fsEst } = chiHat(90000, CONFIGS.full);
const spectrum: [number, number][] = [];
for (let bin = 1; bin <= 200; bin++) {
  const f = bin / T;
  spectrum.push([f, modulationDepth(chi, fsEst, f)]);
}

process.stdout.write(JSON.stringify({
  fs, T, F1, F2, respRate: RESP_RATE, nChi: chi.length, fsEst, out, spectrum,
}));
'''

f = ROOT / '.g4-probe.mts'
f.write_text(HARNESS, encoding='utf8')
p = subprocess.run(
    ['node', '--experimental-strip-types', '--no-warnings', str(f), str(N_SEEDS)],
    cwd=ROOT, capture_output=True)
f.unlink(missing_ok=True)
if p.returncode != 0:
    raise SystemExit(p.stderr.decode()[:3000])

d = json.loads(p.stdout)
T, F1, F2 = d['T'], d['F1'], d['F2']
spec = np.array(d['spectrum'])
freqs, amps = spec[:, 0], spec[:, 1]

print(f"G4 fixture: chi modulated at f1 = {F1} Hz, respiration at f2 = {F2} Hz "
      f"({d['respRate']:.0f}/min)")
print(f"  {T:.0f} s record, chi-hat has {d['nChi']} samples at {d['fsEst']} Hz, "
      f"1/T = {1/T:.5f} Hz")
print(f"  f1 -> bin {round(F1*T):.0f}, f2 -> bin {round(F2*T):.0f}, "
      f"sidebands f2+-f1 -> bins {round((F2-F1)*T):.0f} and {round((F2+F1)*T):.0f}\n")

# ------------------------------------------------------------------ 1. flatness
print("1. IS THE chi-hat SPECTRUM LOCALLY FLAT? (D12's objection to the neighbourhood null)\n")
print(f"  {'band (Hz)':>16} {'bins':>6} {'median':>10} {'IQR/median':>11} {'p95/median':>11}")
print("  " + "-" * 60)
for lo, hi in [(0.005, 0.05), (0.05, 0.10), (0.10, 0.20), (0.20, 0.35), (0.35, 0.67)]:
    m = (freqs >= lo) & (freqs < hi)
    # Excise the injected lines and the sidebands so this describes the FLOOR.
    for line in (F1, F2, F2 - F1, F2 + F1):
        m &= np.abs(freqs - line) > 10 / T
    v = amps[m]
    if len(v) < 4:
        continue
    med = np.median(v)
    iqr = np.percentile(v, 75) - np.percentile(v, 25)
    print(f"  {lo:6.3f}-{hi:6.3f} {len(v):6d} {med:10.5f} {iqr/med:11.2f} "
          f"{np.percentile(v, 95)/med:11.2f}")

lo_band = amps[(freqs < 0.05)]
hi_band = amps[(freqs >= 0.10) & (freqs < 0.35)]
ratio = np.median(lo_band) / np.median(hi_band)
print(f"\n  Drift band (<0.05 Hz) sits {ratio:.1f}x the floor at 0.10-0.35 Hz.")
print(f"  {'A neighbourhood null spanning both is measuring two different floors.' if ratio > 1.5 else 'Comparable: the drift objection does not bite at these parameters.'}")

# ------------------------------------------------------- 2. do matched nulls separate?
print("\n2. DO MATCHED NULLS SEPARATE?\n")
o = {k: {kk: np.array(vv) for kk, vv in v.items()} for k, v in d['out'].items()}


def line(label, v):
    print(f"  {label:34s} {np.median(v):9.5f} {np.percentile(v,5):9.5f} "
          f"{np.percentile(v,95):9.5f}")


print(f"  {'':34s} {'median':>9} {'p5':>9} {'p95':>9}")
print("  " + "-" * 64)
line("f1 arm  observed  (FULL @ f1)", o['full']['f1'])
line("f1 arm  null      (NULL1 @ f1)", o['null1']['f1'])
print()
line("f2 arm  observed  (FULL @ f2)", o['full']['f2'])
line("f2 arm  null      (NULL2 @ f2)", o['null2']['f2'])

p95_null1 = np.percentile(o['null1']['f1'], 95)
p95_null2 = np.percentile(o['null2']['f2'], 95)
f1_pass = o['full']['f1'] > p95_null1
f2_exceed = o['full']['f2'] > p95_null2

print(f"\n  f1 arm: {f1_pass.sum()}/{N_SEEDS} seeds exceed the null p95 ({p95_null1:.5f}).")
print(f"          separation = median(obs)/p95(null) = "
      f"{np.median(o['full']['f1'])/p95_null1:.2f}x")
print(f"  f2 arm: {f2_exceed.sum()}/{N_SEEDS} seeds exceed the null p95 ({p95_null2:.5f}).")
print(f"          ratio = median(obs)/p95(null) = "
      f"{np.median(o['full']['f2'])/p95_null2:.2f}x")

# ---------------------------------------------------------------- 3. is there leakage?
print("\n3. IS THERE LEAKAGE AT f2, NOW THAT MECHANISM (a) EXISTS?\n")
rate = f2_exceed.mean()
print(f"  Per-seed exceedance rate at f2: {rate:.3f}")
print(f"  Expected under no leakage:      0.050  (the null's own percentile)")
if rate > 0.2:
    print("\n  LEAKAGE PRESENT. Respiration at f2 is reaching the chi-hat estimate. This is")
    print("  exactly the failure mode G4 exists to catch, and the gate would FAIL -- which")
    print("  is the first time it has been able to say anything at all.")
elif rate <= 0.10:
    print("\n  No leakage detectable at this record length. The f2 arm is a real check that")
    print("  the generator passes, not a vacuous one: mechanism (a) puts substantial energy")
    print("  at f2 and it is not reaching chi-hat.")
else:
    print("\n  Marginal. Needs more seeds before a criterion is set on it.")

# The magnitude of what is at f2 in the signal, for scale.
print(f"\n  For scale: at f2 the FULL config reads {np.median(o['full']['f2']):.5f} against")
print(f"  {np.median(o['full']['f1']):.5f} at f1, a "
      f"{np.median(o['full']['f1'])/max(np.median(o['full']['f2']),1e-9):.1f}x ratio.")
