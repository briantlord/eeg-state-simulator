# Status — Tier 0 complete, Tier 1 in progress

*Written 2026-07-29. Facts here are measured, not estimated; every number has a probe in
`prep/reference/` that reproduces it. Companion to `Execution-Scheme.md`, which is the plan.*

---

## In one paragraph

The generator produces multichannel EEG that matches real resting recordings on **effective rank
and alpha frequency**, and is a consistency check on near-field correlation and alpha prominence
because those were fitted. It does **not** match on PC1 share, far-field correlation, amplitude, or
the 1–20 Hz aperiodic slope — and D19 establishes that the first two cannot be fixed by fitting,
because the spatial model is separable. **All seven ledger arms are
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
| Registry mechanism | **done** | 213 rows; source discipline + circularity rule enforced; fixed-point check in CI |
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

**The corpus is resting WAKE.** Only `wake_ec` has a legitimate target here; `n3` is shown because
it is the worst state, but it contributed nothing to any fit and its column is a sanity bound.

| metric | real median [IQR] | wake_ec | n3 | |
|---|---|---|---|---|
| effective rank | 3.09 [2.88–3.28] | **3.17** | 1.63 | ✅ not targeted — the one genuine spatial agreement |
| alpha peak | 10.5 Hz [9.9–11.1] | 10.0 Hz | — | ✅ |
| alpha × aperiodic | 16.2 [11.2–44.6] | 36.4 | 3.2 | ⚠️ in range, high side; **fitted** (D19 rule) |
| \|corr\| near | 0.767 [0.745–0.798] | 0.812 | 0.941 | ⚠️ **fitted** — a consistency check, not evidence |
| PC1 variance | 0.534 [0.503–0.556] | 0.473 | 0.771 | ❌ P9 |
| \|corr\| all | 0.482 [0.452–0.525] | 0.379 | 0.694 | ❌ P9 |
| \|corr\| far | 0.440 [0.402–0.486] | 0.303 | 0.668 | ❌ P9 |
| Pz RMS | 14.8 µV [12.5–16.8] | 10.0 µV | 25.5 µV | ❌ P14 first |
| χ 1–20 Hz | 0.99 [0.95–1.05] | 0.29 | 2.41 | ❌ P13 — comparing two different quantities |

**Read the correlation rows together, not one at a time.** Near-pair sits at or above real while
PC1 and far-pair sit below it. That signature held in **all 21 configurations** swept across four
parameters, and it is the model class rather than a setting (D19, Finding 19). Effective rank
landing inside the IQR is therefore weak evidence: it is a scalar summary of an eigenspectrum whose
shape is demonstrably wrong.

**Three of these rows were fitted and are marked as such.** Per the D19 rule, a metric used to fit a
parameter is a consistency check, not evidence of realism.

---

## What is wrong, in priority order

### 1. The spatial model is separable, so its metrics counterbalance by construction — D19

Each source contributes `s_g(t) · w_g(channel)`: an outer product, **rank 1 in space × time**. The
channel covariance is therefore exactly `Σ_g var_g w_g w_gᵀ`. Two consequences, both measured:

- **One function of distance is all the model admits.** Near-pair and far-pair correlation cannot
  be matched together. Across 21 configurations spanning four parameters, near-pair sat at or above
  real (0.740–0.812 vs 0.767) while far-pair (0.251–0.323 vs 0.440) and PC1 (0.426–0.473 vs 0.534)
  sat below — **simultaneously, every time.**
- **The observables are not independent.** Rank, PC1, near and far are four summaries of one 21 × 21
  matrix, so fitting one moves the others.

**31 invented spatial parameters, no topography with external provenance, fitted against ~5
non-independent statistics of one covariance matrix.** Overparameterized in knobs, underparameterized
in shape. **Decided (D19): replace the Gaussian mixture with a published lead field** — executing
seam 3, which was designed for exactly this. Rank, PC1, near and far then become *predictions* whose
agreement is a falsification test rather than a fit.

**Measured before building it (Finding 20), and it corrected the mechanism twice over.** A real
fsaverage BEM lead field with a *parameter-free* source model measures far-pair 0.239 — worse than
the mixture it replaces. Then the same real recordings measure far-pair **0.437 under linked-ear and
0.257 under average reference**: a 70% swing from the reference alone, and the generator's
linked-mastoid output depends on `topo_reference_far_field`, an **invented** row. So spatial
parameters were partly fitted against an invented number (amendment **D19.1**: fit only under average
reference). Under that reference the lead field is *too* correlated, which no source-coherence model
can cause — only per-electrode independent signal can. `sensor_noise_rms` is **0.56% of variance
where the fit wants 20%** (P16).

| average reference | mean relative error | free parameters |
|---|---|---|
| shipped Gaussian mixture *(linked-ear)* | 0.250 | 31 invented |
| **lead field + independent share 0.20** | **0.125** | **1** |

