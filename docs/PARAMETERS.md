# PARAMETERS.md — the constant registry

> **GENERATED FILE — do not edit.** Source of truth: `registry/parameters.yaml`.
> Regenerate with `npm run registry:emit`; `npm run registry:check` fails the build if
> this file and the registry have drifted apart. See `tools/registry/GRAMMAR.md`.

Generator version `0.1.0` · schema `1`

**Code reads the registry. No numeric constant may appear in source or UI copy that is
absent from it** — a Tier 0 acceptance check. **It is not yet enforced:**
`tools/lint/literals.mjs` does not exist. This document previously asserted that it did.

**States.** `wake_eo` · `wake_ec` · `n1` · `n2` · `n3` · `rem`

## Pinned toolchain

*A class-V claim has no meaning without a pinned tool version.*

| Tool | Version | Gates |
|---|---|---|
| `specparam` | 2.0.0rc7 **(pre-release)** | G1a, G1b |
| `yasa` | 0.7.0 | G3 |
| `mne` | 1.12.1 | — |
| `numpy` | 1.26.4 | — |
| `scipy` | 1.15.3 | — |

## 1. Sampling, display, infrastructure

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `fs` | 256 | Hz | `chosen` | Nyquist for 45 Hz analysis with ample margin. Sampling theory mandates >90 Hz; 256 is our choice among adequate rates. | all |
| `synth_block` | 4096 | samples | `chosen` | FFT efficiency; 16 s at fs=256 | all |
| `synth_overlap` | 1024 | samples | `chosen` | 25% of synth_block; overlap-add region for the cosine crossfade | all |
| `epoch_display` | 30 | s | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — scoring epoch | all |
| `analysis_window` | 30 | s | `chosen` | matches display | all |
| `analysis_update` | 1 | Hz | `chosen` | perceptual | all |
| `n_channels` | 19 | — | `definitional` | International 10-20 system (Jasper 1958), as adopted by IFCN/ACNS | all |
| `reference_channels` | A1/A2 | — | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — contralateral mastoid reference | all |
| `sensor_noise_rms` | 1–2 *(uncertainty)* | uV | `invented` |  | all |
| `export_schema_version` | 1 | — | `chosen` | epoch-directory schema (seam 9) | all |
| `rng_algorithm_ts` | xoshiro128++ | — | `chosen` | 32-bit state, native in typed arrays; see DECISIONS D2 | all |
| `n_seeds` | 20 | — | `chosen` | provisional; to be set from observed variance — power analysis, not circularity | all |

**`fs`.** Re-standed definitional -> chosen on import. Sampling theory constrains fs to exceed 90 Hz; it does not select 256. A convention is not a standard.

**`synth_overlap`.** Added on import. Build Plan 3.2 specifies overlapping blocks with cosine crossfade and the risk register lists streaming discontinuities, but no overlap length was registered.

**`reference_channels`.** Added on import, and load-bearing. A 19-channel 10-20 montage contains no mastoids, but gate_aasm_n3 is referenced to contralateral mastoid and anchors snr_nominal and therefore every absolute uV amplitude in this registry. Without A1/A2 the criterion cannot be computed at all. These are additional to the 19.

**`rng_algorithm_ts`.** Source markdown offered 'xoshiro128++ or PCG32'. An unresolved disjunction is not a value; xoshiro128++ selected so seam 4 is pinned.

## 2. SNR and amplitude calibration

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `snr_nominal` | *solved:* Solve on snr_calibration_seed and snr_calibration_epoch for the mix value at which generated N3 satisfies gate_aasm_n3. | dB | `derived` | One-time calibration; see harness G5 and DECISIONS D5. Calibration and gate are separate steps. | all |
| `snr_range_ui` | -12–12 *(ui_domain)* | dB | `chosen` | sweep range for the control, relative to nominal | all |
| `snr_calibration_seed` | 20260728 | — | `chosen` | fixed named seed, held out of every G5 evaluation | n3 |
| `snr_calibration_epoch` | 0 | — | `chosen` | epoch index within the calibration record | n3 |
| `snr_null_offset` | -6 | dB | `chosen` | -6 dB is a factor-of-two amplitude reduction: a standard engineering convention, deliberately adopted, not an estimate of anything | n3 |

**`snr_nominal`.** Anchors every absolute uV amplitude here. Evaluated on HELD-OUT seeds by G5, reported as a pass fraction. Tuning this until G5 passes would make G5 pass by construction.

**`snr_calibration_seed`.** In the source markdown this row sat in a one-row table separated from its header by a blank line. Every markdown table parser drops it — and it is the row the entire G5 held-out design depends on. Recovered on import.

**`snr_calibration_epoch`.** Added on import. D5 requires a named fixture seed AND epoch; only the seed was registered.

**`snr_null_offset`.** The offset at which generated N3 must FAIL gate_aasm_n3. It appears in Build Plan 9, harness 5 and DECISIONS D5 and was registered in none of them -- a threshold on the arm all three documents say carries the discriminative weight. RE-STANDED invented -> chosen. The runner's preflight refused to start with it as `invented`, correctly: G5's null is failable, its criterion gate_g5_null_ordering is `derived`, and that criterion CONSUMES this number -- so an invented value was being laundered through a derived criterion, which is exactly what harness section 1 prohibits. It is not, however, an empirical estimate that could be fitted: halving the amplitude is a convention chosen for being a substantial but not absurd attenuation. `chosen` is what it always was. The discriminative power of the second null clause is set entirely by this value -- hard at -1 dB, trivial at -20 dB -- so it is declared in the gate's `criterion_inputs` and the report prints its standing.

