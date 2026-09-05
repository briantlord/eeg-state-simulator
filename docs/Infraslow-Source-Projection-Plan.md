# Infra-slow source projection — execution plan

*ISF-0 written 2026-08-25. This document is an implementation contract, not a source of
runtime values. `registry/parameters.yaml` remains normative. No generated sample changes in
ISF-0.*

## 0. Objective

Add physiologically interpretable activity below 0.1 Hz without turning every slow baseline
change into a cortical dipole or retuning the simulator against a collection of coupled summary
metrics.

The implementation must distinguish four observations that can occupy the same frequency range:

1. an additive cortical current projected through the BEM lead field;
2. a latent infra-slow excitability state that modulates faster cortical activity;
3. respiration and its neural and mechanical effects; and
4. electrode, skin and amplifier drift.

Only the first two may be called neural infra-slow activity. The last path is an artifact even
when it resembles the first at one electrode. Respiration retains its existing independent truth
and controls.

## 1. What comparable simulators establish

There is no need to invent a new forward-projection mechanism. SEREEGA, EEGSourceSim and
MNE-Python accept source time series and project them through a lead field. The Virtual Brain
also exposes an EEG projection monitor for simulated source dynamics. These establish the
standard algebra:

```text
X(t) = L S(t) + E(t)
```

where `S` contains cortical source currents, `L` is the existing BEM lead field and `E` contains
terms that do not belong in that cortical forward model.

Published computational models can generate infra-slow dynamics from ion concentration, glial,
adaptation or whole-brain network mechanisms. They do not provide a uniquely validated mapping
from healthy wake/sleep model state to 19-channel scalp voltage. A large mechanistic neural-mass
model would therefore add parameters without solving the calibration problem. This project will
use the smallest stochastic state-space prefix that can satisfy external temporal and spatial
observations.

Primary implementation comparisons:

