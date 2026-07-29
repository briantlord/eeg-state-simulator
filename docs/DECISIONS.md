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

## D12 — Amendments from adversarial review (2026-07-29)

*An independent review attacked D7–D11 and the measurements behind them. Every finding below
was re-verified here before being recorded. Two decisions do not survive intact.*

### D8 is **partly withdrawn.** The supersession of D4 stands; the replacement does not.

D4's f₁ mechanism is genuinely broken and D8 is right to kill it. Three defects in the
replacement, all measured:

1. **The f₁ spectral-neighbourhood null is not implementable at its registered parameters.**
   At `g4_record_length` 300 s and `analysis_update` 1 Hz, χ̂(t) has 300 samples and
   1/T = 0.00333 Hz, so f₁ → bin 30. `g4_f1_neighbourhood_halfwidth` = 60 gives bins
   **[−30, 90] — the lower half is below DC.** After the guard bands only **38 bins** survive,
   of which **39% sit below 0.05 Hz**, in the drift band of any sliding-window χ̂ estimator
   where the local spectrum is emphatically not flat. A local-noise-floor null presumes local
   stationarity; this neighbourhood does not have it. A 95th percentile over 38 samples is
   near enough `max()`.
2. **The "5% per-seed false-exceedance rate by design" is false, and not measured.** It is a
   function of respiration regularity, not of the percentile. Measured over independent
   respiration realisations, 60 trials each:

   | `resp_period_cv` | measured rate | expected exceedances at `n_seeds` = 20 |
   |---|---|---|
   | **0.02** (N3-like, "most regular") | **0.317** | **6.3** |
   | 0.05 | 0.083 | 1.7 |
   | 0.08 (the registry's provisional) | 0.067 | 1.3 |
   | 0.10 | 0.100 | 2.0 |
   | 0.25 (REM-like) | 0.050 | 1.0 |

   `resp_period_cv` is a single row for **all** states even though §5.2 and `resp_rate_n3`
   both say N3 is the most regular. The moment a state-specific cv near 0.02 is fitted at
   T1-M1, D8's exact-binomial test rejects a working generator at p ≈ 3×10⁻⁴ — which is the
   defect D8 exists to remove, reintroduced by its own fix.
3. **"Could never have passed" is an interpretation stated as a measurement.** `obs == p95` is
   a *tie*; a `>=` comparison passes trivially. The real defect is that the null carries
   **zero information in either direction.** The exactness also depends on `f₁·T` being an
   integer (30 cycles exactly at the registered values); at f₁ = 0.1017 the same test gives
   obs/p95 = 1.039 and passes.

**The cleanest statement of why D4 had to go** is not the one D8 gives: **D4's own
`g4_min_bin_separation` ≥ 10-bin requirement forces the χ modulator to be a clean spectral
line, and a clean line is exactly what makes its own circular-shift null degenerate.** D4 is
internally inconsistent. That argument does not depend on which reading of D4 you take, and
D8's does.

**Status: G4 has no agreed pass criterion.** It must not be implemented until one exists.
Options on the table: shrink the halfwidth and correct for one-sidedness; lengthen
`g4_record_length` so a symmetric neighbourhood exists; fit a parametric local noise floor
instead of an order statistic; and for the f₂ arm, estimate the exceedance rate per run from
the shift-null's own rank rather than hard-coding 0.05.

### D9 is **withdrawn.** Its load-bearing premise is false.

D9 claimed *"an ordering needs no invented number."* It does: the ordering consumes
`snr_null_offset` = −6 dB, standing **`invented`**, which sets the entire discriminative power
of the second clause. Two further defects: `pass_fraction(N2)` is **0 by construction** — no
0.5–2 Hz generator is assigned to N2, so half the verdict tests the registry's state
assignment rather than the generator — and a raw `0.55 > 0.50` point comparison has no error
control, which harness §3 forbids.

**And D9's premise that no criterion exists is wrong.** A definitional one does: an epoch our
generator *labels* N3 must satisfy the AASM rule that *defines* N3, so the criterion is
`pass_fraction = 1.0`, from the same definitional source as `gate_aasm_n3_min_amp`. That is
neither invented nor read from our own spread. **Adopt that instead**, with a proportion test
carrying a CI on the difference for the null.

### D10 stands; one claim in it is **withdrawn**, and a units error is fixed.

The degrees-of-freedom argument is correct and the decision is right. But *"makes
`snr_nominal` a genuine single-scalar solve"* is false — `so_amp` (100–200 µV at
`so_freq` < 1 Hz) also lands inside `gate_aasm_n3_band`, the aperiodic offset `b` has **no
registry row at all** despite `aperiodic_model` naming it, and the interval→point reduction
rule is unregistered with **zero `Dv` rows** in the registry. At least three degrees of
freedom remain.

