# Status — Tier 0

*Written 2026-07-29. Facts here are measured, not estimated; every number has a probe in
`prep/reference/` that reproduces it. Companion to `Execution-Scheme.md`, which is the plan.*

---

## In one paragraph

The generator produces multichannel EEG that matches real resting recordings on effective rank,
amplitude, alpha frequency, near-field correlation and PC1 share. The harness runs, three gates
are implemented with their nulls — including **G4, which the spec calls the most important gate
in Tier 0 and which spent two decisions with no pass criterion at all** — and the registry
mechanism prevents a numeric constant from existing outside it. **All three demonstrations now
work**: Demo 1 moves 100% → 1% across the clinical cutoff range against a measured noise floor.

Both of the last two work packages ended by correcting a claim rather than confirming one. The
filter demo's loss turned out to be entirely the movement artifact, with the physiological
mechanisms untouched. And G4, once buildable, established that **the shipped χ modulation is
invisible to the estimator that reads it** — the gate must inject 13× that depth, and fails at
the shipped one.

---

## What is built and measured

| Area | State | Evidence |
|---|---|---|
| Registry mechanism | **done** | 183 rows; source discipline + circularity rule enforced; fixed-point check in CI |
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
| **Gates G2, G4, G5** | **done** | with nulls; G4 falsified against three deliberate breakages |
| **Gates G1a, G1b, G3, G6** | **not built** | measurements exist as probes; need wrapping as modules |

`npm run verify` — 5 checks, 71 tests, green.

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

### 2. Four gates unimplemented

G1a, G1b, G3, G6 all have working measurements in `prep/reference/`. They need wrapping in the
gate-module contract with matched nulls. `--allow-partial` is currently switched on in
`npm run verify`, which means **the build does not notice a gate going missing.**

### 3. The literal linter does not exist

`tools/lint/literals.mjs` is the sole mitigation for the register's top-rated risk. The claim
that it is enforced was removed from the registry and `PARAMETERS.md` rather than left standing.

---

## The Tier 1 backlog, quantified

| standing | rows | meaning |
|---|---|---|
| `invented` | 99 | not empirically constrained — the T1-M1 work plan |
| `chosen` | 50 | deliberate convention; **not** Tier 1 work |
| `definitional` | 11 | fixed by AASM or a named standard |
| `literature` | 8 | published, author and year recorded |
| `derived` | 7 | computed from a stated procedure |
| `absent` | 8 | deliberately unset, and why |

33 rows are `pending`: they hold **no value**, only a provisional number reachable solely
through `provisionalValue()`, so a placeholder cannot silently become the value of record.

Milestones: **95 rows** route to T1-M1 (corpus fitting), **4** to T1-M2 (estimator
characterization).

---

## Documentation map

| File | Contents |
|---|---|
| `Build-Plan.md`, `Validation-Harness_Spec.md` | the original specification, unmodified |
| `PARAMETERS.md` | **generated** from `registry/parameters.yaml`; never edit |
| `DECISIONS.md` | D1–D14 and pending P1–P10, append-only |
| `Execution-Scheme.md` | the plan: gate ledger, work packages, build order |
| `Tier0-Estimator-Probe.md` | Findings 1–13, every one reproducible from `prep/reference/` |
| `STATUS.md` | this file |

Corrections are marked in place rather than rewritten: Finding 2 carries a correction block
(D3 upheld after re-measurement), Finding 9 carries one ("one cause" withdrawn), and D12
records what the adversarial review withdrew from D8 and D9.

---

## Next, in the order that unblocks the most

1. **Wrap G1a, G1b, G3, G6** as gate modules with nulls, then **remove `--allow-partial`** —
   the last change that stops the build silently tolerating a missing gate.
2. **Write `tools/lint/literals.mjs`**, then restore the claim it enforces.
3. Tier 1 proper: corpus fitting (P10 jointly, P8, P9) and estimator characterization. The χ
   proxy's floor (§1 above) makes T1-M2 more urgent than the milestone ordering suggests: it
   is not a refinement, it is the reason a shipped mechanism reads as absent.
