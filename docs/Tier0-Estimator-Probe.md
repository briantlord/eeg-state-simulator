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