## 3. Aperiodic background

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `aperiodic_model` | knee form: L(f) = b - log10(k + f^chi) | — | `chosen` | single-knee form | all |
| `chi_direction` | wake flattest < N1 < N2 ~ N3 < REM steepest | — | `literature` | Lendner et al. 2020, *eLife* — NSRR replication, final analytic sample N=10,255 | all |
| `chi_wake_eo` | — *(pending T1-M1; runs on 0.9)* | — | `invented` |  | wake_eo |
| `chi_wake_ec` | — *(pending T1-M1; runs on 1.1)* | — | `invented` |  | wake_ec |
| `chi_n1` | — *(pending T1-M1; runs on 1.4)* | — | `invented` |  | n1 |
| `chi_n2` | — *(pending T1-M1; runs on 1.7)* | — | `invented` |  | n2 |
| `chi_n3` | — *(pending T1-M1; runs on 1.66)* | — | `invented` |  | n3 |
| `chi_rem` | — *(pending T1-M1; runs on 2.1)* | — | `invented` |  | rem |
| `knee_modelled` | the ~20 Hz knee only | — | `chosen` | see DECISIONS D3 | all |
| `knee_freq_low` | 20 | Hz | `invented` | approximate location reported in a 2024 J Neurosci intrinsic-timescales paper; author not recorded, value not read out under a known pipeline | all |
| `knee_freq_high_unmodelled` | 45 | Hz | `invented` | ibid.; documented, NOT generated at any tier | all |
| `knee_present` | REM prominent; wake/N1/N2 attenuated; N3 absent | — | `invented` | ibid.; direction reported, magnitudes not read out | all |
| `knee_freq_wake_eo` | — *(pending T1-M1; runs on 12)* | Hz | `invented` |  | wake_eo |
| `knee_freq_wake_ec` | — *(pending T1-M1; runs on 12)* | Hz | `invented` |  | wake_ec |
| `knee_freq_n1` | — *(pending T1-M1; runs on 12)* | Hz | `invented` |  | n1 |
| `knee_freq_n2` | — *(pending T1-M1; runs on 10)* | Hz | `invented` |  | n2 |
| `knee_freq_n3` | — *(pending T1-M1; runs on 0.5)* | Hz | `invented` |  | n3 |
| `knee_freq_rem` | — *(pending T1-M1; runs on 20)* | Hz | `invented` |  | rem |
| `k_wake_eo` | — *(pending T1-M1; runs on 9.3597)* | — | `invented` |  | wake_eo |
| `k_wake_ec` | — *(pending T1-M1; runs on 15.3851)* | — | `invented` |  | wake_ec |
| `k_n1` | — *(pending T1-M1; runs on 32.423)* | — | `invented` |  | n1 |
| `k_n2` | — *(pending T1-M1; runs on 50.1187)* | — | `invented` |  | n2 |
| `k_n3` | — *(pending T1-M1; runs on 0.3164)* | — | `invented` |  | n3 |
| `k_rem` | — *(pending T1-M1; runs on 539.7131)* | — | `invented` |  | rem |
| `fit_band_broad` | 1–45 *(band_edges)* | Hz | `chosen` | one of eleven bands in use in the literature; ours by choice | all |
| `fit_band_narrow` | 30–45 *(band_edges)* | Hz | `literature` | Lendner et al. 2020, *eLife* | all |

**`chi_direction`.** Deliberately NOT a total order. N2 and N3 are related to REM but not to each other: Build Plan 3.2 records N1-N3 correlate r~0.7 and are poorly separated by slope alone, 7 notes a small N3 reversal, and 10 instructs that a clean monotonic ladder be treated as a bug. A strictly monotone encoding would contradict all three.

**`chi_n1`.** Absent from the source markdown although chi_direction and knee_present both reference N1.

**`knee_freq_low`.** Re-standed literature -> invented on import. A venue and year with no author fails source discipline, and the registry's own rule is to re-stand rather than re-source by guess.

**`knee_freq_high_unmodelled`.** Re-standed literature -> invented, same reason. Registered so the acceptance check can authorize it in copy; nothing generates it.

