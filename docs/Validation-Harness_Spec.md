# Validation Harness Specification — `/prep`

*Companion to `Build-Plan.md` and `PARAMETERS.md`. Revised July 28, 2026 — supersedes the previous version; §5 of that document (the dual-implementation question) is **deleted**, and determinism tier 3 with it.*

---

## 0. Why this document exists

The build plan states gates; this document states what makes a gate trustworthy. Every substantive problem found in reviewing that plan was in the validation layer, not the signal model. The generators were sound from the first draft; the gates were wrong repeatedly.

**If the harness is wrong, a passing gate is worse than no gate** — it converts an unexamined assumption into an apparent measurement.

**The runner exists at Tier 0** holding six gates. Retrofitting classification discipline onto twenty gates is worse than building it around six.

---

## 1. The circularity rule

A round-trip through code you wrote proves internal consistency and nothing else. Classify every gate:

| Class | Meaning | Permitted claim |
|---|---|---|
| **V** | Recovery by an external, independently authored, published tool | "The generator produces signals that *X* measures correctly" |
| **C** | Recovery by code in this repository | "The implementation is self-consistent." Nothing more. |
| **U** | No recovery check exists | Must be stated as such in `PARAMETERS.md` |

**The runner prints the class beside every result.** A class-C gate is not a failure — Tier 0's most important gate is class C — but it must never be read as validation.

**A second circularity, previously proposed here and now prohibited:** thresholds must never be set from the observed spread of our own generator. That makes gates unfailable. Thresholds come from estimator properties, definitional sources, or published inter-rater ranges.

**This prohibition does not extend to sample size.** Setting `n_seeds` from observed variance is ordinary power analysis: it determines how precisely a quantity is measured, not what counts as passing. The rule constrains the *criterion*, never the *precision*.

---

## 2. Every recovery gate needs a matched null

A gate that recovers an injected value proves nothing unless the same estimator returns chance when nothing was injected — otherwise it may be recovering the value from its own priors, from the filter, or from the spectral shape.

**A null that simply zeroes the injection is often not a null.** Removing the modulation removes the thing the estimator could leak from. Prefer an **off-frequency null**: inject at f₁, run the confound at f₂ ≠ f₁, and confirm recovery appears at f₁ only.

---

## 3. Gates are distributions, not point estimates

The generator is stochastic. Run each gate over N seeded realizations, report median and IQR, store per-seed values (a gate passing on median while bimodal is a bug signal). Generation runs ~7,000× real time; the cost is entirely in the third-party detectors.

**Two gate forms, two statistics — do not conflate them:**

- **Recovery gates are equivalence tests.** The claim is "recovered ≈ injected," which is not tested by failing to reject a difference. Use **TOST**: the confidence interval of the bias must sit *inside* the tolerance.
- **Band gates** take the CI-excludes-threshold form.

---

## 4. Estimator characterization gates the tolerances `[T1-M2]`

**No recovery gate gets a tolerance until the estimator's bias and variance have been characterized against independently known truth.** This is a milestone (T1-M2, 5 FTE days), not an assumption. Three known cases:

- **SPRiNT** — sliding-window smoothing comparable to a ~4 s respiratory cycle will attenuate recovered modulation depth by an amount the estimator, not the generator, determines. Characterize the transfer function across modulation frequencies; then gate on corrected depth, or on phase.
- **Circular statistics for PAC** — precision is set by event count. Circular SE ≈ √((1−R̄²)/(nR̄²)); at 2–5 spindles/min a 5-minute segment yields ~15 events, giving a 95% CI near ±50° at R̄ = 0.5 and ±30° at R̄ = 0.7. **±15° is unreachable at that n.** Derive the required event count from the target precision and set segment length accordingly, or gate on resultant length rather than preferred phase.
- **LZ surrogates (phase-shuffled only)** — a phase-shuffled surrogate preserves the spectrum, so its complexity depends on χ. Characterize that dependence before any **phase-shuffled-normalized** LZc value is gated or plotted. **This clause does not scope to all normalization.** Tier 0 uses time-shuffled surrogates, whose complexity depends only on length and symbol density — χ-dependence is zero by construction, so they need no characterization and create no Tier 0 dependency on this milestone.

---

## 5. Tier 0 gates — full specification

Four gates. Each carries its matched null and prints its class.

### G1 — χ round-trip `[V]` — **two gates, not one**

An exponent is a (value, band, mode) tuple, so a single χ gate violates the plan's own rule. **A knee cannot be identified from a band lying entirely above it**, and the documented low-frequency knee sits near 20 Hz.

- **G1a:** generate at known (χ, k); fit **knee mode over 1–45 Hz** with `specparam`; recover both χ and k.
- **G1b:** same signal; fit **fixed mode over 30–45 Hz**; recover χ.

