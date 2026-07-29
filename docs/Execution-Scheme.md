# Tier 0 Execution Scheme

*Derived from `Build-Plan.md`, `Validation-Harness_Spec.md`, `PARAMETERS.md`, `DECISIONS.md`
by a five-way document audit plus direct measurement (`Tier0-Estimator-Probe.md`).
Written 2026-07-28. This document is a plan, not a decision record — decisions it proposes
are marked and belong in `DECISIONS.md` once accepted.*

---

## 0. The headline

**Two Tier 0 gates cannot pass as specified, and one of them is the gate the artifact's thesis
rests on.** Both were found by reading the documents against each other and then confirmed by
measurement, not by argument:

1. **G4's f₁ arm is unpassable.** Circular-shifting a clean phase ramp multiplies an
   alignment-magnitude coupling index by a unit-magnitude constant, so the surrogate null is a
   point mass at the observed value. Measured: observed = null median = null 95th percentile =
   0.250000, IQR exactly zero. `obs > p95` is false on a perfect signal.
2. **G5's positive arm has no criterion.** D5 correctly splits calibration from gate and
   requires a *pass fraction*, but no document states what fraction passes. Every candidate
   number would be invented, which §1 forbids for a criterion.

Neither is fatal. Both have resolutions that keep the project's own rules (proposed D8 and D9
below). But **G4 must not be implemented against D4 as it stands**, and harness §9's
instruction to build G4 first is now doubly right: its criterion needs repairing before it is
written.

A third class of problem is mechanical rather than conceptual: **`PARAMETERS.md` is not
machine-readable today**, while "code reads this file" is the premise of seam 6 and the sole
mitigation for the register's top-rated risk. That is the first thing to build.

---

## 1. Canonical gate ledger — freeze this first

The documents disagree three ways. Build Plan §1 excludes *"every gate beyond the four in
§9"*; §9 is titled *"Tier 0's six gates"*; harness §5 opens *"Four gates."* and then specifies
seven arms. The runner cannot be written against an ambiguous set.

**Canonical: six gate IDs, seven evaluation arms, each with exactly one matched null.**

| ID | What | Class | Tier 0 verdict | Runtime tier |
|---|---|---|---|---|
| G1a | χ + k, knee mode, 1–45 Hz | **V** `specparam` | record-only | fast |
| G1b | χ, fixed mode, 30–45 Hz | **V** `specparam` | record-only | fast |
| G2 | Determinism, bit-identical | C | **pass/fail** | fast |
| G3 | Spindle F1 vs inclusion threshold | **V** `YASA` | record-only (curve) | slow |
| G4 | Respiration–χ off-frequency null | C | **pass/fail**, both arms | fast |
| G5 | AASM N3 criterion | C | record-only positive arm, **pass/fail null** | fast |
| G6 | Topography, structural `argmax` | C | **pass/fail**, both arms | fast |

`runner.py` refuses to start if any module under `gates/` lacks a counterpart under `nulls/`,
or if any gate declares a pass criterion whose registry standing is `invented`. That second
check is §1's circularity rule made mechanical.

**G2 is pass/fail, not record-only.** Build Plan §9 lists it among "gates 1–3 are record-only",
but bit-identity has no distribution to record, and a determinism gate that cannot fail is
worthless. It is also the root of the §7 dependency graph, so it belongs immediately after
`runner.py` as the runner's self-test — harness §9's first-actions list omits it entirely.

---

## 2. Binding decisions

### D7 — Tier 0 is TypeScript-only; the harness measures exported epoch directories

All three surviving analysts converged on this independently.

**Decision.** The Tier 0 core generator is TypeScript. It ships a headless Node CLI
(`bin/eegsim-export.mts`) that writes seam-9 epoch directories. `/prep` invokes that CLI and
measures the exported artifact. No Python generator exists at Tier 0.

**Reasoning.** Harness §8 already makes the seam an *artifact* boundary — *"Validate against a
lossless format — the epoch directory from seam 9"* — not an in-process API. Building a Python
generator at Tier 0 to satisfy "the Python package is what the harness measures" would recreate
precisely the cross-implementation parity trap the plan strikes in §1. Tier 2 swaps the Python
package in behind the same directory contract: a prefix, not a placeholder.