## 4. Oscillations

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `alpha_band` | 8–12 *(band_edges)* | Hz | `chosen` | conventional band edges; no single standard fixes them | wake_ec, rem |
| `alpha_peak` | 10 | Hz | `invented` | individual peak varies 8-13; no fitted value | wake_ec |
| `alpha_amp` | 20–50 *(uncertainty)* | uV_pp | `invented` | textbook range, not a measurement under a known pipeline | wake_ec |
| `alpha_bandwidth_sharp` | 1 | Hz | `invented` | -3 dB bandwidth of the weakly damped (high-amplitude) alpha mode | wake_ec, rem |
| `alpha_bandwidth_broad` | 6 | Hz | `invented` | -3 dB bandwidth of the strongly damped (low-amplitude) alpha mode | wake_ec, rem |
| `alpha_mode_dwell` | 1.25 | s | `invented` | mean dwell time in each alpha amplitude mode | wake_ec, rem |
| `alpha_burst_dur` | 0.5–2 *(uncertainty)* | s | `invented` | conventional description of posterior alpha runs; uncited | wake_ec, rem |
| `alpha_burst_rate` | 20–30 *(uncertainty)* | 1/min | `invented` | uncited; set from a target duty cycle rather than observed directly | wake_ec, rem |
| `alpha_burst_duty_note` | duty cycle = alpha_burst_dur * alpha_burst_rate / 60; the two rows are not independent | — | `chosen` | records the constraint linking the two burst rows | wake_ec, rem |
| `alpha_interburst_level` | 0.15 | — | `invented` | envelope floor between bursts, as a fraction of burst peak | wake_ec, rem |
| `alpha_shape_triangularity` | 0.45 | — | `invented` | blend from sinusoid (0) toward triangle (1) in the alpha waveform | wake_ec, rem |
| `alpha_shape_rdsym` | 0.42 | — | `invented` | rise-decay symmetry in bycycle's convention: the fraction of the trough-to-trough cycle spent rising | wake_ec, rem |
| `alpha_rem_shift` | -2–-1 *(uncertainty)* | Hz | `invented` | direction well known; magnitude uncited | rem |
| `beta_band` | 15–25 *(band_edges)* | Hz | `chosen` | conventional band edges | wake_eo |
| `beta_amp` | 5–15 *(uncertainty)* | uV_pp | `invented` | textbook range | wake_eo |
| `theta_band` | 4–7 *(band_edges)* | Hz | `chosen` | conventional band edges | n2, rem |
| `theta_amp` | 15–40 *(uncertainty)* | uV_pp | `invented` | textbook range | n2, rem |
| `delta_band` | 0.5–2 *(band_edges)* | Hz | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — slow wave activity band | n3 |
| `delta_amp` | 100–200 *(uncertainty)* | uV_pp | `invented` | textbook range, matching neighbouring so_amp and kc_amp. Explicitly NOT derived from the 75 uV AASM criterion. | n3 |
| `so_freq` | <1 | Hz | `invented` | distinct from the AASM delta band; uncited | n3 |
| `so_amp` | 100–200 *(uncertainty)* | uV_pp | `invented` | uncited | n3 |
| `background_rms_uv` | 15–25 *(uncertainty)* | uV | `invented` | broadband RMS of the aperiodic background | all |
| `amp_pp_to_rms` | 2.828 | — | `invented` | peak-to-peak to RMS for a quasi-sinusoidal rhythm: 2*sqrt(2) | all |
| `osc_carrier_flatten` | 0.75 | — | `invented` | exponent alpha in dividing the carrier by its own smoothed envelope^alpha before imposing burst structure | all |
| `filter_order` | 4 | — | `chosen` | Butterworth bandpass | all |

**`alpha_band`.** Re-standed definitional -> chosen on import: a convention in wide use is not a named standard. Same for beta_band, theta_band.

**`alpha_bandwidth_sharp`.** Damping, not filter width. A damped oscillator's bandwidth IS its damping: r = exp(-pi*B/fs). Narrow means weakly damped, long phase memory, a genuine oscillation; wide means heavily damped and noise-like. One parameter spans both regimes, which is what makes "alpha is a real oscillation, unlike the rest of the signal" expressible rather than asserted.

**`alpha_bandwidth_broad`.** The second mode exists because alpha amplitude is BISTABLE, bursting between high- and low-amplitude states rather than diffusing about one mean (Freyer et al. 2009, 2011; mechanism a subcritical Hopf bifurcation). A single linear mode has a Rayleigh envelope -- measured CV 0.521 against Rayleigh's exact 0.523 -- which is precisely the distribution that finding contradicts. With two modes the measured bimodality coefficient is 0.580, above the 0.555 threshold; with one it is 0.434.

**`alpha_burst_dur`.** SUPERSEDED by the damped-oscillator model (DECISIONS D13). Alpha burst structure now EMERGES from bistable damping rather than being imposed by an envelope, so nothing reads this row. Retained rather than deleted because the burst-envelope machinery still exists for rhythms whose damping is unfitted, and because deleting it would erase the record of why it was tried.

**`alpha_burst_rate`.** SUPERSEDED by DECISIONS D13; nothing reads this row. Rate and duration are not independent: together they fix the DUTY CYCLE, which is the quantity with physiological meaning. At alpha_burst_dur's midpoint of 1.25 s, 20-30/min gives 42-63% — eyes-closed posterior alpha is the dominant rhythm and is present much of the time, so a duty cycle near half is more defensible than the 25% an earlier 8-16/min produced. T1-M1 should fit the duty cycle and one of the two, not all three independently.

**`alpha_interburst_level`.** SUPERSEDED by DECISIONS D13; nothing reads this row. Not zero. Alpha becomes hard to see between bursts rather than provably absent, and a hard-gated envelope would put switching transients into the band -- a spectral artefact manufactured by the realism fix.

**`alpha_shape_triangularity`.** Occipital alpha reads as TRIANGULAR in raw traces -- its extrema are sharper than a sinusoid's rounded ones -- while the sensorimotor mu rhythm is arciform. This project's alpha is posterior (topo_expect_alpha = O1/O2/Pz), so triangular is the right target and mu's arciform shape is not. The VALUE is invented: the shape literature reports log sharpness and steepness ratios per cycle rather than a blend coefficient, so no published number maps onto this parameter directly. T1-M2 must fit it by matching bycycle's rise-decay and peak-trough symmetry against a corpus, not by eye.

**`alpha_shape_rdsym`.** 0.5 is symmetric; below 0.5 is a steeper rise, above is a steeper decay. Stated as the MEASURED QUANTITY rather than as a signed deviation, because the deviation form was got wrong twice in one sitting -- the registry note inverted the formula, and independently the implementation used a phase warp that produced no asymmetry at all while appearing to. A parameter that IS the measurement cannot be misread, and test/oscillations.test.ts pins it against the generated signal. BOTH THE MAGNITUDE AND THE DIRECTION ARE UNFITTED. The shape literature reports log sharpness and steepness ratios per cycle, not rdsym for occipital alpha specifically, and no source consulted gives a direction for posterior alpha. 0.42 is a mild steeper rise, chosen to be visibly non-sinusoidal without asserting a direction the data does not support. T1-M2 fits it against a corpus with bycycle.

