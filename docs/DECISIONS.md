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

## D19 — the spatial model is separable, and that is why the metrics counterbalance; adopt a lead field

**Decided.** The Gaussian-mixture projection is **retired as the generative spatial model** and
replaced by a published lead field (P9, promoted from shortfall to architecture). The temporal
engine is **kept unchanged**. New rule adopted: **a metric used to fit a parameter may not also be
reported as evidence of realism.**

**Prompted by a design question, not a defect:** *"is this a parsimonious strategy, or are we
setting ourselves up to chase metrics that keep counterbalancing off each other?"* The second. This
entry records why that is structural rather than bad luck, because the distinction determines
whether more fitting would ever help.

### The mechanism: every source is rank 1 in space × time

Each source contributes `s_g(t) · w_g(channel)` — an outer product of a time course and a fixed
topography. The model is therefore **separable**: spatial and temporal structure are independent by
construction, and the channel covariance is exactly

```
C = Σ_g var_g · w_g w_gᵀ
```

which is why the analytic surrogate in Finding 19 is *exact* rather than approximate. Two
consequences follow, and both are visible in the measurements:

1. **The model admits exactly one function of distance.** Correlation-versus-distance is fully
   determined by the Gaussian widths, so near-pair and far-pair correlation cannot be matched
   together. Measured across **21 configurations** spanning four parameters: near-pair at or above
   real (0.740–0.812 against 0.767), far-pair always below (0.251–0.323 against 0.440), PC1 always
   below (0.426–0.473 against 0.534) — **simultaneously, in every one.** The signature never moved
   because it cannot.

2. **The covariance observables are not independent.** Effective rank, PC1 share, near-pair and
   far-pair correlation are four summaries of one 21 × 21 matrix. Fitting any one *necessarily*
   moves the others. This is not tuning difficulty; it is the model family not containing the
   target.

### The degrees-of-freedom accounting

**37 generative spatial rows, 31 of them `invented`.** Section 5 holds 35 rows (27 invented, 2
derived, 1 chosen, 5 literature) plus six more outside it (`background_n_sources`,
`background_global_fraction`, `osc_n_sources`, `osc_coherent_fraction`, `so_origin_coherent_fraction`,
`osc_carrier_flatten`). Four of the five literature rows are `topo_expect_*` — **G6's expectations,
i.e. the test, not the generator** — and the fifth is `so_travel_v`, a velocity. So **no topography
in this project has external provenance.**

Thirty-one invented numbers generate a 21 × 21 covariance and are fitted against ~5 non-independent
statistics of that same covariance. The model is **simultaneously overparameterized in knobs and
underparameterized in shape.** That is the formal statement of the counterbalancing.

### A circularity leak, and the rule that closes it

The project already forbids thresholds derived from our own spread. It did not forbid the
neighbouring error, and Finding 19 committed it: `near_corr` and alpha frontal/occipital prominence
were **fitted**, then reported as "hit almost exactly" — which is evidence the optimiser worked, not
that the model is realistic.

> **Rule (D19).** A metric used to fit a parameter may not also be reported as evidence of realism.
> It becomes a **consistency check**. Realism claims require a metric that was not targeted.

Under this rule, wake_ec's effective rank landing in the real IQR is the one genuine spatial
agreement in Finding 19, because it was not directly targeted. **And it is weak evidence:** rank is
a scalar summary of an eigenspectrum whose *shape* is demonstrably wrong, so it can land correctly
for the wrong reason.

### The same error class, in χ

`chi_wake_ec` is registered 1.1; the generated signal measures 0.29 over 1–20 Hz. This was first
called a knee problem. The sharper diagnosis is that **two different quantities are being
compared**: the registry stores an asymptotic exponent, `compare_real.py` measures an in-band slope,
and `knee_freq_wake_ec` = 12 Hz puts the knee inside the fit band. Build Plan 3.7 already warns that
a published exponent is a joint function of method, band and knee model — the warning was written
and then compared across anyway.

So this is a **quantity-definition error, not a tuning error**, exactly like the leak above. Resolve
by deciding which quantity `chi_*` denotes: either register the in-band slope, or keep the
asymptotic exponent and report the in-band slope as a *derived prediction*. **Do not move the knee
to close a gap between two different quantities.** Registered as P13.

### How this compares to the alternatives