- Krol et al. 2018, SEREEGA, DOI
  [10.1016/j.jneumeth.2018.06.001](https://doi.org/10.1016/j.jneumeth.2018.06.001).
- Barzegaran et al. 2019, EEGSourceSim, DOI
  [10.1016/j.jneumeth.2019.108377](https://doi.org/10.1016/j.jneumeth.2019.108377).
- MNE-Python,
  [simulated raw data through a forward solution](https://mne.tools/stable/auto_examples/simulation/simulate_raw_data.html).
- The Virtual Brain,
  [EEG projection monitor](https://docs.thevirtualbrain.org/api/tvb.simulator.monitors.html).
- Krishnan, González & Bazhenov 2018, ion/glia-mediated infra-slow network model, DOI
  [10.1073/pnas.1715841115](https://doi.org/10.1073/pnas.1715841115).

## 2. Empirical anchor and claim boundary

The primary healthy human anchor is Väyrynen et al. 2023, DOI
[10.1016/j.clinph.2023.10.013](https://doi.org/10.1016/j.clinph.2023.10.013): 256-channel
full-band EEG in 21 subjects during wake and NREM sleep, with respiration measured separately.
It supports:

- an infra-slow analysis range of 0.008-0.1 Hz;
- separate ISF1 (0.008-0.05 Hz) and ISF2 (0.05-0.1 Hz) analyses;
- irregular periods from roughly ten seconds to more than one hundred seconds rather than one
  fixed oscillator;
- greater broadly distributed infra-slow power during sleep, particularly frontally;
- ISF1-to-fast-amplitude PLV of 0.178 +/- 0.014 in wake and 0.211 +/- 0.022 in sleep under the
  paper's pipeline; and
- significant ISF-fast coupling at 5-15% of electrodes in wake and 5-35% in sleep.

The study aggregates N1-N3 for its principal sleep comparison and does not supply a REM profile.
It does **not** license a monotone N1-to-N3 ladder. Its PLV is an estimator output, not the
generator's log-amplitude depth.

Hiltunen et al. 2014, DOI
[10.1523/JNEUROSCI.0276-13.2014](https://doi.org/10.1523/JNEUROSCI.0276-13.2014), found that
independent full-band EEG components were associated with subsets of fMRI resting-state networks.
This rejects one global infra-slow scalp waveform as the default spatial model, but it does not
identify the shared-source variance or source delays needed here.

The mechanism remains uncertain. Slow scalp potentials may include neural current, glial,
blood-brain-barrier, vascular and recording contributions. Consequently:

- the BEM is used only for the explicitly cortical current component;
- the latent excitability driver may modulate cortical activity without being equated to the
  complete measured DC voltage;
- an optional recording-drift component is generated outside the BEM; and
- no additive RMS, source coherence, source delay or modulation depth is assigned in ISF-0.

The raw recordings behind the primary paper were not found in a public download. Literature
aggregates can constrain bands, orderings and estimator-specific reference values. They cannot
support a tightly fitted 19-channel amplitude model. Those rows are registered as `absent`, not
filled with provisional values.

## 3. Shipped baseline

The current generator has three slow ingredients, none of which is the proposed subsystem:

- the aperiodic FFT extends to the first nonzero frequency bin and therefore contains incidental
  sub-0.1 Hz power, with DC explicitly zeroed;
- `background_envelope_rate = 0.10 Hz` creates slow amplitude variation in the broadband
  background, not an additive named infra-slow potential; and
- respiration contributes its own carrier, coupling and optional movement artifact around the
  respiratory rate.

There is no infra-slow source ID, source phase, source topography, source delay, additive RMS or
mechanism-off arm in generated truth. The ordinary 0.1 Hz zero-phase high-pass also strongly
attenuates the direct voltage that happens to exist. The 15-60 s display cannot characterize a
0.008 Hz process whose period is 125 s.

ISF-0 does not remove or rename the incidental low-frequency part of the aperiodic spectrum.
ISF-1 must measure it before adding a named component so that the two are not double-counted.

## 4. Accepted architecture

### 4.1 Latent controller

Use two continuous stochastic processes corresponding to ISF1 and ISF2. For cortical mode `j`:

```text
z_j(t) = sqrt(c) z_shared(t - tau_j) + sqrt(1-c) z_local,j(t)
```

All component processes have unit variance before state and source loadings. `c` is the shared
variance fraction and `tau_j` is a source-space delay. Neither has a value at ISF-0.

The controller is serializable and survives every live-buffer boundary. A request for a display
chunk must never define the physiological epoch.

### 4.2 Candidate temporal models

ISF-1 compares these candidates before one enters the generator:

| Candidate | Parameters | Strength | Rejection condition |
|---|---:|---|---|
| Band-limited power-law state space | exponent, two band gains, damping edge | Parsimonious; no preferred line | Cannot provide stable phase or produces edge ringing |
| Stochastic damped-oscillator bank | centre/damping distribution per band | Analytic phase and natural wandering | Produces a visible spectral comb or excessive periodicity |
| Hybrid: power-law driver plus weak resonant mode | exponent, weak resonance, damping | Can represent broad background plus common ~0.02 Hz tendency | Resonance becomes a tuning knob unsupported by external spectra |

The selection metric is not visual preference. On external full-band data or literature-derived
fixtures, choose the least complex candidate that reproduces broad-band power, variable periods,
autocorrelation and non-comb spectra. A whole-brain neural-mass model is deferred unless all three
prefixes fail.

### 4.3 Spatial model

Begin with three or four broad named cortical patch families, each represented by the existing
lead-field covariance modes:

- medial/frontal association;
- central/sensorimotor;
- posterior/visual; and
- lateral association, only if the first three fail spatial-rank or topographic checks.

Patch membership is fixed anatomically before amplitude fitting. Partial coherence and delay live
between patches. No amplitude, phase or delay is assigned directly to an electrode.

The parent patch and its modes enter `projection_10_20.json` through the existing projection
producer. The number of retained modes remains a property of `patch_mode_variance`, not a new
independently chosen parameter.

### 4.4 Additive and modulatory outputs

The cortical current path is:

```text
x_isf(t) = L s_isf(t)
```

The excitability path applies a positive gain to each faster source:

```text
s_fast,k(t) = g_k(z(t), phase(t)) u_k(t)
E[g_k(t)^2] = 1
```

Unit mean square prevents ISF coupling from silently changing accepted state power and forcing a
retune of alpha, delta or SNR. Additive voltage and modulation depth remain independently
switchable matched arms.

Recording drift is:

```text
x_observed(t) = x_cortical(t) + e_electrode(t) + e_reference(t)
```

It is not projected through the cortical BEM and cannot satisfy a neural gate.

## 5. Truth contract

When implementation begins, run-level truth must distinguish requested and realized values:

```text
infraSlow:
  bands
  temporalModel
  sourceModes[]:
    sourceId
    sharedFraction
    delayS
    additiveRmsUv
    realizedBandPower
  modulation[]:
    targetSource
    band
    requestedDepth
    realizedGainRms
    preferredPhase
  electrodeDrift:
    enabled
    requestedPerChannelRmsUv
    realizedPerChannelRmsUv[]
    requestedCommonReferenceRmsUv
    realizedCommonReferenceRmsUv
```

The export schema and generator version move only when these fields or default generated samples
actually change.

## 6. Validation ledger

No implementation gate may derive its tolerance from generated spread.

### I0 — specification fixed point

Class C, structural. Assert that ISF1 and ISF2 exactly cover `isf_band`, the probe spans ten
cycles at its lower edge, amplitude/depth/delay rows remain unreadable while absent, and no ISF
truth is falsely exported before implementation.

### I1 — temporal controller

Class C plus external comparison. Over at least `isf_probe_record_length`:

- whole-record and arbitrarily chunked generation are bit-identical;
- no boundary jump or phase reset occurs;
- the PSD has no chunk-rate comb or fixed-frequency line;
- period and amplitude vary; and
- ISF1 and ISF2 power can be independently disabled.

The matched null is the same seed with both ISF drivers disabled. External magnitude thresholds
remain record-only until an accessible full-band corpus is selected.

### I2 — source projection

Class C structural fixed points:

- every neural ISF voltage reaches channels only through named BEM modes;
- no electrode-level topography exists;
- changing reference applies the ordinary linear reference operator; and
- source-space delay, not channel phase rotation, creates propagation.

Record effective rank, PC1 variance and near/far correlation. Do not fit all four: they summarize
one covariance matrix.

### I3 — wake/NREM contrast

Class V when raw data is available; otherwise literature-ordering RECORD. Aggregate NREM must
exceed aggregate wake in infra-slow relative power and show broader coupling extent, with frontal
power enhancement. There is no N1/N2/N3 ordering gate and no REM gate.

### I4 — phase-amplitude coupling

Paired arms with identical carriers and seed:

1. additive voltage only;
2. modulation only;
3. both; and
4. phase-shifted or mechanism-off null.

Recover coupling using an implementation independent of the generator. Paper PLV values are
comparators only when its filtering, amplitude extraction and surrogate pipeline are reproduced.
The generator depth is never assigned directly from a PLV.

### I5 — respiration separation

Regress or condition on known respiratory phase. ISF truth and ISF-fast coupling must remain
identifiable. A future shared physiological driver requires an explicit third arm; it may not be
introduced as an unexplained correlation between the two controllers.

### I6 — artifact identifiability

Neural ISF changes with BEM geometry and reference. Electrode drift does not obey the cortical
lead field and is separately switchable. A high-pass can remove both direct voltages, but truth
must retain their different causes.

### I7 — regression

With a 0.1 Hz high-pass and ISF coupling disabled, established G1-G6 and respiration/cardio gates
must remain unchanged. With coupling enabled, mean-square-preserving modulation must leave each
carrier's long-run power unchanged within numerical precision.

## 7. Interface requirement

The existing clinical scroll remains the default view. Infra-slow inspection requires a separate
full-band view rather than compressing 20 minutes into the ordinary trace:

- explicit `Full-band/DC` mode;
- spectrum down to at least 0.005 Hz;
- decimated 120, 300 and 600 s overview choices, with a longer analysis buffer behind them;
- direct comparison of unfiltered and conventional 0.1 Hz high-passed traces; and
- independent truth toggles for cortical ISF, excitability modulation and electrode drift.

The view must state that removing a visible slow potential does not establish whether its origin
was neural or artifactual.

## 8. Work sequence

### ISF-0 — empirical specification; no signal change

- Register the externally defined bands and wake/NREM reference metrics.
- Register unknown amplitude, depth, delay, REM and drift quantities as absent.
- Freeze the causal architecture and candidate comparison.
- Add the structural I0 probe.

**Exit:** registry fixed point, documentation, I0, tests and the unchanged generator version all
pass.

### ISF-1 — current baseline and temporal candidate sweep — complete

- Measure incidental sub-0.1 Hz aperiodic power before adding anything.
- Implement the three temporal candidates outside `composeState`.
- Compare PSD shape, autocorrelation, period variability and streaming continuity.
- Select one model without assigning physiological amplitude.

**Result.** A 1,250-second linked-mastoid baseline with discrete graphoelements and optional
respiratory EEG paths disabled found that the existing continuous generator already carries
0.49-4.22 uV RMS below 0.1 Hz across states. That voltage is incidental aperiodic/rhythm content,
not a named ISF source. ISF power was 9.7-14.3% of 0.1-1 Hz power; ISF-band effective rank was
4.10-5.00 and median absolute channel correlation 0.259-0.325. The result forbids treating the
new component as though the old spectrum were empty, but supplies no target for its amplitude.

Three normalized families were compared over twenty seeds and ten lower-edge cycles. Every family
was exactly identical under whole-record and arbitrary 1/7/31/2/113/19-sample chunking. After a
common causal band observation stage, all produced broad spectra and irregular ISF1 periods:

| candidate | target-band share | largest-bin share | spectral entropy | ISF1 period p10 / median / p90 |
|---|---:|---:|---:|---:|
| power-law state space | 0.848 | 0.076 | 0.838 | 16.7 / 36.4 / 65.6 s |
| damped-oscillator bank | 0.864 | 0.082 | 0.834 | 20.7 / 42.3 / 75.1 s |
| hybrid weak resonance | 0.890 | 0.080 | 0.838 | 19.0 / 39.9 / 69.9 s |

The accepted family is `band_limited_power_law_state_space`. The other models did not earn their
additional oscillator centres, damping/Q parameters or resonance mixture weight. In particular,
the hybrid placed its median spectral peak at the commonly observed 0.02 Hz, but selecting a
mixture weight to make that happen would turn “commonly observed” into “always generated.” The
accepted family has no physiological amplitude yet. Its exponent and approximation order remain
`absent`; the fixture's exponent one and nine poles were not promoted.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf1_current_baseline.mts` and
`node --experimental-strip-types --no-warnings prep/reference/isf1_temporal_candidates.mts`.

### ISF-2 — BEM source families — complete

- Define cortical patches and regenerate projections.
- Project unit-variance drivers and characterize topographies and covariance.
- Choose the minimal patch family before amplitude fitting.

**Result.** Three broad bilateral Desikan-Killiany families now enter the projection artifact:

- `isf_frontomedial`: superior frontal, rostral middle frontal, anterior cingulate and medial
  orbitofrontal cortex;
- `isf_sensorimotor`: precentral, postcentral and paracentral cortex; and
- `isf_posterior`: calcarine, cuneus, lingual, lateral occipital, precuneus and superior parietal
  cortex.

They use exactly the established fsaverage three-shell BEM and patch-covariance eigenmode path.
No channel topography, channel phase or channel delay was authored. At the existing 0.99 spatial-
variance truncation they retain 6, 7 and 7 modes and contain 3,126, 2,960 and 3,967 fixed-normal
cortical sources respectively. Under independent unit-variance mode drivers and linked-mastoid
referencing, their scalp-power maxima are Fz, C3 and Pz—outputs of anatomy and conduction, not
inputs.

| unit-variance family | effective rank | PC1 variance | median abs correlation |
|---|---:|---:|---:|
| frontomedial | 1.365 | 0.850 | 0.586 |
| sensorimotor | 2.607 | 0.537 | 0.366 |
| posterior | 2.120 | 0.651 | 0.481 |
| equal-variance combination | 3.480 | 0.410 | 0.313 |

The combined values are characterizations, not targets. In particular, their proximity to prior
real-data rank and PC1 summaries does not license equal physiological variance among families.
Reference linearity agrees whether covariance is referenced before or after mode projection to a
maximum absolute residual of `8.9e-16` across unreferenced, linked-mastoid and average-reference
operators.

The conditional lateral-association family remains `absent`. The three-family basis already
provides anterior, central and posterior BEM covariance modes, and no independent external
observation requires a fourth degree of freedom. All cortical RMS, shared variance, delay, state
gain and coupling-depth rows remain absent. The new projection entries are undriven, so generated
samples, truth, export schema and `generator_version = 0.9.0` remain unchanged.

Reproduce:
`.venv311/Scripts/python.exe -m prep.leadfield.make_projection` and
`.venv311/Scripts/python.exe prep/reference/isf2_source_families.py`.

### ISF-3 — power-preserving excitability coupling — complete

- Add independently switchable additive and modulation paths.
- Implement matched mechanism-off and shifted-phase arms.
- Keep respiration independent and verify I4-I5.

**Result.** `src/core/generators/infraslow.ts` implements the selected causal two-band controller
as a serializable 2 Hz state-space process interpolated to EEG sampling rate. Arbitrary whole and
1/7/31/2/113/19-sample chunk sequences are sample-identical, checkpoints survive JSON round trips,
and ISF1 and ISF2 can be independently selected without changing either draw. Stationary variance
is normalized from the linear system's impulse energy, not from generated records.

`composeState` now accepts an explicit `infraSlowFixture` with no defaults. The caller must supply
the still-absent exponent, pole count, ISF1 variance fraction, additive family RMS, modulation
target and log-amplitude depth. Omitting the fixture preserves every default sample and omits
infra-slow truth. When requested:

- additive current drives each retained mode of a named ISF family and reaches electrodes only
  through the BEM projection artifact;
- source-level modulation multiplies a named continuous cortical carrier by
  `g(z) = exp(m z - m²)`, for which `E[g²] = 1` under the unit-Gaussian controller;
- additive-only, modulation-only, both, off and π-inverted-driver arms share identical carriers
  and RNG substreams; and
- optional truth records requested and realized source RMS, ISF1/ISF2 source power, requested
  depth, realized gain RMS and whether the driver was inverted. Unknown sharing, delay and
  preferred phase are represented as `null`, never zero.

The BEM reconstruction test recovers the additive electrode waveform to `1.3e-14 µV`; the two
mechanisms remain additive to `3.2e-14 µV`. Changing the matched respiratory rate from 10 to 20
breaths/min leaves every EEG sample bit-identical while changing the belt. In the independent Pz
recovery probe, LS loading of log 8-12 Hz Hilbert amplitude on the known ISF driver is 0.075 with
the mechanism off, 0.075 with additive voltage alone, 0.357 with modulation, 0.357 with both, and
-0.197 under the π-inverted null. These are fixture diagnostics, not physiological estimates or
gate tolerances.

The modulation gain algebra is registered, while band balance, target map, preferred phase,
amplitudes and depths remain absent. The fixture path is not exposed in the UI or exporter; the
default truth, export schema and `generator_version = 0.9.0` therefore remain unchanged.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf3_mechanism_arms.mts`.

### ISF-4 — external amplitude calibration

- Audit an accessible healthy full-band wake/sleep corpus or obtain the primary study data.
- Require a continuous record spanning `isf_probe_record_length`, an acquisition passband that
  preserves the 0.008 Hz edge, absolute calibrated voltage, and a route that distinguishes
  cortical current from non-cortical full-band potential before fitting additive cortical RMS.
- Fit modulation depth only from raw full-band records under the registered estimator, with held-
  out participants. A published PLV remains a comparator until that estimator mapping exists.
- Keep REM absent unless a REM corpus is acquired.

**Result: HOLD, not a failed fit.** Four primary/public candidates were audited in
`prep/reference/isf4_external_evidence.mts`. Väyrynen et al. supply the right full-band band,
aggregate NREM/wake direction and PAC estimators, but only relative power is published and the raw
records are not public. OpenNeuro ds005385 and ds007987 provide healthy raw wake EEG, but their
continuous runs span only 1.44 and 2.4 cycles at 0.008 Hz; ds007987 also does not state the exact
acquisition high-pass. OpenNeuro ds003768 supplies raw 0-250 Hz W/N1/N2/N3 EEG in 15-minute runs,
but those runs span 7.2 lower-edge cycles and the raw voltage contains simultaneous-MRI gradient
and ballistocardiogram artifacts. The cleaned data used for staging were filtered 0.3-35 Hz.

More fundamentally, none separates projected cortical current from BBB/vascular, respiratory,
skin/electrode and reference contributions. Fitting the BEM source RMS to their total scalp RMS
would silently assert an origin the evidence does not identify. Therefore no physiological value
moves: cortical RMS, source sharing/delay and modulation depth remain `absent`; the published
relative scalp and PAC results remain external comparators. This preserves a usable fixture path
without promoting its values into the released generator.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf4_external_evidence.mts`.

### ISF-5 — optional recording drift — complete

- Add electrode/reference drift outside the BEM.
- Fit only against recording-system data.
- Verify that artifact output cannot satisfy neural gates.

**Result.** `src/core/generators/recording_drift.ts` implements an explicit fixture-only
observation layer with two separable terms: one independent stochastic drift for every generated
lead, and one shared mastoid-reference drift added only to A1/A2. Both reuse the selected broad
causal temporal engine, but the caller must supply its still-absent shape and both amplitudes.
There is no default, UI path or registry provisional.

The location is structural: drift is added directly after cortical composition and sensor noise;
the module imports no projection function and reads no lead-field weight. The ordinary reference
operator determines its consequence. Turning the shared mastoid term on leaves as-generated scalp,
average-reference and Laplacian output bit-identical, while linked-mastoid and contralateral output
gain its negative exactly. Truth reports requested and realized independent-channel and common-
reference RMS separately, with zero cortical source modes and zero modulation targets. A drift-
only record is therefore ineligible for I2-I5 neural gates by construction.

On a deliberately visible 120-second fixture (1 uV independent RMS and 0.7 uV common-reference
RMS, neither physiological), drift effective rank was 9.18 as generated, 3.63 under linked
mastoids and 8.82 under average reference; a posterior cortical ISF fixture was 1.60 under linked
mastoids. A 1 Hz zero-phase high-pass retained 0.0053 of Fz linked-mastoid drift RMS. These values
characterize mechanism and reference behavior only. They do not fit either absent amplitude.

`electrode_dc_drift_rms` remains absent and `reference_dc_drift_rms` is added as a second explicit
absence. Default samples and truth are unchanged, so generator and export schema remain at 0.9.0
and v5.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf5_recording_drift.mts`.

### ISF-6 — full-band interface and release — complete

- Add the overview, filter comparison and truth controls.
- Bump generator and export schema when output/truth changes.
- Run all prior gates plus I0-I7.

**Result.** The release now has a lazy full-band / DC panel with 120, 300 and 600 second
choices. Each request makes one continuous `composeState` record under the current state, seed,
respiratory settings and reference; it does not concatenate or crossfade the live scroll's
90-second presentation buffers. The long trace is anti-aliased to a registered 2 Hz display
rate and directly overlays the DC-retaining arm with the same record after the registered
0.1 Hz comparison high-pass. Both remain on the ordinary fixed µV/mm scale.

The accompanying 0.005-1 Hz spectrum uses a complete-record Hann periodogram instead of the
live filter panel's four-second Welch segments. The UI prints `1 / duration` as the actual
fundamental resolution and warns that zero padding creates plotted bins, not observed cycles;
none of the overview choices is presented as a replacement for the 1250 second I0-I7 probe.

Projected cortical voltage, excitability modulation and electrode/reference drift are shown as
separate causal layers, but their controls fail closed while their RMS/depth rows remain absent.
The fixture implementations stay usable for matched tests without allowing the interface to
promote arbitrary characterization values. The ordinary released signal therefore remains free
of named infra-slow truth. Removing slow voltage with the comparison filter is explicitly not
presented as evidence of origin.

Five display/analysis rows were added to the normative registry. No generator default or export
truth changed, so `generator_version = 0.9.0` and export schema v5 remain correct. D32 and
Finding 48 record the release boundary. Reproduce the integration characterization with
`node --experimental-strip-types --no-warnings prep/reference/isf6_release_integration.mts`.

## 9. Parsimony stop rule

Do not add another source family, resonant peak, stage-specific value or shared physiological
driver merely because one summary metric misses. A new degree of freedom requires:

1. an external observation the current model cannot reproduce;
2. a causal location in the architecture;
3. a matched mechanism-off arm; and
4. a metric not already used to fit that same degree of freedom.

This is the guard against repeating the earlier cycle in which rank, PC1 and inter-channel
correlations were treated as independent targets even though they were summaries of one
covariance matrix.

### ISF-7 — provisional physiological release — complete

The fail-closed interface was revised after review: lack of source identifiability does not mean
the mechanism or every useful scale estimate is absent. The causal voltage and excitability paths
are now enabled by default with explicit pending registry values. Wake/NREM/REM cortical budgets
are 2/3/2 µV aggregate source RMS; REM is labelled as a wake-derived extrapolation. The named
source consumes the existing cortical background variance budget in quadrature, preventing the
new mechanism from becoming an unaccounted amplitude increase.

Coupling is mode-to-mode inside the BEM rather than one global gain. NREM's frontomedial family
modulates its represented canonical rhythms; distributed aperiodic modes, the channel-local
covariance residual and discrete events remain outside this causal path. The aperiodic arm was
rejected because it let background alone pass the AASM slow-wave criterion. A persistent
controller in `SignalStream` keeps ISF samples continuous across 90-second display-buffer changes.

On the registered 1250-second record, the release estimator measures mean PLV 0.169 in wake-EC
against 0.178 published, and 0.205 in N2 against aggregate sleep 0.211. Significant-channel
fractions are 4/19 and 7/19; wake exceeds its published high-density interval and N2 is one
19-channel electrode above the reported 0.05-0.35 sleep range. Both are recorded as disagreements.
Median ISF RMS is 1.24 µV wake-EC and 2.39 µV N2, with N2 frontal median 3.06 µV. Recording drift
remains deferred and fixture-only. Generator 0.10.0 and export schema v6 record the changed
samples and truth.

Reproduce:
`node --experimental-strip-types --no-warnings prep/reference/isf7_release_calibration.mts`.