**Units error, now fixed:** `delta_amp` carried `units: uV` while the textbook 100–200 figure
is peak-to-peak. Read as peak it is 200–400 µV p-p, which at −6 dB still clears 75 µV — so
**G5's null could not have failed**, and under D9 that null was G5's only failable arm.

### D11 stands, with three corrections applied

- **Every `k_*` row contradicted its own stated `basis` by 16× to 3783×.** I wrote basis
  strings reading `k = knee_freq_low ^ chi` and stored values computed some other way. Nothing
  could catch it: per-row validation cannot see one row contradicting another. `emit.mjs` now
  **cross-checks `k = knee_freq_state ^ chi_state`**, `knee_freq_*` is registered per state,
  and the check caught two further arithmetic errors in the repair itself.
- **A tension this exposed, recorded not resolved:** D3 says `k` encodes *the ~20 Hz knee*, a
  single location, while `knee_present` requires prominent-in-REM / attenuated / absent-in-N3.
  With one `k` per state the only way to express "absent" is to *move* the knee below the fit
  band, not to weaken it. T1-M1 must settle whether the single-knee form can carry
  `knee_present` at all.
- **`gate_determinism` was re-sourced by guess** to "IEEE 754 binary64", which defines float64
  representation but says nothing about one seed producing identical output — that is a
  property of our implementation and its draw ordering. Re-standed `definitional` → `chosen`.

### Known-false claim removed

`registry/parameters.yaml` and the generated `PARAMETERS.md` both asserted that the numeric-
literal acceptance check was *"enforced by `tools/lint/literals.mjs`."* **That file does not
exist.** The claim is removed from both and carries a TODO. A stated check that does not exist
is worse than none, for the reason the harness spec gives about gates.

---

## D13 — Alpha is a damped stochastic oscillator, not bandpass-filtered noise

**Decided.** Alpha is generated as a **stochastically driven damped oscillator with bistable
damping**, discretized as AR(2):

    x'' + 2γx' + ω₀²x = ξ(t)   →   x[n] = 2r·cos(ω₀)·x[n−1] − r²·x[n−2] + ξ[n],  r = e^(−πB/fs)

Beta and theta keep the filtered-noise form. **This asymmetry is deliberate**, not an
oversight — see below.

**Reasoning.** §3.3's rule is *"narrowband-filtered noise, never pure sinusoids"*, and that
rule is right about what to avoid. But it is a rule about the *tell*, not about the mechanism,
and applied literally it produces a signal that fails three separate things the literature
says about alpha. All three were measured before the change and after:

| | bandpass noise | damped oscillator | what the literature says |
|---|---|---|---|
| peak shape (w₋₁₀/w₋₃) | **1.26** | **3.10** | a resonance is Lorentzian, ≈3 |
| envelope CV | 0.528 | 0.693 | Rayleigh is 0.523 — real alpha is not Rayleigh |
| envelope skew | 0.633 | 1.222 | Rayleigh is 0.631 |
| bimodality coefficient | 0.428 | **0.558** | >0.555 indicates two modes |
| phase memory | 1.8 cycles | 2.7 cycles | a resonance holds phase |

1. **The peak shape was a boxcar.** A 4th-order Butterworth bandpass has a flat passband and
   steep skirts; it deposits a *rectangle* of power, not a peak. A damped oscillator has a
   Lorentzian peak. Measured, the old model scored 1.26 where a Lorentzian scores ~3.1 — and
   the whole point of alpha in this project is that it is the one component that stands out
   as a *peak* above the aperiodic background. `specparam`, which G1a depends on, fits peaks
   over an aperiodic component; a boxcar is not a shape it expects.

