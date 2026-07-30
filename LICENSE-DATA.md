# Third-party data and attribution

The BSD-3-Clause `LICENSE` covers the code in this repository. Two committed artifacts are derived
from third-party data and carry additional terms, reproduced here so that they travel with any
copy.

**This file is a statement of attribution and compliance, not legal advice.** If this project is
used commercially or redistributed as part of a product, read the FreeSurfer licence yourself.

## FreeSurfer / fsaverage

`data/projection_10_20.json` and `prep/leadfield/cache/*.npz` are computed from the **fsaverage**
template subject, distributed with [MNE-Python](https://mne.tools) and derived from
[FreeSurfer](https://surfer.nmr.mgh.harvard.edu/). fsaverage is a template brain built from a
combination of 40 MRI scans.

- `prep/leadfield/cache/fsaverage_leadfield.npz` — a three-shell BEM lead field, 21 electrodes ×
  20,484 cortical sources, with source coordinates.
- `prep/leadfield/cache/fsaverage_labels.npz` — Desikan–Killiany (`aparc`) label to source-index
  mapping.
- `data/projection_10_20.json` — 58 weight vectors of 21 numbers each, being the leading spatial
  eigenmodes of seven cortical patches. A heavy reduction of the above: it does not permit
  reconstruction of the head model, the source space, or any anatomical image.

The FreeSurfer licence grants the right to copy, modify and make derivative works, including for
commercial purposes, provided that the terms travel with any redistributed copy and that
attributions are preserved. As it requires:

> All or portions of this licensed product (such portions are the "Software") have been obtained
> under license from The General Hospital Corporation and are subject to the following terms and
> conditions.

The full FreeSurfer Software License Agreement is at
<https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense> and applies to the
fsaverage-derived files listed above.

The licence also states that **clinical applications are neither recommended nor advised**, and
that any commercialisation is at the sole risk of the party undertaking it. Neither the names nor
the logos of MGH may be used to endorse or promote anything derived from this work.

For the parcellation used to define the cortical patches, cite Desikan et al. (2006), *An automated
labeling system for subdividing the human cerebral cortex on MRI scans into gyral based regions of
interest*, NeuroImage 31(3).

## Recordings — not redistributed

`prep/realdata/` is **gitignored**. The PhysioNet recordings used for fitting — [EEG During Mental
Arithmetic Tasks](https://physionet.org/content/eegmat/) and the [Haaglanden Medisch Centrum sleep
staging database](https://physionet.org/content/hmc-sleep-staging/) — are fetched by
`prep/realdata/fetch_hmc.sh` and are governed by PhysioNet's own terms. No recording, and no
per-subject derivative of one, is committed here.

## If you would rather not carry the fsaverage files at all

The lead field cache is committed so that the projection drift check in `npm run verify` works on
a clean checkout without a ~1 GB anatomical download first. That is an engineering convenience,
not a requirement.

To remove it, note that **`.gitignore` is not sufficient**: the files are already in the history
of commits `9737542` and `99b2543`, and publishing the repository would publish them whatever the
ignore file says. Removing them means rewriting history —

```bash
git filter-repo --path prep/leadfield/cache --invert-paths
```

— before the first push, and then having CI fetch fsaverage once, cached with `actions/cache`.

`data/projection_10_20.json` stays either way: it is what the runtime loads, and it is the reduced
derivative described above.
