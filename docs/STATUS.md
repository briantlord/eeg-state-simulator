# Status — Tier 0 complete, Tier 1 in progress

*Written 2026-07-29. Facts here are measured, not estimated; every number has a probe in
`prep/reference/` that reproduces it. Companion to `Execution-Scheme.md`, which is the plan.*

---

## In one paragraph

The generator produces multichannel EEG that matches real resting recordings on effective rank,
amplitude, alpha frequency, near-field correlation and PC1 share. **All seven ledger arms are
implemented with their matched nulls and `--allow-partial` is gone**, so the runner now refuses
to start if a gate goes missing. All three demonstrations work: Demo 1 moves 100% → 1% across
the clinical cutoff range against a measured noise floor.

**Tier 0 is complete and Tier 1 has started.** The literal acceptance check closed the register's
top-rated risk (D15), and T1-M2's first measurement immediately found a Tier 0 generator defect
that no Tier 0 check could have caught: **the generator was delivering 48% of the requested χ
modulation at the respiratory rate**, because of a hardcoded 2 s coefficient hold in the tilt
filter. Fixed and derived (D16, Finding 15); `generator_version` → 0.2.0.

The pattern has held throughout: **the most valuable results came out of checks while they were
being built, and most of them corrected a claim rather than confirming one.** Narrowband χ cannot
resolve the spacing between adjacent states (G1b's null). The generator held two dead copies of
registry values in its HTML (the linter). Half the χ modulation was never generated (T1-M2). Each
was invisible to the check that should have owned it, and each is recorded with the reason it was
missed.

---

## What is built and measured

| Area | State | Evidence |
|---|---|---|
| Registry mechanism | **done** | 197 rows; source discipline + circularity rule enforced; fixed-point check in CI |
| Seams 1, 2, 4, 7, 9 | **done** | `test/rng.test.ts`, `test/exponent.test.ts`, `prep/test_epochio.py` |
| Aperiodic + knee | **done** | χ recovery −0.03…+0.11 via `specparam` (Finding 2 correction) |
| Oscillations | **done** | alpha as a damped bistable oscillator, non-sinusoidal (D13, P7) |
| Graphoelements | **done** | spindles, K-complexes, SO with AP travel; YASA detects them |
| Respiration + tilt filter | **done** | sideband risk measures −34 dB (Finding: WP-F) |
| All three respiratory mechanisms | **done** | separately switchable; Demo 1 moves 100% → 1% (Finding 10, resolved) |
| Observables χ / LZc / coupling | **done** | pink-noise demo passes under both LZ parses |
| SNR calibration | **done** | `snr_nominal` = -3.0765 dB, re-solved after D18 changed the mastoid weights |
| Web artifact | **done** | scrolling trace, filter panel, reference montages, resp/ECG lanes |
| Cardiac (T1-M5 prefix) | **partial** | McSharry PQRST + RSA, displayable; NOT validated against neurokit2 |
| Gate runner | **done** | class/status separation, matched-null refusal, per-arm thresholds |
| **All seven ledger arms** | **done** | G1a, G1b, G2, G3, G4, G5, G6, each with its matched null |
| ``--allow-partial`` | **removed** | the runner now refuses to start if a gate goes missing |
| Literal acceptance check | **done** | ``tools/lint/literals.mjs`` in ``verify``; self-tested (D15) |

`npm run verify` — 6 checks, 48 TS tests, 36 harness tests, all 14 gate arms, green.

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

### 1. The shipped χ modulation is marginal against its own detection floor

G4 found this while being built (D14, Finding 13): at `chi_mod_depth` = 0.15 the recovered line
was **1.02× its own null**, so the gate injects 13× that depth to have anything to attribute.

**T1-M2 has worked both halves of the cause and neither is now the plan's fault.** The generator
half is fixed — a 2 s tilt-coefficient hold meant only 48% of the requested modulation was
*generated* at the respiratory rate; `tilt_block_s` = 0.75 s recovers 2.1× (D16, Finding 15). The
estimator half is **settled against the plan**: replacing the cheap proxy with specparam-per-window
would have been 2× *worse*, and could not run in a browser. A least-squares slope over 2–40 Hz is
the best of five candidates measured and is what now ships (D17, Finding 16).

What remains is not an estimator defect but a **floor**: `chi_est_mdd_resp` = 0.048 in true-χ units
against a provisional depth of 0.15, a margin of ~3×. Demo 1's (c) row still reads mostly mechanism
(c)'s *amplitude* half. **No claim may rest on recovered χ modulation** until either the depth is
fitted at T1-M1 or the record length is raised — and the latter is now the cheaper lever, since the
estimator is no longer the limit.

### 2. Narrowband χ cannot resolve the spacing between states

G1b's null measures the fixed-mode estimator's noise floor at **sd 0.18–0.23** over 30–45 Hz on
a 300 s record. The χ difference between adjacent states in the registry is 0.30. So **no state
ordering is supportable from narrowband χ on a single record** (Finding 14).

This constrains P10 more sharply than P10 states: fitting χ and the knee jointly per state does
not help if the estimator used to *check* the ordering cannot resolve it. It is not a short-
record artifact — 30–45 Hz is 0.176 decades of leverage, and a slope over that span scatters
however long the record.

Nothing in the Tier 0 build list remains open. Both items above are T1-M2 work, and the first has
already had its generator-side half fixed there (D16).

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
| `DECISIONS.md` | D1–D18 and pending P1–P12, append-only |
| `Execution-Scheme.md` | the plan: gate ledger, work packages, build order |
| `Tier0-Estimator-Probe.md` | Findings 1–18 (16 with a resolution block), every one reproducible from `prep/reference/` |
| `STATUS.md` | this file |

Corrections are marked in place rather than rewritten: Finding 2 carries a correction block
(D3 upheld after re-measurement), Finding 9 carries one ("one cause" withdrawn), and D12
records what the adversarial review withdrew from D8 and D9.

---

## Next, in the order that unblocks the most

Tier 0 is closed. Everything below is Tier 1.

1. **T1-M2, estimator characterization — IN PROGRESS, promoted above T1-M1.** The milestone
   ordering puts corpus fitting first, and both problems above say that is backwards: fitting
   parameters more carefully cannot be verified with estimators that cannot resolve them.
   Promoting it paid immediately: the first measurement found half the χ modulation was never
   generated (D16), and the second found the plan's prescribed fix would have made things worse
   (D17). Done and remaining:
   - ~~Replace the two-band χ proxy with specparam-per-window~~ — **done, against the plan**
     (D17). specparam measured 2× *worse* and cannot run in a browser; a least-squares slope over
     2–40 Hz ships instead, and it also made the readout dimensionally honest.
   - ~~Demonstrate G4's null arm can fail~~ — **done** (D17). Swept a monotone leakage source:
     the arm first reports at 2.0× its detection floor and is silent below, so the effect-size
     floor did not neuter it. The sweep also caught two defects — **ties counted as evidence** in
     the sign test (two identical records scored p = 0.000488; it affected G3's null too, where
     integer counts tie often), and `resp_amp_mod_depth` being non-monotone above ~1.2.
   - **P12** — characterize `filterbank`'s over-response, then settle the default tilt scheme.
   - **PAC precision versus event count.** Circular SE ≈ √((1−R̄²)/(nR̄²)); the spec already
     shows ±15° is unreachable at 2–5 spindles/min, so this determines segment length or forces
     gating on resultant length instead of preferred phase.
   - **LZ χ-dependence**, needed only before any *phase-shuffled*-normalized LZc is gated or
     plotted. Tier 0's time-shuffled surrogate has zero χ-dependence by construction (D1).
2. **Then T1-M1 proper:** corpus fitting (P10 jointly, P8, P9). The `@lit-ok invented …` waivers
   are the call-site half of that backlog — every hardcoded morphology constant the linter now
   marks (KC peak positions, spindle jitter, envelope depth/rate, SO scheduling) needs a registry
   row fitted against the corpus.