**`delta_amp`.** Given a Tier 0 value on import; see Execution-Scheme D10. Left blank, this row and snr_nominal are under-determined by one degree of freedom and the calibration absorbs it, setting delta amplitude from the 75 uV figure through the back door — the exact circularity D5 exists to close, re-entering through the one row D5's prose leaves empty. The AASM number appears in gate_aasm_n3 and nowhere else. UNITS CORRECTED to uV_pp on review: the textbook 100-200 figure for slow waves is peak-to-peak, and it had been placed on a row declared in plain uV. Read as peak it is 200-400 uV p-p, which at snr_null_offset = -6 dB still clears the 75 uV criterion — so G5's null could not have failed, and under D9 that null is G5's only failable arm. D10's claim that fixing this row "makes snr_nominal a genuine single-scalar solve" is FALSE and is withdrawn: so_amp (100-200 uV, so_freq < 1 Hz) also lands inside gate_aasm_n3_band, the aperiodic offset b has no registry row at all, and the interval-to-point reduction rule is unregistered with zero Dv rows in the registry. At least three further degrees of freedom remain. See Execution-Scheme section 7.

**`background_rms_uv`.** Added on measurement. It had been a bare literal (20) inside compose.ts — exactly the hidden constant the acceptance check exists to forbid, in the file that sets the denominator of every SNR in the project. It is also the scale `snr_nominal` is solved against, so it belongs beside the amplitudes rather than in code. NOTE this row is in RMS while every oscillation amplitude is peak-to-peak; the conversion is amp_pp_to_rms.

**`amp_pp_to_rms`.** Added on measurement, and the measurement is worth recording. Feeding the textbook oscillation ranges to the generator AS RMS gave wake_ec an alpha source at 35 uV RMS against a 20 uV background — 1.75x the entire broadband signal — and G1a's recovered chi was +1.22 off the injected value, against -0.03 to +0.11 for the states with no strong oscillation. The generator was correct; the number handed to it was not. Textbook figures for a visible rhythm are peak-to-peak. 2*sqrt(2) is exact for a sinusoid; narrowband filtered noise has a higher crest factor, so this OVERSTATES the RMS somewhat and is marked invented rather than derived. T1-M1 must fit amplitude distributions directly and retire this conversion instead of refining it.

**`osc_carrier_flatten`.** Added on measurement, and it fixes a defect that affects every burst-structured rhythm, not just alpha. Narrowband-filtered noise carries an INTRINSIC Rayleigh envelope whose timescale is set by the bandwidth (~1/B, i.e. 0.25 s for an 8-12 Hz band). Multiplying that carrier by a burst envelope does NOT impose burst structure, because the intrinsic fluctuation survives underneath: measured, imposed 1.25 s bursts still read as 0.25 s runs at 40/min, with a third of the envelope's power above 1 Hz. Dividing by the carrier's own smoothed envelope raised to this exponent suppresses the beat before the burst envelope is applied. 0 leaves it untouched; 1 flattens it completely, which would make the carrier a frequency-modulated near-sinusoid and reintroduce the tell that "never a pure sinusoid" exists to prevent. 0.75 is a compromise picked by eye and marked accordingly. THIS APPLIES TO SPINDLES TOO, where duration is a DEFINITIONAL AASM criterion (spindle_dur_min = 0.5 s) that G3 tests against YASA. A spindle generator whose events read as 0.25 s to a detector would fail G3 for a reason that has nothing to do with spindle morphology.

## 5. Topography and geometry

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `topo_sigma_alpha` | — *(pending T1-M1; runs on 0.35)* | normalized_10_20 | `invented` |  | wake_ec |
| `topo_sigma_beta` | — *(pending T1-M1; runs on 0.4)* | normalized_10_20 | `invented` |  | wake_eo |
| `topo_sigma_theta` | — *(pending T1-M1; runs on 0.4)* | normalized_10_20 | `invented` |  | n2, rem |
| `topo_sigma_delta` | — *(pending T1-M1; runs on 0.45)* | normalized_10_20 | `invented` |  | n3 |
| `topo_sigma_spindle_fast` | — *(pending T1-M1; runs on 0.3)* | normalized_10_20 | `invented` |  | n2 |
| `topo_sigma_spindle_slow` | — *(pending T1-M1; runs on 0.3)* | normalized_10_20 | `invented` |  | n2 |
| `topo_sigma_kc` | — *(pending T1-M1; runs on 0.35)* | normalized_10_20 | `invented` |  | n2 |
| `topo_centre_alpha_x` | 0 | normalized_10_20 | `invented` | posterior centre | wake_ec |
| `topo_centre_alpha_y` | -0.75 | normalized_10_20 | `invented` | posterior centre | wake_ec |
| `topo_centre_beta_x` | 0 | normalized_10_20 | `invented` | frontocentral centre | wake_eo |
| `topo_centre_beta_y` | 0.3 | normalized_10_20 | `invented` | frontocentral centre | wake_eo |
| `topo_centre_theta_x` | 0 | normalized_10_20 | `invented` | central/frontal centre | n2, rem |
| `topo_centre_theta_y` | 0.25 | normalized_10_20 | `invented` | central/frontal centre | n2, rem |
| `topo_centre_delta_x` | 0 | normalized_10_20 | `invented` | frontal centre | n3 |
| `topo_centre_delta_y` | 0.5 | normalized_10_20 | `invented` | frontal centre | n3 |
| `topo_centre_spindle_fast_x` | 0 | normalized_10_20 | `invented` | central-parietal centre | n2 |
| `topo_centre_spindle_fast_y` | -0.15 | normalized_10_20 | `invented` | central-parietal centre | n2 |
| `topo_centre_spindle_slow_x` | 0 | normalized_10_20 | `invented` | frontal centre | n2 |
| `topo_centre_spindle_slow_y` | 0.5 | normalized_10_20 | `invented` | frontal centre | n2 |
| `topo_centre_kc_x` | 0 | normalized_10_20 | `invented` | frontal centre | n2 |
| `topo_centre_kc_y` | 0.5 | normalized_10_20 | `invented` | frontal centre | n2 |
| `ap_axis_span` | 180 | mm | `invented` | anterior-posterior extent used for the travel delay in 3.5 | n3 |
| `so_travel_v` | 1–7 *(uncertainty)* | m/s | `literature` | Massimini et al. 2004, *J Neurosci* | n3 |
| `topo_expect_spindle_fast` | C3/C4/Cz | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — central maximum for fast spindles | n2 |
| `topo_expect_spindle_slow` | F3/Fz/F4 | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — frontal maximum for slow spindles | n2 |
| `topo_expect_kc` | Fz/F3/F4 | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — K-complex frontal maximum | n2 |
| `topo_expect_alpha` | O1/O2/Pz | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — posterior dominant rhythm, occipital maximum | wake_ec |
| `so_travel_v_used` | 3 | m/s | `chosen` | point value drawn from the so_travel_v literature interval 1-7 m/s | n3 |