**G1a and G1b recover different quantities and take separate tolerances.** Both tolerances are `invented` at Tier 0 and derived at T1-M2. **Tier 0 is explicitly record-only** — it captures the recovery error distribution rather than passing or failing.

**G1b straddles the upper knee, and that is deliberate.** The literature documents a knee near 45 Hz as well as near 20 Hz, so the 30–45 Hz band is not above all knees, and a fixed-mode fit across a knee is biased. **Keep the bias.** The published narrowband exponents we compare against were themselves fitted fixed-mode over this band with that knee present; reproducing the bias is what makes our values comparable to theirs, and removing it would yield a more correct number corresponding to nothing in the literature. Record the bias; do not chase it.

**Expect G1a's error to exceed G1b's, and do not chase that either.** Fitting knee mode over 1–45 Hz with the knee near 20 Hz gives roughly a decade below the knee and a third of a decade above; χ and `k` trade off strongly over that span. Larger recovery error in G1a is a property of the band, not a bug.

*Null:* generate white noise (χ = 0); both fits must recover ≈ 0 and G1a must not report a spurious knee.

### G2 — Determinism `[C]`

Same seed and parameter set produces **bit-identical output within a platform and within a version.** That is the whole gate. There is no cross-platform tier and **no cross-implementation clause** — identical event lists across TypeScript and Python would require identical draw ordering and identical float behaviour at every threshold comparison, which is not weaker than bit-identity, and the build plan declines parity.

The RNG must be **named, seeded, and version-pinned**, with documented substream derivation per generator so adding a generator does not perturb existing draws. **The algorithm need not be shared across languages** — parity is struck, so there is nothing to make identical. TypeScript: `xoshiro128++` or PCG32 (32-bit state, native in typed arrays). Python: `np.random.Generator(np.random.PCG64(seed))` with `SeedSequence.spawn()`, which supplies the non-perturbation property directly.

*Null:* two different seeds must produce different output. Trivial, and it catches a seed that is not actually threaded through.

### G3 — Spindle detection `[V]` — a curve, not a threshold

Run YASA's spindle detector against the **graded** ground-truth event list (seam 1). Report **F1 as a function of inclusion threshold** on the prominence field — i.e. how agreement varies as marginal events are included or excluded.

**Tier 0 records the curve and sets no pass band.** The reasoning in the previous plan — "experts reach ~0.75, so above 0.9 means over-stereotyped" — was wrong: it conflated morphological realism with gold-standard *label noise*. Our ground truth has no label noise, so a realistic generator should score **above** the human ceiling, and forcing F1 down means injecting events too marginal to be spindles.

Tier 1 sets the criterion by checking the shape of the roll-off against MODA, where events carry per-event agreement counts from ~47 scorers — the correct comparison is curve shape against curve shape, not a single number against a human ceiling.

*Null:* detector on pure aperiodic background at matched χ; false-positive rate near zero.

### G4 — Respiration–χ off-frequency null `[C]` — the most important gate in Tier 0

**Modulate χ at f₁ while respiration runs at f₂ ≠ f₁. Recovered coupling must appear at f₁ and not at f₂.**

**The pass criterion is derived, not invented.** Compute the coupling index against **surrogate respiration phase produced by circular shift** (`g4_n_surrogates` = 200) and take the criterion as the **95th percentile of that null distribution** (`g4_percentile`). Coupling at f₁ must exceed it; coupling at f₂ must not. This is a threshold derived from estimator properties, which is what §1 requires — and besides the definitional AASM one, it is the only Tier 0 pass criterion that is not an invented number.

**Frequency separation is constrained, not free.** Run the gate on a **300 s record** (`g4_record_length`), not the live 30 s window, giving 1/T ≈ 0.0033 Hz. With f₁ = 0.10 Hz and f₂ = 0.25 Hz, f₁ and f₂ sit 45 bins apart and f₁ sits 15 bins from the nearest sideband at f₂−f₁ = 0.15 Hz. **Require ≥10 bins of separation between f₁, f₂, and both sidebands f₂±f₁** — below that the injected modulation and the sideband structure are not distinguishable and the gate cannot do its job.

This is the only check that the filter demonstration measures coupling rather than leakage, and it catches the failure mode the generator is most likely to produce: modulating filter coefficients at the respiratory rate creates **sidebands at f ± f_resp**, which a coupling estimator will happily report as coupling. A depth-zero null cannot catch this, because zeroing the depth also removes the sidebands.

It is class C — we wrote the coupling estimator — and it is still the gate to build first. Self-consistency is worth little in general; here it is the difference between a demonstration and an artifact.

*Additional check:* with modulation off entirely, recovered coupling at chance across all filter cutoffs — the flat baseline for Demo 1's loss curve.

### G5 — AASM N3 criterion `[C]`

