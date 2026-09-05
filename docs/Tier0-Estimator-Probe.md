# Tier 0 estimator probe — findings before implementation

*Measured 2026-07-28 on the toolchain below, against the generative form specified in
`Build-Plan.md` §3.2. Companion to `DECISIONS.md`; see the proposed D7 at the end.*

**This is not T1-M2.** T1-M2 characterizes estimators against the *full generator* at our
SNR and window length in order to derive tolerances. This probe runs on clean, pure-aperiodic
signal at 300 s with no oscillations and no sensor noise. It establishes the working API
recipe and one structural fact. **No tolerance may be derived from it.**

---

## Toolchain as installed

| Package | Version | Gate it serves |
|---|---|---|
| `specparam` | 2.0.0rc7 | G1a / G1b `[V]` |
| `yasa` | 0.7.0 | G3 `[V]` |
| `mne` | 1.12.1 | (YASA dependency; T1 artifact ICA) |
| `numpy` | 1.26.4 | — |
| `scipy` | 1.15.3 | — |

Installed into a project-local venv at `.venv/`. Node v25.5.0 / npm 11.8.0 for the core.

### specparam 2.0 API differs from `fooof` and from specparam 1.x

The 1.x accessor `model.aperiodic_params_` **does not exist** in 2.0.0rc7 and raises
`AttributeError`. The working recipe:

```python
from specparam import SpectralModel

m = SpectralModel(aperiodic_mode='knee', verbose=False)   # or 'fixed'
m.fit(freqs, psd, [1, 45])                                 # fit range is the 3rd positional arg
labels = m.modes.aperiodic.params.labels   # ['offset','knee','exponent'] | ['offset','exponent']
values = m.get_params('aperiodic')         # ndarray, same order as labels
chi    = m.get_params('aperiodic', 'exponent')
```

Always zip against `labels` rather than indexing positionally — the knee-mode and fixed-mode
arrays differ in length, and index 1 means `knee` in one and `exponent` in the other. That is
seam 7's argument restated at the library boundary.

---

## Finding 1 — the `chi = 0` null behaves

White noise, 300 s: fixed mode over 1–45 Hz returns exponent `+0.010`; knee mode returns
exponent `+0.0098` with knee `−0.024`. Both round-trip to zero and knee mode reports no
spurious knee. **The G1 null as specified in harness §5 is satisfiable.**

## Finding 2 — G1b's bias is structural, and roughly 100× G1a's

Eight seeds per χ, knee frequency held at 20 Hz for every χ (so `k = 20^χ`), median reported:

| χ | G1a χ̂ (knee, 1–45) | G1a error | G1a knee recovered | G1b χ̂ (fixed, 30–45) | G1b error | analytic |
|---|---|---|---|---|---|---|
| 0.5 | 0.481 | −0.019 | 16.5 Hz | 0.314 | −0.186 | 0.288 |
| 1.0 | 0.991 | −0.009 | 19.4 Hz | 0.657 | −0.343 | 0.647 |
| 1.5 | 1.493 | −0.007 | 19.8 Hz | 1.078 | −0.422 | 1.069 |
| 2.0 | 1.997 | −0.003 | 19.9 Hz | 1.561 | −0.439 | 1.540 |
| 2.5 | 2.498 | −0.002 | 20.0 Hz | 2.064 | −0.436 | 2.045 |
| 3.0 | 3.000 | −0.000 | 20.0 Hz | 2.588 | −0.412 | 2.574 |

Median |error|: **G1a 0.005, G1b 0.417.**

The `analytic` column is the least-squares slope of the *generative form itself* over
30–45 Hz — no estimator involved:

    d(log₁₀P)/d(log₁₀f) = −χ · f^χ / (k + f^χ)

G1b's measured error (0.417) matches the analytic prediction (0.429) to within 3%.
**`specparam` is not making an error. It is correctly reporting the slope of a curve that is
not a straight line over that band.** The bias is deterministic, and it is a function of `k`.

---

## ⚠ CORRECTION (adversarial review, 2026-07-29) — D3 is UPHELD; this section was wrong

**The caveat below named the right confound and did not spend the ten lines needed to test it.
A reviewer ran that measurement. It reverses the conclusion.**

| regime | G1a \|err\| | G1b \|err\| | D3's expectation |
|---|---|---|---|
| this probe: 300 s, clean | 0.019 | 0.435 | reversed |
| 300 s + oscillatory peaks | **1.110** | 0.435 | **UPHELD** |
| 30 s window, clean | 0.166 | 0.374 | reversed |
| 30 s + peaks | **0.816** | 0.374 | **UPHELD** |
| 30 s + peaks + 1.5 µV sensor noise | **0.815** | 0.415 | **UPHELD** |

**The probe's regime is not merely "clean" — it is model-exact.** `synth_knee()` synthesises
`b − log₁₀(k + f^χ)` and `SpectralModel(aperiodic_mode='knee')` fits `b − log₁₀(k + f^χ)`.
G1a's estimator and the generator are the same equation, over a 300 s record (~10× production
averaging), with no peaks the fit must first remove. **Under those conditions G1a cannot lose.**
That is the confound, and the caveat below does not name it.

**A second error compounds it.** The −0.42 figure below is computed at `k = 20^χ`. The registry
does not hold those values — see the correction to Finding 2's premise in
`registry/parameters.yaml`, where every `k_*` row disagreed with its own stated basis by 16× to
3783×. At the registry's actual `k`, the analytic 30–45 Hz bias is **−0.0002 to −0.031**, not
−0.42, and re-running the sweep at the registry's own (χ, k) gives median |error| G1a 0.006,
**G1b 0.021**. The `k_*` rows have since been repaired and `emit.mjs` now cross-checks
`k = knee_freq^χ`, but every number in the table below is from the `20^χ` parameterisation.

**What survives:** G1b's bias *is* structural and *is* generated by the modelled 20 Hz knee
rather than inherited from the literature's 45 Hz one — that part of the reasoning holds, and
it is why the analytic-slope column matches the measurement. What does not survive is the
ordering claim and the magnitude.

*Original text follows, retained because the reasoning is instructive about how it failed.*

## ~~Consequence — two claims in `DECISIONS.md` D3 do not survive contact~~

**D3 says:** *"G1a will show larger recovery error than G1b. […] χ and `k` trade off strongly
over that span. Record it; do not chase it."*

In this regime the ordering is **reversed, by two orders of magnitude.** The χ/`k` tradeoff D3
anticipates is real but small when the fit band spans a decade below the knee and the model
form is exactly correct. Caveat that keeps this honest: the full generator adds oscillatory
peaks inside 1–45 Hz and runs a 30 s window, both of which attack G1a specifically. **The
ordering must be re-measured under the full generator before D3 is amended** — this probe
justifies re-opening the question, not answering it.

**D3 also says** the 30–45 Hz bias is inherited from the unmodelled ~45 Hz knee, and that
reproducing it is what makes our narrowband χ comparable to published values:

> *"The published narrowband exponents this project compares against were themselves fitted
> fixed-mode over 30–45 Hz with that knee present."*

But in our generator there **is no 45 Hz knee** — `knee_freq_high_unmodelled` is registered as
documented and not generated at any tier. Every bit of the −0.42 above comes from the
*modelled 20 Hz* knee, because 30–45 Hz is only 1.5–2.25× above 20 Hz and `k` still
contributes 15–30% of `(k + f^χ)` across the band.

So the bias is reproduced **in form but not in mechanism**, and its magnitude is set by our
own `k_wake` … `k_rem` — every one of which is `invented` and pending T1-M1. D3's comparability
argument requires the bias to be inherited from the literature's measurement conditions; here
it is a free parameter we chose. That is a different claim and a weaker one.

This does not change what gets built: G1a and G1b are record-only at Tier 0 either way, and
"keep the bias" remains right — removing it would still produce a number corresponding to
nothing. What changes is **what the runner is allowed to print next to G1b**, and what T1-M1
must check.

### Proposed `DECISIONS.md` D7 (not yet entered — needs the full-generator re-measurement)

> **G1b's narrowband bias is generated by the modelled 20 Hz knee, not inherited from the
> literature's 45 Hz knee.** Its magnitude is therefore a function of the `invented` `k_*`
> rows and is not evidence of comparability with published narrowband exponents. The runner
> prints G1b's recovery error alongside the analytic slope of the generative form over the
> same band, so the structural component is visibly separated from estimator error. T1-M1
> must report, for each fitted `k_*`, the analytic 30–45 Hz bias it implies, and any claim of
> comparability with a published narrowband χ must cite that number.

---

---

# The tilt filter — P2 answered, P3 shown to be unanswerable yet

`DECISIONS.md` lists P2 (`tilt_n_poles` and spacing for flatness across 1–45 Hz) and P3
(`tilt_mod_settling_ratio` sufficient to suppress sidebands) as pending, both due T0-M4, both
blocking G4. Sideband contamination is rated **High** in the risk register.

## The design, derived rather than guessed

Cascade of first-order pole–zero pairs, poles log-spaced by ratio `D`, zero of each pair
offset from its pole by `D^g`:

    H(s) = Π (1 + s/z_i)/(1 + s/p_i),   p_i = p₀·Dⁱ,   z_i = p_i·D^g

Each section contributes `20·log₁₀(z_i/p_i)` dB in total; with `1/log₁₀D` poles per decade
the mean amplitude slope is `20g` dB/decade, so the achieved **PSD exponent is −2g** and is
independent of `D`. `D` controls only the ripple.

> **Sign convention, measured, not reasoned:** zeros *below* poles (`g < 0`) give a *rising*
> PSD. `g = −Δχ/2` yields PSD ∝ f^(+Δχ). I got this backwards once while writing the probe.
> The implementation must pin it with a unit test asserting the achieved slope's sign against
> a known input, not with a comment — this is the sign that silently inverts the wake/sleep
> phase reversal in §5.2, where the artifact's most striking behaviour lives.

## Finding 3 — second-order sections are mandatory, not preferred

Built via `zpk2tf` + `lfilter`, cascades of 12–24 poles **overflow to non-finite values**
within a 120 s impulse response. Transfer-function form is too ill-conditioned at this order.
Converted to SOS (`zpk2sos` + `sosfilt`), every design tested is stable and settles cleanly.

**`tilt_n_poles` cannot be chosen independently of the filter realization.** The TypeScript
implementation needs a biquad-cascade structure; a direct-form implementation of the same
mathematics is not an equivalent choice, it is a broken one.

## Finding 4 — P2: ripple is ~15% of Δχ at 4 poles/decade, and scales with Δχ

Peak-to-peak variation of the achieved PSD exponent across 1–45 Hz:

| poles/decade | n poles | Δχ = 0.2 | Δχ = 0.5 | Δχ = 1.0 | ripple / Δχ |
|---|---|---|---|---|---|
| 1 | 3 | 0.268 | 0.616 | 0.877 | ~100% |
| 2 | 6 | 0.041 | 0.112 | 0.242 | ~22% |
| 3 | 9 | 0.033 | 0.087 | 0.186 | ~18% |
| **4** | **12** | **0.028** | **0.074** | **0.161** | **~15%** |
| 6 | 18 | 0.022 | 0.060 | 0.131 | ~12% |
| 8 | 24 | 0.019 | 0.052 | 0.113 | ~10% |

Ripple scales roughly linearly with Δχ, so **relative** ripple is depth-independent — which
matters, because `chi_mod_depth` is `invented` and pending T1-M1, so an absolute flatness
criterion would have to be revised once it is fitted and a relative one will not.

The 1→2 poles/decade step buys a 5× reduction; everything after that is slow. **Proposed
`tilt_n_poles` = 12** (4 per decade over 0.1–115 Hz, i.e. 1 decade of pad either side of
1–45 Hz), giving ~15% relative ripple at 6 biquad sections. 24 poles buys 15%→10% for double
the cost. Standing would be `derived` — it comes from a stated procedure against a stated
flatness criterion, not from taste.

## Finding 5 — P3 is a red herring as posed, and cannot be closed before G4 exists

Settling time of the cascade, measured as 99% of impulse-response energy:

| poles/decade | t₉₉ | vs 10 s modulation period at f₁ = 0.10 Hz |
|---|---|---|
| 2 | 0.195 s | 51× |
| 4 | 0.164 s | **61×** |
| 8 | 0.148 s | 68× |

The intuition that a pole at 0.1 Hz implies a ~1.6 s time constant is **wrong for this
cascade**: each pole sits within a factor `D^g` (≈0.81) of its own zero, so the pairs nearly
cancel and each contributes a small, fast-decaying residue. Even against the fastest
respiration in the registry (0.25 Hz, 4 s period) the ratio is 24×.

**So `tilt_mod_settling_ratio` is satisfied with roughly two orders of magnitude of margin,
and "modulate slowly relative to settling time" is not the mitigation that matters.** The
residual sideband risk lives entirely in *how coefficients are interpolated between updates* —
block-wise recompute with crossfade, versus interpolating between a bank of pre-settled LTI
filters — which is a different question from the one P3 asks.

I attempted to measure that directly and **the attempt failed in an instructive way.** The
band-power-ratio proxy I used to recover χ(t) is itself nonlinear in χ, so the harmonic
distortion it reported (≈ −10 dB at 2f₁) measures my estimator and not the filter. Reporting
those numbers would have been precisely the failure mode the harness spec opens by naming —
*"a passing gate is worse than no gate"* — with the sign reversed.

> **Conclusion for P3: the measurement of "does the tilt filter manufacture sidebands" *is*
> G4.** It cannot be answered by a cheaper proxy beforehand, because any proxy weak enough to
> build quickly is nonlinear enough to fabricate the answer. P3's T0-M4 due date is correct
> and cannot be pulled earlier. What P3's registry row should say is not a number but a
> procedure: *the chosen interpolation scheme is the one whose G4 f₂ coupling sits below the
> surrogate 95th percentile*, with the schemes compared as a documented experiment.

## What is safe to hand the implementation

1. Cascaded pole–zero design as above; **SOS/biquad cascade only**.
2. `tilt_n_poles` = 12 at 4 poles/decade over 0.1–115 Hz — provisional `derived`, revisit if
   the flatness criterion is tightened.
3. PSD exponent = −2g; pin the sign with a unit test.
4. Build **both** coefficient-update schemes behind one interface, and let G4 choose between
   them. Do not pick one on reasoning.

---

# Finding 6 — G4's pass criterion cannot be satisfied as specified `[CONFIRMED]`

**This is the most important gate in Tier 0 and its positive arm is unpassable as written.**
Raised by the cross-document audit, verified numerically here.

`DECISIONS.md` D4 and harness §5 G4 set the criterion as: coupling index at f₁ exceeds the
95th percentile of a null built from **200 circular shifts of the phase reference**.

For an alignment-sensitive coupling index `MI = |⟨χ(t)·e^{iφ(t)}⟩|` and a phase reference that
is a clean ramp `φ(t) = 2πf₁t`, a circular shift by τ gives

    e^{iφ(t+τ)} = e^{iφ(t)} · e^{i2πf₁τ}

which multiplies `MI` by a **unit-magnitude constant**. The magnitude is invariant, so the
null is a point mass at the observed value.

Measured, 300 s at 256 Hz, χ modulated at f₁ = 0.10 Hz, 200 surrogates:

| | observed MI | null median | null 95th pct | null IQR | obs / p95 |
|---|---|---|---|---|---|
| **A. f₁ arm, ideal ramp reference** | 0.250000 | 0.250000 | 0.250000 | **0.0** | **1.000** |
| B. f₂ arm, respiration cv = 0.02 | 2.56e−3 | 2.06e−3 | 2.55e−3 | 8.4e−4 | 1.002 |
| B. f₂ arm, respiration cv = 0.10 | 2.82e−3 | 2.25e−3 | 2.82e−3 | 9.8e−4 | 1.001 |
| B. f₂ arm, respiration cv = 0.25 | 1.21e−2 | 1.07e−2 | 1.21e−2 | 2.8e−3 | 0.995 |
| **C. coupling to the shifted reference itself** | 0.249891 | 3.17e−2 | 1.55e−1 | 4.8e−2 | **1.611** |

**Row A is exact, not approximate** — zero IQR to floating point. `obs > p95` is false, so the
f₁ arm returns *fail* on a perfect signal, forever.

**Row C is the diagnosis.** Circular-shift surrogates are a sound null for testing coupling
**between χ(t) and a reference that has genuine temporal structure** — there the null is
healthy (median 0.032 against an observed 0.250, obs/p95 = 1.61). The method is not wrong; it
is being asked the wrong question.

G4 conflates two different tests under one criterion:

- *"Is χ coupled to respiration?"* — a **phase-reference** question. Circular shift is the
  correct null. This is the f₂ arm, and row C shows it works.
- *"Is χ modulated at f₁?"* — a **spectral-line** question. There is no reference to shift;
  the f₁ "reference" is our own injected modulator, which is by construction a clean ramp.
  Circular shift is not a null for it at all.

**Row B carries a second, independent defect.** On the f₂ arm the observed value sits at
`obs/p95 ≈ 1.00` across every respiration regularity tested — i.e. right at the threshold, as
a ~5% per-seed coin flip *by construction*, since a correct null puts the observation inside
its own distribution. At `n_seeds` = 20 an "all seeds must pass" aggregation therefore fails
about 64% of the time (0.95²⁰ = 0.36) with a perfectly working generator. The spec never
states how per-seed results aggregate to a verdict, so the f₂ arm is unimplementable as
written on top of being mis-nulled.

### Proposed resolution — `DECISIONS.md` D8, superseding D4's criterion

> **The f₁ arm takes a spectral-neighbourhood null; the f₂ arm keeps the circular-shift null
> and an exact-binomial verdict.**
>
> - **f₁ (positive arm).** Compare the coupling index at f₁ against its distribution over
>   neighbouring frequency bins, excluding f₂ and the sidebands f₂±f₁ together with the
>   `g4_min_bin_separation` guard band already in the registry. The threshold is the 95th
>   percentile of that neighbourhood distribution. This is still "derived from estimator
>   properties" as §1 requires — it is the standard null for a spectral line — and it survives
>   the invariance that kills the circular shift, because neighbouring bins are not related to
>   f₁ by a unit-magnitude phase factor.
> - **f₂ (negative arm).** Keep the circular-shift null, which row C shows is sound here.
>   Aggregate across seeds with an **exact binomial test against the 5% per-seed
>   false-exceedance rate the 95th percentile defines**, not "all seeds must pass."
> - `g4_percentile` splits into two rows: the percentile *level* (`chosen` — 95 could as
>   easily be 99) and the threshold *value* at that level (`derived`, computed per run).

**Consequence for the build order.** Harness §9 says to build G4 first because it "most
changes what gets built." That is now doubly true: the gate needs its criterion repaired
before it is written, and the repair is a decision, not an implementation detail. **G4 must
not be implemented against D4 as it stands.**

---

# Finding 7 — filtered-noise oscillations have an intrinsic beat that swamps imposed structure

**This affects spindles, where duration is a definitional AASM criterion, not just alpha.**

Prompted by a direct question: *does the generated alpha come in characteristic bursts?* Real
posterior alpha arrives in runs of roughly 0.5–2 s. Measured on 600 s of generated wake-EC at
Pz, Hilbert envelope of the 8–12 Hz band:

| | before | after burst structure + carrier flattening |
|---|---|---|
| median run length | **0.23 s** | 0.35 s |
| runs per minute | 56 | 58 |
| envelope CV | 0.60 | 0.76 |
| envelope power above 1 Hz | 46% | 31% |
| *injected* burst length | — | 1.25 s at 25/min (52% duty) |

**The original answer was no.** What looked like waxing and waning was the **intrinsic Rayleigh
envelope of narrowband Gaussian noise**, whose timescale is fixed by the bandwidth at ~1/B —
0.25 s for an 8–12 Hz band, which is exactly what was measured. The explicit 0.3 Hz envelope
carried only 11% of the modulation power; it was not producing the structure, the filter was.

**An envelope cannot impose burst structure on filtered noise.** Multiplying by a burst
envelope leaves the intrinsic fluctuation underneath, so a detector still fragments each
imposed 1.25 s burst into several short runs. Dividing the carrier by its own smoothed
envelope raised to `osc_carrier_flatten` before imposing bursts suppresses the beat; the
smoothing window is 1/B, derived from the bandwidth rather than tuned.

**Two measurement errors on the way, both instructive.**

1. The envelope estimator for flattening was **causal**, so it lagged the signal by half a
   window and corrected the envelope at the wrong moment: it cut the carrier's envelope CV
   only from 0.353 to 0.239. Centring it is a two-line change and invisible in review.
2. The burst detector thresholded at a **fixed 75th percentile**, which is degenerate when the
   percentile coincides with the duty cycle — the threshold then sits exactly on the burst
   edge, where any wobble splits one real burst into several. At 25% duty that is the worst
   possible choice, and it produced a full round of chasing the generator for a defect in the
   probe. The threshold must be derived from the injected duty cycle.

**What remains unresolved.** At the registered values a detector still reads 0.35 s where 1.25 s
was injected. The machinery is demonstrably sound — at 3 s bursts and a 2% floor it measures
1.96 s at 7.6/min, matching the injection — so this is a question of how hard to flatten the
carrier, and `osc_carrier_flatten` = 0.75 is a compromise picked by eye. Flattening harder
makes the carrier a frequency-modulated near-sinusoid, which is the tell that *"never a pure
sinusoid"* exists to prevent.

### Consequence for G3, which is the reason this matters

`spindle_dur_min` = 0.5 s is **definitional**, from AASM, and G3 runs YASA's detector against
our ground-truth event list. A spindle built as filtered noise in an 11–16 Hz band has an
intrinsic beat of ~1/5 Hz = 0.2 s. **A generator that injects 0.8 s spindles could have them
detected as 0.2 s events and fail G3 for a reason that has nothing to do with spindle
morphology** — and the failure would look like a morphology problem, which is exactly the case
harness §7 warns about: *"A spindle F1 anomaly when the amplitude scale is wrong is not a
morphology problem, and tuning morphology to fix it makes the generator worse."*

WP-E must apply carrier flattening to spindles, and G3 must record the detected-versus-injected
duration distribution alongside F1, or the curve will be uninterpretable.

---

# Finding 8 — a synthesis comb landed exactly on `g4_f2`

Found while building the coupling probe, and it sat on the arm of G4 that must show **no**
coupling.

With no modulation injected at all, the recovered χ(t) carried a spurious line at 0.25 Hz
**nine times** the size of the 0.10 Hz baseline — and injecting genuine coupling at 0.25 Hz
partially *cancelled* against it.

**Cause.** `synth_block` (4096) − `synth_overlap` (1024) = a hop of 3072 samples = **12 s**, so
overlap-add deposits a comb at k/12 Hz. And:

