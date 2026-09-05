# Respiration realism — execution plan

*Written 2026-08-18 from the respiration design review. This is an implementation contract,
not a source of parameter values. `registry/parameters.yaml` remains normative. Empirical
results and accepted design changes belong in `Tier0-Estimator-Probe.md` and `DECISIONS.md`.*

---

## 0. Objective

Replace the current repeated-breath prefix with a continuous, state-dependent
cardiorespiratory controller that produces realistic respiratory morphology and variability,
drives ECG through RR-domain respiratory sinus arrhythmia, and affects EEG through four
separately identifiable paths:

1. mechanical movement artifact;
2. respiration-locked aperiodic-slope modulation;
3. respiration-locked periodic-power modulation; and
4. respiration-conditioned NREM event timing.

The result must remain a parametric simulator with known ground truth. It must not replay real
recordings, train a generative model, or describe any generated sample as measured physiology.

## 1. Non-negotiable rules

1. **Separate causes.** Respiratory phase, shared autonomic/arousal state, mechanical artifact,
   and neural coupling are different causes and remain separately switchable in the API and
   separately identified in injected truth.
2. **Preserve the circularity rule.** No tolerance, fitted parameter, or state ordering is
   derived from the generator's own spread. External literature, held-out recordings, an
   independent implementation, or a threshold-free ordering must anchor every claim.
3. **One causal layer at a time.** R1 changes the respiratory controller, R2 cardiac timing,
   R3 continuous EEG coupling, and R4 event hazards. A layer is characterized before its
   dependents change.
4. **Matched mechanism-off arms.** Every coupling characterization compares paired records
   with identical seed and unrelated substreams, differing only in the mechanism under test.
5. **No silent power changes.** Periodic amplitude modulation preserves the rhythm's mean
   squared amplitude. Event-hazard modulation preserves the marginal event rate. State fits
   already accepted for EEG power and event density do not become hidden respiratory knobs.
6. **Continuous physiology.** Respiratory phase, current breath, latent rate and depth,
   cardiac phase, and RR state survive live display-buffer boundaries. A display chunk is not
   a physiological epoch.
7. **Subject before state.** A seed defines one cardiorespiratory phenotype. Changing state
   applies a state offset to that phenotype rather than creating a different person.
8. **Truth means realized truth.** Sidecars distinguish requested parameters from realized
   rate, variability, phase concentration, modulation depth, and event-phase statistics.
9. **Prefix, not placeholder.** If a mechanism is not calibrated, ship the smallest valid
   prefix with an explicit standing and a falsifiable interface; do not add decorative noise
   under a physiological name.
10. **Normal physiology first.** Apneas, hypopneas, desaturation, Cheyne-Stokes breathing,
    pathological pauses, and disease-specific arousals are out of scope until the normal model
    passes its gates.

## 2. Target architecture

The controller has two dynamic outputs that must not be conflated:

- a respiratory oscillator producing breath morphology and analytic phase; and
- a slower shared autonomic/arousal state that can influence respiration, ECG, and EEG without
  being labelled as a causal effect of respiration.

For breath `n`, the initial timing model is:

```text
log(T_n) = mu_subject + delta_state + u_fast[n] + u_slow[n] + epsilon[n]
u_k[n]   = rho_k,state * u_k[n-1] + sigma_k,state * eta_k[n]
log(A_n) = a_subject + beta_state * u_fast[n] + v[n]
```

Two correlated timescales approximate observed 6–16 s and 50–200 s structure while keeping
the model inspectable. NREM receives little slow variance; wake and REM receive more. A more
complex long-memory process is adopted only if this model fails an external fluctuation gate.

Cardiac timing is modelled in RR space:

```text
RR_n = mu_RR,state
     + A_RSA,state * breath_depth[n] * sin(resp_phase[n] - delta_RSA,state)
     + h_fast[n] + h_slow[n]
```

Respiration-locked exponent modulation at channel or cortical mode `j` is:

```text
chi_j(t) = chi_0,state
         + L_chi[j,state] * m_n * cos(resp_phase(t) - delta_chi[n,state])
```

Periodic amplitude modulation uses a positive, power-preserving gain:

```text
g_band(t) = exp(m_band,state * cos(resp_phase(t) - delta_band,state))
            / sqrt(I0(2 * m_band,state))
```

Respiration-conditioned event generation first draws the ordinary Poisson count and then samples
event-marker phases from a von Mises law:

```text
lambda_event(t) = lambda_0,event
                * exp(kappa_event * cos(resp_phase(t) - mu_event))
                / I0(kappa_event)
```

In implementation, phase-indexed conditional sampling preserves the realized baseline count
exactly and prevents unequal inspiration/expiration duration from shifting the circular target.

## 3. Work sequence