**Amendment — the interchange format must be float64, not CSV.** Build Plan §8 specifies CSV;
harness §8 requires float64. CSV round-trips float64 only at 17 significant digits. More
sharply: **G2's bit-identity check run through a lossy serializer tests the serializer, not the
generator** — the identical argument harness §8 uses to reject EDF. Epoch directories therefore
carry a binary `.f64` per channel *and* a CSV projection for human inspection, with the harness
and G2 reading only the binary.

**Amendment — the epoch sidecar must carry injected ground truth.** Every recovery gate needs
it: injected χ with band and mode, knee k, modulation depth and phase, SNR, per-generator
weights. Without it the harness would have to reimplement generator internals to reconstruct
truth — which at Tier 2 means the Python package and the harness must agree on that
reconstruction, quietly reintroducing parity.

### D8 — G4's f₁ arm takes a spectral-neighbourhood null; the f₂ arm keeps circular shift

**Supersedes D4's pass criterion.** Full evidence in `Tier0-Estimator-Probe.md` Finding 6.

- **f₁ (positive arm):** compare the coupling index at f₁ against its distribution over
  neighbouring frequency bins, excluding f₂ and the sidebands f₂±f₁ plus the existing
  `g4_min_bin_separation` guard band. Threshold = 95th percentile of that distribution. Still
  "derived from estimator properties" as §1 requires — it is the standard null for a spectral
  line — and it survives the invariance that kills the circular shift.
- **f₂ (negative arm):** keep the circular-shift null, which measurement shows is sound when
  testing coupling *to the reference being shifted* (obs/p95 = 1.61, healthy IQR). Aggregate
  across seeds by an **exact binomial test against the 5% per-seed false-exceedance rate the
  95th percentile defines** — not "all seeds must pass", which fails 64% of the time at
  `n_seeds` = 20 on a working generator (0.95²⁰ = 0.36).
- `g4_percentile` splits into two rows: the percentile *level* (`chosen`) and the threshold
  *value* at that level (`derived`, computed per run).

**Two further G4 repairs, both blocking:**

- **The f₂ arm is vacuous unless respiratory movement artifact is enabled at f₂.** The
  sidebands the gate exists to catch sit at f₂±f₁ and are intermodulation products requiring
  energy at *both* frequencies. With mechanism §5.1(a) off, nothing exists at f₂ and "coupling
  at f₂ must not exceed" passes trivially. The G4 fixture must state which mechanisms are on.
- **G4 needs a generator capability described nowhere: χ modulation decoupled from
  respiration.** §5.2 defines χ(t) as *driven by* respiration phase, so there is no specified
  way to modulate χ at f₁ while respiration runs at f₂. Add an explicit independent-modulator
  input to the tilt filter, used by the G4 fixture and by nothing in the shipped UI.

### D9 — G5's positive arm is record-only; its null carries the verdict

**Decision.** G5 reports the N3 pass fraction as a **recorded quantity** with no threshold.
Its null is **pass/fail** and is a strict ordering: `pass_fraction(N3 @ snr_nominal)` >
`pass_fraction(N2)` and > `pass_fraction(N3 @ snr_nominal − 6 dB)`.

**Reasoning.** D5 already establishes that after calibration the positive arm is "largely a
regression check" and that "the null carries the discriminative weight". Any threshold on the
pass fraction would be invented, or read from our own generator's spread — both prohibited.
An *ordering* needs no invented number and tests exactly what D5 says the gate retains.

### D10 — `delta_amp` gets a Tier 0 value from a non-AASM source

**Decision.** `delta_amp` takes a textbook range with standing `invented`, sourced explicitly
*not* to the 75 µV criterion, pending T1-M1 — matching its neighbours `so_amp` (100–200 µV)
and `kc_amp` (100–200 µV p-p), which both carry textbook ranges already.

**Reasoning.** This is subtle and it matters. With `delta_amp` blank *and* `snr_nominal` solved
so that N3 satisfies the AASM criterion, the pair is **under-determined by one degree of
freedom, and the calibration absorbs it** — the delta amplitude ends up set by the 75 µV figure
through the back door. That is the exact circularity D5 exists to close, re-entering through
the one row D5's own prose leaves blank. Fixing `delta_amp` independently makes `snr_nominal`
a genuine single-scalar solve.

### D11 — Invert the registry: normative YAML, generated `PARAMETERS.md`

**Decision.** `registry/parameters.yaml` becomes the single source of truth.
`docs/PARAMETERS.md` becomes a generated projection, with a CI fixed-point check
(`emit --check` regenerates every projection in memory and diffs) so the human table and the
machine values **cannot** disagree. The markdown is parsed exactly once, by a throwaway
migration importer, and never again.

