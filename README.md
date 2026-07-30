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
URL, in a subdirectory of another site, or opened straight from disk.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/, a self-contained static bundle (~56 kB gzipped)
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

- **86 of 184 registry rows are `invented`** — not empirically constrained. Every one is marked as
  such and routed to a milestone. A slider labelled "not empirically constrained" is more honest
  than a hidden literal.
- **Four of six arousal states have thin empirical support.** The reference corpus for wake is
  PhysioNet EEGMAT (8 subjects); sleep states are being anchored against the HMC sleep-staging
  database. Neither is a full-montage sleep corpus, so *spatial* statistics for sleep are
  unanchored.
- **Gates print their class.** V = recovery by an external, independently authored, published
  tool. C = recovery by code in this repository, which proves internal consistency and nothing
  more. U = no recovery check exists. Several important gates are class C; that is not a failure,
  but it must never be read as validation.
- Known open problems are listed as P1–P17 in `docs/DECISIONS.md`, with what each one blocks.

## Development

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
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
| core + harness tests | seam 4 non-perturbation, the exponent contract, the export boundary |
| gate ledger | all fourteen arms, each with its matched null; refuses to start if one is missing |

```bash
npm run registry:emit      # regenerate docs/PARAMETERS.md + gen/ from the registry
npm run projection:emit    # rebuild data/projection_10_20.json from the forward model
npm run export -- --seed 20260728 --state n3 --epochs 10 --out prep/out/run
```

## Layout

```
registry/parameters.yaml    NORMATIVE constant registry; docs/PARAMETERS.md is generated from it
data/                       montage and projection weights (generated, committed)
src/core/                   generators, registry accessors, RNG, types
src/render/, src/ui/        canvas trace, spectrum, controls
bin/eegsim-export.mts       headless CLI — the boundary the harness measures
prep/leadfield/             the forward-model producer and its probes
prep/reference/             measurement probes; every Finding is reproducible from here
docs/                       planning documents, decisions, findings, status
```

## Read these first

| Document | What it is |
|---|---|
| `docs/STATUS.md` | what is built, what is measured, what is wrong, in priority order |
| `docs/DECISIONS.md` | every parameter and architectural choice with its reasoning, D1–D19, P1–P17 |
| `docs/Tier0-Estimator-Probe.md` | Findings 1–22: measured behaviour, including several confirmed defects in this project's own gates |
| `docs/PARAMETERS.md` | the constant registry *(generated — edit `registry/parameters.yaml`)* |

## Attribution

- **Head model:** fsaverage, distributed with [MNE-Python](https://mne.tools), derived from
  FreeSurfer. The projection weights in `data/` are a derived work; see `LICENSE-DATA.md`.
- **Atlas:** Desikan–Killiany (`aparc`) cortical parcellation.
- **Reference recordings:** PhysioNet [EEG During Mental Arithmetic Tasks](https://physionet.org/content/eegmat/)
  and the [Haaglanden Medisch Centrum sleep staging database](https://physionet.org/content/hmc-sleep-staging/).
  No recording is redistributed here; `prep/realdata/` is gitignored and fetched by script.
- **External validators:** [YASA](https://raphaelvallat.com/yasa/) for spindle detection,
  [specparam](https://specparam-tools.github.io/) for aperiodic fits. These are what make the
  class-V gates class V.

## License

Code: BSD-3-Clause, see `LICENSE`. Derived data has separate terms — see `LICENSE-DATA.md`.