2. **The amplitude envelope was Rayleigh, and real alpha's is not.** Filtered Gaussian noise
   has a Rayleigh envelope by construction — the old model measured CV 0.528 / skew 0.633
   against Rayleigh's exact 0.523 / 0.631, i.e. it reproduced the analytic values to three
   decimals. Freyer et al. report alpha amplitude is **bistable**, bursting between high- and
   low-amplitude modes rather than diffusing about one mean, with a subcritical Hopf
   bifurcation as the mechanism. Switching the damping between two values reproduces that:
   bimodality coefficient 0.558 against 0.428 before.

3. **One mechanism, fewer parts.** Liley and colleagues show that resting EEG — *both* the
   alpha peak *and* the 1/f background — is well accounted for by a sum of stochastically
   driven damped alpha-band processes with a distribution of dampings. Under that account
   alpha and the aperiodic background are not separate ingredients requiring separate
   machinery. This decision adopts the mechanism for alpha only; adopting it for the
   background too is a Tier 1 question.

**Why alpha and not the others.** Damping bandwidth is the parameter that says *how much of a
real oscillation this is*: narrow means weakly damped with long phase memory; wide means
heavily damped and indistinguishable from filtered noise. One parameter spans both regimes.
Alpha is the component with a clear, well-documented resonance. Beta and theta are broader,
weaker and far less clearly resonant, and **no damping has been fitted for them** — giving
them alpha's mechanism would assert a resonance nobody has measured. `chosen` for alpha,
open for the rest.

**What this replaces.** The imposed burst envelope, the carrier-flattening step, and
`osc_carrier_flatten` for alpha. Burst structure now *emerges* from the damping rather than
being multiplied on afterwards. `alpha_burst_dur`, `alpha_burst_rate` and
`alpha_interburst_level` are marked superseded in the registry rather than deleted, because
the burst machinery still serves rhythms whose damping is unfitted.

**Known gap, and it is load-bearing.** AR(2) is **linear**, so its output is exactly
symmetric — measured peak/trough ratio 1.000. Real alpha is non-sinusoidal, and that
asymmetry **manufactures spurious phase–amplitude coupling** (Cole & Voytek; Gerber et al.).
This project measures PAC — SO–spindle coupling at Tier 0, respiration–χ throughout — so a
perfectly symmetric alpha understates a confound the artifact exists partly to demonstrate.
**Registered as P7**, not fixed here: the fix is a nonlinear oscillator or explicit waveform
shaping, and it must be characterized before any PAC recovery gate is trusted.

---

## D15 — the literal acceptance check exists, and the claim is restored with accurate scope

**Built, enforced, and self-tested.** `tools/lint/literals.mjs` runs in `npm run verify` (6th
check). D12 had removed the claim that it existed, because a stated check that does not run is
worse than none; the claim is restored only now that the check runs.

**The claim is narrowed to what is true, which is a change from the literal wording.** The
registry header said *"no numeric constant may appear in source or UI copy absent from this
registry."* Taken literally that is impossible — you cannot register the 2 in `2·π` — so it was
always implicitly about *model* constants. The linter makes that precise: a sourced constant is
read through a typed accessor and so appears as a **string key, not a number**, therefore any
numeric literal is unsourced by construction, and the check is to decide which literals are
model constants in disguise. It cannot decide that by inspection, so it does not pretend to:

- A tiny allowlist of arithmetic furniture — `0, 1, -1, 2, 0.5, 100` — passes silently. The
  self-test pins that set so widening it is a decision, not a drift.
- Every other literal must carry an inline `@lit-ok <reason>` waiver, or its whole file a
  `@lit-ok-file` waiver, naming why the number is structural. The waivers are grep-able: the
  `@lit-ok invented …` ones mark **model constants not yet in the registry** — an auditable
  T1-M1 fit backlog — and every other names an algorithm, unit, layout or format constant.

**Scope is the shipped generator and UI** (`src/**/*.ts`, `bin/*.mts`, `index.html` attributes),
not the Python harness, tests, tooling or generated output. HTML is scanned at its **attributes
only**: a hidden parameter default lives in a control's `value`/`max`, while a note reading
"1.02× its own null" is documentation, the same category as a code comment, which the linter
already skips.

