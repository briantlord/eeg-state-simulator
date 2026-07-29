# EEG State Simulator — Build Plan

*Supersedes `EEG-State-Simulator_Build-Plan.md`. Companions: `Validation-Harness_Spec.md`, `PARAMETERS.md`. Read all three.*

*Revised July 28, 2026.*

---

## 0. Brief for the executor (read first)

**What this is.** A generator of realistic multichannel EEG for arousal states, shipped in three tiers: a static web artifact, then the validation and parameter provenance that let claims be made in public, then a pip-installable instrument.

**The prime directive.** This is a **model**, not a measurement. No pixel is data recorded from a brain. The second observable axis is **signal complexity**, never "awareness" or "content."

**The structural idea — two spaces, not one.** Unchanged and load-bearing.
- **Parameter space (input, what the user drags):** aperiodic exponent and knee, oscillatory amplitudes, event rates, coupling depths.
- **Observable space (output, computed live from the generated signal):** spectral exponent on one axis, Lempel–Ziv complexity on the other, with canonical states as landmarks.

**Do not build a preset interpolator.** Interpolating between two state presets produces a signal that feels continuous and corresponds to nothing.

### The organizing rule

**Every Tier 0 decision must be a *prefix* of Tier 2, never a placeholder.** A prefix is a crude implementation behind a stable interface. A placeholder is something that gets deleted.

Each `[T0]` section below carries an **↑ upgrade** line stating what it becomes and why the transition is not a rewrite. If that line cannot be written, the Tier 0 design is wrong.

### The Tier 0 shipping test

**If everything except the scrolling trace and the filter demonstration were deleted on the last day, the artifact would still make its point.** Build in that order. The filter demonstration — injected coupling, a user-movable cutoff, and the ground-truth line visibly diverging from the recovered estimate — is the thesis. Protect it above everything else.

### Effort

| Tier | Scope | FTE days |
|---|---|---|
| **Tier 0 — Ship** | Static web artifact, six gates, design tokens and copy | **23** |
| **Tier 1 — Credible** | Corpus fitting, estimator characterization, full gate set | **26** |
| **Tier 2 — Instrument** | Python package, full-night generation, JOSS | **25–40** |

Full-time-equivalent working days, **not aggregated** — Tier 1 begins after Tier 0 ships and is separately budgeted. The previous plan's "3–4 weeks part-time" understated the generator alone and omitted the harness, corpus fitting, packaging, docs, and CI entirely.

---

## 1. Tiering and scope

### Tier 0 — Ship `[T0]`

**In:** five states as parameter sets; 19-channel 10-20 montage plus respiration belt; aperiodic-with-knee background and filtered-noise oscillations; Gaussian topography loaded from a data file; spindles, K-complexes, slow oscillations with anteroposterior travel; SO–spindle phase coupling *injected*; respiration generator with state-dependent rate and regularity; respiration–χ coupling including the wake/sleep phase reversal; the filter panel with live coupling readout against ground truth; χ and LZc readout with band selector; the pink-noise demo preset; blink, EMG and line-noise artifacts; epoch-directory export (CSV plus JSON sidecar per seam 9); `PARAMETERS.md`; the gate runner with six gates; one line of copy naming robust detrending as a Tier 1 alternative.

**Explicitly out of Tier 0:** ECG and all cardiac coupling; full-night hypnogram; sawtooth and vertex waves; lateral eye movement and electrode pop; EDF export (stretch only); SEREEGA `data`-class export; the Python package; corpus-fitted parameters; JOSS; every gate beyond the four in §9.

### Tier 1 — Credible `[T1]`

Corpus acquisition and staging-conditional parameter fitting; estimator bias characterization; the full gate set with TOST-form equivalence tests; the real-versus-generated discriminator; cardiac mechanisms and HEP; robust detrending; phase-shuffled LZ normalization; EDF and SEREEGA export.

### Tier 2 — Instrument `[T2]`

Pip-installable Python package as the normative implementation; full-night hypnogram with dwell times and transitions; benchmark obligations; BSD-3-Clause, `CITATION.cff`, Zenodo DOI, CI, JOSS submission.

### Two deliverables, no parity claim `[T0/T2]`

The **Python package (Tier 2) is normative** — it is where the audience lives (MNE, YASA, `specparam`, NeuroKit2) and what the harness measures. The **web artifact (Tier 0) is illustrative** — fewer channels, shorter windows, no validation claims. Its only cross-implementation obligation is *qualitative* similarity, checked by eye.