Generated N3 satisfies the scoring rule: **≥20% of a 30 s epoch occupied by 0.5–2 Hz activity at ≥75 µV peak-to-peak, referenced to contralateral mastoid.**

Class C because we compute it, but the rule is entirely external — which is what makes it usable without derivation. It is the one threshold in the project needing none.

**Specify the derivation, because the reference toggle changes the answer by an amount that matters.** AASM's criterion is referenced to contralateral mastoid; evaluating it under average reference gives a different number and would silently miscalibrate everything downstream.

**Calibration and gate are separate steps, and conflating them would re-introduce the circularity this gate was added to close.**

If `snr_nominal` is tuned until N3 passes G5, then G5 passes by construction — the same shape as the `delta_amp` defect, reintroduced by its own fix. Split it:

1. **Calibration (once, not a gate).** On a **named fixture seed and epoch**, solve for the mix value at which generated N3 satisfies the criterion. Record it as `snr_nominal`, standing `derived`, in the registry. This is a one-time procedure, versioned like any other parameter.
2. **The gate (every run, held-out).** Evaluate the criterion on **seeds not used for calibration**, across many epochs, and report the **pass fraction** rather than a single boolean. Calibration fixes one scalar; it does not guarantee the criterion survives across seeds, epochs, or subsequent changes to amplitudes or the variability contract.

**Be explicit about what remains after calibration.** G5's post-calibration content is largely a **regression check** — it detects when a change elsewhere breaks the amplitude relationship — plus whatever the null contributes. It is not evidence that our N3 resembles real N3. Print it as such; a gate whose positive arm is calibrated is weaker than its class letter suggests, and the runner should say so.

**The null carries the discriminative weight here**, which is unusual and worth stating.

**`delta_amp` must not be set from the 75 µV figure.** Doing so would generate N3 to satisfy the check meant to test it — the circularity §1 prohibits, sitting inside the registry built to expose it. The AASM number appears in this gate and nowhere else.

*Null:* generated N2 must **fail** the N3 criterion, and generated N3 at `snr_nominal` − 6 dB must also fail. A criterion everything passes is not a criterion, and after calibration the null is the only arm that can genuinely fail.

### G6 — Topography, structurally `[C]`

Criteria are **structural rather than ratio-based**, so the gate needs no invented threshold: `argmax` over electrode positions requires no tolerance. That matters because Tier 0 ships hand-tuned σ values, and a ratio gate would need an invented threshold to test invented parameters.

**The expected electrodes must come from outside the projection file, or the gate is a tautology.** If "expected central electrode" is read from the same file that places the Gaussian, the gate tests that `argmax` works — nothing more. The expectations live in their own registry rows (`topo_expect_spindle_fast` = C3/C4, `topo_expect_kc` = Fz, `topo_expect_alpha` = O1/O2/Pz), standing **`literature`**, sourced to clinical convention as recorded in AASM. **G6 then tests projection file against literature**, which is a real comparison.

| Generator | Expected `argmax` | Registry row |
|---|---|---|
| Fast spindle | central (C3/C4/Cz) | `topo_expect_spindle_fast` |
| Slow spindle | frontal | `topo_expect_spindle_slow` |
| K-complex | frontal (Fz/F3/F4) | `topo_expect_kc` |
| Alpha | posterior (O1/O2/Pz) | `topo_expect_alpha` |

`gate_alpha_ratio` (>3 posterior/frontal) is **recorded as a quantity, not used as a pass criterion**, until T1-M2 derives it.

*Null:* a deliberately mis-centred projection file must fail. This confirms the gate reads the **data** from the projection file (seam 3) while comparing against the **independent** expectation, rather than comparing the file to itself.

---

## 6. Tier 1 and Tier 2 gates — listed with their dependencies stated

None of these acquires a tolerance before T1-M2. G5 (AASM N3) and G6 (topography) were promoted to Tier 0 in revision 2 and are specified above.

| Gate | Class | Blocked on |
|---|---|---|
| SO–spindle phase recovery | **V** (use `tensorpac`/`pactools`, not our own estimator) | PAC precision characterization; event-count budget |
| Respiration–χ depth recovery | V (`SPRiNT`) | SPRiNT transfer function |
| Coupling loss vs HPF cutoff | C | G4 passing first |
| Robust detrending comparison | C | the Tier 1 detrending implementation |
| Phase-shuffled LZ normalization | C | its χ-dependence characterized (§4) |
| Topography, ratio form | C | `gate_alpha_ratio` derived at T1-M2; the structural form already gates at Tier 0 |
| HEP false-positive demo | C | cardiac generators (T1-M5) |
| State orderings (χ, LZc) | mixed | LZ parse decision; **restricted to *direction* only if our parse differs from the reference literature**, since magnitudes are not comparable across parses |
| Artifact morphology | V (`mne` ICA) | recovering injected topographies from generated data |
| Variability contract | C | 1,000 events; empirical parameter distributions match specified `Dv` and caps; `Slope` produces the intended drift |
| Sleep architecture | V (RobustSleepNet / YASA stager) | Tier 2 hypnogram |
| EDF interoperability | V (`EDFbrowser`, `mne`) | EDF export |