| | harmonic of 1/12 Hz | on the comb? |
|---|---|---|
| `g4_f1` = 0.10 Hz | 1.2 | no |
| `g4_f2` = 0.25 Hz | **3.0** | **exactly** |

The arm that looked healthy was the one that happened to sit *off* the comb. A gate built on
this would have reported leakage the generator never produced, or masked leakage it did.

**An equal-power crossfade does not prevent it.** Consecutive blocks are independent
realizations, so the variance is flat through the join while the local *spectrum* still
wobbles. The fix is to stop having a block rate: whenever the run length is known — every
export, every gate — synthesis uses a single transform. The block path remains for the live
streaming buffer, where nothing scientific is measured across a boundary.

**Two wrong diagnoses on the way**, both recorded rather than deleted: estimator window
smoothing (shortening the window did not help) and the tilt coefficient scheme (both schemes
failed identically). What isolated it was driving the *independent* modulator **at** the
respiration frequency — it failed the same way, proving the driver innocent and the frequency
guilty.

This is the same bug shape as the epoch-boundary comb fixed earlier, one level down.

---

# Finding 9 — the state ordering cannot be set from `chi_*`, and three symptoms share one cause

Build Plan §7 sets a trap deliberately: *"Do not assume monotonic orderings … **Treat a clean
ladder from wake down to N3 as a bug.**"* Measured across all six states, 8 seeds, Pz:

| state | χ broad (1–45, knee) | χ narrow (30–45, fixed) | LZc normalized |
|---|---|---|---|
| wake EO | 0.875 | 0.631 | 0.595 |
| wake EC | 1.800 | 0.909 | 0.639 |
| N1 | 1.400 | 1.227 | 0.595 |
| N2 | 1.700 | 1.554 | 0.553 |
| N3 | 1.650 | 1.619 | 0.463 |
| REM | 2.275 | 1.668 | 0.600 |

**The generator walked straight into the trap**, and the fix is not what it looks like.

### The recovered ordering is a joint function of χ and the knee

`chi_n3` was lowered to 1.66, below `chi_n2` = 1.70, to encode the small N3 reversal §7
documents. It shows up in the **broad** band (1.650 < 1.700) and **not** in the narrow band
(1.619 > 1.554) — because the 30–45 Hz fit is biased by the knee, and the states have
different knees by design (`knee_present`: prominent in REM, absent in N3). N2's knee at 10 Hz
flattens its narrowband fit; N3's at 0.5 Hz barely touches it.

**So the recovered ordering cannot be set by setting `chi_*`.** It is fixed jointly by χ and
`knee_freq_*`, which is seam 7's rule — *"an exponent is a (value, band, mode) tuple"* —
arriving as a concrete consequence rather than a style guide. **T1-M1 must fit χ and the knee
together, per state, against a corpus; fitting either alone cannot reproduce the documented
orderings.** Chasing it by hand now would be tuning invented numbers until a plot looked
right, which is the failure mode the whole registry exists to prevent.

### The broad band is already non-monotone, and that is the band-choice artifact

wake-EC's broadband χ (1.800) exceeds N1's (1.400). That is the alpha peak contaminating a
knee-mode fit, and it is exactly the effect §7 names: *"broadband and narrowband fits give
different orderings across sleep stages, and much of the apparent disagreement in this
literature is a band-choice artifact."* The artifact will show this the moment a user toggles
the band control, which is the point of making it a control.

### ⚠ CORRECTION — "one cause" was wrong, and the calibration proved it

The section below attributes three symptoms to `snr_nominal` not yet existing. **It now exists,
and it does not fix them.** Solved on the fixture seed, `snr_nominal` = **+1.43 dB**, a gain of
×1.18 — essentially nothing. YASA's spindle recall moved 0.29 → 0.36; the ratios that matter
are unchanged:

| | amplitude | / background | anchored by |
|---|---|---|---|
| `delta_amp` | 150 µV p-p → 53 µV RMS | **2.65** | the AASM criterion, definitionally |
| `spindle_amp` | 40 µV p-p → 14 µV RMS | **0.71** | *nothing* |

**`snr_nominal` is ONE GLOBAL SCALAR.** It multiplies every non-background source equally, so
it cannot change the ratio *between* spindles and delta — those are set independently in the
registry, and only delta is tied to a definitional threshold. The AASM criterion anchors the
N3 delta amplitude scale **and nothing else in the project.**

So the correct statement is weaker and more specific than the one below: the three symptoms
share a *class* of cause — uncalibrated relative amplitudes — but they do not share a single
parameter, and calibration was never going to resolve them. Spindle amplitude relative to
background is unconstrained by any definitional threshold and requires T1-M1 corpus fitting.
The instinct to wait for the upstream node was right; the identification of which node was not.

**A second thing calibration revealed.** Solving for the mix at which N3 *exactly meets* the
criterion puts the fixture epoch at the threshold boundary, so held-out epochs land on either
side of it and the pass fraction comes out near 0.5 — measured 0.44. That is **by
construction**, not a defect, and it is one more reason the positive arm cannot carry a
verdict: the number it reports is largely a statement about where calibration was aimed.

*Original text follows.*

### ~~Three symptoms, one cause~~

**LZc does not rise from N1 to N2**, which §7 documents that it should. N2's extra complexity
should come from its spindles and K-complexes — N1 has neither — and instead LZc tracks χ
almost mechanically. The graphoelements are present in the event list and in the trace, but
too weak against the background to move a complexity measure.

That is the same root cause as two findings already recorded: **YASA's spindle recall of 0.29**
(Finding in the WP-E commit) and the graphoelements being visually underwhelming in
`docs/graphoelements.png`. All three are the amplitude of injected events relative to the
aperiodic background, which is uncalibrated because **`snr_nominal` does not exist yet** — it
is solved at T0-M5.

Harness §7's dependency rule says this plainly: *"if a gate fails, refuse to evaluate its
dependents and report the earliest failure only … A spindle F1 anomaly when the amplitude
scale is wrong is not a morphology problem, and tuning morphology to fix it makes the
generator worse."* Three downstream symptoms, one upstream node, and the node is scheduled.
**Nothing here should be tuned before T0-M5.**

### Collinearity — the good news

| pair | r |
|---|---|
| χ broad vs LZc | **−0.01** |
| χ narrow vs LZc | −0.50 |
| χ broad vs χ narrow | +0.68 |

The register rates collinearity between the observable axes **High**, and investigators have
asked in print whether LZc adds anything over the aperiodic exponent. At these values it does:
LZc is essentially uncorrelated with the broadband exponent and only moderately correlated
with the narrowband one. The χ-broad/χ-narrow correlation of +0.68 sits close to the r ≈ 0.7
the Build Plan quotes for N1–N3 separation by slope.

**This number must be displayed in the artifact**, not merely measured here — §7 requires it.

---

# Finding 10 — the filter demonstration does not yet demonstrate coupling loss `[RESOLVED — and it changed the claim]`

The Tier 0 shipping test names the filter demonstration as the artifact's thesis and says to
protect it above everything else. Built and measured, **Demo 1 shows no loss**:

| high-pass cutoff | injected depth | recovered | retained |
|---|---|---|---|
| 0.01 Hz | 0.150 | 0.140 | 93% |
| 0.1 Hz | 0.150 | 0.140 | 93% |
| 0.5 Hz | 0.150 | 0.140 | 93% |
| **1.0 Hz** | 0.150 | 0.136 | **91%** |

Two percentage points across the entire clinical range. The demonstration is supposed to show
a ground-truth line *visibly diverging* from the recovered estimate.

### Why, and it is not a bug in the filter

**The coupling is carried entirely above the cutoff.** χ(t) is estimated from a ratio of band
powers at 2–8 Hz and 16–40 Hz. A high-pass at 1 Hz does not touch either band. Respiration
modulates the *spectral slope*, and slope modulation lives in the envelope of frequencies well
above the filter's stopband — so no high-pass in the clinical range can remove it.

That is a true statement about mechanism **(c)**, and it is the only respiratory mechanism
currently implemented.

### What the demonstration actually needs

Build Plan §5.1 lists three mechanisms and insists they be kept separate:

- **(a) respiratory movement artifact** — mechanical, *at* the respiratory rate. Energy at
  0.25 Hz. A 0.5–1 Hz high-pass removes it **completely**. *Not implemented.*
- **(b) RMBO** — respiration-entrained neural activity. *Not implemented.*
- **(c) respiration-phase modulation of amplitude and of the aperiodic exponent.** Only the
  *exponent* half is implemented; the *amplitude* half — respiration modulating the amplitude
  of low-frequency content — would also be removed by the filter, because that content sits
  in the stopband.

**So the demonstration is measuring the one mechanism a high-pass cannot damage, and omitting
the two it destroys.** The plan's own framing is right — *"standard EEG practice high-passes at
0.5–1 Hz, directly on top of the respiratory rate"* — but "directly on top of the respiratory
rate" bites on mechanisms (a) and the amplitude half of (c), not on slope modulation.

**This is the same gap the review found in G4.** Its negative arm was called vacuous "unless
the respiratory movement artifact is enabled at f₂", because the sidebands the gate hunts are
intermodulation products needing energy at *both* frequencies. Mechanism (a) missing breaks
the gate and the demo for one reason.

### What to do

Implement mechanism (a), and the amplitude half of (c), before claiming the demonstration
works. Both are small — (a) is a low-frequency component at the respiratory rate with a
mechanical topography; the amplitude half of (c) modulates the delta/theta envelope by
respiratory phase. Neither needs new architecture: both project through the existing path.

Until then the artifact ships **Demo 2 and Demo 3 working and Demo 1 flat**, which is worth
stating plainly rather than letting a 91% readout imply the filter was gentle.

---

## RESOLVED — and the fix corrected the lesson, not just the number

All three mechanisms are implemented and separately switchable (`movementArtifact`,
`amplitudeModulation`, `chiModulation` on `ComposeOptions`). Measured, N3, 180 s, Fz, linked
mastoid, with all three on:

| cutoff | (a) artifact | (c) amp-mod | retained | (c) χ-mod | retained |
|---|---|---|---|---|---|
| 0.01 Hz | 11.14 µV | 0.2198 | 100% | 0.2311 | 100% |
| 0.10 Hz | 11.10 µV | 0.2198 | 100% | 0.2311 | 100% |
| 0.50 Hz | **0.02 µV** | 0.2211 | 101% | 0.2312 | 100% |
| 1.00 Hz | **0.05 µV** | 0.2227 | 101% | 0.2304 | 100% |

**One prediction above was wrong.** The amplitude half of (c) was expected to be removed too,
"because that content sits in the stopband." It is retained at 100–101% across the entire
clinical range. The reasoning error: *a high-pass removes a carrier below its cutoff, but it
does not remove amplitude modulation of a carrier that passes.* Modulating 0.5–4 Hz delta at
0.25 Hz puts sidebands around the delta band, not at 0.25 Hz, and a 1 Hz cutoff keeps the delta
that carries them. Only the modulation of content genuinely below the cutoff is lost, and
almost none of the delta band is.

So the loss is carried entirely by mechanism **(a)**, and there it is total: **11.14 → 0.02 µV,
a 99.8% collapse**.

### The honest lesson is sharper than the one the demo was framed around

The original framing — *the filter destroys real respiratory coupling* — is not what the
generator shows. What it shows is:

> A naive respiration–EEG coupling measure is **dominated by the movement artifact**. Filtering
> removes the artifact and therefore removes the apparent coupling — and that is the filter
> working correctly, because (a) *is* an artifact. The two mechanisms that were physiological
> all along, (c)'s amplitude and exponent halves, are untouched.

This is a better demonstration than the intended one, because the failure mode it exhibits is
the one that actually appears in the literature: reporting a coupling number without
establishing which mechanism carries it. It is also exactly why Build Plan §5.1 insists the
three be kept separate, and the separation is what made the diagnosis possible at all.

The artifact's Demo 1 was rewired to report this: `respiratoryCoupling()` in µV — the
component locked to respiratory phase — with the χ-modulation row beside it as the control
that does not move.

### Two things the rewire forced, both worth recording

**Ground truth had to be stated at the electrode, not at the source.** Comparing recovered µV
against the injected source amplitude showed 66% retained at a 0.01 Hz cutoff, where the filter
has done nothing. The missing 34% was projection weight and the linked-mastoid subtraction —
geometry being charged to the filter, the same conflation the demo exists to warn about.
`referencedGain()` pushes the generator's weight vector through the *same* `applyReference`
operator as a one-sample record (every operator there is linear and sample-wise, so the result
is exact) and the readout is now ~100% at low cutoff under all five montages.

**The estimator needed a stated floor.** `respiratoryCoupling` takes a magnitude, so it returns
something positive from any finite record; retained read 103–130% at low cutoff, worst under the
Laplacian where the injected amplitude is only ~2 µV. The null is an *off-resonance* probe — the
same estimator against a phase ramp at 1.7× the respiratory rate. The first attempt, a circular
rotation of the real phase, is **wrong here**: respiration is near-periodic, a rotation by half
a cycle anti-aligns, and a magnitude estimator returns the signal back rather than a null.

Measured, linked mastoid: recovered 9.96 µV against a floor of 2.87 µV at 0.01 Hz — clearly
above it; recovered 0.21 µV against a floor of 0.11 µV at 0.5 Hz — *at* it. The correct reading
is not "the coupling shrank" but "after filtering, the coupling is indistinguishable from
nothing," and only a stated floor licenses that sentence.

**This also unblocks G4's negative arm**, which needed energy at f₂ for the intermodulation
sidebands to exist. Mechanism (a) supplies it.

### Demo 3 does work, and is the most visceral of the three as the plan predicted

Energy the filter *invented* on an isolated K-complex, measured as filtered − original:

| cutoff | invented RMS | vs signal RMS 22.7 µV |
|---|---|---|
| 0.01 Hz | 0.64 µV | 3% |
| 0.1 Hz | 2.05 µV | 9% |
| 0.5 Hz | 3.98 µV | 18% |
| 1.0 Hz | 5.31 µV | **23%** |

At the standard clinical cutoff nearly a quarter of the trace's amplitude, on a K-complex, is
deflection the filter created. With ground truth we can draw exactly which deflections those
are — which no real recording can.

---

# Finding 11 — the channels were effectively rank 1, and N3 still is

Prompted by an observation that the traces looked "extremely synchronized". They were.

| | effective rank | PC1 variance | median \|corr\| |
|---|---|---|---|
| **before**, one uniform background source | **1.14** | 93% | **0.988** |
| **after**, six spatially distinct sources | **2.99** | 55% | 0.37 |

Effective rank is the participation ratio (Σλ)²/Σλ², which needs no threshold. Nominal rank
was always 19; that is not the question. **One background source with uniform scalp weighting
at 20 µV against 1.5 µV of independent sensor noise is a 180:1 variance ratio, so every channel
was the same trace scaled.**

Build Plan §3.1 forbids per-channel independent signals — *"instantly wrong to anyone who has
looked at EEG"* — and a single shared source is the opposite error, equally visible in a
covariance matrix and equally wrong. The rule guards one ditch and says nothing about the other.

Six overlapping wide Gaussian sources give correlation that falls off with distance, which is
what volume conduction produces. The count and width are `invented` and marked.

### N3 is still effectively rank 1.2, and that is only half excusable

| state | linked mastoid | average | Laplacian |
|---|---|---|---|
| wake EC | 2.99 | 3.04 | **4.83** |
| N2 | 3.81 | 3.73 | 4.60 |
| **N3** | **1.17** | 1.23 | 1.23 |

N3's variance is dominated by the delta generator, which is still a *single* shared source at
53 µV RMS. Widespread synchronous slow-wave activity is the defining feature of N3, so a low
rank there is partly correct — but 1.17 means one component, and real N3 is not one component.
**The same fix applies: several delta sources rather than one.** Not done, because it is a
modelling decision about whether slow-wave activity is one distributed source or several, and
that should be answered by T1-M1 fitting rather than by picking a number that improves a
statistic.

### Referencing is a rank operation, and now a control

Reference montages are exposed in the artifact: as-generated, linked mastoid, contralateral
mastoid (the AASM derivation), average, and a nearest-neighbour Laplacian. The Laplacian nearly
doubles the effective rank in wake — not by adding information, but by removing the common
component that was dominating it.

**And the reference changes every downstream number**, which is the reason it belongs in an
artifact about what analysis choices do to data. On the same 90 s of N3:

| reference | χ (1–45 Hz, knee) | LZc |
|---|---|---|
| as generated | 1.650 | 0.510 |
| linked mastoid | 1.550 | 0.574 |
| average | **1.950** | **0.366** |
| Laplacian | **1.250** | **0.609** |

χ spans 1.25–1.95 and LZc 0.37–0.61 on identical data. Harness §5 warns about exactly this for
the one criterion the project calls definitional — *"evaluating it under average reference
gives a different number and would silently miscalibrate everything downstream"* — and here it
is, on both observable axes at once.

---

# Finding 12 — measured against real EEG, for the first time

Every other check in this project is a round trip through code we wrote. Harness §6 says of the
Tier 1 discriminator: *"every gate above is a round trip; none tests whether the output
resembles EEG at all."* This is a cheap, small-n precursor to that. **It is not a gate.**

**Corpus.** PhysioNet **EEGMAT** (Zyma et al. 2019), Open Data Commons Attribution v1.0. The
`_1` files are background EEG recorded *before* the arithmetic task — resting adults. It was
chosen because it matches our scheme almost exactly: **the same 19 channels of the 10-20
system**, **referenced to interconnected ears** (our `linked-mastoid` mode), awake and at rest.
n = 8 subjects, 172 s each, resampled 500 → 256 Hz.

| metric | REAL median [IQR] | our wake_ec | verdict |
|---|---|---|---|
| **effective rank** | **3.09** [2.88–3.28] | **3.12** | ✅ |
| PC1 variance fraction | 0.534 [0.503–0.556] | 0.485 | ✅ |
| median \|corr\|, near pairs | 0.767 [0.745–0.798] | 0.745 | ✅ |
| median \|corr\|, far pairs | 0.440 [0.402–0.486] | **0.286** | ❌ |
| Pz RMS | 14.8 µV [12.5–16.8] | 14.0 µV | ✅ |
| alpha peak | 10.5 Hz [9.9–11.1] | 10.0 Hz | ✅ |
| alpha × aperiodic | 16.2× [11.2–44.6] | 56.5× | ⚠ above IQR |
| χ over 1–20 Hz | 0.99 [0.95–1.05] | **0.32** | ❌ |

### The rank answer

**Effective rank 3.12 against a real 3.09.** Before Finding 11's fix it was 1.14. So the answer
to "is our effective rank reflective of real data" is now *yes*, and it emphatically was not an
hour ago. Amplitude, alpha frequency, near-field correlation and PC1 share all land inside or
beside the real IQR.

### The two that do not match, and one is structural

**Far-field correlation, 0.29 against 0.44.** Distant electrodes in our generator are too
independent. Adding a spatially uniform common mode (`background_global_fraction`) moved it
0.254 → 0.286, but there is a **tension a few Gaussians cannot resolve**: more global component
raises far-field correlation and *lowers* effective rank, and real EEG has both a rank of 3.09
*and* a far-field correlation of 0.44 simultaneously. A handful of independent Gaussian sources
approximates the eigenstructure of volume conduction only roughly.

**This is the seam-3 upgrade, not a tuning problem.** Build Plan §3.4 already names the fix:
replace the projection file's contents with *"LΨᵀ columns or a SEREEGA lead field"*. The schema
does not change and the loader does not change. Further parameter tuning here would be fitting
the wrong model harder.

**χ over 1–20 Hz, 0.32 against 0.99.** Our spectrum is too flat in the band the real data can
actually speak to. The cause is the knee: `knee_freq_wake_ec` = 12 Hz sits *inside* 1–20 Hz and
flattens the low side. Diagnosed by isolating components — sensor noise is *not* responsible
(0 → 3 µV white moves the 30–45 slope only 1.78 → 1.70), and moving the knee from 12 Hz to
1 Hz recovers the injected exponent almost exactly. **Left unfitted**, because χ and the knee
must be fitted *jointly* per state (Finding 9) and against a staged corpus, not against n = 8
awake subjects from one lab.

### A caveat that is itself the point

The first version of this comparison reported **χ = 3.49 over 30–45 Hz** for the real data and
0.75 for ours, and I nearly recorded "our high frequencies are far too flat."

**That number is their anti-aliasing filter, not their cortex.** Measured on the raw 500 Hz
recording: local slope **6.7** over 20–30 Hz, the 50 Hz mains line sitting **below** its
neighbours (a notch), and a flat instrument floor at −70 dB above 80 Hz. No cortical process
produces a log-log slope of 6.7.

Build Plan §3.7 states it: *"A published exponent is a joint function of PSD method, fit band,
knee model, reference, artifact rejection and electrode. **It does not transfer.**"* Here is
that claim demonstrated on real data — and it very nearly caused a wrong parameter change in
the direction of the artefact. **The 30–45 Hz comparison is therefore not made at all**, rather
than made and caveated, and only 1–20 Hz is quoted.

---

## Reproduce

```bash
.venv/Scripts/python.exe prep/reference/probe_g1_sweep.py
```

| Script | Establishes |
|---|---|
| `prep/reference/probe_specparam.py` | the specparam 2.0 API recipe; Finding 1 |
| `prep/reference/probe_g1_sweep.py` | Finding 2 — G1a vs G1b error across χ, with the analytic slope |
| `prep/reference/probe_tilt2.py` | Findings 3–5 — SOS stability, ripple vs pole count, settling time |
| `prep/reference/probe_g4_null.py` | Finding 6 — the degenerate G4 null, all four cases |

These are characterization probes, not gates. They run on clean synthetic signal and **no
tolerance may be derived from them** — that is T1-M2, against the full generator.

---

# Finding 13 — G4 was unbuildable for two decisions, and measuring its premises is what unblocked it

D8 proposed G4's criterion; D12 refuted it and left four options on the table. **None of the
four was adopted.** Measuring the premises first removed the need for all of them.

## D12's own objection did not survive measurement

D12 rejected the f₁ spectral-neighbourhood null partly because 39% of surviving bins sit below
0.05 Hz, "in the drift band of any sliding-window χ̂ estimator where the local spectrum is
emphatically not flat." Measured, the χ̂ noise floor by band:

| band | bins | median | IQR/median |
|---|---|---|---|
| 0.005–0.05 Hz | 13 | 0.0633 | 0.70 |
| 0.05–0.10 Hz | 6 | 0.0378 | 0.70 |
| 0.10–0.20 Hz | 4 | 0.0753 | 0.33 |
| 0.20–0.35 Hz | 14 | 0.0675 | 0.31 |