**No document in this project claims cross-implementation parity anywhere.** Identical event lists across languages is not a weaker requirement than bit-identity — it demands identical draw ordering and identical float behaviour at every threshold comparison. It is struck from every gate.

---

## 2. The seams `[T0]` — get these right now or the upgrade path is fiction

These cost little at Tier 0 and cannot be retrofitted. They are the entire content of "room for improvement."

**1. The event list is the primary output; the waveform is derived.** Every event carries onset, duration, amplitude, type, **and a graded prominence/quality field**. The graded field is what makes the Tier 1 detector-agreement curve possible; adding it later means regenerating every stored result.
↑ *Upgrade: Tier 1 consumes the same list; only the analysis changes.*

**2. `state(t)` is an interface.** Tier 0 implements it as "whatever the control says." No generator may read a global `currentState`.
↑ *Upgrade: Tier 2 implements it as a hypnogram with dwell times and transitions. No generator knows which.*

**3. Signal class and projection are separate objects.** Projection is a per-generator weight vector read from a data file in a fixed schema — never hardcoded channel weights.
↑ *Upgrade: swapping in eigenmode columns (LΨᵀ) or a SEREEGA lead field is a file, not a refactor.*

**4. The RNG is named, seeded, and version-pinned,** with documented substream derivation such that adding a generator does not perturb existing draws. That is the property required; **the algorithm need not be shared across languages, because parity is struck.**
- **TypeScript:** `xoshiro128++` or PCG32 — 32-bit state, native in typed arrays. PCG64 in a float64 language means BigInt (roughly an order of magnitude slower per draw) or hand-rolled 32-bit limb arithmetic; neither is warranted.
- **Python:** `np.random.Generator(np.random.PCG64(seed))` with `SeedSequence.spawn()` for per-generator substreams, which supplies the non-perturbation property directly rather than as something to hand-build.
↑ *Upgrade: none needed — but every seed produced before this decision is worthless after it, so decide first.*

**5. SNR is an explicit mix parameter from the first commit.** The nominal calibration point is **defined, not reserved: `snr_nominal` is solved, once, on a named fixture seed, so that generated N3 satisfies the AASM criterion.** Absolute µV amplitudes are interpretable only at that point, which makes the project's single definitional threshold load-bearing rather than decorative.

**Calibration and gate are separate steps.** Tuning `snr_nominal` until G5 passes would make G5 pass by construction — the same circularity as setting `delta_amp` from the 75 µV figure, one level up. Calibration runs once on a fixture seed; G5 evaluates on held-out seeds and reports a pass fraction.
↑ *Upgrade: Tier 1 sweeps it. Retrofitting SNR invalidates every prior amplitude calibration, including the absolute AASM criterion.*

**6. Every constant lives in `PARAMETERS.md`** with fields: value, units, `standing` ∈ {definitional, literature, fitted, invented}, source, applicable state. Code reads the registry. **Tier 0 ships with `invented` constants — that is fine, provided the UI marks them.** A slider labelled "not empirically constrained" is more interesting than a hidden literal.
↑ *Upgrade: Tier 1 corpus fitting changes values and never touches code.*

**7. An exponent is a (value, band, aperiodic mode) tuple everywhere** — in code, exports, UI, and every gate. Never a bare number. The two bands the artifact exposes require different aperiodic modes and recover different quantities; make it a type error to compare them.
↑ *Upgrade: none — this is correct at every tier.*

**8. The gate runner exists at Tier 0** with V/C/U classification, the dependency graph, and JSON output, even holding six gates.
↑ *Upgrade: retrofitting classification discipline onto twenty gates is worse than building it around six.*

**9. Export writes a directory of fixed-schema epochs,** not a single file.
↑ *Upgrade: Tier 1's discriminator and any external tool consume it without a converter.*

---

## 3. Signal model

### 3.1 Architecture `[T0]`

Generate a small number of **shared source generators**, then project to channels with weight vectors from the projection file:

  **x_c(t) = Σ_g w_{g,c} · s_g(t) + Σ_a w_{a,c} · art_a(t) + η_c(t)**

**Do not generate independent signals per channel** — it is instantly wrong to anyone who has looked at EEG and it breaks every downstream measure. η_c is small independent sensor noise.

