"""G3 in embryo: does YASA detect the spindles we injected, at the durations we injected?

Class V -- recovery by an external, independently authored, published tool. Tier 0 records
all-event agreement and sets no pass band; random tags are not event-quality labels.

The duration comparison is the point of running this now rather than later. `spindle_dur_min`
= 0.5 s is a DEFINITIONAL AASM criterion, and a filtered-noise carrier in an 11-16 Hz band has
an intrinsic beat of ~1/B = 0.2 s that fragments a long spindle into short detections. If that
were happening, F1 would look like a morphology failure while being nothing of the kind.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import yasa

from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))
CHANNEL = 'Cz'


def match(injected, detected, min_overlap=0.2):
    """Greedy overlap matching. Returns (tp, fp, fn, matched pairs)."""
    used = set()
    pairs = []
    for i, inj in enumerate(injected):
        best, best_ov = None, 0.0
        for j, det in enumerate(detected):
            if j in used:
                continue
            ov = min(inj[1], det[1]) - max(inj[0], det[0])
            if ov > best_ov:
                best, best_ov = j, ov
        if best is not None and best_ov > min_overlap * (injected[i][1] - injected[i][0]):
            used.add(best)
            pairs.append((i, best))
    tp = len(pairs)
    return tp, len(detected) - tp, len(injected) - tp, pairs


run = generate(tempfile.mkdtemp(), seed=20260728, state='n2', epochs=20)
sig, ch = run.concatenated()
x = sig[ch.index(CHANNEL)]

injected_all = [
    e for e in run.events['events']
    if e['type'].startswith('spindle') and CHANNEL in e['channels']
]
print(f"injected spindles projecting to {CHANNEL}: {len(injected_all)}")

sp = yasa.spindles_detect(x, FS)
if sp is None:
    print("\nYASA detected NOTHING. Either the spindles are too weak, or the amplitude scale "
          "is wrong -- and harness section 7 says to fix the amplitude before touching "
          "morphology.")
    raise SystemExit(0)

det = sp.summary()
detected = list(zip(det['Start'], det['End']))
print(f"YASA detections: {len(detected)}")

print("All-event recovery; arbitrary event tags are not quality scores.")

# --- the duration check, which is why this runs now ------------------------------
inj_all = [(e['onset'], e['onset'] + e['duration']) for e in injected_all]
tp, fp, fn, pairs = match(inj_all, detected)
if pairs:
    inj_d = np.array([inj_all[i][1] - inj_all[i][0] for i, _ in pairs])
    det_d = np.array([detected[j][1] - detected[j][0] for _, j in pairs])
    print("\nDURATION: INJECTED vs DETECTED  (matched pairs)")
    print(f"  pairs                  {len(pairs):6d}")
    print(f"  injected median        {np.median(inj_d):6.2f} s")
    print(f"  detected median        {np.median(det_d):6.2f} s")
    print(f"  ratio detected/injected{np.median(det_d)/np.median(inj_d):6.2f}")
    print(f"  AASM spindle_dur_min   {R.scalar_value('spindle_dur_min'):6.2f} s")
    print(f"  detections below min   {int(np.sum(det_d < R.scalar_value('spindle_dur_min'))):6d}"
          f" of {len(det_d)}")
