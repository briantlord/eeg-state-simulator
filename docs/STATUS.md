# Status — Tier 0

*Written 2026-07-29. Facts here are measured, not estimated; every number has a probe in
`prep/reference/` that reproduces it. Companion to `Execution-Scheme.md`, which is the plan.*

---

## In one paragraph

The generator produces multichannel EEG that matches real resting recordings on effective rank,
amplitude, alpha frequency, near-field correlation and PC1 share. **All seven ledger arms are
implemented with their matched nulls and `--allow-partial` is gone**, so the runner now refuses
to start if a gate goes missing. All three demonstrations work: Demo 1 moves 100% → 1% across
the clinical cutoff range against a measured noise floor.

**Tier 0 is complete.** The literal acceptance check — the last outstanding item — now runs in
`npm run verify` (D15), which closes the register's top-rated risk: no scientific constant ships
outside the registry unnoticed.

The work packages kept ending by correcting a claim rather than confirming one, and the most
important results came out of the checks *while they were being built*: the shipped χ modulation
is invisible to the estimator that reads it, narrowband χ cannot resolve the spacing between
adjacent states, and the generator held two dead copies of registry values in its HTML. All
point the same way — the estimators need characterizing (T1-M2) before the parameters are worth
fitting (T1-M1).

---

## What is built and measured

| Area | State | Evidence |
|---|---|---|
| Registry mechanism | **done** | 193 rows; source discipline + circularity rule enforced; fixed-point check in CI |
| Seams 1, 2, 4, 7, 9 | **done** | `test/rng.test.ts`, `test/exponent.test.ts`, `prep/test_epochio.py` |
| Aperiodic + knee | **done** | χ recovery −0.03…+0.11 via `specparam` (Finding 2 correction) |
| Oscillations | **done** | alpha as a damped bistable oscillator, non-sinusoidal (D13, P7) |
| Graphoelements | **done** | spindles, K-complexes, SO with AP travel; YASA detects them |
| Respiration + tilt filter | **done** | sideband risk measures −34 dB (Finding: WP-F) |
| All three respiratory mechanisms | **done** | separately switchable; Demo 1 moves 100% → 1% (Finding 10, resolved) |
| Observables χ / LZc / coupling | **done** | pink-noise demo passes under both LZ parses |
| SNR calibration | **done** | `snr_nominal` = 1.4288 dB, solved on the fixture seed |
| Web artifact | **done** | scrolling trace, filter panel, reference montages, 119 kB static |
| Gate runner | **done** | class/status separation, matched-null refusal, per-arm thresholds |
| **All seven ledger arms** | **done** | G1a, G1b, G2, G3, G4, G5, G6, each with its matched null |
| ``--allow-partial`` | **removed** | the runner now refuses to start if a gate goes missing |
| Literal acceptance check | **done** | ``tools/lint/literals.mjs`` in ``verify``; self-tested (D15) |

`npm run verify` — 5 checks, 40 TS tests, 36 harness tests, all 14 gate arms, green.

## Measured against real EEG

PhysioNet EEGMAT, 8 resting adults, same 19-channel 10-20 montage, same linked-ear reference.

| metric | real | ours | |
|---|---|---|---|
| effective rank | 3.09 | 3.12 | ✅ |
| PC1 variance | 0.534 | 0.485 | ✅ |
| \|corr\| near | 0.767 | 0.745 | ✅ |
| \|corr\| far | 0.440 | 0.286 | ❌ P9 |
| Pz RMS | 14.8 µV | 14.0 µV | ✅ |
| alpha peak | 10.5 Hz | 10.0 Hz | ✅ |
| χ 1–20 Hz | 0.99 | 0.32 | ❌ P10 |

---

## What is wrong, in priority order

### 1. The shipped χ modulation is invisible to the estimator that measures it

G4 established this while being built (D14, Finding 13). At `chi_mod_depth` = 0.15 the
recovered line is **1.02× its own null** — the gate has to inject 13× that depth to have
anything to attribute, and it correctly **fails** at the shipped depth. So the exponent half of
respiratory mechanism (c) is present in the generator and absent from every readout, and
Demo 1's (c) row is mostly reading the *amplitude* half instead.

This is a property of the cheap two-band χ proxy (floor ~0.10 in its own units over 300 s), not
of the generator. Replacing it is T1-M2 estimator-characterization work, and until then **no
claim may rest on recovered χ modulation.**

### 2. Narrowband χ cannot resolve the spacing between states

G1b's null measures the fixed-mode estimator's noise floor at **sd 0.18–0.23** over 30–45 Hz on
a 300 s record. The χ difference between adjacent states in the registry is 0.30. So **no state
ordering is supportable from narrowband χ on a single record** (Finding 14).

This constrains P10 more sharply than P10 states: fitting χ and the knee jointly per state does
not help if the estimator used to *check* the ordering cannot resolve it. It is not a short-
record artifact — 30–45 Hz is 0.176 decades of leverage, and a slope over that span scatters
however long the record.

Both are estimator-characterization problems (T1-M2), not generator defects. Nothing in the
Tier 0 build list remains open.

---

## The Tier 1 backlog, quantified

| standing | rows | meaning |
|---|---|---|
| `invented` | 104 | not empirically constrained — the T1-M1 work plan |
| `chosen` | 51 | deliberate convention; **not** Tier 1 work |
| `definitional` | 11 | fixed by AASM or a named standard |
| `literature` | 8 | published, author and year recorded |
| `derived` | 8 | computed from a stated procedure |
| `absent` | 11 | deliberately unset, and why |

34 rows are `pending`: they hold **no value**, only a provisional number reachable solely
through `provisionalValue()`, so a placeholder cannot silently become the value of record.

Milestones: **95 rows** route to T1-M1 (corpus fitting), **4** to T1-M2 (estimator
characterization).

---

## Documentation map

| File | Contents |
|---|---|
| `Build-Plan.md`, `Validation-Harness_Spec.md` | the original specification, unmodified |
| `PARAMETERS.md` | **generated** from `registry/parameters.yaml`; never edit |
| `DECISIONS.md` | D1–D15 and pending P1–P10, append-only |
| `Execution-Scheme.md` | the plan: gate ledger, work packages, build order |
| `Tier0-Estimator-Probe.md` | Findings 1–14, every one reproducible from `prep/reference/` |
| `STATUS.md` | this file |

Corrections are marked in place rather than rewritten: Finding 2 carries a correction block
(D3 upheld after re-measurement), Finding 9 carries one ("one cause" withdrawn), and D12
records what the adversarial review withdrew from D8 and D9.

---

## Next, in the order that unblocks the most

Tier 0 is closed. Everything below is Tier 1.

1. **T1-M2, estimator characterization — promoted above T1-M1.** The milestone ordering puts
   corpus fitting first, and both problems above say that is backwards. A χ proxy whose floor
   exceeds the injected modulation (§1) and a narrowband fit whose noise exceeds the state
   spacing (§2) mean that fitting parameters more carefully cannot be verified with the
   estimators we would verify them with. Characterize the estimators, then fit.
2. **Then T1-M1 proper:** corpus fitting (P10 jointly, P8, P9). The `@lit-ok invented …` waivers
   are the call-site half of that backlog — every hardcoded morphology constant the linter now
   marks (KC peak positions, spindle jitter, envelope depth/rate, SO scheduling) needs a registry
   row fitted against the corpus.