### The discriminator check `[T1-M4]` — the only gate that is not a round trip

Every gate above is a round trip; none tests whether the output resembles EEG at all. Train a standard classifier to separate generated from held-out real epochs and report **AUC *and* feature importances**. **Use an interpretable feature set — spectral and temporal summary features — not a model over raw traces.** A deep model returns an AUC and nothing actionable, forfeiting the only thing this check is for.

**Do not gate on AUC.** The features driving the discrimination are the deliverable — they name exactly what is unrealistic, which no round-trip gate can. A high AUC with interpretable features is a more useful result than a low AUC with none.

---

## 7. Gate dependencies — fix upstream first

```
seed/RNG ──► event list ──► everything

amplitudes (delta_amp, osc amps)
        │
        └──► SNR CALIBRATION (one-time, fixture seed)  ──► snr_nominal
                        │
                        ├──► G5 AASM N3        [held-out seeds]
                        ├──► G3 detector F1    [T0 record-only]
                        └──► PAC recovery      [T1]

projection file ──► G6 topography

χ synthesis ──► G1a/G1b χ recovery ──► state orderings [T1] ──► coupling depth [T1]

tilt filter ──► G4 off-frequency null ──► coupling loss curve [T1]
```

**SNR calibration is a node, not a gate.** It sits between the amplitudes and everything that depends on absolute scale. Drawing it as a gate would make the graph appear cyclic, because G5 both defines and tests the calibration point — which is exactly why §5's G5 splits the two steps.

**Runner rule: if a gate fails, refuse to evaluate its dependents and report the earliest failure only.** Otherwise the temptation is to tune a downstream threshold until it passes. A spindle F1 anomaly when the amplitude scale is wrong is not a morphology problem, and tuning morphology to fix it makes the generator worse.

---

## 8. Harness engineering

**Two tiers by runtime:**

| Runtime tier | Budget | Contents (project tier tagged) | Cadence |
|---|---|---|---|
| **Fast** | < 2 min | G1a/G1b `[T0]`, G2 `[T0]`, G4 `[T0]`, G5 `[T0]`, G6 `[T0]`, all matched nulls `[T0]`, variability distributions `[T1]` | every commit |
| **Slow** | < 30 min | G3 across seeds with YASA `[T0, record-only]`, SNR sweeps `[T1]`, PAC sweeps `[T1]`, discriminator `[T1]`, EDF round-trip characterization `[T1]`, sleep-stager benchmark `[T2]` | nightly, pre-release |

Runtime tier and project tier are independent axes — a Tier 1 gate may be fast and a Tier 0 gate slow. Tag both, so the every-commit set is not silently populated with work that does not exist yet.

**Interchange format.** Validate against a **lossless** format — the epoch directory from seam 9, float64 plus the event list. **Not EDF.** EDF stores 16-bit integers scaled by physical min/max; at ±3000 µV the quantum is ~0.09 µV, harmless for the 75 µV AASM criterion and plausibly not harmless for a χ gate at 30–45 Hz where the signal is small. Use EDF only for the interoperability gate, and add a check quantifying what the round trip costs each metric.

**Regression baselines.** Store golden per-seed metric values keyed by generator semantic version. An intentional change requires a minor version bump and a line in `DECISIONS.md`; an unintentional one fails the build.

**Report format.** One JSON artifact and one human summary per run. Every line carries: gate ID, class (V/C/U), N seeds, median, IQR, threshold, **threshold standing** (from `PARAMETERS.md`), pass/fail, generator version.

**Layout:**

```
/prep
  gates/          one module per gate: run(seed, params) -> metric
  nulls/          matched null for every gate in gates/
  reference/      third-party wrappers: specparam, YASA, SPRiNT, tensorpac, mne
  golden/         per-version baseline metric values
  fixtures/       fixed seeds and parameter sets
  runner.py       dependency graph, tiering, V/C/U printing, report emission
  DECISIONS.md
```

---

## 9. First actions

1. **Build `runner.py` first** — dependency graph, tiering, V/C/U printing — before any individual gate. The runner is what makes the gates trustworthy.
2. Write G4 and its off-frequency null together. It is the Tier 0 gate that most changes what gets built.
3. Never merge a gate without its null.
4. The surrogate type is decided — time-shuffled, `DECISIONS.md` D1. **The LZ parse may remain open**: it does not block Tier 0, whose landmarks are self-consistent under any parse. Settle it before citing any published magnitude.
5. Characterize the EDF round-trip cost per metric before any gate is validated through EDF.