**Reasoning.** Runtime markdown parsing is not viable against the file as it stands: an
orphaned single-row table (`snr_calibration_seed`, separated from its header by a blank line,
which every table parser silently drops — and it is the row the entire G5 held-out design
depends on), an ellipsis row standing for five keys (`k_wake` … `k_rem`), four empty `Standing`
cells, English values (`near zero`, `variable`, `few`), and a four-column §12 schema against
§1–§11's six.

**The value field is a tagged union**, because the doc's ranges mean at least three
incompatible things: filter band edges where both endpoints are simultaneously in force
(`spindle_band` 11–16 Hz), uncertainty bands the generator must reduce to a point plus `Dv`
(`alpha_amp` 20–50 µV), and UI slider domains (`snr_range_ui`). One accessor returning all
three is how a plausible-looking number reaches a filter.

**Pending rows hold no value at all.** `value.kind: pending` forbids a number; a required
`provisional:` sub-object holds the runtime number with `basis`, `expires_at_milestone` and
`constrained_by`. The only path to it in code is `provisionalValue(P.chi_n2)` — `P.chi_n2` is
typed with no numeric accessor, so arithmetic on it is a compile error. This is what stops a
placeholder silently becoming the value of record.

---

## 3. Registry repairs that block "code reads the registry" today

Applied by WP-A as part of the migration, each recorded:

- **Standing enum**: Build Plan seam 6 names four standings; `PARAMETERS.md` defines six and
  rests real machinery on the two extras. Canonical = **six**. Seam 6's list is the stale one.
- **Four rows have an empty `Standing`** (`lz_parse`, `gate_chi_tol_knee`,
  `gate_chi_tol_fixed`, `gate_spindle_f1`). Three are record-only Tier 0 tolerances that have
  *no value at all*, distinct from an `invented` guess. New standing: `absent`, meaning
  "deliberately not set, scheduled for T1-M2".
- **~11 rows fail the registry's own source discipline.** `topo_expect_alpha` first — it is the
  row G6 reads, D6 built the gate around its independence, and it names no standard.
  `definitional` rows naming a convention rather than a standard: `fs`, `alpha_band`,
  `beta_band`, `theta_band`, `line_freq`, `gate_determinism`. `literature` rows with a venue
  and year but no author: `knee_freq_low`, `knee_freq_high_unmodelled`, `knee_present`,
  `lz_binarize`, `chi_mod_phase_wake/_sleep`. The doc's own remedy is **re-standing, not
  re-sourcing by guess**.
- **`gate_aasm_n3` hides four separately-typed constants in one prose cell** (0.20, 75 µV, 0.5,
  2.0 Hz). The acceptance check cannot authorize any of them; split into four rows.
- **~30 constants referenced in prose have no row.** Most load-bearing: **the −6 dB in G5's
  null**, which appears in Build Plan §9, harness §5 and D5, and is registered nowhere — a
  threshold on the arm the docs say carries the discriminative weight. Also missing: Welch
  settings, `synth_overlap`/`synth_crossfade_len`, `display_sensitivity`, `render_decimation`,
  `lz_band`, `lz_channel_order`, `emg_amp_wake`, `line_amp`, `notch_q`, `blink_rate`, the
  six-sigma `Dv` range, and every `Dv` row (the registry currently contains **zero**, though
  §3.6 requires them for every parameter).
- **`chi_n1` is absent** although `chi_direction` and `knee_present` both reference N1. The
  state set is never enumerated in one place; `StateId` is seam 2 and imported by every
  generator.
- **`tilt_n_poles` and `tilt_mod_settling_ratio` are filed as ordinary `invented` rows** with
  no milestone, but the pending table makes them P2/P3, due T0-M4, blocking G4. Under the rule
  that `invented` converts at T1-M1 by corpus fitting they would be routed to a milestone that
  never touches them. `tilt_n_poles` is answered below.
- **specparam's fit settings are absent**, though they determine recovered χ as much as band
  and mode do — contradicting seam 7's premise. In 2.0.0rc7 these moved out of the constructor
  into `algorithm_settings`, so the row records shape as well as values. **No document pins any
  third-party version, yet a class-V claim has no meaning without one.**

### P2 answered by measurement — `tilt_n_poles` = 12

