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

## Consequence — two claims in `DECISIONS.md` D3 do not survive contact

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