### 3.2 Aperiodic background, with knee `[T0]`

Use the knee form, **L(f) = b − log₁₀(k + f^χ)**, with **k a state-dependent generated parameter.** A pure power law is wrong here and the error is not small.

The sleep literature documents knees near 20 Hz **and** near 45 Hz. The generative form has a single `k`: **at Tier 0, `k` encodes the ~20 Hz knee, and the ~45 Hz knee is registered as documented but unmodelled at every tier** (`knee_freq_high_unmodelled`). The modelled knee is prominent in REM, attenuated in wake/N1/N2, and effectively absent in N3 — and inclusion or exclusion of the low-frequency knee has been offered as the explanation for previously contradictory findings on aperiodic activity in sleep. A knee that appears and vanishes across states is visible, real, and in no comparable simulator.

**Consequence for G1b, stated so it is not mistaken for an error.** G1b's justification is that a knee cannot be identified from a band lying entirely above it. That holds for the 20 Hz knee but not the 45 Hz one — so the 30–45 Hz band *straddles* the upper knee, and a fixed-mode fit across a knee is biased, which is the error this section opens by warning about. **Keep the bias; do not eliminate it.** The published narrowband exponents this project compares against were themselves fitted fixed-mode over 30–45 Hz with that knee present. Reproducing the bias is what makes our values comparable to theirs; removing it would produce a more correct number corresponding to nothing in the literature.

**An exponent is never a bare number.** Reported fit bands across the literature include 30–50, 3–55, 0.5–35, 1–40, 1–20, 20–40, 1–45, 0.5–40, 3–45, 30–45 and 2–48 Hz; a PRISMA review of 16 sleep studies found heterogeneous ranges throughout. Carry (value, band, mode) everywhere.

**Direction, not magnitude, at Tier 0:**

| State | Direction at 30–45 Hz |
|---|---|
| Wake | flattest |
| N1 | intermediate |
| N2 / N3 | steeper than wake; N1–N3 correlate r ≈ 0.7 and are poorly separated by slope alone |
| REM | **steepest** |

REM being steepest is counterintuitive — REM is "wake-like" in its *oscillatory* content, not its 30–45 Hz slope. Lendner et al. found this band separates wakefulness from all three reduced-arousal states including REM; a replication across NSRR cohorts (final analytic sample N = 10,255) found progressive steepening from wake → NREM → REM. Surface this in the artifact.

Absolute values are `invented` at Tier 0 and marked as such in the UI.
↑ *Upgrade: Tier 1 replaces them with fitted distributions per §3.7; no code changes, registry values only.*

Generation: FFT synthesis in overlapping blocks with cosine crossfade.

### 3.3 Oscillations `[T0]`

**Narrowband-filtered noise, never pure sinusoids.** A pure sine reads as synthetic within one second. White noise → 4th-order Butterworth bandpass → amplitude envelope.

Bands, peaks, amplitudes and topography centres: see `PARAMETERS.md`.

### 3.4 Topography `[T0]`

Per-generator weight vector, loaded from a data file. Tier 0 generates it from a Gaussian on projected 10-20 coordinates: **w = exp(−d²/2σ²)**.
↑ *Upgrade: the file schema is the seam. Replace its contents with LΨᵀ columns or a SEREEGA lead field; the generator never changes.*

### 3.5 Traveling slow waves `[T0]`

Delay each channel by (AP position)/v. One line, empirically correct, and the most visually distinctive thing in the build — the slow wave visibly sweeps frontal to posterior.

### 3.6 The variability contract `[T0]`

Adopt SEREEGA's, do not invent one. Every parameter takes `<param>Dv` (per-event deviation, six-sigma range, hard-capped), `<param>Shift`, `<param>Slope` (systematic drift across the run), and events take `probability`/`probabilitySlope`.

Separate **signal class** from **projection** as independent objects, and require `validateClass()` to fill defaults and reject malformed definitions before generation.
↑ *Upgrade: `Slope` is the mechanism for Tier 2's within-night non-stationarity. Building it now costs nothing extra.*

### 3.7 Parameter provenance `[T1]` — its own phase, not a footnote

**Literature for structure, data for numbers.**

Literature transfers for definitional and structural things: AASM criteria, band edges, event durations and morphology, normative architecture, the *direction* of effects.

