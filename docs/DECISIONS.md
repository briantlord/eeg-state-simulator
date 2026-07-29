# DECISIONS.md

*Every parameter choice and architectural decision, with the reasoning and the gate or constraint that justifies it. Append-only; supersede rather than edit.*

*Companion to `Build-Plan.md`, `Validation-Harness_Spec.md`, `PARAMETERS.md`.*

**Rule:** an intentional change to a golden gate output requires a minor version bump and an entry here. An unintentional one fails the build.

---

## D1 — LZ surrogate normalization: time-shuffled at Tier 0

**Decided.** `lz_surrogate` = **time-shuffled**. Standing `chosen`.

**What it normalizes against:** *"same density, no structure."* State this in the UI beside the LZc readout — a normalized complexity value is meaningless without naming its null.

**Reasoning.** The two surrogate options are not symmetric, and that asymmetry resolves what was a circular dependency between tiers.

- **Time-shuffled** destroys the spectrum. The surrogate's complexity therefore depends only on sequence length and symbol density — **its χ-dependence is zero by construction.** It is legally cacheable by (length, density), and it needs no estimator characterization.
- **Phase-shuffled** preserves the spectrum. A steep 1/f signal's surrogate stays steep, so surrogate complexity **tracks χ**. Caching it by (length, density) would return the value for an effectively independent sequence and inflate normalized LZc as a systematic function of χ — manufacturing correlated structure along the second observable axis, which is the collinearity risk already rated High.

**What this fixes.** The previous revision had Tier 0 plotting normalized LZc while the harness forbade any normalized value before T1-M2 characterization. Choosing time-shuffled removes the dependency rather than waiving it.

**Superseded by:** nothing. Phase-shuffled normalization is added at **Tier 1**, gated on its χ-dependence being characterized at T1-M2. Both may then be offered as a toggle, which is itself informative.

**Related open item:** `lz_parse` (LZ76 vs LZW) remains **UNDECIDED and does not block Tier 0.** Tier 0's landmarks are computed from the generator's own output and are self-consistent under any parse; the parse constrains only comparison to *published* magnitudes. Settle it before citing any published value.

---

## D2 — RNG: named and seeded per language, not shared across them

**Decided.** TypeScript: **`xoshiro128++` or PCG32**. Python: **`np.random.Generator(np.random.PCG64(seed))`** with `SeedSequence.spawn()` for per-generator substreams.

**The required property, stated precisely:** named, seeded, version-pinned, with documented substream derivation such that adding a generator does not perturb existing draws. That is all seam 4 needs.

**Reasoning.** The previous "PCG64 or xoshiro256++, implemented identically in both" was a fossil of the cross-implementation parity requirement, which is struck. With parity gone there is nothing to make identical, and both named options carry 64-bit state in a language whose numbers are float64 — PCG64 in TypeScript means BigInt (roughly an order of magnitude slower per draw) or hand-rolled 32-bit limb arithmetic. Neither is warranted for a property no longer required.

Python's `SeedSequence.spawn()` supplies the non-perturbation property directly rather than as something to hand-build, which is the reason to prefer it there.

**Consequence:** every seed produced before this decision is worthless after it. Decide before generating anything worth keeping.

---

## D3 — The knee: `k` encodes the ~20 Hz knee; the ~45 Hz knee is unmodelled

**Decided.** The generative form **L(f) = b − log₁₀(k + f^χ)** has a single `k`. At every tier, **`k` encodes the low-frequency knee near 20 Hz.** The knee documented near 45 Hz is registered as `knee_freq_high_unmodelled` — present in the literature, absent from the model.

**Reasoning and its consequence for G1b.** G1b (fixed-mode fit over 30–45 Hz) is justified on the grounds that a knee cannot be identified from a band lying entirely above it. That holds for the 20 Hz knee. It does **not** hold for the 45 Hz one: the 30–45 Hz band *straddles* the upper knee, so a fixed-mode fit across it is biased — the exact error the aperiodic section opens by warning about.

**Keep the bias. Do not eliminate it.** The published narrowband exponents this project compares against were themselves fitted fixed-mode over 30–45 Hz with that knee present. Reproducing the bias is what makes our values comparable to theirs; removing it would produce a more correct number corresponding to nothing in the literature.

This is recorded here because the alternative reading — that G1b is simply wrong — would otherwise cost someone a day.