### R0 — characterize the shipped system; no generated-signal changes

Build one reproducible probe that records, by state and seed:

- realized respiratory rate, inter-breath interval CV, lag-1 correlation, breath-depth CV,
  and short/long fluctuation measures;
- belt morphology and respiratory carrier versus sub-0.1 Hz power;
- mean HR, RR SD, respiration-fitted RR amplitude and phase;
- respiration-locked EEG artifact amplitude at referenced Fz;
- respiratory modulation of low-band amplitude and recovered aperiodic exponent;
- respiratory phases and resultant lengths of slow oscillations and fast/slow spindles; and
- discontinuity across the 90 s live-buffer join.

Run paired mechanism-off arms. Save a machine-readable result and append the interpretation to
`Tier0-Estimator-Probe.md`. R0 may add probes, tests, and documentation only.

**Exit:** the baseline is reproducible, every reported quantity names its estimator, and no
generator or registry value has changed.

### R1 — continuous respiratory controller and morphology

- Introduce an explicit serializable `RespiratoryState` carrying phase, current-breath
  morphology, fast/slow latent states, and subject phenotype.
- Preserve state across live chunks and provide a stateless whole-record wrapper for exports.
- Replace fixed per-breath pauses with probabilistic inhale/exhale pauses and varying inhale,
  exhale, depth, and duty cycle.
- Validate feature parity against BreathMetrics/NeuroKit2 using rate, IBI CV, depth CV, pause
  frequency/duration, duty cycle, and waveform continuity—not pixel similarity.
- Replace broad state rate intervals with a subject baseline plus literature-anchored state
  offsets. Add a distinct N1 row.
- Split respiratory regularity by state; do not encode REM irregularity as a wider mean-rate
  interval.

**Exit:** continuity passes; mean rates and regularity ordering have external anchors; R0's EEG
and ECG mechanisms remain unchanged when driven by the new phase.

### R2 — RR-domain cardiac dynamics — implemented

- Move RSA from multiplicative instantaneous HR to RR intervals in seconds.
- Add state-dependent mean RR, RSA strength, correlated HRV, and phase lag.
- Let breath depth modulate RSA without making respiration the only source of HRV.
- Preserve beat scheduling and latent cardiac state across live chunks.
- Defer respiration-dependent R/T morphology until timing passes.

**Exit:** NREM RSA exceeds REM in the externally specified direction; REM/wake have stronger
long-timescale HR variability; ECG morphology and R-peak truth remain valid.

**Result:** complete in generator 0.7.0. Stage HR and HRV targets come from 19 HMC nights;
relative RSA follows Penzel et al.; absolute RSA remains pending. Arbitrary chunks, serialized
resume, and the browser's 90-second rollover reproduce uninterrupted ECG and R peaks exactly.

### R3 — continuous EEG coupling — implemented

- Give aperiodic modulation an empirical spatial loading, state-specific mean phase, and
  breath-to-breath phase/depth variability.
- Separate periodic-power phase and depth from aperiodic slope. Remove the current shared
  phase offset.
- Replace the global low-band `0.65..1.35` multiplier with band/state rows only where external
  evidence supports them.
- Preserve each rhythm's mean squared amplitude by construction.
- Keep mechanical artifact independently controllable and calibrate it as artifact, not as
  evidence of neural coupling.

**Exit:** slope has the supported wake/sleep phase shift and spatial pattern; periodic and
aperiodic phase courses are distinguishable; paired off arms remain matched.

**Result:** complete in generator 0.8.0. Respiratory phase is peak-inspiration-centred and the
five state maxima reproduce the published overnight directions. A posterior cortical BEM patch
sets the nonnegative scalp loading for slope modulation, including its volume-conducted frontal
tail. Periodic low- and high-band gains use separate literature-derived phase courses and preserve
mean squared rhythm amplitude exactly. Across matched 180-second records, recovered slope phase
is within 1–4 degrees of truth, recovered scalp depth correlates 0.999 with the independent BEM
loading, and total EEG RMS changes by at most 0.02%. Absolute coupling depths remain pending.

### R4 — NREM event hazards — implemented

- Modulate slow-oscillation downstate and fast-spindle onset hazards by respiratory phase.
- Do not modulate slow-spindle timing unless a separate source supports it.
- Combine respiratory and existing SO–spindle coupling without multiplying their marginal
  event rates.
- Target externally reported preferred phases and resultant lengths; characterize estimator
  bias before assigning a tolerance.

**Exit:** marginal SO/spindle rates remain within their pre-respiration baselines, the expected
phase ordering is recovered by an external detector, and a matched mechanism-off arm contains no
injected preference. A raw phase-shuffled distribution need not be circularly flat when unequal
I:E timing makes phase exposure itself nonuniform; the matched arm is the valid null.