**`topo_expect_alpha`.** Re-sourced on import, not re-standed. In the source markdown this row read 'clinical convention (posterior dominant rhythm)' — naming neither author/year nor standard, which the registry's own discipline calls a contradiction on its face. It is the row G6 reads and D6 built the gate around its independence, so the violation sat on the load-bearing path. AASM does define the posterior dominant rhythm, so the standard is nameable and the literature standing survives.

**`so_travel_v_used`.** so_travel_v is a literature INTERVAL (Massimini et al. 2004, 1-7 m/s); the generator needs a point. Registered separately rather than silently taking a midpoint inside the code, so the reduction is visible and can be replaced by a per-event draw once Dv rows exist. At 3 m/s across ap_axis_span = 180 mm the frontal-to-occipital delay is 60 ms, which is what makes the wave visibly sweep.

## 6. Graphoelements

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `spindle_band` | 11–16 *(band_edges)* | Hz | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — sleep spindle frequency | n2, n3 |
| `spindle_dur_min` | 0.5 | s | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — minimum spindle duration | n2 |
| `spindle_amp` | 20–60 *(uncertainty)* | uV_pp | `invented` | textbook range | n2 |
| `spindle_rate` | 2–5 *(uncertainty)* | 1/min | `invented` | uncited | n2, n3 |
| `spindle_fast_freq` | 13–15 *(uncertainty)* | Hz | `invented` | uncited; central-parietal | n2 |
| `spindle_slow_freq` | 11–13 *(uncertainty)* | Hz | `invented` | uncited; frontal | n2 |
| `kc_amp` | 100–200 *(uncertainty)* | uV_pp | `invented` | textbook range | n2 |
| `kc_dur_min` | 0.5 | s | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — minimum K-complex duration | n2 |
| `kc_rate` | 1–3 *(uncertainty)* | 1/min | `invented` | uncited | n2 |
| `kc_sharp_width` | 0.09 | s | `invented` | Gaussian width of the K-complex's sharp negative component | n2 |
| `kc_slow_width` | 0.2 | s | `invented` | Gaussian width of the K-complex's slower positive component | n2 |
| `kc_slow_ratio` | 0.55 | — | `invented` | amplitude of the positive component relative to the negative one | n2 |
| `so_rdsym` | 0.4 | — | `invented` | rise-decay symmetry of the slow oscillation, bycycle convention | n3 |
| `so_spindle_pref_phase` | — *(pending T1-M1; runs on 0)* | rad | `invented` |  | n3 |
| `so_spindle_strength` | — *(pending T1-M1; runs on 0.6)* | — | `invented` |  | n3 |

**`spindle_rate`.** States extended to N3 on import: DECISIONS/Build-Plan 4.1 parameterize SO-spindle coupling for N3 (so_spindle_pref_phase, so_spindle_strength) but spindle_rate existed only for N2, leaving the N3 spindle generator with no rate.

**`kc_sharp_width`.** The K-complex is modelled as a difference of Gaussians: an earlier, larger, narrower NEGATIVE component followed by a later, smaller, broader positive one. Written in standard polarity, so the sharp component is negative here and renders upward under the negative-up display convention. Applying the convention in the generator as well would invert twice and silently restore the wrong sign.

**`so_rdsym`.** Build Plan 4.1 states the slow oscillation "is emphatically non-sinusoidal", and PAC estimation has hard requirements around exactly that -- phase filters must be moderately narrow-band ESPECIALLY for non-sinusoidal rhythms. A symmetric SO would understate the confound the SO-spindle coupling demonstration exists to expose, in the same way a symmetric alpha did. Same convention as alpha_shape_rdsym: 0.5 symmetric, below 0.5 a steeper rise. Magnitude and direction both unfitted.