**Related expectation, also not a bug:** G1a will show larger recovery error than G1b. Fitting knee mode over 1–45 Hz with the knee near 20 Hz gives roughly a decade below and a third of a decade above; χ and `k` trade off strongly over that span. Record it; do not chase it.

---

## D4 — G4's pass criterion: surrogate percentile, not an invented number

**Decided.** The off-frequency null passes when the coupling index at f₁ **exceeds the 95th percentile of a circular-shift surrogate distribution** (200 surrogates) and the index at f₂ does not.

**Reasoning.** "Recovered coupling must appear at f₁ only" was not yet a test — "only" needed a number, and every other Tier 0 number is invented. This one need not be: a surrogate distribution built by circularly shifting the respiration phase reference gives a threshold **derived from estimator properties**, which is what the circularity rule requires. It is, besides the definitional AASM criterion, the only Tier 0 pass criterion that is not an invented value.

**Frequency separation is constrained, not free.** Run on a **300 s record**, not the live 30 s window: 1/T ≈ 0.0033 Hz. With f₁ = 0.10 Hz and f₂ = 0.25 Hz, f₁–f₂ = 45 bins and f₁ sits 15 bins from the nearest sideband at f₂−f₁ = 0.15 Hz. **Require ≥10 bins between f₁, f₂, and both sidebands f₂±f₁.** Below that the injected modulation and the sideband structure are not distinguishable, and the gate cannot do the one job it exists for.

**Why this gate matters more than its class suggests.** It is class C — we wrote the coupling estimator — and it is still the first thing to build. It is the only check that the filter demonstration, which is the artifact's entire thesis, measures coupling rather than leakage from a tilt filter modulated at the respiratory rate.

---

## D5 — SNR calibration is a procedure, not a gate

**Decided.** `snr_nominal` is solved **once**, on a named fixture seed and epoch (`snr_calibration_seed`), as the mix value at which generated N3 satisfies the AASM criterion. Standing `derived`. **G5 then evaluates the criterion on seeds held out of that calibration and reports a pass fraction**, not a boolean.

**Reasoning.** Revision 2 defined the calibration point as "the value at which generated N3 satisfies the AASM criterion" and, in the same round, added G5 to test whether generated N3 satisfies the AASM criterion. Left conflated, that makes G5 pass by construction — structurally the same defect as setting `delta_amp` from the 75 µV figure, reintroduced one level up by its own fix. Calibrating a single scalar against a criterion and then testing that criterion is circular regardless of which level it happens at.

**What survives the split.** Calibration fixes one global scalar; it does not guarantee the criterion holds across seeds, across epochs, or after subsequent changes to amplitudes or the variability contract. So G5 retains real content as a **regression check** on the amplitude relationship. It does *not* provide evidence that our N3 resembles real N3, and the runner must print it that way — a gate whose positive arm is calibrated is weaker than its class letter suggests.

**The null carries the discriminative weight**, which is unusual enough to state: generated N2 must fail the N3 criterion, and generated N3 at `snr_nominal` − 6 dB must also fail.

---

## D6 — G6's expectations come from literature, not from the projection file

**Decided.** The expected `argmax` electrode for each generator lives in its own registry rows — `topo_expect_spindle_fast`, `topo_expect_spindle_slow`, `topo_expect_kc`, `topo_expect_alpha` — standing `literature`, sourced to clinical convention as recorded in AASM.

**Reasoning.** G6 as first written checked that "the spindle maximum lands on the expected central electrode" without saying whose expectation. If it is read from the projection file that places the Gaussian, the gate tests that `argmax` works and nothing else. Holding the expectation independently makes G6 a genuine comparison of **projection file against literature**, which is the only version worth running.

**Consequence for the null.** The mis-centred-file null now confirms that the gate reads its *data* from the projection file while comparing against an *independent* expectation — rather than comparing the file to itself.

---

## D7 — Tier 0 is TypeScript-only; the harness measures exported epoch directories

**Decided.** The Tier 0 core generator is TypeScript. It ships a headless Node CLI
(`bin/eegsim-export.mts`) writing seam-9 epoch directories. `/prep` invokes that CLI and
measures the exported artifact. **No Python generator exists at Tier 0.**