The drift band sits at **0.9×** the floor over 0.10–0.35 Hz — not elevated. The objection was
reasonable and it was wrong, and it is recorded as wrong in `g4_f1_neighbourhood_halfwidth`'s
absence reason rather than quietly inherited.

## What replaced it needs no threshold at all

Measure every seed **twice**, once with the mechanism under test on and once off, everything
else identical, and count how often the pair orders correctly. Under the null a paired
difference is positive with probability 0.5 — **from the pairing, not from a choice.** This
dissolves D12's defect 2 (the percentile null's per-seed exceedance rate was a function of
respiration regularity, 0.317 at N3-like cv against an assumed 0.05) because the seed is its
own control and seed-to-seed variance cancels rather than needing to be modelled.

## The fixture choice that would have failed the gate for working correctly

Decomposing the f₂ line by mechanism, χ modulation off throughout:

| respiratory mechanisms | median @ f₂ | vs empty floor |
|---|---|---|
| neither | 0.0707 | 1.00× |
| **(a) movement artifact only** | 0.0708 | **1.00×** |
| **(c) amplitude only** | 0.2331 | **3.30×** |
| both | 0.2331 | 3.30× |

**Mechanism (a) does not reach χ̂ at all** — ~11 µV at 0.25 Hz on Fz, and none of it crosses
into a 2–8 vs 16–40 Hz band ratio. That is the result the f₂ arm exists to establish, and it
could not have been established before P11 because there was no energy at f₂ to leak.

**Mechanism (c)-amplitude does, at 3.30×, and correctly.** It moves 0.5–4 Hz power at the
respiratory rate and χ̂'s low band is 2–8 Hz; the bands overlap by construction. A fixture
leaving it on would have failed G4 for doing exactly what it was built to do — the standard
error Build Plan §5.1 names, committed in the gate rather than the generator. It is off in the
fixture, and the epoch sidecar now carries four flags for three mechanisms so a reader can tell
which halves of (c) were running.

## The gate injects 13× the shipped modulation depth, and that is a finding, not a detail

Detection rate of the f₁ line against its own null, by injected depth, 40 seeds:

| `chi_mod_depth` | median @ f₁ | seeds clearing the null p95 |
|---|---|---|
| 0 | 0.1024 | 2/40 |
| **0.15** *(shipped)* | 0.1016 | — *1.02× its own null* |
| 0.80 | 0.1658 | 10/40 |
| 1.25 | 0.2223 | 20/40 |
| 1.75 | 0.3077 | 36/40 |
| **2.00** *(fixture)* | 0.3599 | **39/40** |

**At the depth the generator ships, the injected χ modulation is invisible to the estimator that
measures it.** G4 asks whether the estimator attributes a *detectable* line to the *right*
frequency, so the fixture supplies one — but it follows that G4 establishes nothing about the
shipped coupling. This is a property of the cheap two-band proxy (floor ~0.10 in its own units
over 300 s), and replacing it is T1-M2 estimator-characterization work.

**It also qualifies Demo 1's χ row.** The artifact prints χ-modulation as the control that does
not move with the filter. It is still a valid control, but it is not what its label says: at the
shipped depth the exponent half contributes essentially nothing, and the 0.238 on screen is
almost entirely mechanism (c)-**amplitude** (measured alone at f₂: 0.2331). The row is honest
about not moving; it is not honest about which mechanism it is reading, and the label is
corrected in the artifact.

## Result, and that it can fail

Gate: detection **12/12**, selectivity **12/12**, p = 2.4×10⁻⁴ each, f₁/f₂ ratio 4.93×.
Null: f₂ **6/12**, sidebands **6/12** and **4/12**, ratios 1.000, 1.001, 1.000 — exactly chance.

Three deliberate breakages all read FAIL: wrong frequency (0/12), nothing injected (0/12), and
the shipped depth (8/12, p = 0.19). The last is not hypothetical — it is the generator as it
ships, and the gate correctly refuses it.

The null arm remains **absence of evidence**: a sign test at n = 12 resolves a shift only when
it flips most pairs, and mechanism (a) moves the f₂ line by 0.2% of the null median. It
establishes that leakage is not gross. The report prints the effect ratio beside the p-value so
that limit is visible rather than inferred.

Reproduce: `probe_g4.py`, `probe_g4_decompose.py`, `probe_g4_fixture.py`, `probe_g4_falsify.py`.

---

# Finding 14 — the four remaining gates, and what building each one measured

G1a, G1b, G3 and G6 are implemented with matched nulls. `--allow-partial` is removed from
`npm run verify`: all seven ledger arms exist, so the runner now refuses to start if one goes
missing, which is what freezing the ledger was for.

Every one of the four exposed something. Three were defects in the gate rather than the
generator — which is the expected ratio the first time a measurement is written down, and worth
recording because each failed in a way that would have read as a *result*.

## G1b's narrowband estimator noise exceeds the χ spacing between states `[CONSTRAINS P10]`

The most consequential number here, and it came out of a null rather than a gate. On white
noise over 300 s, fixed-mode χ̂ over 30–45 Hz:

| | value |
|---|---|
| mean | −0.016 to −0.025 (unbiased) |
| **per-seed sd** | **0.18 – 0.23** |
| range over 12 seeds | −0.32 to +0.25 |

30–45 Hz is **0.176 decades** of leverage. A slope estimated over that span scatters widely
however long the record — this is not a short-record artifact.

**That sd is larger than the χ difference between adjacent states in the registry** —
`chi_wake_ec` 1.10 against `chi_n1` 1.40 is 0.30, barely above one standard deviation. So **no
state ordering is supportable from narrowband χ on a single 300 s record**, and any comparison
that appears to work is reading noise. This constrains P10 directly: fitting χ and the knee
jointly per state does not help if the estimator that will later be used to *check* the ordering
cannot resolve it.

It also explains the first failure of G1a's null, which required every seed to satisfy
|χ̂| < 0.10 and read −0.2028 on its first real run. The bound was right; applying it per seed
was not. The nulls now test the **mean** and report the sd, so the limit is visible in every run
instead of only here.

## G6's null had a fixed point, and it was on the generator that most needed testing

G6 compares `argmax` over projection weights against `topo_expect_*`, which is `literature` and
independent by registry constraint. Its null must show that mis-centring the projection breaks
the comparison — otherwise the gate could be reading its expectation from the file it is testing.

The first perturbation was an anterior–posterior mirror. It broke **3 of 4** comparisons.
`spindle_fast` peaks at **Cz**, which lies on the AP midline, so the mirror maps it to itself —
a fixed point of the perturbation. And `spindle_fast` is the generator whose expected set
(`C3/C4/Cz`) is hardest to miss by accident, so it is precisely the one the null most needed to
exercise.

Replaced with a **transposition of weight vectors between generators**: `spindle_fast ↔ kc`,
`alpha ↔ spindle_slow`. No geometry, no fixed points, and it targets a failure that could really
occur — a projection file with two entries swapped. The pairing is not arbitrary:
`topo_expect_kc` is `Fz/F3/F4` and `topo_expect_spindle_slow` is `F3/Fz/F4` — **the same three
electrodes** — so swapping those two would have broken neither comparison and silently halved
the null's coverage. Now 4/4.

## G3's F1 curve ran backwards because "found a marginal spindle" was scored as "fired on noise"

The spec asks for F1 as a function of inclusion threshold on the graded prominence field. First
implementation, median over 6 seeds:

| threshold | p≥0.0 | p≥0.2 | p≥0.4 | p≥0.6 | p≥0.8 |
|---|---|---|---|---|---|
| **first version** | 0.604 | 0.603 | 0.472 | 0.398 | **0.143** |
| **corrected** | 0.604 | 0.611 | 0.571 | 0.649 | 0.619 |

The first curve falls monotonically, which reads as *the detector is worse at canonical
spindles* — the opposite of the truth. Raising the threshold shrank the ground truth while
leaving the detection count fixed, so every detection of an excluded event was charged to
precision. What it measured was YASA correctly finding the marginal events we had just decided
not to ask about.

Detections matching excluded events are now **excused** — neither true nor false positives. The
false-positive question belongs to the null, which asks it on a background containing no events
at all. Conflating the two is the same error the project keeps finding elsewhere: charging one
mechanism's behaviour to another.

**What the corrected curve says:** it is roughly flat, and recall is the limiter — a median of
**25 injected against 12 detected**. YASA finds about half our spindles, equally often whether
they are marginal or canonical. Record-only, no pass band, and per the spec a low F1 here is not
automatically a failure — but the flatness means the prominence field is not yet doing the work
seam 1 built it for, which is a T1 question against MODA.

## G1a's knee arm cannot work in N3, by design

First run reported a recovered knee of **`-0.3+0.6j Hz`** — a complex number, from a negative
fitted parameter raised to a fractional power. The symptom was a missing guard; the cause was
asking N3 for a knee it does not have. `knee_freq_n3` is **0.5 Hz**, below the 1–45 Hz fit band,
and that is deliberate: D11 recorded that with one `k` per state, the only way to express
`knee_present: absent` is to *move* the knee out of band rather than weaken it.

G1a now runs **two states** — REM (`knee_freq` 20 Hz, prominent) and N3 (0.5 Hz, out of band) —
and reports each. Measured at Pz, 10 epochs × 6 seeds:

| state | injected χ | G1a error | knee | G1b error |
|---|---|---|---|---|
| rem | 2.100 | **+0.442** (IQR 0.050) | 20.0 → 15.3 Hz | −0.465 (IQR 0.137) |
| n3 | 1.660 | −0.068 (IQR 0.019) | out of band, 6/6 unrecoverable | −0.158 (IQR 0.190) |

REM's large G1a error is the regime effect the Finding 2 correction predicted: oscillatory peaks
inside 1–45 Hz attack knee-mode fitting specifically, and REM carries both theta and alpha.

## And the test suite caught a test asserting on a transient condition

`test_preflight_refuses_a_ledger_gate_with_no_module` called `preflight(strict_ledger=True)` and
expected a raise — which passed only because the gate set was incomplete when it was written.
Completing the ledger turned it red, and the mechanism it meant to test had never been exercised
on its own. It now **plants** a ledger entry with no module. A test that passes because of the
state of the repository rather than the behaviour of the code is worth less than no test, for
the same reason the harness spec gives about gates.

Reproduce: `npm run verify`, or `python -m prep.runner --tier all --seeds 6`.

---

# Finding 15 — half the χ modulation was never generated `[T1-M2]`

*The first Tier 1 measurement, and it found a Tier 0 generator defect that no Tier 0 gate could
have caught.*

T1-M2 was promoted above T1-M1 because two Tier 0 findings said the estimator was the binding
constraint. Characterizing it properly showed that for one of them, **the estimator was not the
problem at all.**

## What the sweep found, and the two wrong conclusions I drew from it

Sweeping modulation frequency against analysis window (`t1m2_chi_transfer.py`) shows recovered
depth collapsing at high f. I first reported two conclusions from it, both of which fail on
inspection and are recorded because the errors are the instructive part:

| claim | why it fails |
|---|---|
| *"tracks the sinc prediction, median \|err\| 0.100"* | The median averaged over a grid whose low-frequency corner is all 1.00/1.00. At W = 0.5 s — where a sliding window attenuates almost nothing — measured/predicted was **0.47/0.97** at 0.25 Hz and **0.10/0.94** at 0.40 Hz. Something *W-independent* was removing the modulation, and a median cannot see it. |
| *"0.15 is detectable at W = 8 s"* | Arithmetic inconsistency in my own formula: it divided the measured floor by the **predicted** sinc while the **measured** attenuation at that cell was 5× smaller. Recomputed model-free as `depth × floor/recovered`, W = 8 s is the **worst** cell (0.127), not the best. |

The harness spec is explicit that the quantity of interest is what *"the **estimator**, not the
generator, determines"*. Separating them is not tidiness — it is the measurement.

## The mechanism: a 2-second coefficient hold

`applyTimeVaryingTilt` defaulted to `blockwise` with `blockSamples = Math.round(2 * fs)`.
`tiltBlockwise` **averages Δχ over each block**, applies one fixed tilt, and overlap-adds at a
hop of 0.75·B — two stacked smoothings. At the respiratory rate of 0.25 Hz that is two blocks per
cycle.

An A/B against the `filterbank` scheme, which interpolates per sample and so has no staircase,
read out with the *same* proxy at the *same* window in both arms so the readout's bias cancels:

| f_mod | blockwise | filterbank | ratio |
|---|---|---|---|
| 0.05 Hz | 1.00 | 1.00 | 1.02 |
| 0.10 Hz | 0.95 | 1.06 | 1.13 |
| 0.15 Hz | 0.79 | 1.08 | 1.39 |
| **0.25 Hz** *(respiratory)* | **0.48** | **1.17** | **2.48** |
| 0.40 Hz | 0.11 | 1.30 | 12.3 |

**At the respiratory rate the generator was delivering 48% of the requested χ modulation**, and
11% at 0.40 Hz. Entirely generator-side, before any estimator saw the signal.

## Two reasons this survived all of Tier 0

**G4 probes the wrong frequency to see it.** The gate runs at `g4_f1` = 0.10 Hz, where the 2 s
hold retains 95%. The defect lives at the respiratory rate — which G4 deliberately keeps clear
of, so that f₁ and f₂ stay separable. *A gate can only see the frequencies it probes*, and G4's
whole design puts the modulation somewhere the confound isn't.

