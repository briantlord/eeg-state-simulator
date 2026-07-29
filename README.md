# EEG State Simulator

A generator of realistic multichannel EEG for arousal states.

**This is a model, not a measurement. No pixel is data recorded from a brain.** The second
observable axis is *signal complexity* — never "awareness" or "content".

---

## Build process

```bash
npm install
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
npm run verify
```

`npm run verify` is the whole gate. It runs four checks, ordered so the earliest failure is
the most informative, and stops at the first one — the same rule the harness applies to gates,
because a registry drift makes every downstream result meaningless.

| Step | What it protects |
|---|---|
| registry fixed-point | `docs/PARAMETERS.md` and `registry/parameters.yaml` cannot disagree |
| typecheck | seam 7 — comparing a 1–45 Hz knee-mode exponent to a 30–45 Hz fixed-mode one is a compile error |
| core tests | seam 4 non-perturbation, the exponent contract |
| harness tests | the D7 boundary: TS exporter → epoch directory → Python harness |

Other commands:

```bash
npm run registry:emit    # regenerate docs/PARAMETERS.md + gen/ from the registry
npm run export -- --seed 20260728 --state n3 --epochs 10 --out prep/out/run
```

## Layout

```
registry/parameters.yaml   NORMATIVE constant registry. docs/PARAMETERS.md is generated from it
tools/registry/            emitter, grammar, fixed-point check
gen/                       generated: registry.json, registry.d.ts  (committed, checked in CI)
src/core/                   registry accessors, RNG, types (state, exponent, event)
src/io/                     seam-9 epoch-directory export
bin/eegsim-export.mts       headless CLI — the boundary the harness measures
prep/                       validation harness: registry reader, epoch IO, gates, nulls
docs/                       the four planning documents, plus the execution scheme and probes
```

## Read these first

| Document | What it is |
|---|---|
| `docs/Build-Plan.md` | scope, tiering, signal model, milestones |
| `docs/Validation-Harness_Spec.md` | what makes a gate trustworthy |
| `docs/PARAMETERS.md` | the constant registry *(generated — edit `registry/parameters.yaml`)* |
| `docs/DECISIONS.md` | every parameter and architectural choice, with its reasoning |
| `docs/Execution-Scheme.md` | the Tier 0 build plan: gate ledger, work packages, build order |
| `docs/Tier0-Estimator-Probe.md` | measured estimator behaviour, including two confirmed gate defects |

## Two things to know before trusting a gate

**Gates print their class.** V = recovery by an external published tool. C = recovery by code
in this repository, which proves internal consistency and nothing more. U = no recovery check
exists. Tier 0's most important gate is class C; that is not a failure, but it must never be
read as validation.

**`invented` constants ship, and the UI marks them.** 61 of 135 registry rows are not
empirically constrained. A slider labelled "not empirically constrained" is more honest than a
hidden literal, and converting them is the Tier 1 work plan.

## Status

Tier 0 foundation. The registry mechanism, seams 1/2/4/7/9, and the build pipeline are in.
The signal generators are not — `bin/eegsim-export.mts` currently writes a white-noise stub
behind the real interface. See `docs/Execution-Scheme.md` §5 for the work packages.

License: BSD-3-Clause.