## 7. Respiration and coupling

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `resp_rate_wake` | 12–18 *(uncertainty)* | 1/min | `invented` | uncited | wake_eo, wake_ec |
| `resp_rate_n2` | 12–15 *(uncertainty)* | 1/min | `invented` | uncited | n2 |
| `resp_rate_n3` | 12–15 *(uncertainty)* | 1/min | `invented` | uncited; most regular | n3 |
| `resp_rate_rem` | 10–22 *(uncertainty)* | 1/min | `invented` | irregularity is well established; magnitude uncited | rem |
| `resp_ie_ratio` | 1.5–2 *(uncertainty)* | — | `invented` | expiration:inspiration duration ratio; uncited | all |
| `resp_pause_fraction` | 0.15 | — | `invented` | fraction of the breath period spent in inhalation and exhalation pauses | all |
| `resp_period_cv` | — *(pending T1-M1; runs on 0.08)* | — | `invented` |  | all |
| `chi_mod_depth` | — *(pending T1-M1; runs on 0.15)* | — | `invented` | Kluger et al. 2023 Fig. 2 reports this but the value has not been read out | all |
| `chi_mod_phase_wake` | slope decreases in late inspiration, increases in late expiration | rad | `invented` | 2025 respiratory-excitability study, N=23; author not recorded | wake_eo, wake_ec, n1 |
| `chi_mod_phi0_wake` | — *(pending T1-M1; runs on 3.14159265358979)* | rad | `invented` |  | wake_eo, wake_ec, n1 |
| `chi_mod_phi0_sleep` | — *(pending T1-M1; runs on 0)* | rad | `invented` |  | n2, n3, rem |
| `chi_mod_phase_sleep` | reversed relative to wake, from N2 onward | rad | `invented` | ibid.; author not recorded | n2, n3, rem |
| `alpha_mod_depth` | — *(pending T1-M1; runs on 0.1)* | — | `invented` | Kluger & Gross 2021 — not yet read out | all |
| `nasal_oral_factor` | — *(pending T1-M1; runs on 0.3)* | — | `invented` | Zelano et al. 2016 shows attenuation; magnitude unread | all |
| `tilt_n_poles` | 12 | — | `derived` | Measured: 4 cascaded log-spaced pole-zero pairs per decade over 0.1-115 Hz gives peak-to-peak ripple of ~15% of delta-chi across 1-45 Hz, and relative ripple is depth-independent. 1/decade gives ~100%; 8/decade gives ~10% for double the sections. See docs/Tier0-Estimator-Probe.md Finding 4. | all |
| `tilt_pole_spacing` | logarithmic, 4 pole-zero pairs per decade across 0.1-115 Hz (1 decade of pad either side of the 1-45 Hz band) | — | `chosen` | a first-order shelf cannot give uniform slope change across the band | all |
| `tilt_mod_settling_ratio` | — *(absent)* | — | `absent` | The chosen interpolation scheme is the one whose G4 f2 coupling sits below the surrogate null. Compared as a documented experiment at T0-M4. | all |

**`resp_rate_rem`.** Source markdown gave the English word 'variable', which is not machine-readable. Widened interval plus resp_period_cv carries the irregularity.

**`resp_ie_ratio`.** Source markdown wrote '1:1.5 - 1:2'. Normalized to a numeric ratio.

**`resp_pause_fraction`.** NeuroKit2's breathmetrics model interpolates inhalation and exhalation pauses, and the Build Plan says to transcribe it rather than reinvent it. NeuroKit2 is not a dependency here, so this implements the published description instead and the pause fraction is invented. TODO(T1): validate against neurokit2.rsp_simulate directly -- the risk register's mitigation for rebuilding solved generators is "transcribe, cite, validate against the originals", and the third step is not done.

**`chi_mod_depth`.** Routed to T1-M1 but the source names a specific figure — reading it out is an afternoon, not 8 days of corpus work. Flagged for early conversion to literature.

**`chi_mod_phase_wake`.** Re-standed literature -> invented: venue-less, author-less. Also note the value is a sentence with units 'rad' — 5.2's formula needs a number for phi_0, supplied by chi_mod_phi0_wake.

**`chi_mod_phi0_wake`.** Added on import: 5.2 states a formula requiring a numeric phi_0 per state, and no row supplied one.

**`tilt_n_poles`.** Resolves pending decision P2. MUST be realized as second-order sections: direct-form transfer-function realization of this cascade overflows to non-finite values at this order (Finding 3). The PSD exponent is -2g where zeros sit at pole * D^g; pin that sign with a unit test, because it is the sign that silently inverts the wake/sleep reversal.

**`tilt_mod_settling_ratio`.** Resolves pending decision P3 by showing it is not answerable as posed. Build both interpolation schemes behind one interface and let G4 choose.

## 9. Artifacts

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `blink_dur` | 0.2–0.4 *(uncertainty)* | s | `invented` | uncited | wake_eo, wake_ec |
| `blink_amp` | 100–400 *(uncertainty)* | uV | `invented` | uncited; frontopolar max | wake_eo, wake_ec |
| `blink_rate` | 10–20 *(uncertainty)* | 1/min | `invented` | uncited | wake_eo |
| `emg_band` | >20 | Hz | `invented` | uncited | wake_eo, wake_ec |
| `emg_amp_wake` | 5–20 *(uncertainty)* | uV | `invented` | uncited | wake_eo, wake_ec |
| `emg_rem_level` | 0.05 | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — REM atonia staging criterion | rem |
| `line_freq` | 50 or 60 | Hz | `chosen` | regional mains; selected by deployment, not by a standard this project cites | all |
| `line_amp` | 1–10 *(uncertainty)* | uV | `invented` | uncited | all |
| `notch_q` | 30 | — | `chosen` | notch filter quality factor | all |

**`blink_rate`.** Added on import; the blink generator needs a rate and none was registered.