**The literal linter could not have caught it either.** The constant was written
`Math.round(2 * fs)`, and `2` is on the linter's arithmetic-furniture allowlist. This is the
documented cost of that allowlist, paid in full: *the most consequential unregistered constant in
the generator was a `2`*. D15 predicted this failure mode in the abstract ("a `3` is a pairing
count in one place and a filter order in another"); here it is concrete.

## The fix, derived rather than chosen

`tilt_block_s` is now a registry row, standing `derived`, at **0.75 s**. Two opposed constraints,
both already measured in this project:

- **Fidelity wants B small.** A hold of length B attenuates a modulation at f by ≈ \|sinc(fB)\|.
- **Settling wants B large.** Each block filters from **zero state**, so every block has a
  startup transient, masked only while the crossfade (overlap = B/4) exceeds the cascade's
  t99 = 0.164 s (Finding 5). That gives **B ≥ 0.66 s**.

So the derivation is *the smallest block that still hides its own settling transient*. Measured
minimum detectable `chi_mod_depth` at the respiratory rate:

| B | viable? | min detectable depth |
|---|---|---|
| 0.50 s | no (overlap < t99) | 0.060 |
| **0.75 s** | **yes** | **0.061** |
| 1.00 s | yes | 0.067 |
| 1.50 s | yes | 0.089 |
| **2.00 s** *(was shipped)* | yes | **0.129** |
| 3.00 s | yes | 0.401 |

**A 2.1× gain in detectability, with the noise floor unchanged.**

### A vacuous check, caught and replaced

The sweep's noise-floor column came out **bit-identical across all seven block lengths** — which
should have been the tell. It measured the floor at `chi_mod_depth = 0`, where Δχ is constant, so
every block applies the same tilt and *no transient can occur*. It looked like a safety check and
tested nothing.

The check that matters is whether a shorter block deposits a **comb at the hop rate** — the
High-rated sideband risk, and the exact failure Finding 8 found at the epoch boundary, where a
k/30 Hz comb landed on `g4_f1` as harmonic 3. Narrowband excess of the modulated/unmodulated PSD
ratio at k/hop, above its own local neighbourhood:

| B | hop rate | worst excess (k = 1…3) |
|---|---|---|
| 0.50 s *(violates the bound)* | 2.67 Hz | +0.96 dB |
| **0.75 s** | 1.78 Hz | **−0.03 dB** |
| 1.00 s | 1.33 Hz | +0.71 dB |
| 2.00 s *(was shipped)* | 0.67 Hz | +0.20 dB |

**No comb.** 0.75 s is marginally cleaner than the block it replaces, and the one configuration
that violates the t99 bound is the one with the largest excess — the derivation's direction
confirmed, its penalty benign.

## Consequences

- `generator_version` → **0.2.0**. The generated signal changes for every state whose χ is
  modulated; this is precisely the "intentional change to a golden gate output" that field marks.
- **G4 improves and still passes**: median recovered depth 0.352 → 0.394 at f₁ = 0.10 Hz, the
  ~12% the sweep predicts for that frequency. Both arms 12/12.
- **Demo 1's (c) row moves only 0.238 → 0.251 (+5%)**, and that small number is a *confirmation*:
  Finding 13 established the row is dominated by mechanism (c)'s **amplitude** half, which the
  tilt block does not touch. The exponent half roughly doubled but was a minor share. A large
  jump here would have contradicted Finding 13.
- `truth.chiModDepth` in the sidecar remains the **requested** depth. What is achieved is
  scheme- and frequency-dependent, so the field is documented as requested-not-achieved rather
  than silently recomputed — the alternative would bake a model into a ground-truth field.

## Still open

The `filterbank` scheme **over-responds**, reaching 117% at 0.25 Hz and 130% at 0.40 Hz where a
pure attenuation cannot exceed 100%. Linear interpolation between two pre-filtered signals is not
the filter at the interpolated tilt — the outputs are highly correlated, so amplitudes blend
rather than log-slopes. That is uncharacterized, and switching the default to a scheme with an
unexplained 30% over-response would be exactly the unexamined move this project forbids.
**Registered as P12**, not adopted.

Reproduce: `t1m2_chi_transfer.py`, `t1m2_chi_generator_side.py`, `t1m2_tilt_block_sweep.py`,
`t1m2_tilt_block_comb.py`.

---

# Finding 16 — leverage beats sophistication, and specparam loses `[T1-M2]`

*The estimator half of the χ problem. Finding 15 fixed the generator half.*

The plan said: replace the cheap two-band proxy with specparam-per-window, which is SPRiNT's
algorithm and what harness §4 names. Measured, **that would have made the readout worse.**

## An architectural constraint the plan does not state

`specparam` is Python. The artifact is a static TypeScript page with no framework dependency
(Build Plan §8 takes that as a constraint). **The shipped Demo 1 readout can never call
specparam.** So the milestone splits: the harness may use specparam as a class-V reference, and
does; the artifact must keep something cheap regardless of what the reference says. The useful
question is therefore not *"is specparam better"* but *"how much of it can a portable estimator
reach"*.

## Five candidates, identical windows of identical records

Minimum detectable `chi_mod_depth` at the respiratory rate — `depth × floor/recovered`, a ratio,
so it compares across estimators whose units differ:

| estimator | band | decades | DC χ̂ | min detectable | portable |
|---|---|---|---|---|---|
| **`ls240`** LS slope | 2–40 Hz | **1.30** | **1.637** | **0.048** | **yes** |
| `twoband` *(was shipped)* | 2–8 vs 16–40 | 0.80 | — | 0.058 | shipped |
| `sp240` specparam | 2–40 Hz | 1.30 | 1.734 | 0.098 | no |
| `ls3045` LS slope | 30–45 Hz | 0.18 | 1.436 | 0.271 | yes |
| `sp3045` specparam | 30–45 Hz | 0.18 | 1.523 | 0.547 | no |

Injected `chi_n3` = 1.66, for the DC column. **log(MDD) correlates −0.85 with band leverage.**

**Leverage, not sophistication, orders the table.** 30–45 Hz spans 0.176 decades, and a slope over
that span scatters however good the fitter is — this is Finding 14 resurfacing inside a different
measurement. specparam over G1b's band is the worst candidate here, which is a verdict on the
band it was handed, not on specparam.

**At the same band, plain least squares beats specparam by 2×** (0.048 vs 0.098) — and is also
*more accurate* (DC 1.637 vs 1.734 against an injected 1.66). I had predicted the opposite: that
oscillatory peaks inside 2–40 Hz would bias a plain slope and specparam's peak model would earn
its cost. It does not, in this regime. Per-window peak fitting adds variance to the exponent, and
for an AC measurement a static bias cancels in the line at f_mod anyway.

## Adopted, and it fixes a units problem too

`chi_est_band` = 2–40 Hz, `chi_est_window_s` = 2 s, both `derived`. The gain over the shipped
proxy is modest (1.21×), but the second benefit is larger: **a slope fit returns true χ units.**
The two-band ratio returned its own units — measured 0.76 proxy-units per χ-unit in Finding 15 —
so Demo 1's *"injected 0.15, recovered 0.238"* was never a like-for-like comparison. Finding 13
flagged exactly that. It is now dimensionally honest.

G4 improves again: f₁/f₂ selectivity ratio 4.93 → **7.81**, both arms still 12/12.

## The better estimator broke my own gate criterion, correctly

G4's null arm **failed** on first run with the new estimator — reporting `LEAKAGE at 0.35 Hz` and
*"none of it reaches χ̂"* in the same sentence. Both were true, which is the defect:

`f2+f1 1/12 (p=0.0063, ratio 0.999x)`

**A paired sign test detects direction, not magnitude.** Pairing removes the variance, so once the
estimator is precise enough, an arbitrarily tiny but consistently-signed difference clears
p < 0.05. D14 specified the arm as a sign test alone; that was magnitude-blind, and only a
lower-variance estimator could expose it.

Fixed by requiring leakage to be **both** statistically consistent **and** larger than
`chi_est_mdd_resp` = 0.048, the estimator's own detection floor — a difference smaller than what
the estimator can see at all cannot support or refute any claim.

### And the effect metric was wrong before it was right

The first implementation used `obs − null`. Both are **magnitudes of a line at the same
frequency**, so an added component of unknown relative phase combines in **quadrature**:
|obs|² ≈ |null|² + |leak|². Measured on a real leakage source, subtraction says 0.017 where
quadrature says 0.033 — the difference between "well below the floor" and "near it".

## The null arm's falsification is open, and says so

Testing that the new floor had not neutered the arm, I enabled mechanism (c)-amplitude in the
observed arm only — a leakage measured at 3.3× the empty floor in Finding 13. Result:

| | |
|---|---|
| f₂ line with (c)-amplitude on | 0.0669 |
| with it off | 0.0484 |
| leakage amplitude (quadrature) | **0.0332** |
| detection floor | 0.048 |
| paired sign test | 6/12, **p = 1** |

**Inconclusive, and not a demonstration either way.** The floor never bound — the sign test
returned p = 1, so this leakage would not have been flagged before the effect-size clause existed
either. What the numbers do establish is a measurement: **(c)-amplitude reaches χ̂ at roughly the
limit of what this estimator can resolve in one record.**

Why the sign test cannot see it: when a leakage of amplitude ≈ the floor is added at random
relative phase, the resulting magnitude exceeds the original only slightly more than half the
time, so the per-seed sign carries almost no information at n = 12. Falsifying this arm needs a
cleanly monotone leakage source — raising `resp_artifact_amp` far above its registered range would
do it, and that needs a CLI override the exporter does not expose. **Recorded as the arm's open
falsification, not as a pass.** By contrast mechanism (a), the arm's actual target, measures
0.0000 in quadrature — genuinely nil, and distinguishable from (c)-amplitude's 0.033 only because
the metric is now correct.

Reproduce: `t1m2_chi_estimators.py`, `probe_g4_falsify.py` (breakage 4).

## Finding 16, resolved — the null arm can fail, and two more defects surfaced getting there

Finding 16 left G4's amended null arm **not demonstrated falsifiable**, which is the state D12
spent two decisions objecting to. Closing it needed a monotone leakage source, so
`resp_amp_mod_depth` gained a CLI override and the leakage was swept rather than asserted.

| amp depth | f₂ observed | f₂ null | leak (quadrature) | k/n | p | reports leakage |
|---|---|---|---|---|---|---|
| 0.00 | 0.0484 | 0.0484 | 0.0000 | 0/0 | 1 | no |
| **0.35** *(registered)* | 0.0669 | 0.0484 | 0.0332 | 6/12 | 1 | no |
| **0.70** | 0.1089 | 0.0484 | **0.0963** | 10/12 | 0.039 | **YES** |
| 1.20 | 0.1446 | 0.0484 | 0.1353 | 10/12 | 0.039 | YES |
| 2.00 | 0.1282 | 0.0484 | 0.1175 | 10/12 | 0.039 | YES |

**The arm can fail, and its threshold is a measured number rather than a claim:** leakage is first
reported at a leaked line of **0.096 — 2.0× the detection floor**. Below that it stays silent,
including at the registered depth, where the leakage genuinely sits at the limit of what this
estimator resolves in one record.

So the effect-size floor did not neuter the arm. It moved the verdict from *"any consistently
signed difference, however microscopic"* to *"a difference large enough to be mistaken for
coupling"*. The 0.999× ratio that failed the gate before Finding 16 is still silent, correctly.

### Defect: ties were counted as evidence

The depth-0 row is the two arms compared **against themselves** — bit-identical records. Before
this was fixed it read `0/12, p = 0.000488`: **highly significant, for two copies of the same
array.** A bare `a > b` makes every tie a failure, so 12 ties give k = 0, which is exactly as
extreme as k = 12.

The textbook sign test discards ties; `paired_sign_test` now does, and depth 0 reads `0/0, p = 1`
— no evidence in either direction, which is the truth.

**This was not confined to G4.** G3's null compares *integer detection counts*, where two seeds
landing on the same count is ordinary rather than a measure-zero coincidence — so ties were being
charged against that arm too. Both now use the tie-aware test. In the current G4 run no pairs tie
(12/12 non-tied), so no published number changes; the defect was latent, and only a deliberately
degenerate comparison exposed it.

### Defect: `resp_amp_mod_depth` above ~1.2 is not monotone

Leakage rises 0.033 → 0.096 → 0.135 and then **falls** to 0.118 at depth 2.0. A modulation depth
approaching and exceeding 1 drives the multiplier `1 + d·cos(φ)` through zero and negative, which
rectifies rather than scales — so the fundamental at f₂ stops growing. Harmless here, because the
sweep only needed to bracket the threshold and the registered value is 0.35, but it means **depths
near or above 1 are not a valid way to scale this mechanism** and the row's usable range should be
capped when it is fitted at T1-M1.

---

# Finding 18 — frontal alpha, and why a linked reference cancelled the first fix

Reported after Finding 17's far-field mixture: *"the alpha is still not very prominent at all in
the frontal electrodes... when I do recordings and see posterior alpha that large it always shows
up quite prominently in the frontal electrodes."* Correct, and the first fix failed for a reason
worth keeping.

## The first fix was fitted against the wrong quantity

Finding 17 matched far-pair **correlation** and reported a frontal/occipital alpha **band-power**
ratio of 0.225, which looked adequate. It was not: at a frontal electrode most of the 8–12 Hz band
power is aperiodic background, not alpha. **Band power cannot distinguish "there is a rhythm here"
from "there is broadband activity here"** — and prominence is exactly that distinction.

Measured properly, as the height of the 8–12 Hz bump above each channel's own aperiodic fit:

| | frontal | occipital | excess ratio |
|---|---|---|---|
| **real** (EEGMAT, n = 8) | 6.51× | 22.86× | **0.271** |
| ours, after Finding 17 | 1.78× | 55.78× | **0.014** |

1.78× is not a rhythm. The report was right and the previous measurement had missed it entirely.

## The mechanism: a common-mode pedestal is what a linked reference removes

The far-field term is a broad Gaussian centred on the source, so it reaches **every** electrode —
including the mastoids. And the mastoids sit at (±1.12, 0.08), which is **closer to an occipital
source than Fp1 is**. Measured weights:

| | raw weight | after linked-mastoid |
|---|---|---|
| frontal mean | 0.196 | **−0.015** |
| mastoid mean | **0.211** | — |
| occipital mean | 0.890 | +0.679 |

The mastoids picked up *more* alpha than the frontal sites, so referencing subtracted more than
frontal had, leaving referenced frontal alpha **negative and essentially zero**. No value of the
fraction or the width could have fixed this: a pedestal is common mode, and removing common mode
is what a linked reference *is*. **The model needed the reference sites to differ in kind, not in
degree.**

## The fix: the mastoid is not scalp over cortex

That is the reason an ear or mastoid reference is usable at all — it sits behind the ear over
bone with no cortex beneath, so it is relatively inactive. `topo_reference_far_field` attenuates
the volume-conducted pedestal at A1/A2 only.

Fitted jointly against the real prominence ratio:

| fraction | σ_far | ref far-field | frontal | occipital | ratio | vs real 0.271 |
|---|---|---|---|---|---|---|
| 0.35 | 1.2 | **1.00** | 1.78× | 55.78× | 0.014 | 0.257 |
| **0.50** | **2.5** | **0.30** | 19.30× | 62.98× | **0.296** | **0.025** |
| 0.60 | 3.0 | 0.15 | 33.67× | 67.83× | 0.489 | 0.219 |
| 0.70 | 4.0 | 0.05 | 47.27× | 72.08× | 0.651 | 0.381 |

**The reference attenuation is the load-bearing parameter**, not the fraction or the width — the
first row is the previous configuration and it is the only one that fails outright.

Measured on the shipped configuration in the running artifact, on the referenced view the display
actually shows: **frontal 10.48×, occipital 38.06×, excess ratio 0.256** against a real 0.271.
Fz alone reads 12.1× where it read 1.78×.

## Two consequences, neither cosmetic

**`snr_nominal` had to be re-solved.** G5's AASM criterion is evaluated on a contralateral-mastoid
derivation, so attenuating the mastoids increases the referenced amplitude. The pass fraction went
straight to 1.00 before recalibration. Re-solved: `snr_nominal` **+1.4288 → −3.0765 dB**, pass
fraction back to 0.67, and G5's null still discriminates (N3 0.67 vs N2 0.00 and N3−6 dB 0.00).
This is the calibration-is-a-procedure-not-a-knob rule (D5) doing its job.

**`gate_alpha_ratio` now contradicts its own recorded quantity.** Posterior/frontal alpha weight
ratio measured **1049.77** before volume conduction existed and **1.95** after; the invented bound
is > 3. It fails nothing — the row is `invented` and record-only, which is precisely why D6 made
it so — but the bound was set against a generator with no far field at all and is not evidence
about the new value. It is also not the same quantity as the fitted target (prominence excess,
0.271 ≈ 3.7 posterior/frontal). Recorded against the row for T1-M2.

Reproduce: `prep/reference/t1m1_alpha_spread.py`.

## Finding 18, continued — the profile matches on average and not in shape, and that is P9

Asked directly whether the per-electrode alpha profile matches the real recordings, the answer is
**the ratio does; the topography does not.** Normalised so each profile peaks at 1.0 (our absolute
prominence runs high, which is `alpha_amp` against background, a different parameter):

| region | real | ours |
|---|---|---|
| frontopolar | 0.207 | 0.196 |
| frontal | 0.227 | 0.147 |
| **temporal** | **0.445** | **0.266** |
| **central** | **0.406** | **0.231** |
| parietal | 0.737 | 0.620 |
| occipital | 0.851 | 0.767 |
| Pz specifically | 0.653 | **0.841** |

Profile correlation **+0.883**, RMS **0.169**. *Read the RMS, not the correlation* — a profile
uniformly too steep through the middle still rises and falls in the right order, so it correlates
well while looking wrong.

The error is systematic and it is in the **middle of the head**: ours is a sharp posterior peak on
a flat pedestal where real is a smooth gradient. The pedestal lifts the far end but cannot bend
the middle.

### Widening the source makes it worse, for a geometric reason

The obvious fix — widen `topo_sigma_alpha`, lean less on the pedestal — was measured and fails:

| σ_alpha | far fraction | profile RMS | frontal/occipital ratio | central |
|---|---|---|---|---|
| **0.35** | 0.50 | **0.165** | **0.219** | 0.229 |
| 0.55 | 0.35 | 0.190 | 0.091 | 0.229 |
| 0.75 | 0.20 | 0.210 | 0.032 | 0.235 |
| 1.20 | 0.05 | 0.217 | 0.068 | 0.222 |
| *real* | | *0.000* | *0.298* | *0.406* |

RMS worsens monotonically and the frontal/occipital ratio **collapses**. A wider posterior Gaussian
reaches the *mastoids* harder too, and the reference subtracts exactly what it adds. Central stays
pinned near 0.23 throughout — no width helps it.

**The geometry says why.** T3/T4 sit at (±1.00, 0.00); A1/A2 at (±1.12, 0.08). They are
essentially co-located. Under a linked-mastoid reference, *any* topography isotropic about a
posterior centre gives T3 ≈ A1, so the temporal belt is driven toward zero by construction. Real
recordings do not do this because the mastoid is over bone with no cortex beneath — it is not
merely "a scalp site 0.12 units from T3".

`topo_reference_far_field` already encodes part of that, and it is what made frontal alpha
possible at all. But one attenuation factor cannot also bend the mid-belt into shape.

### What this establishes

**A Gaussian mixture about a single centre has a ceiling, and this profile is it.** The remaining
error is not a parameter that has not been fitted; it is the model class. That is P9 — replace the
weights with LΨᵀ columns or a SEREEGA lead field — now supported by a specific, measurable
signature rather than by a single summary correlation: *the central and temporal belt is
compressed by roughly a factor of two, under every width and pedestal setting tested.*

The shipped configuration is kept: it matches the frontal/occipital ratio (0.219–0.256 against a
real 0.271–0.298 across runs), gives frontal alpha that is visibly a rhythm (Fz 12.1× above its
own aperiodic fit, against 1.78× before), and has the lowest profile RMS of anything tested.

Reproduce: `t1m1_alpha_profile.py`, `t1m1_alpha_profile_fit.py`.

---

# Finding 19 — the oscillation layer was rank 1 in every state, and the pedestal was why `[RESOLVED — and it changed the strategy]`

Prompted by an observation that the signal "seems way too correlated", then again by "it still
looks kinda correlated". Both were right, and the second one was right about a different layer
than the first.

Finding 11 rebuilt the aperiodic **background** as six spatially distinct sources and took it from
rank 1.14 to 2.99. It closed with "and N3 still is". This is that sentence, worked out.

## What was actually measured

| state, as shipped before this finding | effective rank | PC1 | median \|corr\| |
|---|---|---|---|
| wake_ec | 2.46 | 0.592 | 0.521 |
| n2 | 2.80 | 0.527 | 0.452 |
| **n3** | **1.07** | **0.967** | **0.950** |
| *real (PhysioNet EEGMAT, resting wake)* | *3.09* | *0.534* | *0.482* |

`check_rank_decompose.py` removes one layer at a time. The aperiodic background **alone** measured
**3.44** — so the ceiling was never the problem. Removing the graphoelements moved N3 from 1.14 to
only 1.21, so the events were not the problem either. The continuous band oscillation was.

`check_topo_rank.py` then made the decisive measurement, and it needed no signal at all. Every
source draws from its own substream, so the sources are independent and the channel covariance is
exactly `Σ_g var_g w_g w_gᵀ`, with referencing a linear operator. The effective rank of that is a
property of the projection file and the amplitudes, computable in milliseconds:

| a band's own source family | effective rank | PC1 |
|---|---|---|
| alpha | 1.08 | 0.962 |
| beta | 1.12 | 0.946 |
| theta | 1.12 | 0.946 |
| delta | 1.10 | 0.951 |

**The defect was in every state, not in N3.** Each state drives one band from one centre, so the
oscillation layer was rank ~1 everywhere. It only *showed* in N3, where delta at 100–200 µV p-p is
87% of the variance and swamps the rank-3.44 background. In wake_ec the background dominates and
hid it. One defect; one state exposing it.

## Two fixes were built, measured, and refuted

**A ring of sub-sources** about each band's own centre. Measured **1.07 → 1.14**. Swept from radius
0.30 to 1.30 the family's rank tops out at **1.26** — because at `topo_far_field_fraction` = 0.50
every source is half a near-flat pedestal and *they all share that term*. No radius beats a
component held in common, so the ring could not have worked at any setting. `osc_source_spread` was
retired with it.

**Moving the sub-sources onto the background's six regional centres** — the basis already measured
at 3.44. Better in principle, **1.10 → 1.18** in practice. Same shared term, same ceiling.

## The cause, and it was a parameter that documented its own trap

`topo_sigma_far` was 2.5, and its registry row said in as many words: *"broad enough that the far
Gaussian is near-flat across the montage, so the fraction alone sets the tail."* Flat, combined
with `topo_reference_far_field` attenuating the mastoids, leaves **every source carrying an
identical residual pedestal of `ff·(1 − refFf)` = 0.35 after the reference is subtracted.** An
identical component in every source is a rank-1 term that nothing downstream can break up.

The two rows were added one finding apart (D18) for a good reason each — a heavy tail for frontal
alpha, a mastoid attenuation so a linked reference would not cancel it — and their *combination*
produced an artefact neither was checked for.

Narrowing `topo_sigma_far` to 1.6 makes the tail a **gradient centred on each source** rather than
a pedestal they share, which is also closer to what a dipolar far field does.

## An analytic surrogate, and why it validates itself first

`t1m1_osc_basis.py` sweeps the exact covariance: a fit that took eight minutes as
generate-and-measure runs in under a second, which is what made four coupled parameters affordable.
It prints its own prediction against the generator **before** printing the sweep.

That check earned its place immediately. The first draft predicted wake_ec rank **1.16** against a
measured **3.20**, because it scaled `background_rms_uv` by `amp_pp_to_rms` when `compose.ts` does
not — an **8× error in the background variance**, the term that decides whether a state looks like
its background or like its band. Every number in the sweep would have been fitted to it.

The validated surrogate is still biased — it under-predicts wake_ec rank by ~0.7 and over-predicts
far correlation by ~0.13 — so it is used to narrow the region and never to pick the value.
`t1m1_spatial_joint.py` chooses against the generator.

## Slow oscillations had one topography, and in N3 that is most of the signal

Visible directly at a 5 s window: the same large wave in every one of 19 lanes with only the fine
detail differing. Slow oscillations projected through the single `delta` topography. The
anterior-posterior travel delay did not hide it — at 1 Hz a 100 ms lag is 36°, so the delayed copy
still correlates at ~0.8. Measured cost: **0.21 of effective rank** (1.32 with events, 1.53
without).

`so_origin_coherent_fraction` gives each wave its own origin. Successive waves now have different
topographies while any single wave still looks like a proper slow wave; real slow waves do have
variable origins with a frontal predominance. The event layer now costs nothing: 1.63 with events
against 1.53 without.

**G5 was the risk worth checking,** because the AASM criterion is measured on frontal derivations
and sending waves elsewhere could have pushed epochs below 75 µV. It held — G5~null still
discriminates N3 0.67 against N2 0.00 and N3−6 dB 0.00.

## Result

| | effective rank | PC1 | median \|corr\| |
|---|---|---|---|
| wake_ec | 2.46 → **3.17** | 0.592 → 0.473 | 0.521 → 0.379 |
| n2 | 2.80 → **3.27** | 0.527 → 0.445 | 0.452 → 0.375 |
| n3 | 1.07 → **1.63** | 0.967 → 0.771 | 0.950 → 0.694 |
| *real* | *3.09 [2.88–3.28]* | *0.534* | *0.482* |

wake_ec and n2 land inside the real interquartile range.

## What this finding does NOT establish, stated because the numbers read stronger than they are

**Near-pair correlation and alpha prominence were FITTED. They are not evidence of realism.**
Reporting "near-pair 0.767 against a real 0.767" and "alpha frontal/occipital 0.266 against a real
0.271" as successes is very nearly circular — it is evidence the optimiser worked. Effective rank
is the one genuine spatial agreement here, because it was not directly targeted. See D19, which
turns this into a rule.

**N3 is not fitted at all.** EEGMAT is resting wake; there is no real N3 in the corpus, so N3
contributed nothing to any error metric and its column is a sanity bound, not a fit.

**The remaining N3 gap is not topography.** The continuous delta band caps N3 at 1.53 on its own,
and no topography parameter moves it — delta is 87% of N3's variance, which may double-count the
slow-wave events now modelled beside it. `delta_amp` feeds `snr_nominal` and G5, so it is named
rather than tuned.

**Far-field correlation never moved.** 0.251–0.323 across all 21 configurations swept, against a
real 0.440, while near-pair sat at or above real and PC1 below it — simultaneously, in every one.
That signature is the model class, not a setting: a Gaussian mixture gives one distance kernel, so
near and far cannot be matched together. **This is the measurement that escalates P9 from a
shortfall to an architectural decision (D19).**

Reproduce: `check_rank_decompose.py`, `check_topo_rank.py`, `t1m1_osc_basis.py`,
`t1m1_spatial_joint.py`, `compare_real.py`.

---

# Finding 20 — the far-field target was mostly the reference, and the model is missing ~20% independent per-channel variance `[CORRECTS D19's MECHANISM]`

D19 decided to replace the Gaussian-mixture projection with a published lead field, on the strength
of Finding 19's separability argument. **The decision survives. Its stated mechanism does not, and
two probes run before any lead field was built are why.**

MNE 1.12.1 was already installed as a YASA dependency and MNE-fsaverage-data was already on disk, so
the test cost nothing: a real 3-shell BEM forward solution on fsaverage, 21 channels × 20 484
cortical sources, dipoles fixed normal to the surface.

## The go/no-go, and it failed

The source model is **white on the cortex** — every dipole independent and unit variance, the
standard "aperiodic activity everywhere" assumption. It is **parameter-free**, so `C = L Lᵀ` is a
prediction with nothing fitted.

| linked-mastoid / linked-ear | rank | PC1 | near | far | near/far |
|---|---|---|---|---|---|
| real (EEGMAT) | 3.09 | 0.534 | 0.767 | 0.440 | 1.74 |
| shipped Gaussian mixture, 4 params fitted | 3.17 | 0.473 | 0.812 | 0.303 | 2.68 |
| **lead field, white cortex, 0 params** | 3.91 | 0.417 | 0.725 | **0.239** | **3.03** |

**Worse on the target it was prescribed to fix.** Real head geometry, given uncorrelated cortical
activity, produces *less* long-range correlation than our invented Gaussians did, and the near/far
ratio moves further from real. A coherence-length sweep (10–80 mm) reproduced the same trade this
project has fought throughout — far-pair up, effective rank down — reaching only 0.290.

So the far-field deficit was never a forward-model deficiency, and no amount of source modelling was
going to close it. That prompted the question that should have come first.

## Is the real 0.440 even a neural quantity?

`probe_real_farfield_origin.py` re-references the same eight recordings. Common mode is *defined* by
what a reference removes, so if the target is common mode it collapses under average reference.

| real EEGMAT, 8 subjects | rank | PC1 | near | far |
|---|---|---|---|---|
| **as recorded (linked-ear)** | 3.07 | 0.535 | 0.765 | **0.437** |
| average reference | **5.36** | 0.369 | 0.413 | **0.257** |
| Laplacian (near-neighbour) | 6.35 | 0.276 | 0.394 | 0.119 |
| linked-ear, band 1–4 Hz | 2.83 | 0.567 | 0.773 | 0.504 |
| linked-ear, band 20–40 Hz | 3.33 | 0.492 | 0.764 | 0.392 |

**A 70% swing in far-pair correlation from the reference alone — larger than any difference between
any two models this project has compared.** Most of the real 0.440 is a spatially broad component
that survives a linked-EAR reference, because real earlobes carry signal and so do not cancel it.
It is not long-range neural coherence in a form average referencing preserves, and the band rows
show it is not primarily eye or muscle artifact either.

**This makes the fit circular in a way not previously seen.** The generator's linked-mastoid
behaviour is set by `topo_reference_far_field` = 0.30 — an *invented* number, introduced in D18 for
how much cortex the mastoids see. Fitting spatial parameters against linked-ear far-pair correlation
therefore fitted them against that invented number as much as against the head. **Average reference
is defined by the montage alone and invents nothing, so it is the comparison that can be trusted.**

## Under a trustworthy reference, the sign flips — and one parameter beats thirty-one

| average reference | rank | PC1 | near | far | mean rel. err |
|---|---|---|---|---|---|
| real | 5.36 | 0.369 | 0.413 | 0.257 | — |
| lead field, white cortex `[0 par]` | 4.32 | 0.346 | 0.553 | 0.376 | 0.264 |
| + independent share 0.10 | 5.00 | 0.319 | 0.475 | 0.339 | 0.168 |
| **+ independent share 0.20 `[1 par]`** | 5.85 | 0.291 | **0.403** | 0.302 | **0.125** |
| + independent share 0.30 | 6.90 | 0.263 | 0.344 | 0.263 | 0.191 |
| *shipped Gaussian mixture, linked-ear, 31 invented rows* | — | — | — | — | *0.250* |

Under average reference the lead field is **too** correlated, not too little — the opposite sign to
the linked-ear comparison, which is the clearest possible demonstration that the reference was
driving the conclusion.

**Real EEG is less spatially correlated than white-cortex-through-a-lead-field.** No source
coherence model can produce that: coherence only ever *raises* correlation. The only thing that
lowers it is signal independent **per electrode**.

And the current model has almost none. `sensor_noise_rms` is 1.5 µV against a 20 µV background —
**0.56% of the variance**, where the fit wants **20%**, i.e. about 10 µV rms per channel. This is
not amplifier noise; it is the non-neural contribution real scalp recordings carry at each site
independently: local muscle tone, skin potential, electrode drift, contact impedance.

**A completely different explanation for "it seems way too correlated" than the one three commits
chased.** Topography was one cause and it was real. Missing independent per-channel variance is a
second, simpler, and larger one, and no amount of topography work would have found it.

## What this does and does not license

**Honest about the 20%:** it is an *independent-equivalent* share under this model, not a measured
physiological quantity. Some of it is certainly model mismatch — fsaverage is a template rather than
these eight subjects' heads, the near/far split uses 2-D projected montage coordinates, and white
cortex is an assumption. It should be fitted as one number with that caveat attached, not promoted
to a claim about scalp physiology.

**D19's decision stands and is strengthened:** lead field + one independent-share parameter reaches
**0.125** mean relative error against **0.250** for 31 fitted invented rows — and does it under a
reference that invents nothing, which means the numbers are a prediction rather than a fit.

**Three amendments to D19**, recorded there: the far-field mechanism was the reference, not the
forward model; spatial metrics must be compared under **average reference**; and an independent
per-channel component is now a required part of the design rather than an afterthought.

Reproduce: `prep/leadfield/probe_leadfield_gono.py`, `prep/leadfield/probe_real_farfield_origin.py`.

---

# Finding 21 — the lead-field generator, and the four things it broke on the way `[D19 IMPLEMENTED]`

The Gaussian-mixture projection is gone. Topographies now come from an fsaverage 3-shell BEM
forward solution over Desikan-Killiany cortical patches, with each patch contributing the leading
eigenmodes of its own channel covariance.

**31 invented registry rows deleted. 4 added.** `cortical_coherence_mm`, `patch_mode_variance`,
`channel_local_share`, `event_topography_spread`.

## The result, under the reference that invents nothing (D19.1)

| wake_ec, average reference | rank | PC1 | near | far | mean rel. err |
|---|---|---|---|---|---|
| real (EEGMAT) | 5.36 | 0.369 | 0.413 | 0.257 | — |
| **lead-field generator** | **5.43** | 0.298 | 0.450 | 0.291 | **0.107** |
| *Gaussian mixture, 31 rows, under its own fitted reference* | — | — | — | — | *0.250* |

**Effective rank 5.43 against a real 5.36, and rank was not fitted** — only `channel_local_share`
was, jointly against all four. Under linked mastoid the same signal reads 0.349, and that gap is
reported rather than closed: real recordings used interconnected earlobes, which sit further from
cortex than the modelled mastoids, and D19.1 forbids fitting against a reference whose electrode
pickup is a modelling choice.

N3 improved from **1.07 → 1.97** (linked mastoid) across the whole arc of Findings 19–21.

## G6 became a real test, and immediately failed twice

Under the Gaussian, G6's argmax expectations were satisfied **by construction** — the peak was
wherever `topo_centre_*` had been written. Under a forward model the peak is a consequence of
anatomy and volume conduction, so the gate can fail. It did, for `spindle_fast`, on two successive
patch definitions.

Measured rather than argued, the peak turned out to depend on one region:

| spindle_fast patch | scalp peak | G6 |
|---|---|---|
| precentral + postcentral + paracentral | C3, C4, Cz | PASS |
| precentral + postcentral | C4, C3, Cz | PASS |
| paracentral alone | C4, C3, Cz | PASS |
| ... + superiorparietal | Pz, P3, P4 | FAIL |
| postcentral + superiorparietal + supramarginal | P3, P4, Pz | FAIL |

Every strictly sensorimotor reading agrees with the literature electrodes; every reading including
the DK `superiorparietal` label — large, extending well posterior — disagrees. The disagreement was
never about the head model. Including that label makes the **generator** parietal, a stronger claim
than the literature makes: fast spindles are sensorimotor with a field that *spreads*
centro-parietally, and the spread is an output of the forward model rather than a region to add.

**The sequence is recorded because it matters:** the gate failed first, and the patch was
re-examined afterwards. The revision is defensible without reference to the gate, and the
sensitivity table is published so a reader can judge that claim rather than take it.

## Four things broke, and each was a hidden assumption surfacing

**1. Amplitude, by a factor of three.** Referenced Pz RMS went 10.0 → 32.6 µV against a real 14.8.
Neither amplitude row changed. Under the Gaussian the mastoids saw the volume-conducted pedestal,
so a linked reference had been subtracting much of alpha along with it — alpha was being cancelled
by its own reference, which is Finding 18's defect seen from the other side, and
`topo_reference_far_field` was invented to fight it. With real electrodes over bone the reference
stops destroying the signal.

**2. Fitting the background alone could not fix it.** Driving `background_rms_uv` to 0.1 µV still
left Pz at 16.7 µV: in wake_ec, Pz is *alpha's own peak electrode*. Refitted as a pair against two
observables that pull in different directions — Pz RMS and alpha-above-its-own-aperiodic — giving
`background_rms_uv` 8 µV and `alpha_amp` 18 µV p-p, and Pz RMS 13.9 with prominence 11.95, inside
the real IQR.

**3. `snr_nominal` twice.** It is the mix at which N3 meets the AASM criterion, measured against
exactly the referenced amplitude that moved. −3.0765 → −4.0666 → −2.7559 dB.

**4. G5 fell from 0.75 to 0.33 of held-out epochs.** Per-event topographies were first drawn as an
exact sample from the patch covariance, `sum_m c_m w_m` with `c_m ~ N(0,1)`. That is the correct
sample, and it varies each event's amplitude at any *fixed* electrode so much that N3 stopped
reliably meeting a criterion real N3 meets by definition. `event_topography_spread` keeps mode 0 at
full strength and admixes the higher modes; G5 recovered to 0.583. **The parameter trades against
G5 and must not be fitted to it** — its registry note says so, and 0.5 is invented pending T1-M1.

## What this does not fix

`chi` over 1–20 Hz is unchanged at 0.31 against a real 0.99, because it was never a spatial
problem: it is P13, two different quantities being compared. Far-field correlation under *linked
mastoid* remains low, which is now attributable to the earlobe-versus-mastoid difference rather
than to the source model. N3 has no real target in this corpus and its column remains a sanity
bound.

Reproduce: `prep/leadfield/make_projection.py`, `check_projection_stats.py`,
`check_generated_spatial.py`, `fit_amplitude.py`, `prep/reference/compare_real.py`.

---

# Finding 22 — P10 and P13: two quantities, an inversion, and a floor the corpus cannot see past

## P13 — the registry's chi is not the number anyone measures

`chi_wake_ec` was 1.1 with `knee_freq_wake_ec` at 12 Hz. The generator measured 0.31 over 1–20 Hz
against a real 0.99, and that was read as a threefold generator error for three sessions.

It was not an error. `chi_*` is the **asymptotic** exponent of `L(f) = b − log10(k + f^chi)`;
`compare_real.py` measures an LS slope over a band; and a 12 Hz knee sits **inside** that band,
below which the spectrum is flat. Registered 1.1 with a 12 Hz knee *predicts* an in-band slope of
0.303 — the generator was agreeing with its own parameters to two decimals. Build Plan 3.7 already
warned that a published exponent is a joint function of method, band and knee model.

**Closed by naming the second quantity.** `chi_inband_slope` is registered as `derived` with the
procedure that computes it, and `chi_inband_band` records the band it is meaningful over. Neither
stores a value: a stored copy of a quantity computed from two other rows can only drift from them.

**And it exposed a claim that does not survive translation.** The registered `chi_direction`
ordering holds for the asymptotic parameter. In the quantity a reader measures it does not:

| state | chi (registered) | knee_freq | → in-band slope |
|---|---|---|---|
| wake_eo | 0.900 | 12.00 | 0.275 |
| n1 | 1.400 | 12.00 | 0.333 |
| n2 | 1.700 | 10.00 | 0.431 |
| **n3** | 1.660 | 0.50 | **1.589** |
| **rem** | **2.100** | 20.00 | **0.172** |

REM has the steepest chi and the *flattest* measured slope; N3 is mid-order in chi and by far the
steepest measured. The inversion is largely by design — `knee_present` records "REM prominent, N3
absent" — but the consequence was never written down: **no state ordering may be claimed from a
band-limited slope.** That independently reinforces Finding 14, which showed narrowband χ cannot
resolve the spacing between adjacent states even when the ordering is real.

## P10 — and the same mistake, committed while closing P13

Real EEGMAT, average reference, knee-mode specparam over 1–20 Hz: **chi 0.850 [IQR 0.373–1.300],
knee 9.87 Hz [IQR 9.54–10.19]**.

Those numbers were written straight into the registry. Measured back out of the generator through
the identical pipeline they returned **chi 2.173, knee 16.58 Hz**.

The registry rows are **source** parameters describing the process each background mode is
synthesised from; the fitted numbers are **output** properties of a 19-channel, average-referenced,
spatially-mixed scalp signal. Setting one equal to the other assumes the montage is transparent.
**That is precisely the error P13 exists to name, committed in the act of closing P13** — which is
the argument for solving rather than assigning.

So the pair is **inverted**: sweep source (chi, knee), measure the generated signal exactly as the
real recordings were measured, keep the pair whose *output* matches.

| src chi | src knee | → out chi | out knee | err |
|---|---|---|---|---|
| 0.85 | 1.0 | 1.270 | 5.50 | 0.469 |
| **0.85** | **3.0** | **1.574** | **10.32** | **0.448** |
| 1.20 | 6.0 | 1.776 | 10.06 | 0.554 |
| 2.00 | 10.0 | 2.538 | 11.58 | 1.080 |

## The floor, which is the actual result

**Output chi never falls below 1.27 anywhere in the grid.** No source setting produces an
average-referenced output as shallow as the real 0.850. The knee is matched (10.32 against 9.87);
chi is not, and it is not a matter of choosing better numbers.

Two things are true at once, and both matter:

- **The real target is poorly determined.** Per-subject chi spans 0.373–1.300 while the knee spans
  9.54–10.19. With a knee near 10 Hz and a band ending at 20 Hz there is *half a decade* above the
  knee to determine an asymptotic exponent from. The knee is well constrained because it sits in
  the middle of the band; chi is barely constrained at all.
- **The band cannot be widened with this corpus.** EEGMAT carries an acquisition low-pass around
  30–45 Hz — local slope 6.7 over 20–30 Hz, a 50 Hz notch, a flat instrument floor above 80 Hz —
  so fitting higher measures their filter, not their cortex.

**P10 is therefore closed for the knee and remains open for chi, and the blocker is the corpus
rather than the model.** Pinning an asymptotic exponent needs clean data well above the knee. That
is a dataset decision, not a fitting one.

`k_wake_ec` was caught by the emitter the moment the knee moved — it must equal
`knee_freq ** chi`, and the stale 15.3851 failed the build rather than shipping. That
cross-check is the registry doing exactly the job it exists for.

Reproduce: `prep/reference/t1m1_chi_knee_fit.py`, `prep/reference/t1m1_chi_invert.py`.

---

# Finding 23 — nineteen scored nights: two rows must move, and the naive direction is backwards `[P17]`

Four of six arousal states were validated against nothing. This is the first real measurement:
**19 HMC nights, AASM-scored, 4 EEG derivations at 256 Hz, fitted per subject.** The criterion was
fixed before the numbers were seen — MOVE if the registry provisional falls outside the
interquartile range across subjects, with floors of 20 epochs per subject and 8 subjects.

| stage | n | med. epochs | χ median [IQR] 1–30 Hz | χ median [IQR] 1–40 Hz | registry | verdict |
|---|---|---|---|---|---|---|
| wake | 19 | 149 | 0.83 [0.65–1.25] | 0.82 [0.65–1.19] | 0.85 | **HOLD** |
| n1 | 18 | 87 | 1.37 [1.20–1.59] | 1.48 [1.29–1.86] | 1.40 | **HOLD** |
| n2 | 19 | 350 | 2.08 [1.96–2.38] | 2.26 [1.88–2.59] | 1.70 | **MOVE** |
| n3 | 18 | 157 | 2.59 [2.32–2.84] | 2.64 [2.34–2.83] | 1.66 | **MOVE** |
| rem | 19 | 152 | 1.95 [1.79–2.10] | 2.30 [1.98–2.62] | 2.10 | band-dependent → **HOLD** |

## wake and n1 hold, and wake's agreement is worth more than a hold

`chi_wake_ec` = 0.85 was fitted from **EEGMAT** — 8 subjects, 19 channels, average reference,
resting wake. It lands at 0.83 / 0.82 in **HMC** — 19 subjects, 4 derivations, contralateral
mastoid, scored wake epochs from whole-night recordings. Different corpus, different montage,
different reference, different population. That is the first quantity in this project confirmed by
an independent corpus rather than fitted to one.

## REM is band-dependent, so the rule says hold

MOVE at 1–30 Hz (1.95, registry 2.10 just outside), HOLD at 1–40 Hz (2.30, registry inside). By
the pre-registered rule that is a fact about the fit band, not about REM.

**And the claim REM's row rests on cannot be tested here at all.** `chi_rem` = 2.1 cites Lendner
et al. 2020, whose result is a **30–45 Hz** slope. HMC's acquisition low-pass makes that band
unusable — measured, the local slope runs `25–35: −0.33 | 35–45: 2.09 | 45–60: 3.85`, which is a
filter, not cortex. Nothing here confirms or refutes Lendner; the corpus simply cannot reach it.

## The n3 < n2 reversal is refuted

`chi_n3` (1.66) was set deliberately **below** `chi_n2` (1.70), citing Build Plan 7's "small
reversal in N3". Measured, N3 is the steepest of all five stages and clearly steeper than N2 —
2.59 vs 2.08 at 1–30 Hz, 2.64 vs 2.26 at 1–40 Hz, across 18 and 19 subjects with hundreds of
epochs each. The ordering claim does not survive.

Measured ordering: **wake 0.83 < n1 1.37 < rem 1.95 < n2 2.08 < n3 2.59.**
Registry ordering: wake 0.85 < n1 1.40 < n3 1.66 < n2 1.70 < rem 2.10.

## THE DIRECTION OF THE FIX IS THE OPPOSITE OF THE OBVIOUS ONE

The table reads "registry 1.70, corpus 2.08, so raise `chi_n2`." **That would make it worse.**

`chi_*` is a SOURCE parameter; the corpus number is an OUTPUT of a referenced, spatially-mixed
scalp signal. Finding 22 measured that mapping for wake: source 0.85 produced an output of 1.574,
a factor of about 1.85. Applying it, `chi_n2` at 1.70 is already producing an output near 3.1
against a measured 2.08 — **the generator is too steep, and the row must come DOWN, not up.**

This is the third time this project has crossed a parameter with an observable, and the second
time inside the work that documented the error. Assigning the measured values here would be the
same mistake with better data behind it.

So the rows are **not edited to the corpus values.** They are marked as requiring inversion against
the HMC pipeline — compose N2/N3, reference to contralateral mastoid on four derivations, measure,
and solve for the source pair whose output matches — exactly as `snr_nominal` and `chi_wake_ec`
were solved.

## The knee: wake and N1 have none, and the probe lied about it once

| stage | subjects with a usable knee | knee median [IQR] |
|---|---|---|
| wake | **1** of 19 | unusable |
| n1 | 3 of 18 | unusable |
| n2 | 14 of 19 | 2.29 [1.15–2.86] |
| n3 | 15 of 18 | 1.74 [0.88–2.60] |
| rem | 13 of 19 | 1.83 [1.44–2.58] |

Waking spectra over 1–30 Hz return a **negative** knee parameter — sampled directly, every subject
gave k between −0.90 and −1.00, which makes `knee_freq = k^(1/χ)` complex. That is not a solver
hiccup; it means there is no knee in the band to fit. The registry gives waking states knees at
12 Hz, and that is the sharpest disagreement in this finding.

**The first run of this probe reported wake's knee as "3.45 [3.45–3.45]".** It discarded the
unphysical fits as NaN and then took a median over what survived — which was one subject — and
printed it beside an IQR of zero width, reading as tight corpus-wide agreement. The probe now
prints the surviving count next to every knee, and refuses to show a median below `MIN_SUBJECTS`.
A number with no n beside it is how a sample of one passes for a corpus.

## Scope

19 nights, not 20 — SN014 failed to fetch and is not retried silently. HMC is a **clinical
referral population**, not healthy sleepers. Four derivations cannot constrain effective rank, PC1
or near/far correlation, so nothing spatial is anchored here.

Reproduce: `prep/realdata/fetch_hmc.sh 20`, then `prep/reference/t1m1_sleep_corpus.py`.

---

# Finding 24 — the first sleep rows with an empirical basis, and my prediction about them was wrong

Finding 23 returned MOVE for `chi_n2` and `chi_n3`. This inverts them, and the direction is the
opposite of what Finding 23 predicted.

| row | was | now | output achieved | corpus target |
|---|---|---|---|---|
| `chi_n2` | 1.70 | **1.9** | 2.017 | 2.08 [1.96–2.38] |
| `chi_n3` | 1.66 | **3.4** | 2.630 | 2.59 [2.32–2.84] |
| `knee_freq_n2` | 10.0 | 1.0 | 1.68 Hz | 2.29 Hz |
| `knee_freq_n3` | 0.5 | 1.0 | none in band | 1.74 Hz |

**These are the first sleep parameters in this project with any empirical basis at all.**

## The prediction, and why it was wrong

Finding 23 stated it plainly: *"the generator is TOO STEEP and the row must come DOWN."* Both rows
go **up**, `chi_n3` by more than double.

The reasoning was half right. `chi_*` is a source parameter and 2.08 is an output of a referenced,
spatially mixed signal, so they cannot be equated — that part holds, and it is why this was an
inversion rather than an assignment. The error was **extrapolating the source→output factor across
pipelines.** Finding 22 measured it under a *nineteen-channel average reference*: source 0.85 →
output 1.574, a factor of 1.85, output steeper than source. Applying that here gave "1.70 already
produces ~3.1, so come down."

Measured under HMC's own pipeline — four derivations against the contralateral mastoid — the factor
is not 1.85 and **does not even have the same sign of effect**: source 3.4 → output 2.63, output
*shallower* than source. Average referencing across 19 channels removes the spatially common
low-frequency part and steepens the residual; a bipolar mastoid derivation does not.

So the factor is a property of the montage and reference, not of the generator, and **no factor
measured under one pipeline transfers to another.** That is D19.1's own rule, broken in the
paragraph that restated it. Fourth crossing of a parameter with an observable in this project;
the first three were caught by measurement, and so was this one.

## The ordering is corrected

`chi_n3` (3.4) is now above `chi_n2` (1.9), matching the corpus, where N3 measures the steepest of
all five stages. The Build Plan 7 "small reversal in N3" that the old value encoded does not
survive 18 subjects.

## One residual, left standing

**N3's knee never appears in the output at any source setting tried**, while the corpus found one
at 1.74 Hz in 15 of 18 subjects. The search was extended twice — an optimum on a grid boundary is
the grid failing, not an answer — and `chi_n3` = 3.4 is interior, but the knee residual is not a
search problem. It is a real disagreement between the model and the data, and it is recorded rather
than fitted away.

## Scope

19 nights, clinical referral population, four derivations. This anchors the aperiodic exponent for
N2 and N3 and nothing else — not amplitudes, not spindle or slow-wave statistics, and nothing
spatial.

Reproduce: `prep/reference/t1m1_chi_invert_sleep.py`.

---

# Finding 25 — Phase 0 for the analysis demo: the estimator is class V, and half my premise was wrong

The planned connectivity panel rested on one claim: every source here is projected
**instantaneously** through the lead field, so inter-channel coupling is zero-lag volume
conduction — exactly what the weighted phase lag index is built to reject. Coherence and dwPLI
side by side, one glowing and one dark, *"with ground truth saying there is no true connectivity
here except the travelling slow wave."*

Measured before anything was designed around it, because this project has twice recently predicted
a direction and been wrong. Half of it held.

## The estimator behaves as designed

Constructed pairs whose answer follows from trigonometry rather than from any model:

| pair | coherence | dwPLI² |
|---|---|---|
| identical (0°) | 0.619 | **0.000** |
| quadrature (90°) | 0.622 | **0.681** |
| anti-phase (180°) | 0.604 | **0.001** |
| independent | 0.178 | 0.050 |

The anti-phase row is the one that mattered. [Vinck et al. (2011)](https://www.sciencedirect.com/science/article/abs/pii/S1053811911000917)
weight each phase difference by its distance from the **real axis**, so ±180° is rejected as
firmly as 0°. A dipolar field projects with opposite sign either side of its source, and plain
coherence reports that as near-perfect coupling — 0.604 above. dwPLI reports 0.001.

## It agrees exactly with an external implementation

| metric | ours | `mne_connectivity` | \|diff\| |
|---|---|---|---|
| coherence | 0.622 | 0.622 | **0.000** |
| `wpli2_debiased` | 0.681 | 0.681 | **0.000** |

Independently authored and published, so connectivity enters the demo as **class V** rather than
class C. Debiased throughout, and not as a detail: Vinck shows the direct estimator is positively
biased by sample size, and [Haartsen et al. (2020)](https://www.nature.com/articles/s41598-020-68981-5)
found dbWPLI more reliable across many short epochs while plain PLI is confounded by segment
count. A sliding real-time window **is** many short epochs, so a biased estimator would make
connectivity appear to *grow as the buffer fills* — an artefact indistinguishable from a finding.

## The centrepiece holds, strongly

Average reference, 300 s, 19 channels:

| state | band | coherence median | coherence max | dwPLI median | dwPLI max |
|---|---|---|---|---|---|
| wake_ec | alpha | 0.410 | 0.744 | 0.004 | 0.021 |
| n3 | delta | 0.538 | 0.877 | 0.008 | 0.061 |
| n3 | theta | 0.313 | 0.637 | 0.016 | 0.164 |

Roughly a **hundredfold** separation. The panel works.

## And the other half is refuted

*"Except the travelling slow wave"* does not survive. The strongest dwPLI pairs in N3 are `Fp1–F3`
and `Fp2–F4` — **adjacent frontal** pairs, which is not what an anterior–posterior travelling wave
predicts. Tested directly against AP separation in the delta band:

| AP separation | pairs | dwPLI median |
|---|---|---|
| near (< 0.4) | 40 | 0.0045 |
| mid (0.4–0.9) | 62 | 0.0119 |
| far (> 0.9) | 69 | 0.0091 |

correlation(dwPLI, AP separation) = **+0.315**

So the travel leaves a faint statistical trace — near-pairs sit at half the value of mid-pairs —
but it is **non-monotonic and ~50× below what a genuine 90° lag produces**. A viewer would see
nothing. The arithmetic says why: a wave crossing ~0.20 m at `so_travel_v` ≈ 4 m/s lags ~50 ms,
which at 1 Hz is only ~18°, and slow oscillations are sparse events embedded in a far larger
*instantaneous* delta background that dilutes them.

## What that changes

**The demo is better for it, and more honest.** The claim was going to be "dwPLI is dark except
where coupling is real". The measured claim is stronger and more useful:

> dwPLI is dark **everywhere — including where the coupling IS real**, because that coupling is
> sparse and its lag is small.

That is the lesson practitioners actually need, and it lines up with the literature: PLI-family
measures [underestimate at small lags and low SNR, and discard genuine zero-lag synchrony
altogether](https://pmc.ncbi.nlm.nih.gov/articles/PMC12603661/).

**If a visible "true connectivity" contrast is wanted**, the generator needs an explicit lagged
source pair — a registered, deliberate feature, not a fudge. That is a design decision, not a bug
fix, and it should be taken openly.

**Still outstanding from Phase 0:** the per-hop cost in an actual Web Worker. The numpy timings
here say nothing about JS, and the incremental running-sum scheme is unproven until the worker
exists.

Reproduce: `prep/reference/t2m1_connectivity_probe.py`.

---

# Finding 26 — real EEG has lagged connectivity, the generator has none, and it is not where I aimed

Step 0 for coupled sources, run before building because it could have cancelled the work. It did
not cancel it — it redirected it, and killed the topology the plan was built around.

## Real resting EEG does have lagged connectivity

PhysioNet EEGMAT, 8 subjects, average reference, 2 s epochs, against a matched surrogate — each
channel circularly shifted independently, which destroys between-channel phase while preserving
every channel's own spectrum exactly.

| band | coherence | dwPLI | surrogate | obs/null | homotopic | other pairs | **ours** |
|---|---|---|---|---|---|---|---|
| delta | 0.266 | 0.0100 | 0.0048 | 2.07 | 0.0066 | 0.0101 | 0.0020 |
| theta | 0.319 | 0.0151 | 0.0054 | 2.82 | 0.0093 | 0.0155 | 0.0020 |
| **alpha** | 0.440 | **0.0678** | 0.0060 | **11.28** | 0.0294 | 0.0694 | **0.0040** |
| beta | 0.324 | 0.0131 | 0.0060 | 2.20 | 0.0101 | 0.0133 | 0.0040 |

**Every band exceeds its surrogate, and alpha does so by 11×.** So the answer to "is real dwPLI
also near zero" is no. The measure is not merely returning nothing when pointed at volume
conduction; there is real lagged structure and it is largest in alpha.

**Our generator produces essentially none of it.** At 0.0040, alpha dwPLI in the simulator sits
*below* the real surrogate level of 0.0060 — indistinguishable from uncoupled channels, which is
exactly what Finding 25 predicted from instantaneous projection. The gap against real is **17×**.

That is a genuine, measured discrepancy, and it justifies coupled sources.

## But the target is not homotopic, and that was the whole design

The plan was to split every rhythm's patch by hemisphere and couple left-right twins across the
corpus callosum — the strongest connections in any structural connectome, with delays that carry
real literature.

**Homotopic pairs measure 0.0294 against 0.0694 for everything else.** They are less than half the
rest. Splitting patches by hemisphere and coupling homotopically would have been building toward
the wrong structure, at the cost of re-fitting every spatial parameter.

Obvious in hindsight, and worth stating because it generalises: homotopic electrodes sit
symmetrically about the midline, so a midline source reaches both with the **same sign and no
lag** — precisely what wPLI discards. The pairs where volume conduction is most perfectly zero-lag
are the pairs where wPLI is guaranteed to find least, whatever the anatomy underneath is doing.

## And the structure is not geometric at all

Strongest alpha pairs, median across subjects:

| rank | pair | dwPLI | AP sep | LR sep | distance |
|---|---|---|---|---|---|
| 1 | F4–T5 | 0.1533 | 1.10 | 1.26 | 1.67 |
| 2 | Fp2–T5 | 0.1513 | 1.54 | 1.12 | 1.90 |
| 3 | Fz–T5 | 0.1344 | 1.09 | 0.81 | 1.36 |
| 4 | F7–O2 | 0.1313 | 1.54 | 1.12 | 1.90 |
| 5 | F3–Pz | 0.1309 | 1.01 | 0.45 | 1.11 |
| 6 | C4–P4 | 0.1276 | 0.51 | 0.05 | 0.51 |
| 7 | Pz–O1 | 0.1211 | 0.45 | 0.31 | 0.55 |
| 8 | T5–P3 | 0.1181 | 0.08 | 0.36 | 0.37 |

correlation with anterior–posterior separation **+0.131**, with left–right **−0.190**, with scalp
distance **−0.104**.

**All three are near zero.** The structure is not "distant pairs", not "front-to-back", not
"across the midline". Long fronto-temporal diagonals sit beside short posterior pairs at nearly the
same strength. A distance rule cannot produce this; it would have to come from anatomy.

## What this does to the plan

**C is justified** — the 17× gap is real and measured.

**Its topology is not.** A source-coupling model now needs an actual structural connectome mapped
onto the Desikan–Killiany parcellation we already use, rather than a geometric rule or a homotopic
assumption. Such connectomes are published, so this is sourceable — but it is a dataset
dependency, not a formula.

**And 8 subjects cannot pin it.** `T5` appears in four of the top eight pairs, which is as
consistent with one channel behaving oddly across a small cohort as with a real network. Per-pair
estimates from n = 8 are not a topology. Fitting a connection-by-connection model to them would be
fitting noise.

So the honest position is that the *magnitude* to reproduce is well measured (alpha dwPLI ≈ 0.068
against a 0.006 floor) while the *pattern* is not, and a first implementation should target the
former without claiming the latter.

Reproduce: `prep/reference/t2m1_real_connectivity.py`.

---

# Finding 27 — a travelling wave reproduces the missing connectivity, and one fixed direction would not

Step 1 for coupled sources, run before implementation. Finding 26 measured the gap: real alpha
dwPLI 0.068 against a 0.006 floor, ours 0.004. The proposal was that patches which fire
synchronously are the omission, and that alpha propagating as a travelling wave — documented, at
published speeds, and already modelled here for slow oscillations — would close it.

Tested by reaching into the lead field and synthesising what the generator *would* emit, at the
registry's own amplitudes, with no generator change.

## It works, and the speed picks itself

| v (m/s) | phase span (rad) | dwPLI | homotopic | other | r(AP) | r(LR) | r(dist) |
|---|---|---|---|---|---|---|---|
| **real (EEGMAT)** | | **0.0678** | **0.0294** | **0.0694** | **+0.131** | **−0.190** | **−0.104** |
| ours, no wave | | 0.0040 | | | | | |
| **0.5** | 8.77 | **0.0775** | **0.0286** | **0.0813** | −0.008 | −0.206 | −0.187 |
| 0.7 | 6.26 | 0.0453 | 0.0050 | 0.0458 | −0.072 | −0.180 | −0.215 |
| 1.0 | 4.38 | 0.1416 | 0.0066 | 0.1851 | +0.218 | −0.315 | −0.070 |
| 1.4 | 3.13 | 0.1974 | 0.0043 | 0.2097 | +0.228 | −0.304 | −0.054 |
| 2.1 | 2.09 | 0.1617 | 0.0072 | 0.1818 | +0.195 | −0.299 | −0.079 |
| 3.0 | 1.46 | 0.0960 | 0.0077 | 0.1153 | +0.170 | −0.295 | −0.096 |
| 5.0 | 0.88 | 0.0432 | 0.0055 | 0.0457 | +0.154 | −0.291 | −0.104 |

All three preconditions hold at **0.5 m/s**, inside Zhang's published intracortical range of
0.25–0.75 m/s:

- **magnitude** 0.0775 against a real 0.0678 — the right size, from a literature speed rather
  than a fitted one;
- **homotopic suppression** 0.0286 against a real 0.0294, and below `other` as measured;
- **non-geometric** — r(LR) −0.206 against −0.190, r(dist) −0.187 against −0.104.

The mechanism is confirmed: instantaneous patches were the omission, and a wave closes a 17× gap.

## The design error it caught

**A single fixed propagation direction over-suppresses homotopic pairs, badly.** At 1.4 m/s the
model gives homotopic 0.0043 against `other` 0.2097 — a **50×** ratio, where the real recordings
show 2.4×. The plan called for one registered direction (posterior→anterior), and that would have
produced a head plot with an obviously wrong hole down the midline.

The cause is exact symmetry. A plane wave travelling along the anterior–posterior axis reaches
left and right twins at *identical* phase, so `Im(S) = a_i b_j − b_i a_j` vanishes for every
homotopic pair by construction. Real cortex does not do this: propagation direction is documented
as variable and task-dependent, and [rotating waves organise sleep
spindles](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3366935/).

So the model needs **direction variability** — drawn per burst, or rotating — not one axis. That
is a design change discovered before implementation rather than after, and it is also better
supported by the literature than the fixed axis was.

**Why 0.5 m/s escapes it**: at that speed the phase span across the patch is 8.77 rad, so the wave
wraps about 1.4 times within the patch (10 Hz at 0.5 m/s is a 50 mm wavelength across a ~100 mm
patch). The wrapping breaks the midline symmetry that suppresses homotopic pairs at faster speeds.
That is a real effect, but relying on it would be relying on an accident of patch size — direction
variability is the principled fix, and the speed should then be re-fitted with it in place.

## The residual

**r(AP) is −0.008 against a real +0.131.** The only statistic that misses. A single
anterior–posterior wave should, if anything, produce a positive AP correlation; it produces none.
Worth understanding before shipping, and likely another consequence of the fixed direction —
direction variability should be measured against it rather than assumed to fix it.

## Cost, revised

No hemisphere split, no patch restructuring, no re-fit of the spatial parameters. The producer
emits two real topographies per travelling rhythm (`W_cos`, `W_sin`) and compose drives them with
a signal and its quadrature — which alpha nearly has for free, being a damped oscillator whose
state includes velocity. **3–5 days**, against the 2+ weeks the homotopic design implied.

Reproduce: `prep/leadfield/probe_travelling_wave.py`.

---

# Finding 28 — direction variability destroys the effect, and that is itself evidence

Finding 27 closed by proposing a fix: propagation direction should vary, because a plane wave along
a fixed axis reaches homotopic pairs at identical phase and suppressed them 50× against a real 2.4×.
The literature agreed — direction is documented as task-dependent, and rotating waves organise
spindles.

Measured, the fix is wrong, and wrong in a way that teaches something.

| direction | v (m/s) | dwPLI | homo/other | r(AP) | r(LR) | r(dist) | err |
|---|---|---|---|---|---|---|---|
| **real (EEGMAT)** | | **0.0678** | **0.42** | **+0.131** | **−0.190** | **−0.104** | |
| **fixed anterior-posterior** | **0.5** | **0.0744** | **0.40** | −0.020 | −0.209 | −0.198 | **0.083** |
| fixed AP | 1.4 | 0.1973 | 0.03 | +0.227 | −0.304 | −0.055 | 0.618 |
| AP-biased, σ ≈ 0.9 rad | 0.5 | 0.0029 | 0.73 | −0.077 | +0.139 | +0.057 | 0.474 |
| rotating | 0.5 | 0.0032 | 1.30 | +0.058 | +0.099 | +0.144 | 0.725 |
| uniform random | 0.5 | 0.0032 | 1.22 | +0.046 | +0.204 | +0.215 | 0.724 |

**Every varying-direction mode collapses dwPLI to ~0.003** — the uncoupled floor, indistinguishable
from the generator as it stands today. The proposed fix would have removed the entire effect it was
meant to refine.

## Why, and it is the definition of the measure

dwPLI averages `Im(S_ij)` across epochs and asks whether the lag is **consistent**. With a fixed
direction, `Im(S_ij) = a_i b_j − b_i a_j` keeps the same sign in every epoch and the average
survives. Reverse the wave and the sign reverses with it, so a direction that varies over the
recording averages its own lag away — exactly what wPLI is built to do to inconsistent phase.

This is the same class of error as Findings 22 and 24: reasoning about a parameter without
following it through the estimator that measures it.

## The inference worth keeping

Real resting EEG **does** show consistent dwPLI — 0.068, eleven times its surrogate. If cortical
propagation direction varied at rest the way the task literature describes, that consistency could
not survive the averaging.

So the measurement implies **propagation direction is substantially consistent during resting
EEG**, and the documented variability is task modulation rather than resting-state randomness. That
is a claim the data here supports, and it is the opposite of what I assumed from the literature.

## The earlier worry was a misread

Finding 27 reported 50× homotopic suppression and called it a design flaw. That was the **v = 1.4
row**. At 0.5 m/s — the speed that fits everything else — the homotopic ratio is **0.40 against a
real 0.42**. There was nothing to fix.

## Where it stands

`fixed-ap` at **0.5 m/s**, mean relative error **0.083**, is the best configuration found and needs
no new mechanism: one direction, one speed, both inside published ranges.

**The r(AP) residual survives**: −0.020 against a real +0.131, the one statistic that misses, and
now known not to be a direction-variability artefact. The obvious next test is the direction
*angle* — this probe only ever tried posterior→anterior, and a lateral or oblique axis would move
r(AP) and r(LR) together. Untested, and recorded as open rather than assumed.

Reproduce: `prep/leadfield/probe_travelling_wave.py`.

---

# Finding 29 — the angle does not rescue r(AP), and the reason is a model-class limit

Finding 28 left one statistic missing and named the untested variable: only posterior→anterior had
ever been tried, chosen because the literature names it rather than because anything selected it.
Swept over azimuth 0–150°, elevation 0° and 30°, and 0.4–0.6 m/s — 36 configurations.

**Azimuth 0°, elevation 0°, 0.5 m/s remains best, unchanged, at mean relative error 0.083.** The
choice Finding 27 made by assumption survives being measured, which is worth knowing on its own.

## But the residual is a trade-off, not a limit of the angle

| configuration | dwPLI | homo/other | r(AP) | r(LR) | r(dist) | err |
|---|---|---|---|---|---|---|
| **real** | **0.0678** | **0.42** | **+0.131** | **−0.190** | **−0.104** | |
| **az 0, el 0, 0.5** | 0.0744 | **0.40** | −0.020 | −0.209 | −0.198 | **0.083** |
| az 0, el 30, 0.4 | 0.0536 | 0.21 | **+0.135** | −0.255 | −0.082 | 0.160 |
| az 0, el 30, 0.6 | 0.0490 | 0.54 | +0.107 | −0.256 | −0.128 | 0.134 |

**Tilting the wave 30° out of the axial plane fixes r(AP) almost exactly** — +0.135 against a real
+0.131 — and breaks the homotopic ratio doing it, to 0.21 against a real 0.42. The in-plane wave
gets the homotopic ratio right and r(AP) wrong. Nothing in the sweep gets both.

## Which is a familiar shape

A single plane wave has **three degrees of freedom** — azimuth, elevation, speed — against **five
target statistics**. It is underparameterised in *shape*, not in count: the same diagnosis D19 made
of the Gaussian mixture, where four fitted parameters could not reproduce a distance kernel because
the model class did not contain one.

So the honest statement is that a single plane wave across one patch captures the **dominant**
effect — the connectivity magnitude and the homotopic suppression, which are the two things the
generator currently gets wrong by 17× and completely — and does not reproduce the full spatial
pattern. Getting the rest would need either several patches propagating independently, or a wave
that follows cortical geometry instead of a plane. Both are real work and neither is justified by
the demo.

## Recommendation

Implement the single plane wave: **azimuth 0° (posterior→anterior), 0.5 m/s**, both inside
published ranges, matching four of five statistics.

Record `r(AP)` as a **known limit of the single-plane-wave model class**, with the measurement above
as its evidence — 36 configurations, and the one that fixes r(AP) costs the homotopic ratio. That
is a bounded, stated limitation rather than an unexplained miss, and it is the difference between a
model that knows what it cannot do and one that has not looked.

Reproduce: `prep/leadfield/probe_wave_angle.py`.

---

# Finding 30 — the injected connection works, and the fifth source-vs-output conflation was mine again

The connectivity panel needed a positive control. Every source here projects instantaneously, so
all inter-channel coupling is zero-lag volume conduction and dwPLI correctly reports almost nothing
— 0.004 against a real 0.068. A blank map is then unfalsifiable: it could mean the measure is
rejecting volume conduction, or that it never shows anything.

`injectedCoupling` drives `coupling_dst` (peak Pz) from `coupling_src` (peak C3):

```
dst(t) = c · src(t − lag) + √(1 − c²) · independent(t)
```

which leaves the target's total variance unchanged and moves only its shared fraction, so `c = 0`
is a genuine null rather than a quiet setting. It is the connectivity-benchmarking literature's
standard two-source design, adopted rather than invented so results are comparable with published
method comparisons.

## What it does

| coupling | dwPLI(C3,Pz) | montage median | ratio | lag recovered |
|---|---|---|---|---|
| **OFF** | 0.0036 | 0.0044 | 0.83 | — |
| **ON** | **0.4062** | 0.0872 | **4.66** | −8.3 ms |

- **rises 112×** when enabled, 0.0036 → 0.4062
- **at chance when off** — 0.0036 against a montage median of 0.0044
- **specific** — 4.7× the montage median, not a global lift

The matched null is the same generator with the same draws and the same injected patches at the
same amplitude; only the driver's reach changes. Anything surviving that contrast is the coupling
and not the anatomy.

## And the criterion I wrote was wrong

The check originally required the recovered lag to match the injected one within 25%. It measured
**8.3 ms against an injected 20 ms** and declared the injection broken.

The injection is correct. **The assumption was.** Both electrodes see *both* patches through volume
conduction, so the measured cross-spectrum mixes the lagged term with zero-lag leakage, and
zero-lag leakage pulls the apparent phase toward zero. The scalp lag is attenuated by construction
— here to **41% of the source lag**.

That is the source-leakage caveat this project already quoted in Finding 25 — *no bivariate index
escapes it* — arriving as a number rather than a warning. And it is the **fifth** time here that a
source parameter has been assumed to appear unchanged as an output observable: Findings 22, 24, 28,
29, and now the pass criterion of the check meant to catch such things.

The criterion now asks only that a lag is **detected**, and reports the scalp-to-source ratio as a
measurement. Requiring them to match would be requiring volume conduction not to exist.

## What this does not establish

**Direction.** dwPLI and the phase slope are symmetric; the sign of the recovered lag depends on
which channel is named first. Showing that the influence runs C3 → Pz rather than the reverse needs
a directed measure — Granger causality or the directed transfer function — and this pair is exactly
the fixture such a check would use. That is the obvious next gate and it is not claimed here.

**Calibration.** 41% is one measurement at one lag, one strength and one pair. Whether the
attenuation is proportional across lags is untested, and until it is, the ratio is a fact about this
configuration rather than a transfer function.

Reproduce: `prep/reference/t2m1_injected_coupling.py`.

---

# Finding 32 — real EEG waxes and wanes; the background did not `[T1-M1]`

The first full state-output comparison used 19 scored HMC nights, bounded to 120 epochs per
state and subject, and matched the generator to HMC's four contralateral-mastoid derivations.
Both arms received the same 0.3–35 Hz analysis filter. Values were summarized within subject
before taking the corpus median.

Absolute scale was already broadly credible: generated robust RMS ranged from **0.79× to 1.14×**
the real median across wake, N1, N2, N3 and REM. The clearest shared defect was temporal rather
than spectral: robust CV of two-second band power was only **0.56–0.73× real** in wake, N1, N2
and REM. The aperiodic process was stationary for the full record.

## One mechanism, not a parameter per band

A bounded low-passed-noise envelope now multiplies the complete distributed aperiodic background.
It is normalized to unit RMS, so `background_rms_uv` keeps its meaning. Because the same envelope
multiplies every spatial mode and the independent-equivalent channel component after they are
mixed, it changes temporal gain without changing lead-field weights or the fitted local variance
share. A single depth is used for every state and band.

The first depth tried, 0.45, corrected the original deficit but overshot N2 and REM. The retained
depth, **0.35**, gives:

| state | delta CV real / generated | alpha CV real / generated | sigma CV real / generated |
|---|---:|---:|---:|
| wake EC | 0.865 / 0.629 | 0.674 / 0.523 | 0.614 / 0.539 |
| N1 | 0.737 / 0.668 | 0.643 / 0.550 | 0.618 / 0.592 |
| N2 | 0.749 / 0.716 | 0.593 / 0.624 | 0.640 / 0.665 |
| REM | 0.644 / 0.586 | 0.517 / 0.503 | 0.535 / 0.587 |

Wake alpha remains less intermittent than real. That residual belongs to alpha's bistable
oscillator, not to the broadband envelope; raising the global depth until alpha matched would
make N2 and REM worse and repeat the counterbalancing-metrics failure D19 was written to stop.

## What was not fitted

HMC wake, N1 and REM are overwhelmingly delta-heavy relative to the generator, while EEGMAT
resting wake is not. HMC is a clinical sleep-referral corpus recorded overnight, and this first
table does not decide whether that disagreement is physiology, acquisition, artifact, or model.
No band amplitude or knee moved. N2 is the cleanest spectral comparison and is already reasonably
close; N3 remains too spectrally pure, with almost no non-delta power. Those are separate next
problems.

The full seven-check verification suite passes. Average-reference wake spatial error remains
0.104 and effective rank remains 5.43 against 5.36 real, confirming that the temporal fix did not
buy its result by retuning the lead field.

Reproduce: `prep/reference/t1m1_state_realism.py`.

---

# Finding 33 — alpha's damping states were too similar and too brief `[T1-M1]`

Finding 32 left one specific residual: wake alpha remained less intermittent than the real
resting recordings even after broadband temporal texture was corrected. The comparison was moved
to the appropriate corpus: eight PhysioNet EEGMAT eyes-closed resting records, Pz, linked-ear,
against eight equal-duration generated seeds.

Before fitting, generated alpha had envelope CV 0.606 against 0.682 real, threshold-defined bursts
at 39.0/min against 32.8/min, median burst duration 0.310 s against 0.348 s, and envelope memory
0.223 s against 0.284 s. Its envelope distribution was also less bimodal. Every discrepancy said
the same thing: high- and low-amplitude damping states were insufficiently separated and switched
too quickly.

An eight-point joint sweep varied only the sharp-mode bandwidth, broad-mode bandwidth and mean
dwell. Alpha amplitude, peak frequency, waveform shape and lead-field patch were fixed. The
retained values are **0.7 Hz / 8 Hz / 4 s**, replacing 1 Hz / 6 Hz / 1.25 s. Mean relative error
over envelope CV, bimodality, burst rate, burst duration and envelope memory fell from **0.143 to
0.031**.

| metric | EEGMAT median [IQR] | generated median [IQR] |
|---|---:|---:|
| envelope CV | 0.682 [0.636–0.772] | 0.643 [0.604–0.675] |
| robust envelope CV | 0.698 [0.634–0.744] | 0.679 [0.645–0.697] |
| bimodality coefficient | 0.549 [0.486–0.592] | 0.528 [0.503–0.538] |
| burst rate (/min) | 32.8 [25.7–35.3] | 33.5 [31.0–35.3] |
| median burst duration (s) | 0.348 [0.323–0.394] | 0.340 [0.317–0.367] |
| envelope memory (s) | 0.284 [0.240–0.562] | 0.297 [0.273–0.346] |

The values are source parameters obtained by output-side inversion, not copies of the measured
observables. The burst threshold is each record's 75th percentile, so occupancy is fixed by
definition and is deliberately not presented as a fitted result.

Reproduce: `prep/reference/t1m1_alpha_temporal.py` and
`prep/reference/t1m1_alpha_temporal_sweep.py`.

---

# Finding 31 — the directed measure fails its own null, so there is no directed gate

Finding 30 established an injected connection that dwPLI detects (112× on, at chance off,
4.7× specific) but cannot orient: dwPLI and the phase slope are symmetric, and the sign depends on
which channel is named first. The obvious completion was a directed measure, and the phase slope
index is the natural choice — built from the imaginary part of coherency, so it inherits the
volume-conduction robustness, with a sign that is meant to be the direction of flow.

Measured across 8 seeds, counting sign consistency and testing against p = 0.5:

| coupling | consistent sign | ties | sign-test p |
|---|---|---|---|
| **ON** | 8/8 | 0 | **0.0078** |
| **OFF** | 8/8 | 0 | **0.0078** |

**Identical.** The sign is exactly as consistent with no connection present as with one.

## What that means, and what it does not

It does **not** mean direction was recovered. A measure returning the same answer whether or not
the thing exists is reporting something else — here, almost certainly a fixed property of the
montage. C3 and Pz sit where they sit, one anterior to the other, and the surrounding alpha patch,
background and per-channel noise are the same in both arms. Whatever asymmetry PSI is reading is
present without any coupling at all.

Two possibilities remain open and this probe does not separate them: the estimator is being applied
wrongly here — epoching, mode, or index convention — or PSI on this montage has a structural bias
that a single pair cannot distinguish from flow. Either way the honest statement is the same:
**direction is not established, and there is no directed gate.**

## The null is the entire reason this is known

With only the ON arm, the result reads *"direction recovered across 8 seeds, p = 0.0078"* — a clean
significant finding, and false. The matched null cost one extra run and converted it into a
detected failure.

That is the seventh time in this project a matched null or a pre-registered criterion has caught
something the positive arm alone would have reported as a result, and it is why the runner refuses
to start when a gate is missing its null.

## What a directed gate would need

- A second pair with the **opposite** injected direction. If PSI returns the same sign for
  src→dst and dst→src, it is reading geometry, and no amount of seeds will fix that.
- A **swap test**: exchanging the two channel indices must flip the sign. If it does not, the usage
  is wrong rather than the measure.
- Only then a Granger or DTF arm, which carries model-order assumptions this project has not
  characterised.

None of that is done. The injected coupling of Finding 30 stands on its own as the fixture such a
gate would use.

Reproduce: `prep/reference/t2m1_injected_coupling.py`.

---

# Finding 34 — N3 was continuous delta masquerading as slow-wave events `[T1-M1]`

YASA was run on the same four contralateral-mastoid derivations in 19 scored HMC nights and six
generated seeds. Real epochs retained five seconds of their actual neighboring signal on each
side; those margins were excluded from detections, so filtering had context without joins being
counted as events.

N2 spindle morphology was already close. Generated versus real medians were 0.684 versus 0.711 s,
51.4 versus 53.4 µV, 8.5 versus 9 oscillations, and 0.65 versus 0.85 detections/channel/minute.
The clear failure was N3 slow waves: **12.4 versus 3.0 detections/channel/minute**, 1.015 versus
1.291 s duration, and 0.986 versus 0.775 Hz.

## The matched null changed the mechanism

Suppressing every scheduled graphoelement left **11.6 detections/minute**. The scheduled slow
waves were not the cause. The continuous delta oscillator itself crossed YASA's morphology
threshold repeatedly, so changing event rate would have tuned a component the detector was barely
reading.

A joint output-side sweep separated the components:

- continuous `delta_amp`: 150 → **50 µV peak-to-peak**;
- scheduled `so_rate`: implicit ~33 → **9/minute**;
- retain the existing theta process in N3 rather than declaring N3 delta-only;
- N3 aperiodic background gain: **1.9**, separately from event amplitude.

The resulting slow waves measure 4.45/minute (real IQR 1.62–4.32), 1.310 s (real 1.291),
0.764 Hz (real 0.775), 99.3 µV peak-to-peak (real 97.6), and 197.9 µV/s slope (real 209.3).
Robust N3 RMS is 22.3 µV against 20.9 real. The exact G5 algorithm, when applied to genuine HMC,
passes a median 0.228 of N3 epochs and 0.014 of N2 epochs; generated N3 now passes 0.28 across the
gate's held-out seeds, versus 0 for N2 and 0.11 after the −6 dB null attenuation.

**Superseded by Finding 35 for generator v0.5.0:** the two-timescale background moves the held-out
N3 fraction to 0.083, still inside HMC's 0.039–0.364 IQR; N2 remains 0 and the −6 dB N3 arm is
0.028. `background_gain_n3` and `snr_nominal` were not retuned after that independent spectral
fit.

The old G5 null used only three seeds. At a real pass fraction near 0.2, eighteen epochs can easily
contain no passes and turn a valid strict ordering into a tie. It now uses every held-out seed the
runner supplies; this changes power, not the criterion.

## Spindles and the remaining residual

The equal fast/slow spindle draw was also measurable: generated center frequency was 13.56–13.79
Hz versus 12.73–12.79 real. Holding both anatomical systems and frequency ranges fixed, a sweep
set `spindle_fast_fraction` to **0.20**. Output is now 12.42 Hz in N2 and 12.75 Hz in N3.

N3 remains too spectrally pure: 95.3% delta versus 83.6% real, despite the large improvements in
amplitude and event morphology. That is left standing. A flatter second aperiodic component can
address the high-frequency tail and missing N3 knee together; adding separate alpha, beta and
sigma amplitude knobs merely to fill the PSD would recreate the counterbalancing-metrics problem.

K-complexes also remain unanchored: HMC has stage labels but no K-complex event labels, and YASA
has no dedicated K-complex detector. Generic N2 slow waves were not relabeled as K-complexes.

Reproduce: `prep/reference/t1m1_sleep_events.py`, `t1m1_n3_slow_wave_sweep.py`,
`t1m1_n3_theta_probe.py`, `t1m1_hmc_aasm.py`, and `t1m1_spindle_mix_sweep.py`.

---

# Finding 35 — one faster aperiodic timescale repairs N3 without band knobs `[T1-M1]`

Finding 34 left N3 at 95.3% delta against 83.6% in HMC, with no recoverable knee. The first
candidate was deliberately the smallest state-continuity model: retain an independent N2-like
background under N3. It failed structurally. As its variance share rose, band allocation improved,
but recovered chi fell from 2.71 to 2.10 and no physical knee appeared. Enough N2-like power to
matter would contradict the independently measured N3 exponent.

The retained model instead sums two N3 aperiodic processes with the **same** asymptotic exponent
and lead-field modes but different knees. Their RMS amplitudes are split by `sqrt(1-q)` and
`sqrt(q)`, so total aperiodic variance is preserved. A joint grid over fast knee and `q` selected
8 Hz and 0.20 using HMC RMS plus delta, theta, alpha, sigma and beta fractions. The HMC exponent
and knee were pre-specified guards, not extra weights on the same spectrum; no AASM threshold or
generator event label entered the fit.

Held-out validation used six new seeds of ten minutes each through HMC's four contralateral-
mastoid derivations:

| metric | HMC median | generated |
|---|---:|---:|
| robust RMS (uV) | 20.94 | 22.57 |
| delta fraction | 0.836 | 0.827 |
| theta fraction | 0.086 | 0.100 |
| alpha fraction | 0.044 | 0.038 |
| sigma fraction | 0.020 | 0.020 |
| beta fraction | 0.010 | 0.012 |
| recovered chi | 2.59 [2.32-2.84] | 2.38 |
| recovered knee (Hz) | 1.74 [0.88-2.60] | 1.35 |

Mean relative error across the six direct scale/allocation observables is 0.097, versus 0.563 for
the one-component model. The residuals are now balanced rather than all pointing toward missing
faster power. This is the intended stopping rule: do not add per-band controls to erase them.

The model changes exported truth. `chi` and `knee` still identify the primary component for old
readers, while epoch schema v2 records the complete `aperiodicComponents` mixture and variance
shares. The old, weakly sourced 45 Hz row remains unmodelled and is not the fitted 8 Hz source
timescale.

Reproduce: `prep/reference/t1m1_n3_background_mix.py`.

The full v0.5.0 gate regression passes. G5 records 0.083 for N3 against 0 for N2 and 0.028 after
−6 dB attenuation, preserving its strict matched-null contrast. The positive fraction is lower
than v0.4.0's 0.28 but remains inside the real HMC IQR; no amplitude parameter was retuned to move
it back toward the median.

---

# Finding 36 — respiration has a carrier but no physiology around it `[R0]`

The respiration-realism work began with a no-output-change baseline: 600 s per state, three
seeds, with movement artifact, low-band amplitude modulation and exponent modulation each run in
a paired mechanism-off arm. The probe reads analytic respiratory phase rather than recovering it
from the belt. R0 changes no generator or registry value.

| state | rate/min | IBI CV | IBI lag 1 | long DFA | depth CV | power below 0.1 Hz / carrier | RSA (ms) | RSA R2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| wake EO | 15.12 | 0.086 | 0.000 | 0.425 | **0.000** | 3.0e-4 | 80.1 | 0.585 |
| wake EC | 15.02 | 0.078 | -0.100 | 0.492 | **0.000** | 4.7e-4 | 82.0 | 0.576 |
| N1 | 14.99 | 0.079 | 0.022 | 0.561 | **0.000** | 4.2e-4 | 78.3 | 0.556 |
| N2 | 13.42 | 0.082 | -0.099 | 0.538 | **0.000** | 7.7e-4 | 81.1 | 0.570 |
| N3 | 13.59 | 0.079 | -0.077 | 0.491 | **0.000** | 5.5e-4 | 79.7 | 0.580 |
| REM | 16.15 | 0.077 | -0.020 | 0.500 | **0.000** | 2.8e-4 | 78.4 | 0.563 |

## The static appearance has one cause, not several

`resp_period_cv` is one global 0.08 draw from an independent lognormal distribution. The output
is exactly that: every state has CV near 0.08, lag-one correlation near zero and a long-scale DFA
exponent near the 0.5 expected from uncorrelated variation. Breath depth is literally constant.
Power below 0.1 Hz is 0.03–0.08% of carrier power, so there is no meaningful infraslow envelope
around the respiratory cycle.

The state rate rows are carrying a distinction that the dynamics do not. N2/N3 are conspicuously
slower, but REM is not more serially structured and N3 is not more regular. This is the opposite
allocation of model complexity from the external PSG literature: mean sleep-stage rates are
similar, while regularity and long-timescale organization distinguish them.

## RSA is substantial and state-blind

The current ECG has 78–82 ms fitted RR modulation in every state. Respiratory phase alone explains
56–59% of RR variance because the only competitor is independent 3 bpm beat noise. That is enough
to be visually meaningful, but it is not a state model: the same `hr_mean`, `hr_sd` and
`rsa_depth` drive every state. It also exposes a registry/code mismatch. The row describes a
fractional RR modulation while `cardiac.ts` multiplies instantaneous HR and then inverts it.

## One respiratory mechanism is accidentally inside another

The movement artifact was measured two ways: first by independently projecting the registered
artifact through linked mastoids to Fz, and then by subtracting paired full-generator records.
Observed/expected was 0.976–0.977 in every state except N3, where it was **1.857**.

The cause is composition order. Movement artifact enters `out` before the fitted broadband
background envelope is applied. That later loop multiplies all of `out`, not only cortical
background, so it amplitude-modulates a mechanical artifact. N3 then applies
`background_gain_n3` = 1.9 to it as well. The resulting respiration-locked Fz component is
17.63 uV in N3 versus 9.27 uV elsewhere, despite one state-independent artifact amplitude and
topography. This is a causal-layer bug, not a parameter to fit around.

## The neural effects exist, but their current magnitudes are not claims

Low-band envelope modulation recovered an output effect of 0.126 in N1, 0.058 in N2, 0.188 in N3
and 0.137 in REM; wake is zero because no sub-alpha state rhythm is modulated. The provisional
source multiplier is still the unfitted `1 + 0.35 cos(phi)`, and it does not preserve mean squared
power.

Against a requested exponent depth of 0.15, the paired output effect recovered by the shipped
2–40 Hz estimator was only 0.010–0.052 depending on state. This does not estimate the source
depth—it combines generator transfer, spatial mixture, oscillatory interference and estimator
floor—but it establishes what the current page can actually resolve. The requested value must not
be presented as the observed modulation.

## The 90-second boundary is a physiological reset

At a live segment roll, the next respiratory phase starts from zero. Median phase error was
0.72–2.86 radians by state. Tapering the next belt from zero converts the raw reset into a visible
join rather than making it continuous, and independently restarting beat scheduling makes the RR
interval spanning the join wrong by 178–241 ms. The ECG voltage itself is usually near zero at
the boundary, so a sample-discontinuity check alone would falsely pass it.

## Event phase is currently a null

There is no respiratory input to event scheduling. With enough events, the injected phase
distributions are accordingly flat: N3 slow oscillations had pooled resultant length 0.048
(n = 266), N2 slow spindles 0.051 (n = 97), and N3 slow spindles 0.050 (n = 105). Sparse fast
spindles produced larger chance resultants (0.267 and 0.278), demonstrating why their apparent
angles cannot be read as coupling without a matched phase null and adequate event count.

These measurements define R1's scope: introduce continuous subject/state respiratory dynamics,
separate artifact from the cortical envelope, and preserve phase and RR state across chunks.
They do not authorize moving any magnitude row yet.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/r0_respiration_baseline.mts --duration 600 --seeds 3`.

---

# Finding 37 — R1 replaces respiratory jitter with respiratory state `[R1]`

R1 changes the causal model, not just the belt drawing. A seed now defines one subject-rate
phenotype. Each state applies a literature group mean to that phenotype, while a serializable
controller carries the current breath, fast and slow timing latents, depth, morphology and RNG
state. The stateless exporter and stateful live stream are wrappers around the same transition.

Direct characterization over 20 seeds × 600 s gives:

| state | group-mean rate/min | IBI CV | IBI lag 1 | depth CV | inhale pause | exhale pause | pause duration | median E:I |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| wake EO | 16.86 | 0.148 | 0.490 | 0.198 | 0.295 | 0.288 | 0.199 s | 1.75 |
| wake EC | 16.66 | 0.143 | 0.474 | 0.202 | 0.319 | 0.292 | 0.199 s | 1.74 |
| N1 | 15.66 | 0.096 | 0.364 | 0.162 | 0.289 | 0.316 | 0.199 s | 1.74 |
| N2 | 15.44 | 0.078 | 0.312 | 0.121 | 0.307 | 0.294 | 0.199 s | 1.74 |
| N3 | 15.92 | 0.059 | 0.340 | 0.080 | 0.286 | 0.320 | 0.199 s | 1.74 |
| REM | 15.49 | 0.124 | 0.543 | 0.222 | 0.294 | 0.290 | 0.199 s | 1.73 |

The rate targets are Gutierrez et al.'s 16.8/15.7/15.5/15.9/15.2 group means for
wake/N1/N2/N3/REM; the 20-seed means recover them without encoding REM irregularity as a rate
range. N3 is now most regular, while wake and REM carry more timing and depth variability. The
old output had IBI CV 0.077–0.086 in every state, lag-one correlations around zero, and depth CV
exactly zero.

## Feature parity is explicit and limited

BreathMetrics/NeuroKit2 supplies a useful independent simulator anchor, not a normal-population
distribution. Its default inhale-pause probability, exhale-pause probability and mean pause
duration are 0.30, 0.30 and 0.20 s. R1 realizes 0.286–0.320 and 0.199 s across states. Variable
depth and E:I ratio are also present, and every breath is assembled from separate inhale,
post-inhale pause, exhale and post-exhale pause segments. This is feature parity, not pixel
similarity and not evidence that those defaults are physiological constants.

## Continuity is an invariant, not a tolerance

Splitting a record at an arbitrary sample, serializing the state through JSON, and resuming it
produces **zero maximum sample error** in both belt and analytic phase relative to one whole-record
call. The browser's actual prefetch-and-roll path passes the same invariant. The prior live phase
error was 0.72–2.86 radians; it is now exactly zero. No empirical threshold is needed because
these are two executions of the same deterministic state machine.

## The causal-layer bug is removed

Paired mechanism-on/off composition now gives observed/expected movement-artifact gain 1.000 in
all states. Before R1, N3 measured 1.857 because the mechanical artifact was accidentally inside
the stochastic cortical envelope and then inherited `background_gain_n3` = 1.9. The artifact is
now projected only after those background operations. No artifact amplitude was retuned.

## What did not move

The ECG and EEG coupling equations still consume the same belt/phase interface. The post-change
probe still finds roughly 76–81 ms state-blind RSA, and the RR interval spanning a live join is
still wrong by roughly 100–200 ms because cardiac scheduling has no resumable state. That is the
R2 baseline, not an R1 defect to mask. Neural modulation magnitudes and respiratory event hazards
also remain untouched for R3 and R4.

Reproduce the direct controller result:
`node --experimental-strip-types --no-warnings prep/reference/r1_respiration_controller.mts`.

Reproduce the paired downstream mechanisms:
`node --experimental-strip-types --no-warnings prep/reference/r0_respiration_baseline.mts --duration 600 --seeds 3 --output prep/out/r1_respiration_characterization.json`.

---

# Finding 38 — R2 makes cardiac timing physiological and continuous `[R2]`

The ECG is no longer a PQRST picture laid over independently restarted beat times. One
serializable cardiac controller now carries the subject phenotype, next beat, preceding interval,
fast and slow non-respiratory HRV states, and RNG snapshot. It schedules RR intervals directly
from state mean RR, respiration phase and depth, and correlated residual HRV. Whole-record export,
arbitrary chunks and the browser's live prefetch path all use that controller.

## The state targets are empirical, but the RSA magnitude is not

The same QRS detector was applied to all usable ECG epochs from 19 HMC nights. Aggregating within
subject before across subjects gives:

| state | HMC HR, median [IQR] bpm | HMC SDNN, median [IQR] ms | HMC RMSSD, median [IQR] ms |
|---|---:|---:|---:|
| wake | 68.3 [60.2–75.2] | 117.5 [91.8–137.4] | 37.9 [31.9–52.3] |
| N1 | 63.1 [56.7–72.8] | 107.0 [87.0–134.4] | 35.4 [30.2–63.1] |
| N2 | 61.6 [54.8–70.2] | 76.7 [56.8–96.9] | 41.6 [29.6–55.8] |
| N3 | 62.1 [54.9–72.2] | 61.3 [44.6–76.7] | 37.6 [28.4–51.1] |
| REM | 65.1 [55.6–70.5] | 81.8 [61.4–110.2] | 36.3 [25.2–52.2] |

HMC contains ECG but no respiration, so these records cannot estimate RSA. Penzel et al.'s
literature ratios establish NREM > REM > wake as a relative direction only. The registered 30 ms
REM RR amplitude remains `pending`; generated recovery cannot elevate its standing.

## The controller recovers its specified behavior without metric chasing

Twenty seeds × 1,200 seconds per state produce:

| state | generated HR bpm | generated SDNN ms | HMC target ms | RMSSD ms | fitted RSA ms | requested RSA ms | RSA R² |
|---|---:|---:|---:|---:|---:|---:|---:|
| wake EO | 70.4 | 106.6 | 117.5 | 43.9 | 25.9 | 27.0 | 0.027 |
| wake EC | 67.7 | 104.1 | 117.5 | 45.7 | 26.3 | 27.0 | 0.030 |
| N1 | 63.5 | 100.4 | 107.0 | 52.8 | 38.8 | 39.9 | 0.077 |
| N2 | 62.6 | 68.5 | 76.7 | 47.6 | 37.9 | 39.9 | 0.149 |
| N3 | 64.2 | 54.5 | 61.3 | 47.6 | 38.9 | 41.1 | 0.250 |
| REM | 65.8 | 73.1 | 81.8 | 39.8 | 29.0 | 30.0 | 0.076 |

Every generated HR, SDNN and RMSSD entry is inside its HMC IQR. That is the acceptance result;
the controller is not retuned to make every generated median equal every empirical median. Fitted
RSA amplitude recovers the requested RR-domain amplitude and the variance left over after RSA is
assigned to independent correlated HRV in quadrature.

## Chunk continuity now includes the waveform, not just the beat list

P waves begin before an R peak and T waves extend after it. Preserving only `nextBeat` therefore
did not suffice: an early renderer let a future interval alter the Gaussian tails already emitted
in the preceding chunk, producing up to 51 µV error despite identical R peaks. The final renderer
uses the preceding interval for the causal pre-R half and the scheduled interval for the post-R
half. Whole versus arbitrary-chunk ECG, JSON checkpoint/resume, and the actual 90-second live roll
now have zero sample error, zero R-peak-time error and zero spanning-RR error.

The legacy morphology probe still finds P–Q–R–S–T in order with signs `+ − + − +`, a dominant
approximately 1,000 µV R wave, and respiratory locking above a phase-shuffled null. This is a
display-plausibility guard, not validation of diagnostic morphology; wave widths and amplitudes
remain a later corpus task.

Reproduce the HMC fit:
`.venv311/Scripts/python.exe prep/reference/r2_hmc_cardiac.py`.

Reproduce the direct controller characterization:
`node --experimental-strip-types --no-warnings prep/reference/r2_cardiac_controller.mts`.

Reproduce the composed and live-path result:
`node --experimental-strip-types --no-warnings prep/reference/r0_respiration_baseline.mts --duration 600 --seeds 3 --output prep/out/r2_cardiorespiratory_characterization.json`.

---

# Finding 39 — R3 separates respiratory slope and rhythm coupling `[R3]`

The old respiratory EEG path had one global phase, one spatially uniform exponent change and a
linear multiplier applied only to low-frequency state rhythms. It encoded neither the published
wake-to-sleep phase shift nor the posterior weighting of the slope effect; its linear gain also
changed mean squared rhythm power. R3 replaces those structural shortcuts rather than tuning them
against the coupling estimator.

## External facts determine phase and anatomy determines the scalp map

Respiratory phase now follows the convention used by Kluger et al. and Sánchez Corzo et al.:
peak inspiration is zero, inspiration is negative, and expiration positive. The five registered
maximum-slope directions are direct literature values: wake 2.99 rad, N1 -2.70, N2 -1.33, N3
-1.78 and REM -1.45. Thus N1 remains wake-like and the phase reversal begins in N2 instead of
being imposed at the wake/sleep boundary.

Kluger et al. report a widespread but posterior-weighted aperiodic effect. The implementation
therefore defines one posterior cortical modulation patch and projects it through the same
three-shell BEM as the rhythms. Root-sum-square power across the patch's signed modes gives the
nonnegative modulation strength. Its independent fixed-point loading peaks at Pz; Fz/Pz is
0.321, with frontal values around one third of posterior rather than an absent frontal effect.

## Matched recovery preserves the intended invariants

Three paired seeds × 180 seconds per state, differing only in the tested mechanism, give:

| state | recovered slope depth | slope phase error | recovered Fz/Pz | recovered periodic depth | periodic phase error | total RMS ratio |
|---|---:|---:|---:|---:|---:|---:|
| wake EO | 0.101 | 1.2° | 0.319 | 0.010 | 1.1° | 1.0000 |
| wake EC | 0.104 | 1.8° | 0.331 | 0.080 | 1.4° | 1.0001 |
| N1 | 0.114 | 1.0° | 0.300 | 0.043 | 2.5° | 1.0000 |
| N2 | 0.091 | 3.6° | 0.271 | 0.071 | 1.2° | 0.9999 |
| N3 | 0.083 | 4.2° | 0.256 | 0.058 | 0.3° | 0.9998 |
| REM | 0.109 | 1.3° | 0.306 | 0.010 | 9.9° | 0.9999 |

Across all 19 channels, the recovered slope-depth topography correlates **0.999** with the BEM
loading computed without looking at the generated EEG. This is the spatial acceptance result;
the simulator's own spread supplies no threshold. Restoring each aperiodic channel to its
pre-tilt RMS and using a Bessel-normalized exponential periodic gain leave total EEG RMS within
0.02% and mean band amplitude at 1.000 of the matched mechanism-off record.

Periodic depth varies by state because the readout follows a represented rhythm at Pz: a weak
rhythm has a small observable modulation even when its source uses the same pending gain. That is
not a reason to counter-tune every state. The absolute source depths remain provisional because
the cited work establishes their existence and phase courses but has not yet been converted into
the generator's log-amplitude and chi units.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/r3_eeg_coupling.mts`.

---

# Finding 40 — R4 conditions NREM event timing without changing source rates `[R4]`

R4 is a conditional point-process change, not another waveform modulation. For each event class,
the existing homogeneous Poisson scheduler draws the count. A separate named RNG stream assigns
respiratory phases to those events. This makes the strongest rate invariant possible: the on and
off arms have the same count for every seed, not merely equal rates in expectation.

## Natural breathing requires phase-indexed sampling

The first implementation used `exp(kappa cos(phi-mu))` as a clock-time rejection weight. It
recovered the registered resultant lengths but missed the means by 0.19 rad for N2 fast spindles
and 0.31 rad for N3 SOs. The cause was not random error: unequal I:E timing means respiratory
phase has unequal clock-time exposure. The final implementation draws a von Mises phase and then
selects uniformly among samples carrying it. This removes morphology as a hidden phase offset.

Five seeds × 3,600 seconds produce:

| state | injected marker | n | recovered phase | target | error | R | mechanism-off R |
|---|---|---:|---:|---:|---:|---:|---:|
| N2 | fast-spindle onset | 233 | 0.344 | 0.296 | +0.048 | 0.498 | 0.148 |
| N2 | slow-spindle onset | 918 | 1.464 | — | — | 0.169 | 0.169 |
| N3 | SO downstate | 2,686 | -0.169 | -0.164 | -0.005 | 0.517 | 0.158 |
| N3 | fast-spindle onset | 235 | 0.182 | 0.296 | -0.113 | 0.512 | 0.191 |
| N3 | slow-spindle onset | 928 | 1.688 | — | — | 0.163 | 0.163 |

Every paired count is exact. N2 and N3 slow-spindle events are unchanged in onset, duration and
amplitude; their nonzero raw R is respiratory phase exposure, not an injected hazard. This is why
the matched off arm is more informative than demanding that a phase-shuffled raw distribution be
flat.

## The external detector recovers ordering, with visible estimator bias

YASA was run on the complete volume-conducted mixture at Fz for SO/slow-spindle events and C3 for
fast spindles. Detections were greedily matched to injected events by temporal overlap before the
detector's own onset or negative-peak marker was phased:

| state | detected marker | off n / R | on n / R | on phase |
|---|---|---:|---:|---:|
| N2 | fast-spindle onset | 91 / 0.145 | 89 / 0.513 | +0.410 |
| N2 | slow-spindle onset | 113 / 0.234 | 113 / 0.234 | +2.122 |
| N3 | SO negative peak | 667 / 0.142 | 599 / 0.458 | -0.059 |
| N3 | fast-spindle onset | 33 / 0.019 | 30 / 0.549 | +0.799 |

The external ordering is correct: SO negative peaks occur before peak inspiration and fast-
spindle detections after it; the N2 slow-spindle control is exactly unchanged. YASA's N3 onset is
later than injected truth because the event is nested in a large slow wave and detection begins
after the source envelope starts. That error belongs to the estimator. Counter-shifting the
generator until YASA printed +0.296 would violate the circularity rule.

The source-rate invariant is exact, while matched YASA counts move by -2% for N2 fast spindles and
about -10% for N3 SO/fast events because concentrating events in respiratory windows increases
overlap and detector merging. No rate row was retuned: the N3 slow-wave detector rate moves toward,
not away from, the previously measured HMC interval.

Schreiner et al. 2023 provide the shipped inhalation-centred profile and a negative slow-spindle
result. Girin et al. 2024 report a conflicting full-night profile—both spindle classes during
expiration and slow waves near phase transitions. R4 therefore establishes one named profile,
not a universal respiratory law.

Reproduce injected truth:
`node --experimental-strip-types --no-warnings prep/reference/r4_event_hazards.mts`.

Reproduce external recovery:
`.venv311/Scripts/python.exe prep/reference/r4_event_recovery.py`.

---

# Finding 41 — R5 closes the respiratory truth and interaction contract `[R5]`

R5 changes no default signal parameter. It makes the causal model inspectable and adds two
restrained UI contrasts. Epoch schema v5 now carries realized breath morphology, period/depth
variability, I:E and pause fractions; R peaks, RR intervals, SDNN, RMSSD, requested and recovered
RSA; and circular summaries of every respiratory event marker. Variable-length arrays are stored
once in run-level `physiology.json`, while compact epoch truth points to that file. Unit tests
recompute those values from the raw controller arrays and require exact equality. Short records
use `null`, not a JSON `NaN` collapse.

The paired release audit removes each mechanism one at a time from identical seeds. Two seeds ×
120 seconds per state gave:

| state | natural period CV | regular CV | movement Δ RMS (µV) | periodic-gain Δ RMS | slope Δ RMS | event-timing Δ RMS |
|---|---:|---:|---:|---:|---:|---:|
| wake EO | 0.139 | 0.000 | 6.942 | 0.124 | 0.447 | 0.000 |
| wake EC | 0.172 | 0.000 | 6.624 | 0.235 | 0.424 | 0.000 |
| N1 | 0.081 | 0.000 | 6.723 | 0.927 | 0.408 | 0.000 |
| N2 | 0.080 | 0.000 | 6.829 | 0.980 | 0.479 | 0.862 |
| N3 | 0.058 | 0.000 | 6.769 | 2.765 | 0.938 | 13.345 |
| REM | 0.098 | 0.000 | 7.022 | 0.999 | 0.408 | 0.000 |

Every mechanism changes the waveform in each state where it is defined. Event timing is exactly
inert outside N2/N3, and turning it off preserves every event count exactly. The large N3
event-timing difference is not a power gain: large slow waves are moved in time, so pointwise
subtraction is large even though the event set is unchanged. These marginal differences are
diagnostics, not realism tolerances.

No pending magnitude changed standing. In particular, recovery of a value from generated signal
does not become empirical evidence for the value used to generate it.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/r5_release_integration.mts`.

---

# Finding 42 — ISF-0 freezes an infra-slow contract without inventing a source `[ISF-0]`

The shipped aperiodic FFT reaches below 0.1 Hz and the background has a 0.10 Hz stochastic gain
envelope, but neither is a named infra-slow physiological source. Generated truth contains no
infra-slow source, phase, topography, delay or mechanism-off arm. ISF-0 leaves that output
unchanged and records the distinction instead of relabelling an incidental spectral tail.

The external specification now fixes three analysis bands: 0.008-0.1 Hz overall, ISF1 at
0.008-0.05 Hz and ISF2 at 0.05-0.1 Hz. A derived 1,250-second probe spans ten cycles at the lower
edge; the ordinary 15-60 second display is explicitly not a validation record. The wake and NREM
PLV values of 0.178 and 0.211 are registered as estimator-specific reference metrics, not as
generator modulation depths. The accepted state claim is aggregate NREM > wake. No N1/N2/N3
ladder and no REM profile are inferred.

Ten load-bearing quantities remain `absent`: cortical RMS in wake, NREM and REM; shared-source
fraction; source delay; PAC depth in wake, NREM and REM; electrode/DC-drift RMS; and the separately
represented reference/DC-drift RMS. This is the prefix-not-placeholder result. Assigning plausible
values now would let the proposed stochastic
controller validate numbers selected for itself and would also force the complete full-band scalp
potential through a cortical dipole model despite unresolved BBB, vascular, glial and recording
contributions.

The I0 structural probe passes: ISF1 and ISF2 exactly partition the full band, the record spans ten
lower-edge cycles, all nine unknowns remain unreadable, the projection file contains no ISF source
IDs, generated truth makes no ISF claim, and `generator_version` remains 0.9.0. D26 freezes the
three future paths—BEM-projected cortical current, power-preserving excitability modulation and
non-BEM electrode drift—while respiration remains independent.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf0_contract.mts`.

---

# Finding 43 — ISF-1 selects a temporal form without selecting its physiology `[ISF-1]`

The current continuous generator is not empty below 0.1 Hz, but that energy is an incidental tail
of existing aperiodic and rhythmic processes rather than a named infra-slow source. In 1,250-second
linked-mastoid records, its 0.008-0.1 Hz RMS ranges from 0.489 to 4.215 µV across states and its
ratio to 0.1-1 Hz RMS ranges from 0.097 to 0.143. Frequency-domain spatial effective rank ranges
from 4.10 to 5.00. These values describe the current output; they are not targets and were not used
to select an infra-slow amplitude.

Three causal, unit-variance temporal candidates were then compared outside `composeState`: a
power-law state-space process, a damped-oscillator bank, and a power-law process with a weak
resonance. Each was observed through the same causal 0.008-0.1 Hz limiter and tested over twenty
seeds at a 2 Hz controller rate. All three preserved state exactly under arbitrary chunking. Their
median full-band spectral entropies were nearly identical (0.834-0.838), largest-bin shares were
0.076-0.082, and low-band upward-crossing periods broadly overlapped. The hybrid's 0.02 Hz peak
was manufactured by its fixture rather than required by external evidence.

ISF-1 therefore selects the smallest adequate temporal family: a causal, band-limited power-law
state process. It does **not** promote the comparison fixture's exponent, pole count, resonance,
amplitude, source count, topography, state gains or coupling depths. Those quantities remain absent
until the corresponding empirical or structural step. The selected controller rate is 2 Hz, which
provides ten samples at the 0.1 Hz upper edge while keeping long validation records inexpensive.
This is a software architecture decision, not a claim that physiology is sampled at 2 Hz.

Reproduce the current-output boundary:
`node --experimental-strip-types --no-warnings prep/reference/isf1_current_baseline.mts`.

Reproduce the isolated candidate comparison:
`node --experimental-strip-types --no-warnings prep/reference/isf1_temporal_candidates.mts`.

---

# Finding 44 — ISF-2 adds BEM source bases without adding a signal `[ISF-2]`

Three bilateral anatomical families were added to the projection producer: frontomedial
association, sensorimotor and posterior visual/association cortex. They contain 3,126, 2,960 and
3,967 fixed-normal fsaverage cortical sources and retain 6, 7 and 7 covariance eigenmodes at the
existing `patch_mode_variance`. Every mode follows the same three-shell BEM path as the established
rhythms. No electrode-space infra-slow topography, channel phase or channel delay exists.

Independent unit-variance mode drivers produce linked-mastoid power maxima at Fz, C3 and Pz. The
three families individually have effective ranks 1.365, 2.607 and 2.120. Their equal-variance sum
has effective rank 3.480, PC1 variance fraction 0.410 and median absolute channel correlation
0.313; near- and far-distance-quartile correlations are 0.699 and 0.276. Referencing covariance
before versus after projection agrees to a maximum residual of `8.9e-16`.

None of those covariance summaries was fitted. Equal family variance exists only in this
unit-variance characterization and must not become a physiological loading because its summaries
happen to resemble earlier recordings. The conditional fourth lateral family remains absent: no
external observation requires it, and adding it to tune covariance would count the same evidence
several times.

The projection file now contains the undriven spatial bases, while cortical RMS, source sharing,
delay, stage gain and coupling depth remain absent. `composeState` emits no infra-slow truth and no
sample changes; `generator_version` therefore remains 0.9.0.

Reproduce:
`.venv311/Scripts/python.exe prep/reference/isf2_source_families.py`.

---

# Finding 45 — ISF-3 makes additive voltage and excitability independently falsifiable `[ISF-3]`

The selected two-band state-space controller now has a causal runtime implementation. It runs at
2 Hz, linearly interpolates to EEG rate, stores no typed arrays or non-JSON values in checkpoints,
and is exactly sample-identical under whole-record and arbitrary chunk generation. ISF1 and ISF2
can be selected independently without perturbing their underlying draws. Unit stationary variance
is derived from the state-space impulse energy rather than measured from generated spread.

An explicit fixture-only compositor path connects that controller to the ISF-2 BEM modes and to
named continuous cortical carriers. Additive current reconstructed independently from the
posterior modes agrees with the complete-mixture difference to `1.3e-14 µV`. The additive
contribution inside the combined arm agrees with additive-only minus off to `3.2e-14 µV`, showing
that enabling modulation does not redraw or rescale the additive mechanism.

The source gain is `exp(mz - m²)`, which gives `E[g²] = 1` for unit-Gaussian `z`. A finite record
still reports realized gain RMS rather than pretending the ensemble identity holds exactly in
every window. An independent estimator—Pz alpha bandpass, Hilbert amplitude and LS log-envelope
loading on known ISF truth—gave:

| arm | recovered loading | alpha RMS (µV) |
|---|---:|---:|
| off | 0.075 | 4.546 |
| additive only | 0.075 | 4.546 |
| modulation only | 0.357 | 4.617 |
| both | 0.357 | 4.617 |
| π-inverted driver | -0.197 | 4.254 |

These values demonstrate identifiability at one deliberately visible fixture depth; they are not
physiological estimates, recovery thresholds or a mapping from published PLV to generator depth.
The residual off-arm loading and finite-record RMS differences are printed rather than tuned away.

Respiration remains a separate cause: changing the matched belt rate from 10 to 20 breaths/min
leaves every EEG sample bit-identical when respiratory EEG mechanisms are disabled. In the probe,
the ISF-driver/belt correlation is 0.0095. Band variance split, target map, preferred phase,
amplitudes, shared fraction, delay and all state depths remain absent.

The executable path has no defaults and is absent from the UI/exporter. Default samples and truth
remain unchanged at generator 0.9.0.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf3_mechanism_arms.mts`.

---

# Finding 46 — ISF-4 holds at the source-amplitude estimand `[ISF-4]`

Four external candidates were audited against the pre-registered 1,250-second full-band probe.
The primary healthy wake/NREM study uses DC-coupled 256-channel EEG and the correct 0.008-0.1 Hz
analysis, but its published result is relative power from 10-minute records and its raw data are
not public. OpenNeuro ds005385 supplies a large DC-amplifier healthy-wake corpus, but each condition
is 180 seconds (1.44 cycles at 0.008 Hz). OpenNeuro ds007987 supplies raw 128-channel wake EEG in
300-second runs (2.4 cycles), while its public acquisition description does not state an exact
high-pass. Neither contains sleep.

OpenNeuro ds003768 is the closest public sleep candidate: raw 0-250 Hz EEG, scored W/N1/N2/N3 and
15-minute runs. Those runs still provide only 7.2 cycles at the lower edge, and the raw signal was
acquired inside an active MRI scanner. Gradient and ballistocardiogram artifacts must be removed;
the derived signal used for staging was subsequently filtered at 0.3-35 Hz and cannot validate
infraslow voltage. The dataset therefore remains useful for stage annotations and method work,
not for absolute full-band calibration.

No candidate is eligible to fit the requested BEM amplitude for a deeper reason: a scalp electrode
measures the sum of projected cortical current, BBB/vascular and respiratory physiology,
skin/electrode polarization and reference behavior. The BEM term is only one member of that sum.
Matching it to total scalp RMS would manufacture a source attribution rather than estimate one.

The audit therefore returns `HOLD_NOT_IDENTIFIABLE`. No generator value changes. Cortical RMS,
source sharing/delay, band balance and modulation depths remain absent; published relative power,
PLV and coupled-channel extent remain external comparators. A unit test makes that boundary
executable so a later total-scalp fit cannot silently populate source parameters.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf4_external_evidence.mts`.

---

# Finding 47 — ISF-5 makes recording drift separable by cause `[ISF-5]`

Recording drift now has an executable observation-layer path without acquiring a physiological
default. Each generated lead receives an independent broad stochastic fixture directly in
electrode space. A second shared fixture reaches only A1/A2, representing a mastoid-reference
problem whose scalp consequence is produced by the ordinary reference operator. Neither path
calls the BEM projection seam or stores an electrode topography.

The causal location is pinned exactly. Matched on/off subtraction recovers the independently
synthesized electrode additions to machine rounding. Turning only the common mastoid term on
leaves as-generated scalp, average-reference and Laplacian samples bit-identical; every linked-
mastoid and contralateral scalp sample changes by the negative common-reference waveform. Drift-
only truth contains zero cortical source modes and zero modulation targets, so it cannot satisfy
the neural source-projection or coupling gates by being large.

For characterization, a deliberately visible fixture requested 1 uV independent-channel RMS and
0.7 uV common-reference RMS over 120 seconds. Its effective rank was 9.18 as generated, 3.63 under
linked mastoids, 4.28 contralaterally, 8.82 under average reference and 7.02 under Laplacian. A
posterior cortical ISF fixture measured 1.60 under linked mastoids. These are consequences of the
two mechanisms and the selected reference, not rank targets.

At linked-mastoid Fz, a 1 Hz zero-phase high-pass reduced fixture RMS from 1.398 to 0.00738 uV,
retaining 0.0053. That similarity to filtering direct cortical voltage is why filter response
cannot identify origin. The truth distinction survives even when both waveforms disappear.

Electrode and reference drift amplitudes remain separately absent. Omitting the fixture keeps
default samples and infra-slow truth unchanged at generator 0.9.0.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf5_recording_drift.mts`.

---

# Finding 48 — the full-band release view exposes time without inventing origin `[ISF-6]`

The release interface now generates each 120, 300 or 600 second overview as one continuous
record. It does not concatenate the live scroll's 90-second buffers and therefore cannot turn a
presentation crossfade into apparent infra-slow activity. The complete-record spectrum has
plotted bin spacing 0.00781, 0.00195 and 0.000977 Hz respectively, while the interface separately
states the honest fundamental resolutions of 0.00833, 0.00333 and 0.00167 Hz. The distinction is
load-bearing: zero padding densifies frequency bins but does not create observed cycles.

For the release wake-eyes-closed fixture at linked-mastoid Fz, the 2 Hz anti-aliased overview had
DC-retaining RMS 6.67, 6.53 and 6.76 uV over 120, 300 and 600 seconds. The fixed 0.1 Hz comparison
high-pass retained 0.979, 0.980 and 0.984 of that RMS; the removed waveform itself measured 1.10,
1.09 and 0.99 uV RMS. This is a useful negative result: the released generator contains only a
modest direct sub-0.1 Hz contribution. The interface does not enlarge it or silently activate a
fixture to make the demonstration more dramatic.

Every overview reported `namedInfraSlowTruth = false`. The projected-cortical, excitability and
recording-drift controls remain independently visible but disabled because their RMS/depth rows
remain absent. Generator 0.9.0 and export schema v5 are therefore unchanged. In browser QA, a
600-second record generated in 1.79 seconds, both canvases rendered, cached electrode switching
worked, and no console warning or error was emitted.

The complete registry/projection/literal/type/test/harness/gate verification passed: 287 registry
rows, 94 projection entries, 95 core tests, 36 harness tests, and all failable G1-G6 arms. This
closes I0-I7 for the implemented prefix without claiming that the still-unidentified causal
amplitudes have been calibrated.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf6_release_integration.mts`.

# Finding 49 — stabilization reconciles integration and exposes remaining model differences

The 4 September 2026 workspace review found a calibration that failed its saved-value replay,
incompatible TypeScript/Python filtering, different browser/export defaults, stale spectrum
updates, endpoint-seek and display-polarity errors, random quality labels, a short-record hang,
artificial joins in the real-data analysis, and an unexposed continuous overview. Generator
0.11.0 repairs these contracts and adds regressions; details and retained evidence are in
[Stabilization 0.11.0](Stabilization-0.11.0.md).

The calibrated scalar is 3.4836158752441406 dB; its stored fixture replays occupancy
0.20338541666666668. The nine-check verification passes. G5 still records only 0.44 qualifying
N3 epochs over held-out seeds, and G3 all-event median F1 is 0.569. The random event tag is no
longer interpreted as morphology quality. No acceptance threshold was relaxed.

Five previously uncached HMC nights were reserved before analysis, publisher-checksummed, and
kept outside the legacy fitting directory. Continuous preprocessing and within-epoch analysis
replace filtering across artificial stage joins. Against six generated seeds, held-out N3 delta
fraction is 0.866 versus generated 0.870; N1 is 0.693 versus 0.135 and REM is 0.591 versus 0.097.
The corrected development corpus also shows the N1/REM disagreement. These are descriptive
comparisons with a clinical cohort and four derivations, not physiological acceptance bounds.

At the released exponent-modulation depth of 0.15, a new paired full-mixture probe finds N2 median
estimated coupling depth 0.17259 with the mechanism on and 0.17779 with it off. Other respiratory
mechanisms remain active. A nonzero phase-locked readout therefore cannot be attributed solely to
exponent modulation. This record-only result complements the intentionally enlarged G4 fixture.

Reproduce with `npm run verify`, `python -m prep.reference.t1m1_state_realism --cohort development`,
`python -m prep.reference.t1m1_state_realism --cohort holdout`, and
`node --experimental-strip-types --no-warnings prep/reference/released_coupling.mts`.