**Reasoning.** The Build Plan says the Tier 2 Python package is "what the harness measures",
but at Tier 0 it does not exist, and writing one now would recreate the cross-implementation
parity trap §1 explicitly strikes. Harness §8 already makes the seam an *artifact* boundary —
*"Validate against a lossless format — the epoch directory from seam 9"* — not an in-process
API. Tier 2 swaps the Python package in behind the same directory contract: a prefix, not a
placeholder.

**Two amendments, both load-bearing.**

- **The harness-facing format is binary float64, not CSV.** Build Plan §8 says CSV; harness §8
  requires float64. More sharply: **G2's bit-identity check run through a lossy serializer
  tests the serializer, not the generator** — the identical argument harness §8 uses to reject
  EDF. Epoch directories carry `.f64` per channel *and* a CSV projection for human inspection;
  the harness and G2 read only the binary.
- **The sidecar carries injected ground truth** — χ with band and mode, knee `k`, modulation
  depth and phase, SNR, per-generator weights. Without it the harness must reimplement
  generator internals to reconstruct truth, which at Tier 2 means the package and the harness
  must agree on that reconstruction — reintroducing parity through the back door.

---

## D8 — G4's f₁ arm takes a spectral-neighbourhood null; f₂ keeps the circular shift

**Decided. Supersedes D4's pass criterion.** D4's *reasoning* stands — the threshold must come
from estimator properties, not invention. Its *mechanism* does not.

**The defect, measured.** For an alignment-sensitive index `MI = |⟨χ(t)·e^{iφ(t)}⟩|` and a
phase reference that is a clean ramp `φ(t) = 2πf₁t`, a circular shift by τ gives
`e^{iφ(t+τ)} = e^{iφ(t)}·e^{i2πf₁τ}` — the magnitude is multiplied by a **unit-magnitude
constant and is unchanged**. Measured over 200 surrogates: observed MI, null median and null
95th percentile all `0.250000`, IQR exactly zero. `obs > p95` is false on a perfect signal.
**The most important gate in Tier 0 could never have passed.**

**The diagnosis.** G4 conflates two different tests under one criterion:

- *"Is χ coupled to respiration?"* — a **phase-reference** question. Circular shift is the
  right null, and measurement confirms it works: observed 0.250 against a null median of
  0.032, obs/p95 = 1.61, healthy IQR. This is the f₂ arm.
- *"Is χ modulated at f₁?"* — a **spectral-line** question. There is no reference to shift; the
  f₁ "reference" is our own injected modulator, which is by construction a clean ramp.

**Decided.**

- **f₁ (positive arm):** threshold is the `g4_percentile_level` percentile of the coupling
  index over neighbouring frequency bins, excluding f₂ and the sidebands f₂±f₁ together with
  the `g4_min_bin_separation` guard band. This remains "derived from estimator properties" —
  it is the standard null for a spectral line — and it survives the invariance that kills the
  circular shift, because neighbouring bins are not related to f₁ by a unit-magnitude factor.
- **f₂ (negative arm):** keep the circular-shift null.
- **Seed aggregation:** exact binomial test of the f₂ exceedance count against the per-seed
  false-exceedance rate the percentile defines. **Not "all seeds must pass"** — at
  `n_seeds` = 20 that fails ~64% of the time on a working generator (0.95²⁰ = 0.36), because
  the f₂ arm has a 5% per-seed false-exceedance rate *by design*.
- `g4_percentile` splits into `g4_percentile_level` (`chosen` — 95 could as easily be 99) and
  `g4_threshold_value` (`derived`, computed per run).

**Two further G4 repairs, recorded here because they block the gate.**

- **The f₂ arm is vacuous unless respiratory movement artifact is on at f₂.** The sidebands
  the gate exists to catch are intermodulation products requiring energy at *both*
  frequencies. With §5.1(a) off, nothing exists at f₂ and "must not exceed" passes trivially.
  The G4 fixture must declare which mechanisms are enabled.
- **G4 needs a capability described nowhere: χ modulation decoupled from respiration.** §5.2
  defines χ(t) as *driven by* respiration phase, so there is no specified way to modulate χ at
  f₁ while respiration runs at f₂. An independent-modulator input is added to the tilt filter,
  used by the G4 fixture and by nothing in the shipped UI.

Evidence: `Tier0-Estimator-Probe.md` Finding 6; `prep/reference/probe_g4_null.py`.

---

## D9 — G5's positive arm is record-only; its null carries the verdict