**What the first run found, which is the point of building it.** The audit surfaced 849 literals
across 65 values; after the allowlist and waivers, three real findings:

- **Two dead defaults in `index.html`.** `value="20260728"` (the calibration seed) and `max="90"`
  (the buffer length) were hardcoded in the HTML *and* overwritten by `app.ts` from the registry
  on mount — a second, silent copy of two registry values. Removed; `app.ts` is the only source.
- **Range-maxes hardcoded while their mins are sourced.** `kc_dur` and `spindle_dur` read their
  floor from the registry (`kc_dur_min`, `spindle_dur_min`) but drew the upper bound from a bare
  literal. Waived as `invented … TODO(T1)`; the asymmetry is now visible rather than buried.
- **A masker blind spot, made honest.** The tokenizer does not parse regex literals, so the
  10-20 odd-electrode class `/[13579]$/` surfaces `13579` as a "literal". Rather than special-
  case it, the two such lines carry waivers and `test/literals-lint.test.ts` asserts the
  surfacing — so the waiver stays necessary rather than papering over a silent miss.

The self-test pins the masker against the cases a regex gets wrong — numbers inside strings,
comments and template *text* are not seen; a number inside a `${…}` expression is; identifier
digits (`Float64Array`, `background_0`) are not literals.

---

## D14 — G4's criterion is a paired sign test; both of D8's nulls are withdrawn

**Decided, implemented, and falsified against.** D12 left G4 with no pass criterion and four
options on the table. None of them was adopted. Measuring the premises first killed the whole
family:

**D12's stated objection to the neighbourhood null does not survive measurement.** The argument
was that 39% of the surviving bins sit below 0.05 Hz, in a drift band where the local spectrum
is not flat. Measured, the χ̂ floor below 0.05 Hz is **0.9× the floor over 0.10–0.35 Hz** — the
drift band is not elevated at all at these parameters. The neighbourhood null was dropped
anyway, for a better reason than the one that was argued.

**The better reason: a matched null needs no local-flatness assumption and no threshold.**
Measure every seed **twice** — once with the mechanism under test on, once with it off,
everything else identical — and count how often the pair orders correctly. Under the null a
paired difference is positive with probability 0.5. The criterion is an exact sign test, and
**the 0.5 comes from the pairing rather than from anyone's choice**, which is the "derived, not
invented" threshold §1 demands.

This also removes D12's defect 2 at the root. The percentile construction's per-seed
false-exceedance rate turned out to be a function of respiration regularity — 0.317 at N3-like
`resp_period_cv`, against the 0.05 it was assumed to have — so it would have rejected a working
generator once a state-specific cv was fitted. Pairing makes each seed its own control, so
seed-to-seed variance cancels instead of having to be modelled. `g4_threshold_value`,
`g4_f1_neighbourhood_halfwidth` and `g4_n_surrogates` are all now `absent` with reasons.

**The circular shift was never a null here, and the project made the same mistake twice.** A
shift of a near-periodic phase ramp by half a cycle *anti-aligns*, and a magnitude estimator
returns the signal straight back. That is D12's zero-IQR degeneracy — and it is independently
the mistake I made building Demo 1's noise floor a day later, caught by measurement and now
pinned by `test/coupling.test.ts`. The replacement in both places is an **off-resonance or
mechanism-toggle** null, never a permutation of a periodic reference.

### Two positive arms, because "at f₁ and not at f₂" is two claims

`DETECTION` — depth(f₁) with χ modulation on exceeds depth(f₁) with it off, same seed.
`SELECTIVITY` — depth(f₁) exceeds depth(f₂) within the same record.

Detection alone would pass an estimator that smears a real line across every low frequency;
selectivity alone would pass one that reports nothing anywhere. Measured: **12/12 and 12/12,
p = 2.4 × 10⁻⁴ each, f₁/f₂ ratio 4.93×.**

### The fixture, and the choice in it that decides whether the gate means anything

Mechanism **(a) is ON** — it is the confound the f₂ arm must survive, ~11 µV at 0.25 Hz on Fz,
and its absence is what made this arm vacuous until P11.