| family | examples | buys | costs |
|---|---|---|---|
| **colored noise + injected oscillations** (ours) | `neurodsp`, most spindle/SO detector-validation work | exact per-source ground truth, direct control of the demonstrated parameter, cheap, auditable | **univariate by design**; spatial claims are outside its competence |
| **lead-field forward model** | SEREEGA, MNE `SourceSimulator`, FieldTrip, Brainstorm | spatial mixing is *physics, not fitted* — distance kernel, eigenspectrum shape, near/far ratio all emerge | needs a head model and lead field (published, free) |
| **neural mass / mean field** | Jansen–Rit, Wendling, The Virtual Brain | rhythms, cross-frequency coupling and state transitions *emerge* from dynamics | parameters are physiological, not "χ = 1.1 at 30 µV"; forfeits the controllability a state simulator needs |
| **MVAR fitted to real data** | connectivity-method validation | unbeatable second-order realism — it is fitted to it | no interpretable knobs, no event ground truth, no counterfactuals; replays the training corpus's statistics |
| **deep generative** | EEG-GANs, diffusion | discriminator-grade realism | zero interpretability, no ground truth; incompatible with *"a model, not a measurement"* |

**Where this project actually sits.** The temporal engine is the correct family for what the χ, PAC
and LZc gates claim, and it is what the `neurodsp`/`specparam` ecosystem does. The trouble began
when the project started making **spatial** claims — volume conduction, topography, inter-channel
correlation, effective rank. The engine was never built to support those, and D18 plus Finding 19
are the record of trying to make it.

### The decision

**Seam 3 already anticipated this.** `tools/make_projection.mjs` states it: *"swapping in eigenmode
columns or a SEREEGA lead field is a file, not a refactor."* This is not a rewrite; it is executing
a seam that was designed in.

1. **Replace the Gaussian weights with a published lead field.** Highest leverage available. Rank,
   PC1, near and far stop being *targets* and become *predictions* — their agreement becomes a
   falsification test, which is this project's gate philosophy rather than a departure from it.
   Parsimony: **31 invented numbers → source locations with literature provenance plus one published
   matrix.** It also removes `topo_reference_far_field` **physically**: A1/A2 pick up less cortex
   because of where they sit in the volume, and a lead field says so, so the fudge introduced in
   D18 disappears rather than being re-tuned.

2. **Distributed sources, not point sources.** A lead field alone is not sufficient: seven dipoles
   through a real lead field still gives rank ≤ 7 and is still separable. The eigenspectrum's
   natural decay comes from cortical **patches** — many dipoles with graded coherence. Lead field
   *and* patches is what makes the covariance shape right.

3. **Then the temporal items a lead field cannot touch:** burstiness (real alpha arrives in bursts;
   ours is a fixed-depth sinusoidal envelope — `neurodsp`'s `sim_bursty_oscillation` is the
   precedent, and this is likely the largest *perceptual* realism gain available), the χ
   quantity-definition fix, and N3's delta dominance.

### What is explicitly rejected

- **Do not chase far-field correlation with more Gaussian parameters.** 21 configurations of direct
  evidence that it cannot work.
- **Do not add sources to fix the eigenspectrum.** That is fitting a symptom of separability.
- **Do not adopt neural-mass or generative approaches.** They forfeit the ground truth and
  auditability that are the project's premise.
- **Do not tune `delta_amp` or the knee frequencies to close metric gaps** until the quantities
  being compared are the same quantity.

### Sequencing constraint

`background_global_fraction` is registered at 0.35, documented in two places as setting the common
mode's variance share, and **read by nothing** — every background source gets equal rms in
`compose.ts` and peak-1 weights in the projection, so the common mode carries 1/`nBg` by accident.
Wiring it changes referenced background variance by ~24%, because a uniform component is nulled
exactly by a linked-mastoid reference. Amplitude calibration (`Pz` RMS 10.0 µV against a real
14.8 µV) depends on it. **Wire it before fitting any amplitude, or the two will fight.**

**Related:** supersedes the *strategy* of D18 while upholding both of its defect findings.
Finding 19 is the measurement record. P9 is promoted and P13 is new.

### Amended the same day by Finding 20 — the decision stands, the mechanism was wrong