**`emg_amp_wake`.** Added on import.

**`emg_rem_level`.** Source markdown gave 'near zero', which is not machine-readable. Encoded as a fraction of emg_amp_wake.

**`line_freq`.** Re-standed definitional -> chosen: 'regional mains' names no standard.

**`line_amp`.** Added on import.

**`notch_q`.** Added on import.

## 10. Filter and analysis controls

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `hpf_options` | 0.01 or 0.1 or 0.5 or 1 | Hz | `chosen` | spans clinical and ERP practice | all |
| `welch_nperseg` | 1024 | samples | `chosen` | 4 s at fs=256; 0.25 Hz resolution | all |
| `welch_noverlap` | 512 | samples | `chosen` | 50% overlap | all |
| `welch_window` | hann | — | `chosen` |  | all |
| `specparam_peak_width_limits` | 1–12 *(band_edges)* | Hz | `chosen` | specparam algorithm_settings; in 2.0 these moved out of the constructor | all |
| `specparam_max_n_peaks` | 6 | — | `chosen` | specparam algorithm_settings | all |
| `specparam_peak_threshold` | 2 | — | `chosen` | specparam algorithm_settings, in SD | all |
| `lz_band` | 1–45 *(band_edges)* | Hz | `chosen` | bandpass applied before the Hilbert transform | all |
| `lz_channel_order` | montage order as declared in data/montage_10_20.json; column-wise concatenation | — | `chosen` | the parse result depends on concatenation order, so it must be pinned | all |
| `lz_binarize` | binarize around the median of the Hilbert amplitude | — | `chosen` | method described in a 2024 eNeuro slope-versus-LZc comparison; author not recorded | all |
| `lz_surrogate` | time_shuffled | — | `chosen` | DECISIONS D1. Destroys the spectrum, so surrogate complexity depends only on length and density — chi-dependence is zero by construction, caching is legal, no characterization needed. | all |
| `lz_parse` | — *(absent)* | — | `absent` | Decide by which parse the landmark literature used. Settle before citing any published value. | all |

**`welch_nperseg`.** Added on import. 7 mandates a Welch PSD and 8 budgets 5.0 ms per second for it, but no Welch settings were registered — and they determine recovered chi as much as band and mode do.

**`welch_noverlap`.** Added on import.

**`welch_window`.** Added on import.

**`specparam_peak_width_limits`.** Added on import. Seam 7's premise is that an exponent is a (value, band, mode) tuple, but the fit settings shape the recovered value too and were registered nowhere.

**`specparam_max_n_peaks`.** Added on import.

**`specparam_peak_threshold`.** Added on import.

**`lz_band`.** Added on import.

**`lz_channel_order`.** Added on import.

**`lz_binarize`.** Re-standed literature -> chosen on import, and mis-standed twice over: a binarization procedure is a method, not a value or range, and the source named a venue and year with no author.

**`lz_surrogate`.** Normalizes against 'same density, no structure'. The UI must state that null beside the LZc readout.

**`lz_parse`.** Pending decision P1. Standing was EMPTY in the source markdown, which no enum can represent.

## 11. G4 — off-frequency null parameters

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `g4_record_length` | 300 | s | `chosen` | 1/T ~ 0.0033 Hz; the live 30 s window is too coarse to separate f1 from the sidebands | all |
| `g4_f1` | 0.1 | Hz | `chosen` | chi modulation frequency | all |
| `g4_f2` | 0.25 | Hz | `chosen` | respiration frequency | all |
| `g4_min_bin_separation` | ≥10 | bins | `chosen` | f1, f2 and the sidebands f2+-f1 must all be separated by at least this many bins. At 300 s: f1-f2 = 45 bins; f1 to the nearest sideband (0.15 Hz) = 15 bins | all |
| `g4_n_surrogates` | 200 | — | `chosen` | circular shifts of the respiration phase reference — f2 arm only | all |
| `g4_percentile_level` | 95 | percent | `chosen` | the percentile LEVEL is a convention — 99 would serve as well | all |
| `g4_threshold_value` | *solved:* The coupling index at g4_percentile_level of the null distribution, computed per run. | — | `derived` | f1 arm: percentile over the spectral neighbourhood, excluding f2 and the sidebands f2+-f1 plus the g4_min_bin_separation guard band. f2 arm: percentile over the circular-shift surrogate distribution. | all |
| `g4_f1_neighbourhood_halfwidth` | 60 | bins | `chosen` | half-width of the spectral neighbourhood used for the f1 arm's null, at 1/T = 0.0033 Hz | all |

**`g4_percentile_level`.** Split from g4_percentile on import. The level and the threshold value at that level have different standings; as one derived row the UI renders the level read-only and the report prints the wrong threshold standing for the gate whose provenance matters most.

**`g4_threshold_value`.** The two arms take DIFFERENT nulls; see Execution-Scheme D8. A circular shift of a clean phase ramp multiplies an alignment-magnitude index by a unit-magnitude constant, so on the f1 arm the null is a point mass at the observed value and the gate can never pass — measured, with zero IQR. The f2 arm's circular-shift null is sound and is retained.

**`g4_f1_neighbourhood_halfwidth`.** Added on import to support D8's f1 null. Must exceed g4_min_bin_separation by enough to give a usable sample after the guard bands are excised.