Mechanism **(c)-amplitude is OFF**, and getting this wrong would have been invisible. It
modulates 0.5–4 Hz power at the respiratory rate and χ̂'s low band is 2–8 Hz: **the bands
overlap by construction**, so it produces a genuine f₂ line — measured, 3.30× the empty floor.
A fixture that left it on would fail the gate for doing exactly what it was built to do.
Conflating the respiratory mechanisms is the standard error Build Plan §5.1 names; this would
have been that error committed in the gate rather than the generator.

### What G4 does not establish, stated because the gate reads stronger than it is

It injects `g4_fixture_chi_mod_depth` = 2.0, **13× the depth the generator ships**. At the
shipped 0.15 the recovered line is 1.02× its own null — invisible — and the gate's detection arm
**fails** on it (8/12, p = 0.19; measured in `probe_g4_falsify.py`). G4 asks whether the
estimator attributes a *detectable* line to the *right frequency*, and a line must be detectable
before that question means anything. It follows that G4 says nothing about whether the shipped
modulation is recoverable. **It is not.** That is a property of the cheap two-band χ proxy,
whose floor over a 300 s record is ~0.10 in its own units, and replacing it is T1-M2 work.

### The null arm is absence of evidence, and says so

Leakage is checked at f₂ **and at both sidebands** f₂±f₁ — intermodulation products that need
energy at both frequencies to exist, which is precisely why D12 called the arm vacuous before
mechanism (a) was built. Measured: **6/12, 6/12, 4/12, ratios 1.000, 1.001, 1.000.** Exactly
chance. But a sign test at n = 12 resolves a shift only when it flips most pairs, and mechanism
(a) moves the f₂ line by 0.2% of the null median — so the arm establishes that leakage is **not
gross**, not that it is zero. The report prints the effect ratio beside the p-value for that
reason.

### It can fail

Three deliberate breakages, all confirmed FAIL (`prep/reference/probe_g4_falsify.py`): asking
the gate to find the line at the wrong frequency (0/12), injecting nothing (0/12), and injecting
at the shipped depth (8/12, p = 0.19). A gate that cannot fail is not evidence, and G4 spent two
decisions in exactly that state.

---

## Pending decisions

| ID | Question | Blocks | Due |
|---|---|---|---|
| P1 | `lz_parse`: LZ76 (suffix automaton) or LZW | nothing at Tier 0; any citation of published magnitudes | before first published comparison |
| ~~P2~~ | ~~`tilt_n_poles` and spacing~~ | — | **Closed.** `tilt_n_poles` = 12, standing `derived`; see `Tier0-Estimator-Probe.md` Finding 4 |
| ~~P3~~ | ~~`tilt_mod_settling_ratio`~~ | — | **Closed as not answerable as posed.** Settling has 61× margin and is not the binding constraint; the residual risk is the coefficient-interpolation scheme, and measuring it *is* G4. Registered `absent` with a procedure. Finding 5 |
| P4 | Corpus selection for T1-M1 fitting | every `invented` row | T1-M1 |
| ~~P7~~ | ~~Non-sinusoidal waveform shape for alpha and the SO~~ | — | **Implemented, not fitted.** See below |
| P8 | Fit `alpha_shape_rdsym` / `alpha_shape_triangularity` / `so_rdsym` against a corpus | any PAC recovery gate | T1-M2 |
| P9 | Replace Gaussian projection weights with LΨᵀ columns or a SEREEGA lead field | far-field correlation structure | T1-M1 |
| P10 | Fit χ and `knee_freq_*` **jointly** per state | state orderings; any comparability claim | T1-M1 |
| ~~P11~~ | ~~Respiratory mechanism (a), and the amplitude half of (c)~~ | — | **Closed, implemented.** Demo 1 now moves 100% → 1%. See below |