Fit from data anything pipeline-dependent: exponents, knees, amplitudes, coupling depths and phases, SNR, and the `Dv` of all of them. A published exponent is a joint function of PSD method, fit band, knee model, reference, artifact rejection and electrode. **It does not transfer.**

Fit **distributions**, not point estimates — the spread populates `Dv` directly.

| Corpus | Access | Note |
|---|---|---|
| Sleep-EDF (PhysioNet) | open | 2 EEG channels — fine for spectra, useless for topography |
| CAP Sleep Database | open | full montage, includes ECG and respiration |
| DREAMS | open | small, spindle annotations |
| MODA | open | 180 subjects, ~47 scorers, **per-event agreement counts** — the Tier 1 F1 reference |
| MASS | application | full PSG, MODA's source |
| NSRR (MrOS, CHAT, CFS, SHHS) | DUA | very large; **avoid SHHS for high-frequency work** — documented technical issues with its high-frequency EEG were why it alone failed to replicate the slope effect |

PSG corpora already carry EEG, ECG and respiration simultaneously, which is exactly what §5 needs.

**This phase is comparable in size to the generator and is upstream of nearly every constant.** It is milestone T1-M1, not a task.

---

## 4. Graphoelements `[T0]`

This is what separates a credible simulator from plausible-looking noise. N2 without spindles and K-complexes is not N2, and no amount of spectral fidelity substitutes.

Each is an injected event with a morphology template, rate, jitter, topography, and **graded prominence** (seam 1). Parameters in `PARAMETERS.md`.

Tier 0: spindles, K-complexes, slow oscillations. **Deferred to Tier 1:** sawtooth waves, vertex sharp waves, rapid eye movements.

Use standard clinical polarity (negative up) and label it. Getting this backwards is the fastest way to lose a clinical reader.

### 4.1 SO–spindle phase coupling `[T0]` injected, `[T1]` gated

Modulate the spindle amplitude envelope by the instantaneous phase of the slow oscillation, with explicit **preferred phase** and **coupling strength** parameters. In N3, restrict spindle occurrence to detected SO events — sparse co-occurrence is a documented source of spurious coupling estimates.

**Tier 0 injects it and displays it. Tier 0 does not gate on recovery** — see §9 and harness §4 for why that gate must wait on estimator characterization.

Why it matters: a 2025 Bayesian meta-analysis of SO–spindle coupling and memory consolidation found the greatest between-study heterogeneity in *outcome measurement*, reported that only 2 of 23 studies published processed data and code, and called explicitly for standardized methods. PAC estimation has hard requirements — amplitude filter bandwidth at least twice the modulatory frequency, phase filters moderately narrow-band especially for non-sinusoidal rhythms, and the slow oscillation is emphatically non-sinusoidal.
↑ *Upgrade: Tier 1 adds the recovery gate once PAC precision is characterized. The injection API does not change.*

---

## 5. Physiological coupling

### 5.1 Three respiratory mechanisms — keep them separate `[T0]`

Different origins, different topographies, different implications. Conflating them is the standard error in this literature. Each gets its own toggle.

**(a) Respiratory movement artifact.** Mechanical, at the respiratory rate. Genuine artifact; high-passing it out is correct.

**(b) Respiration-entrained neural activity (RMBO).** Real cortical activity phase-locked to the breath via nasal airflow → olfactory epithelium mechanoreceptors → piriform → limbic → cortex. **Nasal-dependent** — expose a nasal/oral toggle. Sources are largely limbic and poorly seen by scalp EEG; say so rather than overstating.

**(c) Respiration-phase modulation of amplitude and of the aperiodic exponent.** The best-supported scalp-visible effect and the one the filter demo depends on.

### 5.2 Generating respiration `[T0]`

**Not a sinusoid** — inspiration shorter and steeper than expiration. Transcribe NeuroKit2's `rsp_simulate` `breathmetrics` model, which interpolates inhalation and exhalation pauses; do not reinvent it. State-dependent rate and regularity; REM's marked irregularity is diagnostic and nearly free.

**Time-varying χ.** Generate at constant χ and apply a **time-varying spectral tilt filter**. Two constraints the previous draft got wrong:

- **A first-order shelving filter cannot produce uniform slope change across 1–45 Hz.** Use **cascaded log-spaced pole-zero pairs** across the band.
- **Modulating filter coefficients at the respiratory rate produces sidebands at f ± f_resp** — a subtler version of the block-boundary trap. Modulate slowly relative to the filter's settling time, and verify against the off-frequency null in §9.

  **χ(t) = χ_state + A_χ · cos(φ_resp(t) − φ₀(state))**