Two probes were run **before** any lead field was built, on the principle that cost this project an
8× error once already (Finding 19's self-checking surrogate). Both changed the design.

**1. The far-field deficit was never a forward-model deficiency.** A real fsaverage 3-shell BEM lead
field with a parameter-free white-cortex source model measures far-pair **0.239** under
linked-mastoid — *worse* than the 0.303 of the Gaussian mixture it was meant to replace, with a
near/far ratio of 3.03 against a real 1.74. A coherence-length sweep reproduced the same
far-up/rank-down trade and reached only 0.290. **The prescription in this decision would not have
fixed the metric it named.**

**2. Most of the real 0.440 is the reference.** The same recordings measure far-pair **0.437** under
linked-ear and **0.257** under average reference, with effective rank 3.07 against 5.36 — a 70% swing
from the reference alone, larger than any difference between any two models compared in this project.

That exposes a circularity this entry did not catch. `topo_reference_far_field` = 0.30 is an
**invented** number (D18) for how much cortex the mastoids see, and the generator's linked-mastoid
output depends on it directly. **Fitting spatial parameters against linked-ear far-pair correlation
fitted them against that invented number as much as against the head.** It is the D19 rule's own
failure mode, one level further out than the rule as written.

> **Amendment (D19.1).** Spatial metrics are compared under **average reference**, which is defined
> by the montage and invents nothing. Linked-ear/linked-mastoid figures may be *reported* — it is the
> montage the artifact ships — but no parameter may be fitted against them while any reference
> electrode's cortical pickup is an invented row.

**3. An independent per-channel component is required, not optional.** Under average reference the
lead field is *too* correlated (near 0.553 against a real 0.413) — the opposite sign to the
linked-ear comparison. Real EEG is **less** spatially correlated than white-cortex-through-a-lead-
field, and no source-coherence model can do that, because coherence only raises correlation. Only
per-electrode independent signal lowers it.

`sensor_noise_rms` is 1.5 µV against a 20 µV background: **0.56% of variance, where the fit wants
20%** (~10 µV rms per channel). Not amplifier noise — the non-neural contribution real scalp
recordings carry independently at each site.

**The result that settles the decision:**

| average reference | mean relative error | free parameters |
|---|---|---|
| shipped Gaussian mixture *(linked-ear)* | 0.250 | 31 invented |
| lead field + independent share 0.20 | **0.125** | **1** |

Half the error, one parameter instead of thirty-one, under a reference that invents nothing — so the
numbers are a prediction rather than a fit. **This decision is strengthened; its item 1 rationale is
replaced by the above, and a fourth implementation item is added: an independent per-channel
component, fitted as one number and carrying the caveat that it is an *independent-equivalent* share
under this model, not a measured physiological quantity** (fsaverage is a template, the near/far
split is 2-D, white cortex is an assumption).

**Registered as P16.** Finding 20 is the measurement record.

---

## D18 — volume conduction needs the reference electrodes to differ in kind, and slow oscillations must start at zero

**Two defects found by looking at the artifact, neither of which any gate could see.**

### Slow oscillations were spliced in with a full-amplitude step

`slowOscWaveform` computed `cos(2π(w − 0.5))`, which is `−cos(2πw)` and therefore **−1 at both
endpoints**. Every slow oscillation began and ended at full negative amplitude — a 50–100 µV step
at `so_amp`, added to all 19 channels simultaneously through the projection. On screen: a hard
vertical jump in every trace at once, at each event boundary. `−sin(2πw)` starts and ends at a
zero crossing while keeping standard polarity and the rise-decay warp.

Measured: splice step **100% of amplitude → 1.5%**, and the largest jump at any event boundary is
now **1.04×** the 99.9th percentile of jumps elsewhere — indistinguishable from the background's
own sample-to-sample variation.

**No gate could have caught it.** G3 asks whether YASA finds spindles, G5 about 0.5–2 Hz
occupancy, G6 about topography. A step is broadband, so it barely moves a band ratio; it is
synchronous across channels, so it does not hurt effective rank either. It was plainly visible and
entirely unmeasured — the argument for looking at the trace, not only at the numbers.

### Frontal alpha: a pedestal is exactly what a linked reference removes

D17's far-field mixture did not produce visible frontal alpha, and the reason is structural. The
far term is centred on the source, so it reaches the mastoids too — and the mastoids sit at
(±1.12, 0.08), **closer to an occipital source than Fp1**. They picked up more alpha (0.211) than
the frontal mean (0.196), so linked-mastoid referencing left referenced frontal alpha at
**−0.015**: zero and inverted. No fraction or width could fix that, because a pedestal is common
mode and removing common mode is what a linked reference *is*.

`topo_reference_far_field` attenuates the pedestal at A1/A2 only. The justification is the reason
ear references exist: **the mastoid is behind the ear over bone with no cortex beneath**, so it is
relatively inactive. Fitted jointly against real alpha *prominence* — the height of the 8–12 Hz
bump above each channel's own aperiodic fit — giving 0.296 against a real 0.271.

**D17's fit was against the wrong quantity**, and that is the transferable lesson. It matched
far-pair correlation and reported a frontal/occipital *band-power* ratio of 0.225, which looked
fine while referenced frontal alpha was negative. Band power cannot tell "there is a rhythm here"
from "there is broadband activity here".

### `snr_nominal` re-solved, as a consequence rather than a tweak

Attenuating the mastoids raises the referenced amplitude, so G5's pass fraction went to 1.00.
Re-solved **+1.4288 → −3.0765 dB**; pass fraction 0.67, null still discriminating. This is D5's
calibration-is-a-procedure rule doing exactly what it was written for.

`gate_alpha_ratio`'s invented `> 3` bound now contradicts its own recorded quantity (1049.77 →
1.95). It fails nothing, being record-only, but the bound was set against a generator with no far
field and is not evidence about the new value. Flagged on the row for T1-M2.

