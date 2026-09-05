# EEG State Simulator

A lead-field based generator of synthetic multichannel EEG for arousal states — wake through N1,
N2, N3 and REM — that runs entirely in the browser.

**Everything it shows is synthetic. No sample is data recorded from a brain.** That is not a
disclaimer bolted on; it is the reason the project exists. A simulator's value is that the ground
truth is *known* — every spindle, K-complex and slow oscillation is placed at a time the generator
recorded, which is exactly what no real recording can give you, and what the validation gates use
them for.

The second observable axis is **signal complexity** — never "awareness" or "content".

---

## It runs locally, and there is no server side

The registry and the projection weights are imported as **JSON modules** and bundled at build
time, so the running page makes no requests of its own. The only network traffic is the browser
fetching the page's own script and stylesheet. Signal generation, filtering, referencing, the
spectrum and the analysis readouts all execute in the visitor's browser.

`vite.config.ts` sets `base: './'`, so the built `dist/` works unchanged at a GitHub Pages project
URL or in a subdirectory of another static HTTP server. Serve the build over HTTP; browser
module restrictions can prevent opening the HTML directly from disk.

```bash
npm install        # Node >=22.12; CI uses Node 22
npm run dev        # http://localhost:5173
npm run build      # -> dist/, a self-contained static bundle
```

## Where the topographies come from

Scalp topographies are **not** hand-placed Gaussians. They are spatial eigenmodes of cortical
patches, projected through an **fsaverage three-shell BEM forward model** with dipoles fixed
normal to the cortical surface. Each rhythm is defined as a set of named
**Desikan–Killiany regions** — "alpha is occipital and parieto-occipital" is a citable claim in a
published atlas, where a normalized `(x, y)` coordinate was not.

This replaced 31 invented registry rows with a published head model and four parameters. It also
turned one of the gates into a real test: G6 checks each rhythm's peak electrode against
literature expectations, and under the old Gaussian model that peak was wherever we had put the
centre — satisfied by construction. Under a forward model it is a consequence of anatomy, and it
caught two bad patch definitions on the way in.

Measured against real resting recordings under average reference, effective rank comes out at
**5.43 against a real 5.36** — and rank was not among the fitted quantities.

## Honest status

This is a research instrument in progress, and the documentation is written to be checkable rather
than persuasive.

- **Provisional parameters are explicit.** Current values and standings are in the generated
  [parameter ledger](docs/PARAMETERS.md); the [current status](docs/STATUS.md) separates tested
  behavior from remaining physiological uncertainty.
- **Four of six arousal states have thin empirical support.** The reference corpus for wake is
  PhysioNet EEGMAT (8 subjects); sleep states are being anchored against the HMC sleep-staging
  database. Five additional nights were reserved before evaluation for version 0.11.0, with
  substantial N1/REM spectral differences recorded. HMC has four EEG derivations, so full-montage
  *spatial* statistics for sleep remain unanchored.
- **Gates print their class.** V = recovery by an external, independently authored, published
  tool. C = recovery by code in this repository, which proves internal consistency and nothing
  more. U = no recovery check exists. Several important gates are class C; that is not a failure,
  but it must never be read as validation.
- The browser and default exporter share the calibrated `physiology-v1` configuration. A lazy
  continuous full-band view exposes infra-slow controls and a fixed high-pass comparison.
- [Stabilization results](docs/Stabilization-0.11.0.md) describe the repairs, schema migration,
  independent comparisons, and remaining limitations. Historical decisions are retained separately.