**φ₀ is state-dependent and reverses sign between wake and sleep.** A full-night study (N = 23) found wake characterised by decreased 1/f slope during late inspiration and increased during late expiration, with this pattern **reversing for all stages from N2 onward** and N1 resembling wake. A single global offset is wrong, and getting it right gives the artifact a striking behaviour: drag from wake to N2 and the coupling flips polarity.

### 5.3 Cardiac mechanisms `[T1]`

Deferred entirely from Tier 0. Three mechanisms, kept separate: **(a) cardiac field artifact** (R-peak-locked, zero latency, much larger with mastoid reference); **(b) pulse/ballistocardiogram** (200–400 ms post R-peak); **(c) heartbeat-evoked potential** (200–600 ms, 1–5 µV, fronto-central, right-lateralized). Plus **(d) respiratory sinus arrhythmia**, strongest in N3, attenuated in REM.

Transcribe NeuroKit2's `ecg_simulate` (ECGSYN, McSharry et al. 2003), where **RSA is intrinsic to the model** rather than bolted on, and use `ecg_rsa` for the analysis-side readout.

The payoff: a 2026 systematic review of heartbeat-evoked response methods found unreported methodological information reaching 80% for some steps, and stated that pulse-related movement artifact's influence on measured HERs **remains unclear**. That is an open question with independently settable parameters on both sides.

### 5.4 The filter demonstration `[T0]` — the signature feature

**Standard EEG practice high-passes at 0.5–1 Hz, directly on top of the respiratory rate.** A simulator with injected, known coupling and a user-adjustable filter demonstrates that loss with ground truth, which no real dataset can — with real data you never knew the pre-filter coupling.

Controls: high-pass cutoff (0.01/0.1/0.5/1.0 Hz); filter type (zero-phase vs causal IIR); live coupling readout against the known injected value.

**Robust detrending moves to Tier 1** `[T1]`. It is the reputational hedge, not the demonstration, and the iterative weighted polynomial fit is a day not worth spending before shipping. Tier 0 carries **one line of copy** noting that alternatives to high-pass filtering exist and naming robust detrending; Tier 1 makes it selectable.

- **Demo 1 — coupling loss.** Recovered coupling vs cutoff, with injected ground truth as a horizontal line.
- **Demo 2 — phase distortion.** Causal IIR distorts phase near cutoff; coupling estimates corrupt even where amplitude survives.
- **Demo 3 — ringing on graphoelements.** Apply a 1 Hz high-pass to an isolated K-complex and watch spurious oscillatory ringing appear, at frequencies resembling a spindle. Most visceral of the three because it is visible in the trace, and with ground truth you can label which deflections the filter invented.

**Name the alternative even before implementing it.** The honest lesson is that high-pass filtering trades a known artifact for a known distortion — not that filtering is a mistake. One line of Tier 0 copy carries that; Tier 1 makes it demonstrable.

---

## 6. Artifacts `[T0]` partial

Tier 0: **blink**, **EMG** (high in wake, near-zero in REM — atonia falls out free), **line noise** with a notch toggle.
Tier 1: lateral eye movement, ECG, electrode pop.

Counterintuitively these make the artifact more useful — it becomes an artifact-recognition trainer.

---

## 7. The observable readout `[T0]`

Compute on a rolling 30 s window, updated ~1 Hz.

**1. Spectral exponent.** Welch PSD then specparam-style fit. **The fit band is a first-class user control** — broadband (1–45 Hz, knee mode) and narrowband (30–45 Hz, fixed mode) at minimum, with landmarks recomputed live.

**Why band is a control:** broadband and narrowband fits give different orderings across sleep stages, and much of the apparent disagreement in this literature is a band-choice artifact. **The two are different quantities, not two estimates of one quantity** — a knee cannot be identified from a band lying entirely above it, so the 30–45 Hz fit must be fixed-mode. The type system should make comparing them an error (seam 7).

**2. Lempel–Ziv complexity.** Bandpass, Hilbert, **binarize around the median**, concatenate channels column-wise, parse, normalize against a surrogate.

**Two decisions the previous draft got wrong, both stated here as open with a required resolution:**