4 pole–zero pairs per decade over 0.1–115 Hz gives peak-to-peak ripple of ~15% of Δχ across
1–45 Hz, and relative ripple is depth-independent (so it survives `chi_mod_depth` being fitted
at T1-M1). Standing `derived`. Two hard constraints found by measurement: the cascade **must**
be realized as second-order sections — direct form overflows to non-finite values at this
order — and the sign convention (PSD exponent = −2g) must be pinned by a unit test, because it
is the sign that silently inverts the wake/sleep phase reversal. Full data in
`Tier0-Estimator-Probe.md` Findings 3–5.

### P3 shown to be unanswerable before G4 exists

Settling time is a red herring: t₉₉ = 0.164 s against a 10 s modulation period is 61× margin,
because each pole sits within a factor ~0.81 of its own zero and the pairs nearly cancel. The
residual sideband risk lives entirely in *how coefficients are interpolated between updates*.
I attempted to measure that with a cheap χ(t) proxy and **the proxy was itself nonlinear enough
to fabricate the answer** — so the honest conclusion is that the measurement of "does the tilt
filter manufacture sidebands" *is* G4, and P3's T0-M4 due date cannot be pulled earlier. Build
**both** interpolation schemes behind one interface and let G4 choose.

---

## 4. Reconciled build order

The documents give three orderings that conflict. Resolutions named.

| Conflict | Resolution |
|---|---|
| **Design tokens** — T0-M7 is scheduled last, but its own text says the token system precedes components, and M2 writes components on days 6–7 | Split: **M7a tokens** (1 d) moves into the foundation; **M7b explanatory copy** (2.5 d) stays last |
| **Epoch export** — listed at T0-M6, but it is the harness's only input under D7, so no gate can run before it | Moves to **T0-M1**. M1 currently carries only the *schema* |
| **G4** — harness §9 says build it first as "the Tier 0 gate that most changes what gets built", but the tilt filter is T0-M4 and all gates are T0-M5 | G4 and its null move **into the tilt-filter package**, built jointly |

**Phase F — foundation, serial, ~3.5 d.** Registry mechanism → core types + RNG → epoch schema
+ CLI skeleton → `runner.py` + G2. Ends at an explicit **interface-freeze commit**.

**Phase 1 — fan-out, ~4 d.** Design tokens; aperiodic+knee and oscillations; projection file
and montage; respiration + tilt filter; χ(t) and coupling index.

**Phase 2 — ~3 d.** Scrolling trace and calibration bar; K-complex; **G4 + its null**.

**Phase 3 — ~4 d.** Filter panel and Demos 1/2/3; spindles, SO, AP travel, SO–spindle
injection; LZ + time-shuffled surrogate + pink-noise preset.

**Phase 4 — ~3 d.** SNR calibration run; G1a/G1b, G3, G5, G6 and their nulls; golden baselines.

**Phase 5 — ~3 d.** Artifacts; export polish; explanatory copy; honesty pass on every report
line.

### The interface freeze — eleven files, frozen before any fan-out

1. `tools/registry/GRAMMAR.md` · 2. `registry/parameters.yaml` (repairs applied) ·
3. `tools/registry/parse_registry.mjs` · 4. `gen/registry.json` + `gen/registry.d.ts` ·
5. `src/core/registry.ts` · 6. `src/core/types/state.ts` · 7. `src/core/types/exponent.ts` ·
8. `src/core/types/event.ts` · 9. `src/core/types/config.ts` +
`schema/generator_config.schema.json` · 10. `src/core/rng/xoshiro128pp.ts` ·
11. `schema/epoch_dir.schema.json` + `src/io/epoch_dir.ts` + `bin/eegsim-export.mts`

After the freeze, changes to any of these require a `DECISIONS.md` entry — each is imported by
every downstream package.

---

## 5. Work packages — disjoint file ownership