**Missing independent per-channel variance is a second, simpler and larger cause of "too correlated"
than topography, and three commits of topography work would never have found it.**

Two errors of the same class were found alongside it and are now rules or pending items:

- **A circularity leak.** Fitted metrics were reported as evidence of realism. D19 forbids it: a
  metric used to fit a parameter is a consistency check.
- **A quantity-definition error in χ (P13).** `chi_*` stores an asymptotic exponent;
  `compare_real.py` measures an in-band slope; `knee_freq_wake_ec` = 12 Hz puts the knee inside the
  band. 0.29 against 0.99 is largely two different quantities being compared, and Build Plan 3.7
  already warned about it. **Do not move the knee to close that gap.**

### 2. The shipped χ modulation is marginal against its own detection floor

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

### 3. Narrowband χ cannot resolve the spacing between states

G1b's null measures the fixed-mode estimator's noise floor at **sd 0.18–0.23** over 30–45 Hz on
a 300 s record. The χ difference between adjacent states in the registry is 0.30. So **no state
ordering is supportable from narrowband χ on a single record** (Finding 14).

This constrains P10 more sharply than P10 states: fitting χ and the knee jointly per state does
not help if the estimator used to *check* the ordering cannot resolve it. It is not a short-
record artifact — 30–45 Hz is 0.176 decades of leverage, and a slope over that span scatters
however long the record.

Nothing in the Tier 0 build list remains open. Items 2 and 3 are T1-M2 work, and item 2 has already
had its generator-side half fixed there (D16). **Item 1 is T1-M1 and is now the active work**, ahead
of the rest of corpus fitting: fitting spatial parameters more carefully is pointless when the
decision is to delete them.

---

## The Tier 1 backlog, quantified

| standing | rows | meaning |
|---|---|---|
| `invented` | 112 | not empirically constrained — the T1-M1 work plan |
| `chosen` | 54 | deliberate convention; **not** Tier 1 work |
| `derived` | 16 | computed from a stated procedure |
| `definitional` | 11 | fixed by AASM or a named standard |
| `absent` | 11 | deliberately unset, and why |
| `literature` | 9 | published, author and year recorded |

213 rows. **41** are `pending`: they hold **no value**, only a provisional number reachable solely
through `provisionalValue()`, so a placeholder cannot silently become the value of record.

Milestones: **104 rows** route to T1-M1 (corpus fitting), **4** to T1-M2 (estimator
characterization), **4** to T1-M5 (cardiac).

**The spatial subset is the sharpest concentration of invented values in the project, and D19
decided to delete it rather than fit it.** 37 generative spatial rows, **31 `invented`**; the only
literature-standing spatial rows are the four `topo_expect_*` — which are G6's *tests* — and
`so_travel_v`, a velocity. **No topography in this project has external provenance.** A published
lead field replaces those 31 numbers with source locations plus one data file.

---

## Documentation map

| File | Contents |
|---|---|
| `Build-Plan.md`, `Validation-Harness_Spec.md` | the original specification, unmodified |
| `PARAMETERS.md` | **generated** from `registry/parameters.yaml`; never edit |
| `DECISIONS.md` | D1–D19 (D19 amended as D19.1) and pending P1–P16, append-only |
| `Execution-Scheme.md` | the plan: gate ledger, work packages, build order |
| `Tier0-Estimator-Probe.md` | Findings 1–20 (Finding 17 was never written; the number is skipped, not lost), every one reproducible from `prep/reference/` or `prep/leadfield/` |
| `STATUS.md` | this file |

Corrections are marked in place rather than rewritten: Finding 2 carries a correction block
(D3 upheld after re-measurement), Finding 9 carries one ("one cause" withdrawn), and D12
records what the adversarial review withdrew from D8 and D9.

---

## Next, in the order that unblocks the most

Tier 0 is closed. Everything below is Tier 1.

0. **The lead field (P9, decided in D19, mechanism corrected by Finding 20) — ACTIVE.** Promoted above the rest of T1-M1 because it
   *removes* 31 invented rows rather than fitting them, and because every spatial metric is
   currently a fit rather than a prediction. Four parts, in order of measured value:
   - **P16, the independent per-channel share.** Cheapest and largest: one number, 0.56% → ~20% of
     variance. Do this FIRST — it is a cause of the reported over-correlation independent of
     everything else, and it needs no lead field.
   - **D19.1, compare under average reference.** Methodology, not code: stop fitting against a metric
     that depends on an invented reference-electrode row.
   - **The lead field itself**, replacing the Gaussian weights via seam 3. MNE and
     MNE-fsaverage-data are already installed, so the forward model costs nothing to build.
   - **Distributed cortical patches**, not optional: seven dipoles through a real lead field is
     still rank ≤ 7 and still separable. Patches give the eigenspectrum its decay.

   Sequenced behind **P14** (`background_global_fraction` is
   read by nothing; wiring it moves referenced background variance ~24% and amplitude calibration
   depends on it).

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
