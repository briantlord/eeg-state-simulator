import sys
import tempfile

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))

fig = plt.figure(figsize=(13, 9))
gs = fig.add_gridspec(2, 1, height_ratios=[1, 1.15], hspace=0.28)
fig.suptitle('Graphoelements — spindles, K-complexes, and the travelling slow wave',
             fontsize=13)

# ---------------------------------------------------------------- N2, single channel
run2 = generate(tempfile.mkdtemp(), seed=20260728, state='n2', epochs=20)
sig2, ch2 = run2.concatenated()
ev2 = run2.events['events']

# Pick a 20 s window containing both a spindle and a K-complex.
best, best_score = 0, -1
for t0 in range(0, 560, 5):
    w = [e for e in ev2 if t0 <= e['onset'] < t0 + 20]
    score = min(sum(1 for e in w if e['type'].startswith('spindle')), 3) + \
        min(sum(1 for e in w if e['type'] == 'kcomplex'), 3)
    if score > best_score:
        best, best_score = t0, score
T0, T = best, 20

ax = fig.add_subplot(gs[0])
x = sig2[ch2.index('Cz')][T0 * FS:(T0 + T) * FS]
t = np.arange(len(x)) / FS + T0
ax.plot(t, -x, lw=0.7, color='#1a1a1a')
for e in ev2:
    if not (T0 <= e['onset'] < T0 + T):
        continue
    col = '#c0392b' if e['type'].startswith('spindle') else '#2c5aa0'
    ax.axvspan(e['onset'], e['onset'] + e['duration'], color=col, alpha=0.16, lw=0)
    ax.text(e['onset'], 118, e['type'].replace('_', ' '), fontsize=6.5, color=col,
            rotation=90, va='bottom')
ax.set_title('N2 at Cz — red = spindle, blue = K-complex  (negative up)', fontsize=10)
ax.set_ylabel('µV', fontsize=9)
ax.set_xlabel('seconds', fontsize=9)
ax.set_ylim(-130, 165)
ax.set_xlim(T0, T0 + T)
ax.grid(alpha=0.15, lw=0.5)

# ------------------------------------------------- N3, travelling wave across channels
run3 = generate(tempfile.mkdtemp(), seed=20260728, state='n3', epochs=10)
sig3, ch3 = run3.concatenated()
ev3 = [e for e in run3.events['events'] if e['type'] == 'slow_oscillation']

ax = fig.add_subplot(gs[1])
CHAIN = ['Fp1', 'F3', 'C3', 'P3', 'O1']   # front to back
onset = ev3[len(ev3) // 2]['onset'] if ev3 else 5.0
a, b = max(0, onset - 1.0), onset + 2.5
sl = slice(int(a * FS), int(b * FS))
tt = np.arange(sl.stop - sl.start) / FS + a

for i, label in enumerate(CHAIN):
    y = sig3[ch3.index(label)][sl]
    ax.plot(tt, -y - i * 150, lw=0.9, color='#1a1a1a')
    ax.text(a - 0.06, -i * 150, label, fontsize=9, ha='right', va='center')

v = R.scalar_value('so_travel_v_used')
span = R.scalar_value('ap_axis_span')
ax.set_title(f'N3 — one slow oscillation down the anterior–posterior chain.  '
             f'Travel {v:.0f} m/s over {span:.0f} mm = {span/1000/v*1000:.0f} ms front to back',
             fontsize=10)
ax.set_xlabel('seconds', fontsize=9)
ax.set_yticks([])
ax.set_xlim(a, b)
ax.grid(alpha=0.15, lw=0.5, axis='x')

plt.tight_layout(rect=[0.02, 0, 1, 0.96])
out = str(Path(__file__).resolve().parents[2] / 'docs/graphoelements.png')
plt.savefig(out, dpi=130)
print('wrote', out)