- **LZ76 versus LZW is a scientific question, not a performance one — and it does not block Tier 0.** LZ76 is O(n) with a suffix automaton; the ~10⁵ ms figure measured earlier is a property of the exhaustive-parse implementation, not of the measure. Decide by which parse the landmark literature used, and if LZ76, implement it with a suffix automaton. **Tier 0 ships with the decision open:** its landmarks are computed from the generator's own output and are self-consistent under any parse. The parse constrains only comparison to *published* magnitudes, so it must be settled before any published value is cited, and the state-ordering gate is restricted to *direction* only if our parse differs from the reference literature.
- **The surrogate choice is settled: Tier 0 uses time-shuffled.** The two options are not symmetric. Time-shuffling destroys the spectrum, so the surrogate's complexity depends only on length and symbol density — **its χ-dependence is zero by construction**, caching is legal, and it needs no estimator characterization, so it creates no Tier 0 dependency on a Tier 1 milestone. Phase-shuffling preserves the spectrum, so the surrogate's complexity tracks χ; caching it would inflate normalized LZc as a systematic function of χ, manufacturing correlated structure along the second axis. **Tier 0 normalizes against "same density, no structure"** and says so in the UI. Phase-shuffled normalization is a Tier 1 addition, gated on its χ-dependence being characterized at T1-M2.

**Do not assume monotonic orderings.** LZc rises from N1 to N2 and is less stage-modulated than slope. Narrowband slope steepens across all sleep stages with a small reversal in N3. **Treat a clean ladder from wake down to N3 as a bug.**

**Collinearity is a documented open question**, not merely a design worry — investigators have asked in print whether LZc adds anything over the aperiodic exponent. Display the correlation between axes across landmarks.

**Required demo preset — "the most complex signal is noise."** Boxcar, pure 10 Hz sine, sine plus pink noise, pure pink noise. LZc rises monotonically across that sequence with **pure noise highest**. This does more against the consciousness-meter misreading than any disclaimer.

**Third observable `[T0]`:** cross-system coupling strength (respiration–EEG modulation index). Should be less collinear with χ than LZc is; promote it to primary second axis if the collinearity proves severe.

---

## 8. Stack and computational budget `[T0]`

| Layer | Choice |
|---|---|
| Core generator | TypeScript, typed arrays, no framework dependency |
| Rendering | Canvas 2D — **not** SVG |
| Build | Vite, static, no backend |
| Export | Directory of fixed-schema epochs: CSV + JSON sidecar. EDF is a Tier 0 stretch |
| Offline validation | Python: numpy, scipy, `specparam`, `YASA`, `neurodsp` |

**Measured budget** (256 Hz, 19 ch, 10 generators, 30 s window, 16 s block; vectorized numeric code in a scalar-interpreter host):

| Stage | Cost | Cadence |
|---|---|---|
| Aperiodic FFT synthesis | 1.1 ms | per 16 s block |
| Narrowband oscillations | 1.0 ms | per 16 s block |
| Channel projection | 0.06 ms | per 16 s block |
| **Synthesis total** | **2.2 ms per 16 s** | **~7,000× real time** |
| Render min/max decimation | 2.7 ms | per frame |
| Welch PSD | 5.0 ms | per 1 s |
| Hilbert envelope | 1.7 ms | per 1 s |
| LZ parse (linear implementation, n ≈ 146k) | 29 ms | per 1 s |

**Real-time generation is not in question.** Do not architect around synthesis cost; the streaming buffer exists for continuity, not throughput. **All performance risk is in the analysis path**, and one algorithm dominates it. Put analysis in a Web Worker — not for throughput but for jitter, since a 29 ms parse on the main thread visibly drops a frame once per second.

**Display:** 30 s epochs by default (the AASM scoring epoch), fixed µV/mm scale with a calibration bar. **Never autoscale.** The amplitude difference between N3 delta and waking alpha is one of the most important facts on screen.

**Design direction:** the anchor is the paper polygraph chart — pen traces, calibration pulses, montage labels down the left margin, sensitivity and time-constant annotations. The prohibition: no sci-fi neuro-interface styling, no glow, no dark-mode-with-cyan. Plan a token system before writing components.

---

## 9. Milestones

### Tier 0 — 23 FTE days (range 22–25)

