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
LO, HI = R.band_edges('alpha_band')

run = generate(tempfile.mkdtemp(), seed=20260728, state='wake_ec', epochs=2)
sig, ch = run.concatenated()
x = sig[ch.index('Pz')]

b, a = sps.butter(4, [LO / (FS / 2), HI / (FS / 2)], 'bandpass')
band = sps.filtfilt(b, a, x)
env = np.abs(sps.hilbert(band))
win = int(round(FS / (HI - LO)))
env_s = np.convolve(env, np.ones(win) / win, mode='same')

T = 20
t = np.arange(T * FS) / FS
fig, axes = plt.subplots(3, 1, figsize=(13, 7), sharex=True)
fig.suptitle('Does the generated alpha come in bursts?  —  wake (eyes closed), Pz, 20 s',
             fontsize=12)

axes[0].plot(t, -x[:T * FS], lw=0.6, color='#1a1a1a')
axes[0].set_ylabel('raw trace\nµV', fontsize=9)
axes[0].set_ylim(-90, 90)
axes[0].grid(alpha=0.15, lw=0.5)

axes[1].plot(t, band[:T * FS], lw=0.7, color='#2c5aa0')
axes[1].set_ylabel(f'{LO:.0f}–{HI:.0f} Hz\nfiltered  µV', fontsize=9)
axes[1].grid(alpha=0.15, lw=0.5)

axes[2].plot(t, env[:T * FS], lw=0.5, color='#bbbbbb', label='envelope (raw)')
axes[2].plot(t, env_s[:T * FS], lw=1.4, color='#c0392b', label=f'envelope (smoothed {win/FS:.2f} s)')
thr = np.percentile(env_s, 48)
axes[2].axhline(thr, color='#333', ls='--', lw=0.8, label='burst threshold')
axes[2].fill_between(t, 0, env_s[:T * FS].max() * 1.05,
                     where=env_s[:T * FS] > thr, color='#c0392b', alpha=0.10)
axes[2].set_ylabel('alpha\nenvelope  µV', fontsize=9)
axes[2].set_xlabel('seconds', fontsize=10)
axes[2].legend(fontsize=7.5, loc='upper right', framealpha=0.9)
axes[2].grid(alpha=0.15, lw=0.5)
axes[2].set_xlim(0, T)

plt.tight_layout(rect=[0, 0, 1, 0.96])
out = str(Path(__file__).resolve().parents[2] / 'docs/alpha-bursts.png')
plt.savefig(out, dpi=130)
print('wrote', out)