**Decided.** G5 reports the N3 pass fraction as a **recorded quantity with no threshold**. Its
null is pass/fail and is a strict ordering:
`pass_fraction(N3 @ snr_nominal)` > `pass_fraction(N2)` and > `pass_fraction(N3 @ −6 dB)`.

**Reasoning.** D5 already establishes that after calibration the positive arm is "largely a
regression check" and that "the null carries the discriminative weight". But it also requires a
pass *fraction* without saying what fraction passes — and any number would be invented, or read
from our own generator's spread. Both are prohibited. An **ordering needs no invented number**
and tests exactly what D5 says the gate retains.

---

## D10 — `delta_amp` takes a Tier 0 value from a non-AASM source

**Decided.** `delta_amp` = 100–200 µV, standing `invented`, sourced explicitly *not* to the
75 µV criterion, pending T1-M1 — matching its neighbours `so_amp` and `kc_amp`, which both
already carry textbook ranges.

**Reasoning.** This closes a circularity that D5 opened while fixing another. With `delta_amp`
blank **and** `snr_nominal` solved so that N3 satisfies the AASM criterion, the pair is
**under-determined by one degree of freedom, and the calibration absorbs it** — the delta
amplitude ends up set by the 75 µV figure through the back door. That is precisely the defect
D5 exists to close, re-entering through the one row D5's own prose leaves empty. Fixing
`delta_amp` independently makes `snr_nominal` a genuine single-scalar solve.

---

## D11 — The registry inverts: normative YAML, generated `PARAMETERS.md`

**Decided.** `registry/parameters.yaml` is the single source of truth; `docs/PARAMETERS.md` is
generated from it, with a fixed-point check (`npm run registry:check`) in CI.

**Reasoning.** "Code reads this file" was not achievable against the markdown as written: an
orphaned one-row table silently dropped `snr_calibration_seed` — the row the entire G5
held-out design depends on — `k_wake` … `k_rem` was an ellipsis standing for five keys, four
rows had an empty `Standing`, and three values were English words. The markdown is parsed
exactly once, by a throwaway importer, and never again.

**The value field is a tagged union.** The registry's ranges meant at least three incompatible
things — filter passbands where both endpoints are in force, uncertainty spreads the generator
must reduce to a point plus `Dv`, and UI slider domains. One accessor returning all three is
how a plausible-looking number reaches a filter.

**Pending rows hold no value.** `provisionalValue(key)` is the only path to the number the
generator runs on today, so a placeholder cannot silently become the value of record.

**Standing enum is six, plus `absent`.** Build Plan seam 6 names four; it is the stale list,
and the two it omits (`chosen`, `derived`) are the standings of `snr_nominal`,
`g4_percentile`, `gate_g4_criterion` and `gate_topography`. `absent` is added for rows
deliberately unset and scheduled — distinct from an `invented` guess — which no enum could
otherwise represent.

---

## Pending decisions

| ID | Question | Blocks | Due |
|---|---|---|---|
| P1 | `lz_parse`: LZ76 (suffix automaton) or LZW | nothing at Tier 0; any citation of published magnitudes | before first published comparison |
| ~~P2~~ | ~~`tilt_n_poles` and spacing~~ | — | **Closed.** `tilt_n_poles` = 12, standing `derived`; see `Tier0-Estimator-Probe.md` Finding 4 |
| ~~P3~~ | ~~`tilt_mod_settling_ratio`~~ | — | **Closed as not answerable as posed.** Settling has 61× margin and is not the binding constraint; the residual risk is the coefficient-interpolation scheme, and measuring it *is* G4. Registered `absent` with a procedure. Finding 5 |
| P4 | Corpus selection for T1-M1 fitting | every `invented` row | T1-M1 |
| P5 | Re-measure G1a vs G1b error under the **full** generator | amending D3 | T0-M5 |

**P5 is new.** D3 states *"G1a will show larger recovery error than G1b."* Measured on clean
aperiodic signal the ordering is reversed by two orders of magnitude (median |error| 0.005 vs
0.417), and G1b's error matches the analytic slope of the generative form to 3% — so it is
structural, and it originates in our **modelled 20 Hz knee**, not the literature's unmodelled
45 Hz one. That makes D3's comparability argument weaker than stated: the bias magnitude is a
function of the `invented` `k_*` rows rather than something inherited from published
measurement conditions. The clean-signal regime flatters G1a, so this justifies re-opening D3,
not amending it. Finding 2.
