# Derived data, and what may be redistributed

The BSD-3-Clause `LICENSE` covers the code. Two committed artifacts are **derived from
third-party data** and are not covered by it. This file states what they are so the question is
visible before the repository is public, rather than after.

## 1. `data/projection_10_20.json` — committed, and I believe fine

58 weight vectors of 21 numbers each. Produced by `prep/leadfield/make_projection.py` from an
fsaverage three-shell BEM forward solution, reduced to the spatial eigenmodes of seven cortical
patches over a 10-20 montage.

This is a **heavily processed derivative**: roughly 1,200 numbers distilled from a 21 x 20,484
lead field, with the anatomy collapsed into per-patch covariance eigenmodes. It does not permit
reconstruction of the head model, the source space, or any anatomical image. Redistributing it
with attribution is, in my reading, ordinary derived-work practice for a research artifact.

**Attribution:** fsaverage, distributed with MNE-Python, derived from FreeSurfer;
Desikan-Killiany (`aparc`) parcellation.

## 2. `prep/leadfield/cache/fsaverage_leadfield.npz` — committed, and this is the one to decide

2.3 MB containing the **lead field matrix itself** (21 x 20,484 float64) plus source coordinates,
and `fsaverage_labels.npz` with the atlas label-to-source index mapping. This is a far more direct
derivative of FreeSurfer's fsaverage subject than the projection file is.

It was committed for a concrete reason: `npm run verify` re-derives
`data/projection_10_20.json` and fails on drift, and that check is only meaningful if it can run
on a clean checkout. Requiring a ~1 GB anatomical download first would mean it never ran in
practice.

**That reason does not settle the licence question, and it should be settled before the repo is
public.** FreeSurfer is distributed under its own terms, which restrict redistribution.

### Recommended resolution

Remove the cache from the public repository and have CI regenerate it:

1. Add `prep/leadfield/cache/` to `.gitignore`.
2. In the `verify` workflow, run `python -c "import mne; mne.datasets.fetch_fsaverage()"` before
   `npm run verify`, with `~/mne_data` restored from `actions/cache` so it downloads once.
3. Locally the producer already regenerates the cache on first run, so nothing changes for a
   developer.

The cost is a slower first CI run. The benefit is that nothing in the repository redistributes
anatomical data, and the drift check keeps working.

Until that is done, treat this repository as **not cleared for redistribution of the cache
files.**

## 3. Recordings — not redistributed at all

`prep/realdata/` is gitignored. The EEGMAT and HMC recordings used for fitting are fetched from
PhysioNet by `prep/realdata/fetch_hmc.sh` and are governed by PhysioNet's own terms. No recording,
and no per-subject derivative of one, is committed here.
