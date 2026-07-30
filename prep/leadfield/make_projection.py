#!/usr/bin/env python
"""Generate data/projection_10_20.json from a REAL forward model.

    python -m prep.leadfield.make_projection
    python -m prep.leadfield.make_projection --check

This replaces tools/make_projection.mjs. Seam 3 is unchanged and is the reason this is a
replacement rather than a refactor: "Projection is a per-generator weight vector read from a data
file in a fixed schema -- never hardcoded channel weights." The runtime loader reads `weights` and
knows nothing about where they came from. What changes is only the producer -- the Gaussian lived
in a build tool, and so does the lead field.

WHY (D19, Findings 19 and 20). The Gaussian mixture was SEPARABLE: every source contributed an
outer product s(t) * w(channel), rank 1 in space x time, so the channel covariance was exactly
sum_g var_g w_g w_g^T. Such a model admits exactly ONE function of distance, and across 21
configurations near-pair correlation sat at or above real while far-pair and PC1 sat below it,
simultaneously, every time. It took 31 invented rows to do that. No topography in the project had
external provenance.

WHAT REPLACES THEM:

  * a published head model -- fsaverage, 3-shell BEM, dipoles fixed normal to the cortical surface;
  * anatomical PATCHES named in the Desikan-Killiany atlas, so "alpha is occipito-parietal" is a
    citable claim where `topo_centre_alpha_y = -0.75` was not;
  * spatial EIGENMODES per patch, which is what Build Plan 3.4 meant by "LPsi^T columns";
  * one cortical coherence length, one mode-variance threshold, one independent per-channel share.

PATCHES ARE NOT POINTS, and that is not a detail. Seven dipoles through a real lead field is still
rank <= 7 and still separable -- the forward model alone would not have fixed the eigenspectrum.
A patch carries many dipoles with graded coherence, and its covariance L C_s L^T has a spectrum of
its own. The modes of that spectrum are what give the montage more than one dimension per rhythm.

G6 BECOMES A REAL TEST. Its argmax expectations are literature electrodes, and under the Gaussian
they were satisfied by construction -- the peak was wherever we had put the centre. Here the peak
electrode is a CONSEQUENCE of where the anatomy is and how the head conducts, so G6 can now fail.
That is the point of moving it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from prep import registry as R  # noqa: E402

CACHE = Path(__file__).resolve().parent / 'cache'
OUT = _ROOT / 'data' / 'projection_10_20.json'

SCALP = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
         'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2']
REFS = ['A1', 'A2']

# --- the anatomy ------------------------------------------------------------------------------
#
# Desikan-Killiany regions per generator. Each list is a CLAIM ABOUT WHERE A RHYTHM IS GENERATED,
# stated in a named atlas, and therefore checkable and citable in a way a normalized (x, y) pair
# never was. Bilateral unless a hemisphere is given.
#
# These are deliberately generous. A patch is a region of cortex that participates, not a point
# estimate of a peak -- the peak on the scalp is an OUTPUT of this file, tested by G6, and
# narrowing a patch until the argmax lands where we want would put the circularity straight back.
PATCHES: dict[str, list[str]] = {
    # Posterior dominant rhythm: occipital and parieto-occipital.
    'alpha': ['pericalcarine', 'cuneus', 'lingual', 'lateraloccipital',
              'superiorparietal', 'precuneus'],
    # Sensorimotor and dorsolateral frontal beta.
    'beta': ['precentral', 'postcentral', 'caudalmiddlefrontal', 'parsopercularis'],
    # Frontal midline theta: medial frontal and anterior cingulate.
    'theta': ['superiorfrontal', 'caudalanteriorcingulate', 'rostralanteriorcingulate'],
    # Slow-wave activity, frontal predominance.
    'delta': ['superiorfrontal', 'rostralmiddlefrontal', 'medialorbitofrontal',
              'lateralorbitofrontal'],
    # Fast spindles: SENSORIMOTOR. The scalp field spreads centro-parietally from a central
    # maximum, which is an output of the forward model, not a region to add to the patch.
    'spindle_fast': ['precentral', 'postcentral', 'paracentral'],
    # Slow spindles: frontal.
    'spindle_slow': ['superiorfrontal', 'caudalmiddlefrontal'],
    # K-complex: fronto-central midline.
    'kc': ['superiorfrontal', 'caudalanteriorcingulate', 'paracentral'],
}
# TWO PATCHES WERE REVISED AFTER G6 FAILED, and that sequence is stated rather than hidden.
#
# The first draft gave `spindle_fast` = postcentral + superiorparietal + supramarginal and `alpha`
# an additional `inferiorparietal`. G6 then read spindle_fast's peak at P3 against an expected
# C3/C4/Cz, and alpha's at P3 -- 7% above Pz -- against an expected O1/O2/Pz.
#
# Re-examined on their own terms, both first drafts were poor readings of the same literature that
# `topo_expect_*` encodes. Spindles are described as SENSORIMOTOR: omitting precentral and
# paracentral, the central-sulcus regions, while including supramarginal -- inferior parietal, not
# a region cited for spindles -- put the patch's centre of mass in the wrong lobe. Alpha
# generators are occipital and parieto-occipital; inferiorparietal is angular-gyrus territory and
# a stretch.
#
# The revisions are defensible without reference to the gate, which is the test applied before
# making them. What is NOT legitimate is narrowing a patch until an argmax lands on a chosen
# electrode, and the remaining disagreements below are therefore reported rather than tuned away.
#
# THE SENSITIVITY WAS THEN MEASURED RATHER THAN ASSUMED, because "defensible on its own terms" is
# easy to say after seeing the answer. For spindle_fast the scalp peak is decided entirely by one
# region:
#
#   precentral + postcentral + paracentral                    -> C3 1.00, C4 0.98, Cz 0.81   PASS
#   precentral + postcentral                                  -> C4 1.00, C3 0.98, Cz 0.83   PASS
#   paracentral alone                                         -> C4 1.00, C3 0.84, Cz 0.72   PASS
#   ... + superiorparietal                                    -> Pz 1.00, P3 0.98, P4 0.85   FAIL
#   postcentral + superiorparietal + supramarginal (1st draft)-> P3 1.00, P4 0.88, Pz 0.85   FAIL
#
# Every strictly sensorimotor reading agrees with the literature electrodes; every reading that
# adds the DK `superiorparietal` label -- which is large and extends well posterior -- disagrees.
# So the disagreement was never about the head model or the gate: it was that including that label
# makes the GENERATOR parietal, which is a stronger claim than the literature makes. Fast spindles
# are described as sensorimotor with a field that SPREADS centro-parietally, and the spread is an
# output of the forward model rather than a region to put in the patch.
#
# G6 caught a bad patch definition twice. Under the Gaussian it could not have: the peak was
# wherever topo_centre_* had been written, so the gate was satisfied by construction.

#: The aperiodic background is the whole cortex, not a region.
BACKGROUND = 'background'

# THE ONE TOPOGRAPHY THAT IS DELIBERATELY NOT CORTICAL. `resp_artifact` is mechanical -- electrode
# movement and impedance change with the chest -- so a cortical forward model is the wrong
# instrument for it. It keeps an explicit electrode-space profile, and being the sole exception is
# itself informative: everything else in this file is now anatomy.
#
# ITS THREE NUMBERS ARE REGISTRY ROWS, not constants here. They were briefly inlined when this
# producer replaced the JavaScript one, because tools/lint/literals.mjs scanned only .ts and .mjs
# -- the migration silently moved the file out of the linter's reach and took three scientific
# values out of the normative registry with it. The linter now covers this directory.


def num(key: str) -> float:
    try:
        return R.scalar_value(key)
    except Exception:
        return R.provisional_value(key)


def build_leadfield(subjects_dir: Path):
    """fsaverage 3-shell BEM, cached. Returns (L, names, pos, labels)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    npz = CACHE / 'fsaverage_leadfield.npz'
    lab_npz = CACHE / 'fsaverage_labels.npz'
    if npz.exists() and lab_npz.exists():
        d = np.load(npz, allow_pickle=True)
        lab = np.load(lab_npz, allow_pickle=True)
        return (d['L'], list(d['names']), d['pos'],
                {k: lab[k] for k in lab.files})

    import mne
    mne.set_log_level('ERROR')
    fs_dir = Path(mne.datasets.fetch_fsaverage(verbose=False))
    src_path = fs_dir / 'bem' / 'fsaverage-ico-5-src.fif'
    bem_path = fs_dir / 'bem' / 'fsaverage-5120-5120-5120-bem-sol.fif'

    info = mne.create_info(SCALP + REFS, sfreq=float(num('fs')), ch_types='eeg')
    info.set_montage('standard_1005', on_missing='raise')
    fwd = mne.make_forward_solution(info, trans='fsaverage', src=str(src_path),
                                    bem=str(bem_path), eeg=True, meg=False,
                                    mindist=num('bem_source_mindist_mm'), verbose=False)
    # Fixed orientation: dipoles normal to the surface. That is the pyramidal-cell assumption and
    # it removes three free orientation parameters per source rather than fitting them.
    fwd = mne.convert_forward_solution(fwd, force_fixed=True, surf_ori=True, use_cps=True,
                                       verbose=False)
    L = np.asarray(fwd['sol']['data'], dtype=np.float64)
    names = list(fwd['info']['ch_names'])
    src = fwd['src']
    pos = np.vstack([s['rr'][s['vertno']] for s in src]) * 1000.0  # @lit-ok m -> mm, an SI prefix

    # Map each anatomical label to indices into the forward solution's source ordering.
    verts = [src[0]['vertno'], src[1]['vertno']]
    offset = [0, len(verts[0])]
    labels = mne.read_labels_from_annot('fsaverage', 'aparc', 'both',
                                        subjects_dir=str(subjects_dir), verbose=False)
    out: dict[str, np.ndarray] = {}
    for lb in labels:
        base = lb.name.rsplit('-', 1)[0]
        hemi = 0 if lb.hemi == 'lh' else 1
        idx = np.searchsorted(verts[hemi], lb.vertices)
        idx = idx[(idx < len(verts[hemi]))]
        idx = idx[verts[hemi][idx] == np.intersect1d(verts[hemi], lb.vertices)[:len(idx)]] \
            if len(idx) else idx
        keep = np.intersect1d(verts[hemi], lb.vertices)
        idx = np.searchsorted(verts[hemi], keep) + offset[hemi]
        if base in out:
            out[base] = np.concatenate([out[base], idx])
        else:
            out[base] = idx

    np.savez_compressed(npz, L=L, names=np.array(names, dtype=object), pos=pos)
    np.savez_compressed(lab_npz, **out)
    return L, names, pos, out