- **T0-M1 — Seams and core (5 d).** All nine seams in §2: named RNG with substreams, `PARAMETERS.md` registry read at load, graded event list, `state(t)` interface, SNR mix parameter with nominal calibration point, projection file schema, exponent tuple type, gate runner skeleton, epoch-directory export schema. Aperiodic-with-knee synthesis and filtered-noise oscillations.
- **T0-M2 — Montage, topography, trace (2 d).** 19 channels plus respiration belt, shared generators, projection from file, scrolling canvas with min/max decimation and calibration bar.
- **T0-M3 — Graphoelements (3 d).** Spindles, K-complexes, slow oscillations with AP travel, SO–spindle coupling injected, graded prominence populated.
- **T0-M4 — Respiration and the filter panel (3 d).** Respiration generator, cascaded-pole tilt filter, state-dependent φ₀ with wake/sleep reversal, all three filter demos, live coupling readout.
- **T0-M5 — Observables, SNR calibration, and gates (5 d).** SNR calibration on the fixture seed; χ with band selector and both aperiodic modes, LZ with time-shuffled surrogate normalization, coupling index, pink-noise preset, the six gates below with matched nulls and V/C/U printing.
- **T0-M6 — Artifacts, export, polish (1.5 d).** Blink, EMG, line noise; epoch-directory export; mobile and reduced-motion passes.
- **T0-M7 — Design tokens and explanatory copy (3.5 d).** The token system §8 requires before components are written, plus the prose that makes the filter demonstration legible. **The artifact's value is pedagogical, and pedagogy is prose.** This was unbudgeted in the previous revision and is not optional.

**Tier 0's six gates** — full specification in `Validation-Harness_Spec.md`:

1. **χ round-trip, as two separate gates with separate tolerances:** knee mode over 1–45 Hz, and fixed mode over 30–45 Hz. Class **V** (`specparam`).
2. **Determinism, within-platform and within-version only.** Class **C**, and that is fine. **No cross-implementation clause.**
3. **Spindle detection by YASA against the graded ground-truth list, reported as F1 versus inclusion threshold.** No pass band at Tier 0 — record the curve; Tier 1 sets the criterion. Class **V**.
4. **Respiration–χ off-frequency null:** modulate χ at f₁ while respiration runs at f₂ ≠ f₁; coupling must exceed the surrogate null at f₁ and not at f₂. The pass criterion is a **percentile of a circular-shift surrogate distribution** — derived from estimator properties, not invented. Class **C**, and **the most important thing in Tier 0**: the only check that the filter demonstration measures coupling rather than leakage.
5. **AASM N3 criterion.** Generated N3 satisfies ≥20% of a 30 s epoch at ≥75 µV p-p, 0.5–2 Hz, referenced to contralateral mastoid, **evaluated on seeds held out of the SNR calibration and reported as a pass fraction.** Class **C** — the rule is external. Post-calibration this is largely a *regression* check on the amplitude relationship, and its null (N2 must fail; N3 at −6 dB must fail) carries the discriminative weight. Say so in the report rather than letting the class letter oversell it.
6. **Topography, structurally.** Each generator's channel `argmax` must match an expectation held in its own `topo_expect_*` registry rows — spindles central, K-complexes frontal, alpha posterior — sourced to clinical convention and **independent of the projection file.** Reading the expectation from the file being tested would make this a check that `argmax` works. **`argmax` over electrode positions needs no tolerance**, so the gate requires no invented threshold. `gate_alpha_ratio` remains a *recorded quantity*, not a pass criterion, until T1-M2. Class **C**.

Gates 1–3 are **record-only** at Tier 0 — they capture distributions and curves rather than pass/fail. Gates 4–6 can fail.

### Tier 1 — 26 FTE days

- **T1-M1 — Corpus acquisition and fitting (8 d).** DUAs, staging-conditional pipeline, distribution extraction. Upstream of nearly every constant.
- **T1-M2 — Estimator characterization (5 d).** SPRiNT transfer function across modulation frequencies; PAC precision versus event count; LZ surrogate behaviour versus χ. **No recovery gate gets a tolerance until this is done.**
- **T1-M3 — Full gate set (4 d).** TOST-form equivalence tests for recovery gates, CI-excludes-threshold for band gates, matched nulls throughout.
- **T1-M4 — Discriminator check (3 d).** Classifier separating generated from held-out real epochs; report AUC **and feature importances**. Use an **interpretable feature set** — spectral and temporal summary features — **not a model over raw traces**: the feature importances are the stated deliverable, and a deep model returns an AUC and nothing actionable.
- **T1-M5 — Cardiac and HEP (4 d).**
- **T1-M6 — EDF and SEREEGA export (2 d).**

