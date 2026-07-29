import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import signal as sps
from prep.epochio import generate
from prep import registry as R

FS = int(R.scalar_value('fs'))
STATES = ['wake_eo', 'wake_ec', 'n1', 'n2', 'n3', 'rem']
LABEL = {'wake_eo': 'Wake (eyes open)', 'wake_ec': 'Wake (eyes closed)',
         'n1': 'N1', 'n2': 'N2', 'n3': 'N3', 'rem': 'REM'}

fig, axes = plt.subplots(len(STATES), 2, figsize=(13, 12),
                         gridspec_kw={'width_ratios': [2.2, 1]})
fig.suptitle('EEG State Simulator — generated output, channel Pz\n'
             'a model, not a measurement',
             fontsize=13, y=0.985)

for row, state in enumerate(STATES):
    run = generate(tempfile.mkdtemp(), seed=20260728, state=state, epochs=10)
    sig, ch = run.concatenated()
    truth = run.epoch(0).truth
    x = sig[ch.index('Pz')]

    # --- 10 s trace, paper-polygraph styling: negative up ---
    ax = axes[row, 0]
    t = np.arange(10 * FS) / FS
    ax.plot(t, -x[:10 * FS], lw=0.6, color='#1a1a1a')
    ax.set_ylabel(LABEL[state], fontsize=9, rotation=0, ha='right', va='center')
    ax.set_xlim(0, 10)
    ax.set_ylim(-160, 160)
    ax.set_yticks([-100, 0, 100])
    ax.tick_params(labelsize=7)
    ax.grid(alpha=0.15, lw=0.5)
    if row == 0:
        ax.set_title('10 s trace  (negative up, clinical convention)', fontsize=10)
    if row == len(STATES) - 1:
        ax.set_xlabel('seconds', fontsize=9)
    else:
        ax.set_xticklabels([])

    # --- PSD ---
    ax = axes[row, 1]
    f, p = sps.welch(x, FS, nperseg=4 * FS, noverlap=2 * FS)
    m = (f >= 0.5) & (f <= 60)
    ax.loglog(f[m], p[m], lw=1.0, color='#1a1a1a')
    knee_hz = truth['knee'] ** (1 / truth['chi'])
    ax.axvline(knee_hz, color='#c0392b', lw=1.0, ls='--', alpha=0.8)
    ax.text(0.96, 0.90, f"χ={truth['chi']:.2f}  knee={knee_hz:.0f} Hz",
            transform=ax.transAxes, ha='right', fontsize=7.5, color='#c0392b')
    ax.set_xlim(0.5, 60)
    ax.tick_params(labelsize=7)
    ax.grid(alpha=0.15, which='both', lw=0.5)
    if row == 0:
        ax.set_title('power spectrum  (dashed = injected knee)', fontsize=10)
    if row == len(STATES) - 1:
        ax.set_xlabel('Hz', fontsize=9)

plt.tight_layout(rect=[0.02, 0, 1, 0.965])
out = str(Path(__file__).resolve().parents[2] / 'docs/generated-states.png')
plt.savefig(out, dpi=130)
print('wrote', out)