**Result:** complete in generator 0.9.0. The baseline Poisson count is drawn once and remains
bit-identical with coupling on or off. N3 SO downstates target -9.4 degrees and N2/N3 fast-spindle
onsets +16.95 degrees using the 2023 nap profile; slow-spindle timing has no respiratory path.
Natural-breath truth recovers SO/fast-spindle mean phases within 0.005–0.17 rad and resultant
lengths 0.48–0.52. YASA independently recovers the SO-before-inspiration, fast-spindle-after-
inspiration ordering. A conflicting 2024 full-night result reports expiratory coupling for both
spindle classes, so this profile is explicit and replaceable rather than described as universal.

### R5 — registry, truth, UI, and release

- Convert accepted literature values and derived procedures into registry rows; leave
  unmeasured magnitudes pending rather than promoting provisional values.
- Extend epoch truth with breath events, realized variability, RR/RSA parameters, and achieved
  coupling summaries. Bump schemas and generator version only when output changes.
- Keep ordinary UI controls small: natural/regular respiration and independently selectable
  movement artifact are sufficient initially.
- Update the website description only for mechanisms that the released gates establish.

**Exit:** fixed-point projections, tests, full gate runner, browser continuity, and static-site
build all pass.

**Result:** complete in generator 0.9.0 with epoch schema v5. The default signal did not change,
so the generator version did not move. Export truth now includes every realized breath, period
and depth variability, I:E/pause summaries, R peaks, RR intervals, SDNN, RMSSD, requested and
recovered RSA, and circular summaries for respiratory event markers. Variable-length physiology
is stored once in run-level `physiology.json`; epoch sidecars keep compact summaries and point to
it, avoiding full-night metadata multiplication. Missing short-record statistics serialize as
`null`, never `NaN`. The UI exposes only the two causal contrasts this
phase justified: natural versus fixed-cycle respiration at the same state mean, and independent
mechanical movement artifact. The 2-seed × 120-second release interaction audit found every
mechanism active only in its intended states, exact event-count preservation, natural period CV
0.058–0.172 by state, and fixed-mode CV exactly zero. Absolute coupling magnitudes remain pending;
none was promoted from simulator output.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/r5_release_integration.mts`.

## 4. Validation ledger

| ID | Claim | External anchor or null | Initial status |
|---|---|---|---|
| RSP1 | Rate by state | Gutierrez et al. PSG summaries | record-only until estimator characterized |
| RSP2 | Wake/REM less regular; N3 most regular | Gutierrez et al.; matched state ordering | record-only |
| RSP3 | Weak NREM and stronger wake/REM long-timescale structure | Rostig et al.; Zschocke et al. | record-only |
| RSP4 | Breath morphology is not a repeated sinusoid/template | BreathMetrics/NeuroKit2 feature parity | pass/fail after parity tolerance derivation |
| RSP5 | Live chunks do not reset physiology | exact state-continuity invariant | pass/fail |
| RSP6 | RSA is stronger in NREM than REM | Penzel et al. relative ordering | pass/fail ordering |
| RSP7 | Aperiodic coupling shifts phase from wake/N1 to deeper sleep | Sánchez Corzo et al.; shuffled respiration | record-only then pass/fail |
| RSP8 | Wake slope modulation is widespread and posterior-weighted | Kluger et al.; phase-preserving spatial null | record-only |
| RSP9 | Periodic and aperiodic respiratory dynamics differ | Kluger et al.; paired equality null | pass/fail only after estimator characterization |
| RSP10 | SO and fast-spindle events prefer inhalation-adjacent phases | Schreiner et al.; shuffled event phases | record-only then pass/fail |
| RSP11 | Slow spindles have no asserted respiratory preference | Schreiner et al. negative result | pass/fail null |
| RSP12 | Coupling does not alter marginal power or event rate | paired mechanism-off invariant | pass/fail |

## 5. Explicitly deferred

- pathological respiratory events and oxygen saturation;
- a full chemoreflex or gas-exchange model;
- a generic all-mechanism “respiration strength” control;
- generative-model or real-waveform replay;
- the pending nasal/oral attenuation factor until a mechanism-specific magnitude is supported;
- fitting normal physiology against a detector or coupling estimator that is also used to gate
  the same injected quantity.

## 6. Handoff rule

At the end of each phase, record:

1. what changed in the causal model;
2. which registry rows changed standing or value;
3. the paired pre/post measurements;
4. which claims became stronger, weaker, or were withdrawn;
5. all failed candidates, not only the retained one; and
6. the exact command that reproduces the result.

Do not begin the next phase while the current phase has an unexplained continuity failure,
unmatched null, or change to an already-fitted EEG metric.
