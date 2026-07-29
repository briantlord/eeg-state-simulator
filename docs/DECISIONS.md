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

## Pending decisions

| ID | Question | Blocks | Due |
|---|---|---|---|
| P1 | `lz_parse`: LZ76 (suffix automaton) or LZW | nothing at Tier 0; any citation of published magnitudes | before first published comparison |
| P2 | `tilt_n_poles` and spacing for flatness across 1–45 Hz | G4 | T0-M4 |
| P3 | `tilt_mod_settling_ratio` sufficient to suppress sidebands | G4 | T0-M4 |
| P4 | Corpus selection for T1-M1 fitting | every `invented` row | T1-M1 |