---

## D17 — χ(t) is a least-squares slope over 2–40 Hz, not specparam; and G4's null gains an effect-size floor

**Decided against the plan, on measurement.** T1-M2's stated task was to replace the cheap
two-band χ proxy with specparam-per-window (SPRiNT's algorithm). Measured, that would have made
the readout **worse by 2×**, and it could not have shipped anyway.

**An architectural constraint the plan does not state.** `specparam` is Python; the artifact is a
static TypeScript page with no framework dependency (Build Plan §8). The shipped Demo 1 readout
can never call specparam. The harness may — and does, as T1-M2's class-V reference — but the
artifact needs something portable regardless.

**Adopted: `chi_est_band` = 2–40 Hz, `chi_est_window_s` = 2 s, both `derived`.** Ordinary
least-squares slope of log₁₀P on log₁₀f. Minimum detectable `chi_mod_depth` at the respiratory
rate, five candidates on identical windows of identical records: **LS 2–40 Hz 0.048**, two-band
0.058, specparam 2–40 Hz 0.098, LS 30–45 Hz 0.271, specparam 30–45 Hz 0.547. log(MDD) correlates
**−0.85** with band leverage.

**Leverage, not sophistication.** At the *same* band, plain least squares beats specparam 2× on
variance and is also closer on bias (DC χ̂ 1.637 vs 1.734 against an injected 1.66). I predicted
the opposite — that peaks inside 2–40 Hz would bias a plain slope and specparam's peak model would
earn its cost. Per-window peak fitting adds variance to the exponent, and for an AC measurement a
static bias cancels anyway. specparam over 30–45 Hz being worst is Finding 14 resurfacing: 0.176
decades cannot support a slope however good the fitter.

**The units fix matters as much as the 1.21× gain.** A slope returns true χ units; the two-band
ratio returned 0.76 proxy-units per χ-unit, so Demo 1's "injected 0.15, recovered 0.238" was never
like-for-like. Finding 13 flagged that; it is now dimensionally honest. G4's selectivity ratio
improves 4.93 → 7.81.

### D14's null arm was magnitude-blind, and only a better estimator could show it

G4's null **failed** on the new estimator, reporting `LEAKAGE at 0.35 Hz` and *"none of it reaches
χ̂"* in one sentence — `1/12, p = 0.0063, ratio 0.999x`. Both statements were true. **A paired
sign test detects direction, not magnitude:** pairing removes the variance, so with enough
precision any systematic difference clears p < 0.05. Amended — leakage is declared only if it is
**both** consistent **and** exceeds `chi_est_mdd_resp` = 0.048, the estimator's own detection
floor. A difference below what the estimator can detect cannot support or refute a claim.

**The effect metric was also wrong.** It used `obs − null`; both are magnitudes of a line at one
frequency, so an added component of unknown relative phase combines in **quadrature**. On a real
leakage source subtraction says 0.017 where quadrature says 0.033.

**The amended arm's falsification is now CLOSED, and it took a depth sweep.** A single point was
inconclusive: (c)-amplitude at its registered depth leaks 0.033 against the 0.048 floor at
`6/12, p = 1`, so the sign test never fired and the floor never bound. A leakage of amplitude ≈ the
floor added at random phase raises the magnitude only slightly more than half the time, so the
per-seed sign carries almost no information at n = 12.

`resp_amp_mod_depth` therefore gained a CLI override and the leakage was **swept**. The arm first
reports at a leaked line of **0.096, 2.0× the detection floor**, and stays silent below — so the
effect-size floor did not neuter it, and the arm's sensitivity is now a measured number rather
than an assertion. Mechanism (a), its actual target, measures 0.0000 in quadrature.

**Two further defects surfaced in the sweep, both fixed.**

*Ties were counted as evidence.* The depth-0 row compares the arm against itself — bit-identical
records — and read `0/12, p = 0.000488`: highly significant, for two copies of one array. A bare
`a > b` makes every tie a failure, so 12 ties give k = 0, as extreme as k = 12. `paired_sign_test`
now discards ties, and that row reads `0/0, p = 1`. **This was not confined to G4:** G3's null
compares integer detection counts, where ties are ordinary, so it was affected too. Both arms now
use the tie-aware test; no published number changes, because no pair in the current runs ties.

*`resp_amp_mod_depth` is not monotone above ~1.2.* Leakage rises 0.033 → 0.096 → 0.135 then falls
to 0.118, because `1 + d·cos(φ)` passes through zero and rectifies. Harmless for the sweep, but the
row needs a usable-range cap when it is fitted at T1-M1.

---

## D16 — `tilt_block_s` is registered and derived at 0.75 s; the blockwise scheme stays

**Decided and measured.** T1-M2's first measurement found that the generator was delivering
**48% of the requested χ modulation at the respiratory rate** and 11% at 0.40 Hz. The cause was a
hardcoded 2 s coefficient hold in `tiltBlockwise`, which averages Δχ over each block and
overlap-adds at a 0.75·B hop — two stacked smoothings, entirely generator-side.

**The value is derived, not chosen.** Two opposed constraints, both already measured here:
fidelity wants the block short (a hold attenuates f by ≈|sinc(fB)|); settling wants it long
(each block filters from zero state, and its transient is masked only while overlap = B/4 exceeds
the cascade's t99 = 0.164 s, giving B ≥ 0.66 s). The derivation is therefore *the smallest block
that still hides its own settling transient*: **0.75 s**, which measures a **2.1× gain** in
detectable `chi_mod_depth` at the respiratory rate with the noise floor unchanged, and is
verified comb-free (−0.03 dB narrowband excess at the hop rate, against +0.20 dB for the 2 s
block it replaces).

`generator_version` → **0.2.0**, because the generated signal changes for every state whose χ is
modulated. G4 improves (median 0.352 → 0.394) and still passes both arms 12/12.

### Two checks that could not have caught this, both worth stating

**G4 probes the wrong frequency.** It runs at f₁ = 0.10 Hz, where the 2 s hold retains 95%. The
defect lives at the respiratory rate, which G4 deliberately keeps clear of so f₁ and f₂ stay
separable. A gate can only see the frequencies it probes — and G4's design puts the modulation
where the confound isn't, by construction.

**The literal linter's allowlist passed it.** The constant was `Math.round(2 * fs)`, and `2` is
arithmetic furniture. D15 named this failure mode in the abstract; this is the concrete instance,
and it means the allowlist's cost is not hypothetical. It is not widened in response — flagging
every `2` would flag ~124 sites and produce noise, which is a worse trade — but the limitation is
now recorded against a real case rather than as a caveat.

### Two errors in my own first analysis, corrected

The first sweep reported that the attenuation *"tracks the sinc prediction"* on a median that
averaged over a grid whose low-frequency corner is all 1.00/1.00, hiding a systematic W-independent
failure. It also reported *"0.15 is detectable at W = 8 s"* from a formula that divided the
measured floor by the **predicted** sinc while the **measured** attenuation there was 5× smaller;
recomputed model-free, W = 8 s is the worst cell. And the block sweep's noise-floor column was
**vacuous** — measured at depth 0, where Δχ is constant and no transient can occur, which is why
it came out bit-identical across all seven block lengths. All three are recorded in Finding 15.

### The sidecar keeps the requested depth, deliberately

`truth.chiModDepth` still records what was **requested**. What is achieved is scheme- and
frequency-dependent, so recomputing the field would bake a model into a ground-truth field —
the opposite of what a truth block is for. It is documented as requested-not-achieved instead,
with the transfer function measured in Finding 15.

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
| **P9** | Replace Gaussian projection weights with LΨᵀ columns or a SEREEGA lead field | far-field correlation structure; **every spatial claim** | **PROMOTED — decided in D19, now the active work** |
| P10 | Fit χ and `knee_freq_*` **jointly** per state | state orderings; any comparability claim | **Partly closed (Finding 22).** wake_ec SOLVED by inversion — source values whose *output* matches the real recordings, not copies of the measurement. **Knee matched** (10.32 Hz vs a real 9.87, IQR 9.54–10.19). **χ is not, and cannot be here:** output χ floors at 1.27 against a real 0.850 whose own IQR is 0.373–1.300, because a 1–20 Hz band with a 10 Hz knee leaves half a decade to fit an asymptotic exponent from. **Blocked on a corpus, not on fitting** — see P17 |
| P12 | Characterize `filterbank`'s over-response, then decide the default tilt scheme | any χ modulation above ~0.3 Hz | T1-M2 |
| ~~P13~~ | ~~Which quantity `chi_*` denotes~~ | — | **Closed (Finding 22).** `chi_*` keeps its meaning as the asymptotic exponent — D3 depends on the form and G1a fits it. `chi_inband_slope` and `chi_inband_band` register the quantity a reader measures, **derived rather than stored**, because a stored copy of a value computed from two other rows can only drift. It also retired a claim: the `chi_direction` ordering does not survive translation into the in-band slope, so **no state ordering may be claimed from a band-limited fit** |
| P14 | Wire `background_global_fraction`, which is registered and documented but read by nothing | amplitude calibration; `snr_nominal` | before any amplitude fit (D19) |
| P15 | Bursty rather than continuously-modulated oscillation envelopes | perceptual realism; any burst-rate claim | T1-M1 |
| **P16** | Fit the independent per-channel share (~0.20 measured); `sensor_noise_rms` is 1.5 µV = 0.56% of variance where the fit wants 20% | inter-channel correlation; **a second, simpler cause of “too correlated” than topography** | with the lead field (D19.1, Finding 20) |
| **P17** | **Acquire a sleep corpus.** Four of six states (N1, N2, N3, REM) are validated against **nothing**, and wake's χ is unpinnable because EEGMAT's acquisition low-pass caps the usable band at 20 Hz | every sleep row; the asymptotic half of P10; any state-ordering claim | **the largest single lever in the project** |
| ~~P11~~ | ~~Respiratory mechanism (a), and the amplitude half of (c)~~ | — | **Closed, implemented.** Demo 1 now moves 100% → 1%. See below |

**P7 is implemented and deliberately left unfitted.** Alpha and the slow oscillation are now
non-sinusoidal: triangularity plus a rise-decay asymmetry applied to the instantaneous phase,
so the envelope and the bistable burst structure survive untouched. Measured harmonic content
in the composed signal is 2.9% at 2f₀ and 1.8% at 3f₀ — the mechanism by which waveform shape
manufactures spurious phase-amplitude coupling now exists rather than being absent. **P8
replaces it**: no source consulted gives an rdsym for posterior alpha specifically, so both
magnitude and direction are unfitted and a PAC recovery gate still must not be trusted until
they are.

**P12 is new (T1-M2).** The `filterbank` tilt scheme recovers the modulation the blockwise hold
loses — but it **over-responds**, reaching 117% at 0.25 Hz and 130% at 0.40 Hz, where a pure
attenuation cannot exceed 100%. The likely cause is that linear interpolation between two
pre-filtered signals is not the filter at the interpolated tilt: the two outputs share an input
and so are highly correlated, meaning amplitudes blend where log-slopes should. Until that is
characterized the default stays `blockwise` at the derived `tilt_block_s` (D16), because adopting
a scheme with an unexplained 30% over-response would trade a measured error for an unmeasured
one. **Blocks any χ modulation above ~0.3 Hz**, where even the derived block length attenuates
appreciably.

**P9 and P10 are new**, and each is a concrete blocker rather than a worry:

- **P9 is no longer a worry but a decision — see D19.** The original entry read: far-field
  correlation 0.29 against a real 0.44, and a handful of Gaussian sources cannot fix it, because
  more global component raises far-field correlation and *lowers* effective rank while real EEG
  has both at once. Finding 19 turned that into a structural argument with 21 configurations of
  evidence: the model is **separable**, so it admits exactly one function of distance, and
  near-pair sat at or above real while far-pair and PC1 sat below it in every single
  configuration. **31 invented spatial parameters, no topography with external provenance, fitted
  against ~5 non-independent summaries of one covariance matrix.** Build Plan §3.4 names the fix
  and the projection-file schema already supports it, so this is executing seam 3 rather than a
  refactor.
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