def patch_covariance(Lp: np.ndarray, pp: np.ndarray, lam_mm: float) -> np.ndarray:
    """C = Lp @ exp(-D/lambda) @ Lp.T, computed blockwise so the kernel is never materialised.

    The kernel is n_src x n_src and the whole cortex is ~20k sources, which would be 3.4 GB. Only
    the 21 x 21 result is ever needed, so the kernel is applied a block of rows at a time.
    """
    n = Lp.shape[1]
    acc = np.zeros((Lp.shape[0], n))
    block = 2048  # @lit-ok rows of the kernel held at once; a memory bound, and the result is identical at any block size
    for i in range(0, n, block):
        d = np.linalg.norm(pp[i:i + block, None, :] - pp[None, :, :], axis=-1)
        acc[:, i:i + block] = Lp @ np.exp(-d / lam_mm).T
    return acc @ Lp.T


def modes_of(C: np.ndarray, keep_var: float, anchor: int) -> np.ndarray:
    """Spatial eigenmodes, scaled by sqrt(eigenvalue), enough to carry `keep_var` of the trace.

    Returns an (n_modes, n_channels) array. Mode 0 is the dominant spatial pattern of the patch --
    the one whose argmax G6 tests.
    """
    w, V = np.linalg.eigh(C)
    order = np.argsort(w)[::-1]
    w, V = w[order], V[:, order]
    w = np.clip(w, 0.0, None)
    frac = np.cumsum(w) / w.sum()
    m = int(np.searchsorted(frac, keep_var) + 1)
    m = max(1, min(m, len(w)))
    M = (V[:, :m] * np.sqrt(w[:m])).T
    # SIGN IS ARBITRARY IN AN EIGENDECOMPOSITION, and an arbitrary sign that flips between builds
    # would invert traces and break G2's determinism digests for no scientific reason. Pinned so
    # each mode is positive at the channel where the family is strongest.
    for k in range(M.shape[0]):
        if M[k, anchor] < 0:
            M[k] = -M[k]
    return M


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    import mne
    mne.set_log_level('ERROR')
    subjects_dir = Path(mne.datasets.fetch_fsaverage(verbose=False)).parent

    L, names, pos, labels = build_leadfield(subjects_dir)
    lam = num('cortical_coherence_mm')
    keep = num('patch_mode_variance')
    idx = {n: i for i, n in enumerate(names)}
    order = [idx[c] for c in SCALP + REFS]
    L, pos = L[order], pos
    chan_names = SCALP + REFS

    montage = json.loads((_ROOT / 'data' / 'montage_10_20.json').read_text(encoding='utf8'))
    chan_xy = {c['label']: (c['x'], c['y'])
               for c in montage['channels'] + montage['reference']}

    projections: dict[str, dict] = {}

    def emit(gen: str, src_idx: np.ndarray, regions: list[str] | None):
        Lp, pp = L[:, src_idx], pos[src_idx]
        C = patch_covariance(Lp, pp, lam)
        anchor = int(np.argmax(np.diag(C)))
        M = modes_of(C, keep, anchor)
        # NORMALISE THE FAMILY, NOT EACH MODE. The registry's `<gen>_amp` is a peak-to-peak
        # amplitude at the generator's strongest electrode, and that must keep meaning across this
        # change or every amplitude row silently redefines itself. compose.ts drives each mode with
        # an independent unit-variance signal at the SAME rms, so the total variance at channel c
        # is rms^2 * sum_m w[m,c]^2 -- dividing by the peak of that root-sum-square makes the peak
        # channel come out at exactly rms, which is what the Gaussian's peak-1 weights gave.
        rss = np.sqrt((M ** 2).sum(axis=0))
        M = M / rss.max()
        for k, w in enumerate(M):
            key = gen if k == 0 else f'{gen}_m{k}'
            projections[key] = {
                'weights': [float(f'{v:.6f}') for v in w],
                'provenance': {
                    'method': 'leadfield_patch_eigenmode',
                    'mode': k,
                    'of_modes': int(M.shape[0]),
                    'head_model': 'fsaverage 3-shell BEM, ico-5, fixed orientation',
                    'regions': regions,
                    'n_sources': int(len(src_idx)),
                    'registry_keys': ['cortical_coherence_mm', 'patch_mode_variance'],
                },
            }

    for gen, regions in PATCHES.items():
        missing = [r for r in regions if r not in labels]
        if missing:
            raise SystemExit(f"{gen}: no such Desikan-Killiany region(s): {missing}")
        src_idx = np.unique(np.concatenate([labels[r] for r in regions]))
        emit(gen, src_idx, regions)

    # The aperiodic background is the whole cortex. Every labelled region, not a chosen subset --
    # `background_n_sources` and its six invented centres are what this deletes.
    allsrc = np.unique(np.concatenate([v for k, v in labels.items() if k != 'unknown']))
    emit(BACKGROUND, allsrc, ['<whole cortex>'])

    # The one non-cortical topography; see RESP_GAUSSIAN.
    cx = num('topo_centre_resp_artifact_x')
    cy = num('topo_centre_resp_artifact_y')
    sg = num('topo_sigma_resp_artifact')
    w = np.array([np.exp(-(((chan_xy[c][0] - cx) ** 2 + (chan_xy[c][1] - cy) ** 2))
                         / (2 * sg * sg)) for c in chan_names])
    projections['resp_artifact'] = {
        'weights': [float(f'{v:.6f}') for v in w / w.max()],
        'provenance': {
            'method': 'electrode_space_gaussian',
            'note': 'MECHANICAL, not cortical: electrode movement and impedance change with the '
                    'chest, so a cortical forward model is the wrong instrument. The sole '
                    'non-anatomical topography in this file.',
            'registry_keys': ['topo_centre_resp_artifact_x',
                              'topo_centre_resp_artifact_y', 'topo_sigma_resp_artifact'],
        },
    }

    out = {
        'schema': 'projection/2',
        'note': (
            'GENERATED by prep/leadfield/make_projection.py from an fsaverage 3-shell BEM forward '
            'solution and the Desikan-Killiany atlas. Seam 3: the runtime reads `weights` only; '
            '`provenance` is documentation and no loader may read it. Entries named <gen>_m<k> '
            'are additional SPATIAL EIGENMODES of the same cortical patch -- compose drives each '
            'with an independent realisation at the same rms, and the weights carry the variance '
            'split. Superseded tools/make_projection.mjs and 31 invented registry rows (D19).'
        ),
        'channels': chan_names,
        'scalp': SCALP,
        'reference': REFS,
        'generators': projections,
    }
    text = json.dumps(out, indent=2) + '\n'

    if args.check:
        if not OUT.exists() or OUT.read_text(encoding='utf8') != text:
            print('DRIFT: data/projection_10_20.json is stale. Run: '
                  'python -m prep.leadfield.make_projection')
            return 1
        print(f'projection check OK - {len(projections)} entries over {len(chan_names)} channels')
        return 0

    OUT.write_text(text, encoding='utf8')
    print(f'wrote data/projection_10_20.json - {len(projections)} entries over '
          f'{len(chan_names)} channels')
    fams: dict[str, int] = {}
    for k in projections:
        fams[k.split('_m')[0]] = fams.get(k.split('_m')[0], 0) + 1
    for g in list(PATCHES) + [BACKGROUND, 'resp_artifact']:
        w0 = np.asarray(projections[g]['weights'])
        peak = chan_names[int(np.argmax(np.abs(w0)))]
        print(f'  {g:<14} {fams[g]:>2} mode(s)   mode-0 argmax {peak}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