## Development

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
npx playwright install chromium # Linux CI also uses --with-deps; local Windows tests use Edge
npm run verify
```

`npm run verify` is the whole gate, ordered so the earliest failure is the most informative and
stopping at the first one:

| Step | What it protects |
|---|---|
| registry fixed-point | `docs/PARAMETERS.md` and `registry/parameters.yaml` cannot disagree |
| projection fixed-point | the weights are the only path the head model takes into the runtime |
| literal acceptance check | no scientific constant may ship outside the registry |
| typecheck | seam 7 — comparing a 1–45 Hz knee-mode exponent to a 30–45 Hz fixed-mode one is a *compile* error |
| production build | the static browser artifact compiles |
| core + harness tests | seam 4 non-perturbation, the exponent contract, the export boundary |
| browser integration | state/spectrum synchronization, continuous overview, and voltage polarity |
| gate ledger | all fourteen arms, each with its matched null; refuses to start if one is missing |

```bash
npm run registry:emit      # regenerate docs/PARAMETERS.md + gen/ from the registry
npm run projection:emit    # rebuild data/projection_10_20.json from the forward model
npm run export -- --seed 20260728 --state n3 --epochs 10 --out prep/out/run
npm run calibrate          # after changing model/calibration inputs; persisted replay is checked
npm run calibration:check  # read-only replay; also runs automatically before npm run build
npm run test:browser       # repeatable page-level regressions
python -m prep.reference.fetch_hmc_holdout
python -m prep.reference.t1m1_state_realism --cohort holdout
node --experimental-strip-types --no-warnings prep/reference/released_coupling.mts
```

The exporter accepts independent mechanism overrides and `--profile isolated` for controlled
fixtures. Its default matches the browser. See [the scoring and configuration contract](docs/Scoring-Contract.md).
The reserved HMC cache is separate from the legacy fitting cache; do not tune parameters on its
results. Empirical comparisons are record-only and are not downloaded or run on every CI push.

## Layout

```
registry/parameters.yaml    NORMATIVE constant registry; docs/PARAMETERS.md is generated from it
data/                       montage and projection weights (generated, committed)
src/core/                   generators, registry accessors, RNG, types
src/render/, src/ui/        canvas trace, spectrum, controls
bin/eegsim-export.mts       headless CLI — the boundary the harness measures
prep/leadfield/             the forward-model producer and its probes
                            (its fsaverage cache is gitignored and regenerated — LICENSE-DATA.md)
prep/reference/             measurement probes; every Finding is reproducible from here
docs/                       planning documents, decisions, findings, status
```

## Read these first

| Document | What it is |
|---|---|
| `docs/STATUS.md` | what is built, what is measured, what is wrong, in priority order |
| `docs/DECISIONS.md` | architectural decisions and their history |
| `docs/Tier0-Estimator-Probe.md` | the chronological measurement ledger, including confirmed defects |
| `docs/Stabilization-0.11.0.md` | current repairs, verification, and development/holdout results |
| `docs/PARAMETERS.md` | the constant registry *(generated — edit `registry/parameters.yaml`)* |

## Attribution

- **Head model:** fsaverage, distributed with [MNE-Python](https://mne.tools), derived from
  [FreeSurfer](https://surfer.nmr.mgh.harvard.edu/). The projection weights in `data/` are a
  derived work. Portions have been obtained under license from The General Hospital Corporation
  and are subject to the FreeSurfer Software License Agreement — see `LICENSE-DATA.md`.
  **Clinical applications are neither recommended nor advised.** The lead field itself is not
  redistributed here; the producer regenerates it from MNE's fsaverage dataset.
- **Atlas:** Desikan–Killiany (`aparc`) cortical parcellation.
- **Reference recordings:** PhysioNet [EEG During Mental Arithmetic Tasks](https://physionet.org/content/eegmat/)
  and the [Haaglanden Medisch Centrum sleep staging database](https://physionet.org/content/hmc-sleep-staging/).
  No recording is redistributed here; `prep/realdata/` is gitignored and fetched by script.
- **External validators:** [YASA](https://raphaelvallat.com/yasa/) for spindle detection,
  [specparam](https://specparam-tools.github.io/) for aperiodic fits. These are what make the
  class-V gates class V.

## License

Code: BSD-3-Clause, see `LICENSE`. Derived data has separate terms — see `LICENSE-DATA.md`.