### Tier 2 — 25–40 FTE days

Python package (normative), full-night hypnogram with dwell times and transitions, sleep-stager benchmark, BSD-3-Clause, `CITATION.cff`, Zenodo DOI, CI, contributor docs with a data-driven signal-class interface, JOSS submission.

---

## 10. Risk register

- **Constants ship `invented` and the UI fails to mark them.** The registry exists precisely so this cannot happen silently. *Mitigation:* seam 6, and a Tier 0 acceptance check that no constant appears in code or copy absent from `PARAMETERS.md`. **High.**
- **Phase-shuffled normalization is adopted before its χ-dependence is characterized.** It would systematically bias the second axis in the direction of the risk already rated High. *Mitigation:* Tier 0 is time-shuffled by decision (`DECISIONS.md` D1); phase-shuffled is Tier 1 only, gated on T1-M2. **Medium** — downgraded from High now that the decision is made.
- **Sideband contamination from the tilt filter.** A self-fulfilling coupling result that looks like success. *Mitigation:* cascaded poles, slow modulation relative to settling time, and the off-frequency null as a Tier 0 gate. **High.**
- **Graphoelements look synthetic.** Fails visually before it fails numerically. *Mitigation:* the variability contract, and eyes on generated N2 beside a published figure. **High.**
- **Tier 1's corpus phase slips and Tier 0 constants ossify.** *Mitigation:* the registry makes replacement mechanical; the UI marking makes the interim state honest. **Medium-high.**
- **Observable axes are collinear.** A documented open question, not a suspicion. *Mitigation:* §7, with the coupling index as the fallback primary. **High.**
- **State orderings assumed rather than checked.** *Mitigation:* treat a monotonic ladder as a bug. **High.**
- **Misuse as a consciousness meter.** *Mitigation:* prime directive, axis labelling, and the pink-noise demo, which works better than any label. Not retrofittable. **Medium.**
- **Rebuilding solved generators.** ECG, respiration and EMG all exist in NeuroKit2 with published models. *Mitigation:* transcribe, cite, validate against the originals. **Medium-high.**
- **Rebuilding SEREEGA's half.** *Mitigation:* §1 out-of-scope and the `data`-class export path. **Medium.**
- **Streaming discontinuities.** *Mitigation:* overlap-add with cosine crossfade; check the PSD across a boundary. **Low.**

---

## 11. Pointers

**Scoring and morphology:** AASM Manual for the Scoring of Sleep and Associated Events.
**Aperiodic:** Donoghue et al. (2020), *Nat Neurosci*; Lendner et al. (2020), *eLife*; Kozhemiako et al., NSRR replication; the J Neurosci (2024) intrinsic-timescales paper for knee locations; the *Communications Psychology* (2025) PRISMA review of aperiodic sleep studies.
**Complexity:** the eNeuro (2024) slope-versus-LZc comparison — **read before setting any landmark**; Schartner et al. (2017); Casali et al. (2013) for PCI as concept only.
**Coupling:** the eLife (2025) Bayesian meta-analysis of SO–spindle coupling; Dvorak & Fenton (2014) on PAC estimation requirements; Helfrich et al. (2018), Staresina et al. (2015); Aru et al. (2015) and Scheffer-Teixeira & Tort (2016) on amplitude/SNR confounds.
**Respiration:** Kluger, Gross et al. (2023), *Nat Commun*; the 2025 respiratory-coordination-of-excitability study for the state-dependent phase reversal; Kluger & Gross (2021); Zelano et al. (2016); Herrero et al. (2018).
**Cardiac:** Steinfath et al. (2026), *Psychophysiology*, systematic review of HER methods; Park & Tallon-Baudry (2014).
**Filtering:** Tanner, Morgan-Short & Luck (2015) and Maess, Schröger & Widmann (2016); Widmann et al. (2015); de Cheveigné & Arzounian on robust detrending.
**Detection benchmarks:** Warby et al. (2014); MODA; SUMO; A7.
**Prior art:** Krol et al. (2018) SEREEGA; NeuroKit2 (Makowski et al. 2021); `mne.simulation`; The Virtual Brain and `neurolib`; `neurodsp`; SEED-G; HArtMuT.