| WP | Title | Owns | Depends on |
|---|---|---|---|
| **A** | Registry *(foundation)* | `registry/**`, `tools/registry/**`, `tools/lint/**`, `gen/**`, `src/core/registry.ts`, `prep/registry.py`, `docs/PARAMETERS.md` | — |
| **B** | Types + RNG + CLI + epoch IO *(foundation)* | `src/core/types/**`, `src/core/rng/**`, `src/io/**`, `schema/**`, `bin/**`, `prep/epochio.py` | A |
| **C** | Harness runner + G2 | `prep/runner.py`, `prep/report.py`, `prep/toolprobe.py`, `prep/gates/__init__.py`, G2 + null | B |
| **D** | Aperiodic + oscillations + projection | `src/core/generators/{aperiodic,oscillations,projection}.ts`, `data/montage_10_20.json`, `data/projection_10_20.json` | B |
| **E** | Graphoelements | `src/core/generators/{spindle,kcomplex,slow_osc,so_spindle}.ts`, `src/core/events/**` | B, D *(data only)* |
| **F** | Respiration + filters + G4 | `src/core/generators/respiration.ts`, `src/core/filters/**`, `prep/gates/g4_*.py`, `prep/nulls/g4_*.py` | B, G |
| **G** | Observables | `src/analysis/**`, `src/workers/analysis.worker.ts` | B |
| **H** | Tokens + render + UI + copy | `src/tokens/**`, `src/render/**`, `src/ui/**`, `src/copy/**` | B |
| **I** | Remaining gates | `prep/gates/{g1,g3,g5,g6}*.py`, `prep/nulls/**`, `prep/reference/**`, `prep/golden/**` | C, D, E |
| **J** | Artifacts | `src/core/generators/{blink,emg,line_noise}.ts` | B |

**No package may edit `registry/parameters.yaml` or `PARAMETERS.md`.** New rows are requested
through WP-A, the only writer — otherwise concurrent agents produce merge conflicts in the one
file everything reads. WP-D commits a schema-valid stub `projection_10_20.json` on day one so
WP-E proceeds concurrently.

---

## 6. Scope call

**Ship real:** the registry mechanism and its acceptance check; CLI + epoch directory + G2;
`runner.py` with class/status/dependency graph and JSON+human reports; G4 and its null
(repaired per D8); G6 and its null; aperiodic-with-knee, oscillations, projection, montage,
scrolling trace with calibration bar; respiration, tilt filter, filter panel, all three demos
with live coupling readout against ground truth; K-complexes, spindles, SO with AP travel,
SO–spindle injection with graded prominence; χ readout with band selector and both modes; the
coupling index; design tokens.

**Ship honestly degraded:** G1a/G1b and G3 against the installed `specparam` 2.0.0rc7 and
`yasa` 0.7.0, record-only, resolved versions printed in the report header, with a
`class_effective = U` path if import fails — never a silent skip. G5 per D9. LZ ships with
`lz_parse` open, time-shuffled surrogate, the UI naming its null ("same density, no
structure"), and **no published magnitude cited anywhere in copy**.

**Stub as a prefix, with a named TODO:** `projection_10_20.json` holds a Gaussian while the
loader and schema validation are real — `TODO(T1-M1): replace contents with LΨᵀ columns`.
`Shift`/`Slope`/`probabilitySlope` exist, are threaded, and are 0 — `TODO(T2)`. The third
observable is a recorded readout plus the cross-axis correlation display, no axis-swap UI.

**Cut:** EDF (a "stretch" that harness §9.5 gates behind an unbudgeted round-trip
characterization, and which Build Plan §1 simultaneously calls explicitly out of scope);
mobile-specific interaction beyond one responsive breakpoint.

**Do not stub:** a Python generator, a preset interpolator, robust detrending, phase-shuffled
LZ, or an in-house `specparam` substitute under a class-V gate ID. Each is a placeholder that
gets deleted, not a prefix.

### Budget

Realistic content is **~28 FTE days against a 23-day budget**. The overrun is not in the
generator — it is the registry mechanism (~2 d), CLI + epoch IO (~1.5 d), and `/prep`
engineering beyond the gates themselves (~2 d), none of which appear in T0-M1…M7. The plan's
own §0 warns that the previous revision "omitted the harness, corpus fitting, packaging, docs,
and CI entirely"; this is the same omission one level down.

---

## 7. Open items requiring a human decision

| # | Item | Why it needs you |
|---|---|---|
| 1 | **D8** — G4's repaired criterion | Supersedes a standing decision (D4) on the most important gate. Confirmed defect, but the *choice* of replacement null is yours |
| 2 | **D9** — G5 positive arm record-only | Downgrades a gate the Build Plan lists as failable |
| 3 | **D10** — `delta_amp` gets a textbook value | Closes a real circularity, but adds an `invented` row |
| 4 | **D7 amendment** — binary `.f64` replaces CSV as the harness-facing format | Contradicts Build Plan §8's stack table |
| 5 | **D3's comparability claim** | G1b's bias comes from our modelled 20 Hz knee, not the literature's 45 Hz one — measured. Needs re-measurement under the full generator before D3 is amended |
| 6 | Third-party version pinning | A class-V claim is meaningless without it; `specparam` is at a **release candidate** |