**P7 is implemented and deliberately left unfitted.** Alpha and the slow oscillation are now
non-sinusoidal: triangularity plus a rise-decay asymmetry applied to the instantaneous phase,
so the envelope and the bistable burst structure survive untouched. Measured harmonic content
in the composed signal is 2.9% at 2f₀ and 1.8% at 3f₀ — the mechanism by which waveform shape
manufactures spurious phase-amplitude coupling now exists rather than being absent. **P8
replaces it**: no source consulted gives an rdsym for posterior alpha specifically, so both
magnitude and direction are unfitted and a PAC recovery gate still must not be trusted until
they are.

**P9 and P10 are new**, and each is a concrete blocker rather than a worry:

- **P9** — measured against real EEG, far-field inter-channel correlation is 0.29 against a
  real 0.44, and a handful of Gaussian sources cannot fix it: more global component raises
  far-field correlation and *lowers* effective rank, while real EEG has both at once. Build
  Plan §3.4 already names the fix and the projection-file schema already supports it.
- **P10** — the recovered state ordering is a joint function of χ and the knee, so fitting
  either alone cannot reproduce the documented orderings (Finding 9), and our χ over 1–20 Hz
  is 0.32 against a real 0.99 because the knee sits inside the band (Finding 12).
**P11 is closed, and closing it corrected the claim the artifact makes.** All three respiratory
mechanisms are implemented and separately switchable. Demo 1 now moves: **100% retained at a
0.01 Hz cutoff, 1% at 1 Hz**, against a measured off-resonance noise floor.

But the expectation that motivated half of P11 was wrong. The amplitude half of (c) was added
because a high-pass "removes most of that band" — measured, it is retained at 100–101% across
the entire clinical range, because *a high-pass removes a carrier below its cutoff and does not
remove amplitude modulation of a carrier that passes*. The whole loss is mechanism (a), and
there it is 99.8%.

So the demonstration's content is sharper than intended: a naive respiration–EEG coupling
measure is **dominated by the movement artifact**; filtering removes the artifact and therefore
the apparent coupling — correctly, because (a) *is* an artifact — and the mechanisms that were
physiological all along are untouched. The (c) rows are now Demo 1's control, on screen beside
the row that collapses. That is a better lesson than the one the demo was framed around, and it
is only visible because §5.1 required the three be kept separate. Finding 10, resolved.

Two consequences worth carrying forward: ground truth in the readout is stated **at the
electrode** via `referencedGain()`, because comparing against the source amplitude charged 34%
of projection-and-reference geometry to the filter; and the estimator prints a **measured
off-resonance floor**, because a magnitude estimator never returns zero and "indistinguishable
from nothing" is a claim that needs a floor to license it.
| ~~P5~~ | ~~Re-measure G1a vs G1b error under the full generator~~ | — | **Closed: D3 stands.** See below |
| P6 | Re-derive G1b's bias magnitude at the repaired `k_*` values | any comparability claim | T1-M1 |

**P5 is closed, against the position that opened it.** D3 states *"G1a will show larger
recovery error than G1b."* I measured the ordering reversed by two orders of magnitude and
flagged, correctly, that the clean-signal regime flatters G1a and must be re-measured. An
adversarial review ran that measurement rather than deferring it: **once oscillatory peaks are
present inside 1–45 Hz, G1a's error rises to 0.82–1.11 against G1b's 0.37–0.44 and D3's
ordering holds** — at both 300 s and 30 s, with and without sensor noise.

The reason is sharper than "clean signal": my probe was **model-exact.** The synthesis and the
`specparam` knee model are the same equation, so G1a's estimator was fitting the form that
generated the data, with no peaks to remove first. Under those conditions G1a cannot lose.
**D3 is upheld and needs no amendment.**

**P6 is what actually remains.** D3's *comparability* argument is still weaker than stated —
G1b's bias comes from our modelled 20 Hz knee, not the literature's unmodelled 45 Hz one, so
its magnitude is a function of the `k_*` rows rather than inherited from published measurement
conditions. But the −0.42 figure I recorded was computed at `k = 20^χ`, **which the registry
did not hold**: every `k_*` row contradicted its own stated basis by 16× to 3783×. At the
registry's values the bias is −0.0002 to −0.031. The rows are repaired and `emit.mjs` now
cross-checks `k = knee_freq^χ`, but the magnitude must be re-derived at T1-M1 before any
comparability claim is made. See `Tier0-Estimator-Probe.md`, correction block.