## 12. Gate criteria

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `gate_aasm_n3_min_fraction` | 0.2 | — | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — N3 requires >=20% of the epoch occupied by slow wave activity | n3 |
| `gate_aasm_n3_min_amp` | 75 | uV_pp | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — slow wave amplitude >=75 uV peak-to-peak | n3 |
| `gate_aasm_n3_band` | 0.5–2 *(band_edges)* | Hz | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — slow wave activity band | n3 |
| `gate_aasm_n3_reference` | referenced to contralateral mastoid (reference_channels) | — | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — derivation reference | n3 |
| `gate_g5_null_ordering` | pass_fraction(N3 @ snr_nominal) > pass_fraction(N2) AND > pass_fraction(N3 @ snr_nominal + snr_null_offset) | — | `derived` | A strict ordering needs no invented threshold. See Execution-Scheme D9. | n2, n3 |
| `gate_g4_criterion` | coupling index exceeds g4_threshold_value at f1 (spectral-neighbourhood null) and does not at f2 (circular-shift null) | — | `derived` | from the null distributions; see Execution-Scheme D8 | all |
| `gate_g4_seed_aggregation` | exact binomial test of the observed f2 exceedance count against the per-seed false-exceedance rate implied by g4_percentile_level | — | `derived` | estimator property: a correctly-sized null exceeds its own percentile at the complementary rate by construction | all |
| `gate_topography` | argmax over electrodes matches the topo_expect_* rows | — | `derived` | structural — no tolerance required; expectations are literature and independent of the projection file | all |
| `gate_determinism` | bit-identical, within-platform and within-version only | — | `chosen` | This project's definition of determinism. No external standard fixes it. | all |
| `gate_chi_tol_knee` | — *(absent)* | — | `absent` | T1-M2 estimator characterization | all |
| `gate_chi_tol_fixed` | — *(absent)* | — | `absent` | T1-M2 estimator characterization | all |
| `gate_spindle_f1` | — *(absent)* | — | `absent` | T1 sets the criterion by roll-off shape against MODA's per-event agreement counts | n2 |
| `gate_alpha_ratio` | >3 | — | `invented` |  | wake_ec |
| `gate_pac_tol` | — *(absent)* | deg | `absent` | Derive the required event count from the target precision, or gate on resultant length rather than preferred phase. Tier 1. | n3 |
| `gate_coupling_depth_tol` | — *(absent)* | — | `absent` | Characterize SPRiNT's transfer function first. T1-M2. | all |
| `gate_hpf_loss` | — *(absent)* | — | `absent` | T1-M2 | all |

**`gate_aasm_n3_min_fraction`.** Split from gate_aasm_n3 on import, which hid four separately-typed constants in one prose cell. The acceptance check could not authorize any of them, so the linter would have had to flag the project's single definitional threshold as a magic number or exempt the file wholesale.

**`gate_aasm_n3_min_amp`.** THE AASM NUMBER APPEARS HERE AND NOWHERE ELSE. delta_amp must not be set from it — that would generate N3 to satisfy the check meant to test it.

**`gate_aasm_n3_reference`.** Evaluating under average reference gives a different number and would silently miscalibrate everything downstream.

**`gate_g5_null_ordering`.** G5's positive arm is RECORD-ONLY: it reports a pass fraction with no threshold, because any threshold on that fraction would be invented or read from our own generator's spread, both prohibited. The null carries the verdict — which D5 already says carries the discriminative weight.

**`gate_g4_seed_aggregation`.** Added on import. The spec never stated how per-seed results aggregate to a verdict, and 'all seeds must pass' fails ~64% of the time at n_seeds=20 on a working generator (0.95^20 = 0.36), because the f2 arm has a 5% per-seed false-exceedance rate BY DESIGN.

**`gate_determinism`.** Build Plan 9 groups G2 with the record-only gates, but bit-identity has no distribution to record and a determinism gate that cannot fail is worthless. It is also the root of the dependency graph. Canonically PASS/FAIL; see Execution-Scheme section 1. RE-STANDED definitional -> chosen on review. It had been sourced to "IEEE 754 binary64", which defines float64 representation and arithmetic but says nothing about one seed producing identical output -- that is a property of OUR implementation and its draw ordering, which is exactly why the Build Plan strikes any cross-implementation clause. That was a re-sourcing by guess, the remedy this registry's own discipline forbids, and it sat on the criterion of a failable gate. No numeric tolerance is invented here, so `chosen` is adequate for a structural criterion -- as it is for gate_topography.

**`gate_chi_tol_knee`.** The source markdown expected G1a's error to EXCEED G1b's. Measured on clean aperiodic signal the ordering is reversed by two orders of magnitude: G1a median |error| 0.005, G1b 0.417. See Tier0-Estimator-Probe Finding 2. Re-measure under the full generator before amending DECISIONS D3.

**`gate_chi_tol_fixed`.** G1b's bias is STRUCTURAL: measured error 0.417 against an analytic prediction of 0.429 from the generative form itself. It comes from our modelled 20 Hz knee, not from the literature's unmodelled 45 Hz one, so its magnitude is a function of the invented k_* rows. That is a weaker claim than DECISIONS D3's comparability argument.

**`gate_alpha_ratio`.** RECORDED, NOT A PASS CRITERION, until T1-M2. G6 uses structural argmax instead.

**`gate_pac_tol`.** Encoded as absent rather than as an invented value of 15, so that no code path can read a number the registry's own note declares impossible. A registry able to hold a refuted value with no machine-readable refutation is one import away from using it.

## Standing tally

*`invented` rows are the Tier 1 work plan. `chosen` rows are deliberately not.*

| Standing | Rows |
|---|---|
| `definitional` | 11 |
| `chosen` | 43 |
| `literature` | 8 |
| `derived` | 7 |
| `invented` | 96 |
| `absent` | 8 |
| **total** | **173** |
