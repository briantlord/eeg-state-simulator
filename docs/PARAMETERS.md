# PARAMETERS.md — the constant registry

> **GENERATED FILE — do not edit.** Source of truth: `registry/parameters.yaml`.
> Regenerate with `npm run registry:emit`; `npm run registry:check` fails the build if
> this file and the registry have drifted apart. See `tools/registry/GRAMMAR.md`.

Generator version `0.11.0` · schema `1`

**Code reads the registry. No scientific constant may appear in source or UI copy that
is absent from it** — a Tier 0 acceptance check, **enforced by `tools/lint/literals.mjs`**
in `npm run verify`. A sourced constant is a string key, not a number, so any numeric
literal is unsourced by construction; the linter allowlists arithmetic furniture and
requires an inline `@lit-ok <reason>` (or whole-file `@lit-ok-file`) waiver for the rest.

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
| `display_sensitivity` | 7 | uV/mm | `chosen` | clinical EEG convention; 7 uV/mm is a common routine sensitivity | all |
| `display_cal_pulse_amp` | 50 | uV | `chosen` | height of the calibration pulse drawn beside the traces | all |
| `display_px_per_mm` | 3.8 | px/mm | `chosen` | assumed CSS pixel density, so the uV/mm figure means something on screen | all |
| `render_decimation` | min_max | — | `chosen` | one min/max pair per pixel column | all |
| `display_sensitivity_options` | 3 or 5 or 7 or 10 or 15 or 20 or 30 or 50 | uV/mm | `chosen` | sensitivity steps offered by the control; clinical machines step similarly | all |
| `display_window_options` | 5 or 10 or 15 or 30 or 60 | s | `chosen` | time-base steps offered by the control; 30 s is the AASM epoch and the default | all |
| `display_buffer_s` | 90 | s | `chosen` | length of the live streaming buffer the display scrolls through | all |
| `export_schema_version` | 7 | — | `chosen` | epoch-directory schema (seam 9) | all |
| `rng_algorithm_ts` | xoshiro128++ | — | `chosen` | 32-bit state, native in typed arrays; see DECISIONS D2 | all |
| `n_seeds` | 20 | — | `chosen` | provisional; to be set from observed variance — power analysis, not circularity | all |

**`fs`.** Re-standed definitional -> chosen on import. Sampling theory constrains fs to exceed 90 Hz; it does not select 256. A convention is not a standard.

**`synth_overlap`.** Added on import. Build Plan 3.2 specifies overlapping blocks with cosine crossfade and the risk register lists streaming discontinuities, but no overlap length was registered.

**`reference_channels`.** Added on import, and load-bearing. A 19-channel 10-20 montage contains no mastoids, but gate_aasm_n3 is referenced to contralateral mastoid and anchors snr_nominal and therefore every absolute uV amplitude in this registry. Without A1/A2 the criterion cannot be computed at all. These are additional to the 19.

**`display_sensitivity`.** FIXED. The display never autoscales: "the amplitude difference between N3 delta and waking alpha is one of the most important facts on screen", and autoscaling would make every state the same height silently.

**`display_cal_pulse_amp`.** Without a calibration bar, "fixed uV/mm" is an unverifiable claim. With one, the trace can be measured against a bar of stated height -- which is what the paper chart this display imitates was for.

**`display_px_per_mm`.** A browser cannot know the physical size of a display, so uV/mm is a claim about an ASSUMED density. Stated rather than hidden: at a different density the sensitivity annotation is wrong by that ratio, and a reader measuring the calibration bar with a ruler would find it.

**`render_decimation`.** Min/max per pixel column preserves the ENVELOPE: a spike narrower than one column still reaches the top of that column. Naive subsampling would drop it entirely, which on an artifact whose subject is graphoelements would be a silent lie.

**`display_sensitivity_options`.** Changing sensitivity is NOT autoscaling. The scale is always stated and always the same for every channel and every state, so the amplitude difference between N3 delta and waking alpha survives; the reader is choosing a ruler, not having one chosen for them per epoch.

**`display_buffer_s`.** "Real-time generation is not in question. Do not architect around synthesis cost; the streaming buffer exists for CONTINUITY, not throughput." 90 s at 256 Hz over 21 channels is ~39 MB, which is the cost of keeping a scroll-back window in memory rather than regenerating on every frame.

**`export_schema_version`.** v2 added the complete aperiodic component mixture. v3 added respiratory aperiodic phase/loading and periodic band modulation. v4 added respiratory event-hazard configuration and realized event-marker phases. v5 adds realized breath morphology, variability, RR/HRV/RSA, and circular event-phase summaries; legacy primary fields remain for older readers.

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
| `chi_inband_slope` | DERIVED, NOT STORED. The least-squares log-log slope of the generative aperiodic form L(f) = b - log10(k + f^chi) over chi_inband_band, with k = knee_freq_state ** chi_state. Computed by prep/reference/t1m1_chi_knee_fit.py; deliberately not a stored value, because a stored copy of a quantity computed from two other rows can only drift from them. | — | `derived` | LS log-log slope of L(f) = b - log10(k + f^chi) over chi_inband_band. The form is specparam's knee-mode aperiodic model and identical to Build Plan 3.2's. | all |
| `chi_inband_band` | 1–20 *(band_edges)* | Hz | `derived` | The only band in which the reference corpus is usable. PhysioNet EEGMAT carries an acquisition low-pass around 30-45 Hz: local slope 6.7 over 20-30 Hz, a 50 Hz mains notch and a flat instrument floor above 80 Hz, so a fit above ~20 Hz measures their filter and not their cortex. See compare_real.py. | all |
| `chi_direction` | wake flattest < N1 < N2 ~ N3 < REM steepest | — | `literature` | Lendner et al. 2020, *eLife* — NSRR replication, final analytic sample N=10,255 | all |
| `chi_wake_eo` | — *(pending T1-M1; runs on 0.9)* | — | `invented` |  | wake_eo |
| `chi_wake_ec` | — *(pending T1-M1; runs on 0.85)* | — | `derived` | Swept as a SOURCE parameter and chosen by the OUTPUT it produces, not assigned from a measurement: the generated signal is passed through the same pipeline the reference recordings went through (19 channels, average reference, knee-mode specparam over 1-20 Hz) and the source pair whose output matches is kept. Assigning the measured value directly was tried first and was wrong by a factor of ~1.85, because the registry stores a source exponent while the corpus reports a property of a referenced, spatially mixed scalp signal. See Finding 22; prep/reference/t1m1_chi_invert.py. | wake_ec |
| `chi_n1` | — *(pending T1-M1; runs on 1.4)* | — | `invented` |  | n1 |
| `chi_n2` | — *(pending T1-M1; runs on 1.9)* | — | `invented` |  | n2 |
| `chi_n3` | — *(pending T1-M1; runs on 3.4)* | — | `invented` |  | n3 |
| `chi_rem` | — *(pending T1-M1; runs on 2.1)* | — | `invented` |  | rem |
| `knee_modelled` | the ~20 Hz knee only | — | `chosen` | see DECISIONS D3 | all |
| `knee_freq_low` | 20 | Hz | `invented` | approximate location reported in a 2024 J Neurosci intrinsic-timescales paper; author not recorded, value not read out under a known pipeline | all |
| `knee_freq_high_unmodelled` | 45 | Hz | `invented` | ibid.; documented, NOT generated at any tier | all |
| `knee_present` | REM prominent; wake/N1/N2 attenuated; N3 absent | — | `invented` | ibid.; direction reported, magnitudes not read out | all |
| `knee_freq_wake_eo` | — *(pending T1-M1; runs on 12)* | Hz | `invented` |  | wake_eo |
| `knee_freq_wake_ec` | — *(pending T1-M1; runs on 3)* | Hz | `invented` |  | wake_ec |
| `knee_freq_n1` | — *(pending T1-M1; runs on 12)* | Hz | `invented` |  | n1 |
| `knee_freq_n2` | — *(pending T1-M1; runs on 1)* | Hz | `invented` |  | n2 |
| `knee_freq_n3` | — *(pending T1-M1; runs on 1)* | Hz | `invented` |  | n3 |
| `knee_freq_rem` | — *(pending T1-M1; runs on 20)* | Hz | `invented` |  | rem |
| `k_wake_eo` | — *(pending T1-M1; runs on 9.3597)* | — | `invented` |  | wake_eo |
| `k_wake_ec` | — *(pending T1-M1; runs on 2.5442)* | — | `invented` |  | wake_ec |
| `k_n1` | — *(pending T1-M1; runs on 32.423)* | — | `invented` |  | n1 |
| `k_n2` | — *(pending T1-M1; runs on 1)* | — | `invented` |  | n2 |
| `k_n3` | — *(pending T1-M1; runs on 1)* | — | `invented` |  | n3 |
| `k_rem` | — *(pending T1-M1; runs on 539.7131)* | — | `invented` |  | rem |
| `fit_band_broad` | 1–45 *(band_edges)* | Hz | `chosen` | one of eleven bands in use in the literature; ours by choice | all |
| `fit_band_narrow` | 30–45 *(band_edges)* | Hz | `literature` | Lendner et al. 2020, *eLife* | all |
| `background_fast_fraction_n3` | — *(pending T1-M1; runs on 0.2)* | — | `invented` | source variance share obtained by output-side inversion; it is not a directly observed physiological fraction | n3 |
| `background_fast_knee_n3` | — *(pending T1-M1; runs on 8)* | Hz | `invented` | source timescale obtained by output-side inversion; HMC constrains the resulting scalp-spectrum knee, not this source knee directly | n3 |

**`chi_inband_slope`.** THE QUANTITY A READER MEASURES, which is not the quantity `chi_*` stores. `chi_*` is the ASYMPTOTIC exponent: the slope the spectrum approaches far above the knee. Any fit over a finite band that contains or sits below the knee returns something shallower, because below a knee the spectrum is flat. THE GAP IS LARGE AND WAS UNRECORDED. chi_wake_ec at its old 1.1 with a 12 Hz knee predicts an in-band slope of 0.303 over 1-20 Hz; the generator measured 0.31, agreeing with its own parameters exactly. It was compared against a real 0.99 and read as a threefold generator error for three sessions. It was two different quantities. Build Plan 3.7 warned that a published exponent is a joint function of method, band, knee model, reference and acquisition; the warning was written and then compared across anyway. NO STATE ORDERING MAY BE CLAIMED FROM THIS QUANTITY. See chi_direction.

**`chi_inband_band`.** A CORPUS PROPERTY, not a choice about EEG. Change the corpus and this changes with it, which is why chi_inband_slope is derived rather than stored: the derived quantity is only meaningful beside the band it was derived over.

**`chi_direction`.** Deliberately NOT a total order. N2 and N3 are related to REM but not to each other: Build Plan 3.2 records N1-N3 correlate r~0.7 and are poorly separated by slope alone, 7 notes a small N3 reversal, and 10 instructs that a clean monotonic ladder be treated as a bug. A strictly monotone encoding would contradict all three. MEASURED AGAINST 19 SCORED HMC NIGHTS, and two parts of this order do not survive in the quantity a reader gets: wake 0.83 < n1 1.37 < rem 1.95 < n2 2.08 < n3 2.59 over 1-30 Hz. N3 is registered BELOW N2 on 7's small reversal, and measures the STEEPEST of all five stages at both fit bands. REM is registered steepest and measures third. REM IS NOT REFUTED BY THIS, because this corpus cannot test it: chi_rem cites Lendner et al. 2020, whose result is a 30-45 Hz slope, and HMC's acquisition low-pass makes that band unusable -- a fit there measures the filter. See Finding 23. In any case no state ordering may be claimed from a band-limited slope; see chi_inband_slope.

**`chi_wake_ec`.** THE FIRST QUANTITY IN THIS PROJECT CONFIRMED RATHER THAN FITTED, which is why this row is `derived` and not `invented`. It was solved against PhysioNet EEGMAT -- 8 subjects, 19 channels, average reference, resting wake -- and then measured independently on 19 scored HMC nights, 4 derivations, contralateral mastoid, a different population: 0.83 [IQR 0.65-1.25] over 1-30 Hz and 0.82 over 1-40, against this row's 0.85 (Finding 23). Different corpus, montage, reference and population, agreeing to two decimal places. IT REMAINS `pending`, because the value that agrees is a provisional and the milestone that would promote it has not run. `derived` describes how it was obtained; `pending` describes what may be read from it. The two are not the same claim. THE KNEE IS THE WEAK HALF OF THE PAIR. knee_freq_wake_ec is solved by the same inversion, but Finding 23 measured NO detectable knee in waking HMC spectra at all -- every subject returned a negative knee parameter over 1-30 Hz, which makes knee_freq complex. Nothing corroborates that row.

**`chi_n1`.** Absent from the source markdown although chi_direction and knee_present both reference N1.

**`knee_freq_low`.** Re-standed literature -> invented on import. A venue and year with no author fails source discipline, and the registry's own rule is to re-stand rather than re-source by guess.

**`knee_freq_high_unmodelled`.** Re-standed literature -> invented, same reason. Registered so the acceptance check can authorize it in copy; nothing generates it.

**`background_fast_fraction_n3`.** Variance share, not amplitude share. Independent components receive sqrt(1-q) and sqrt(q) RMS scaling, preserving total aperiodic variance.

**`background_fast_knee_n3`.** Uses chi_n3 rather than adding another exponent. The two components differ only in correlation timescale and independent realization; they share the same lead-field modes.

## 4. Oscillations

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `alpha_band` | 8–12 *(band_edges)* | Hz | `chosen` | conventional band edges; no single standard fixes them | wake_ec, rem |
| `alpha_peak` | 10 | Hz | `invented` | individual peak varies 8-13; no fitted value | wake_ec |
| `alpha_amp` | 10.29–25.71 *(uncertainty)* | uV_pp | `invented` | textbook range, not a measurement under a known pipeline | wake_ec |
| `alpha_bandwidth_sharp` | — *(pending T1-M1; runs on 0.7)* | Hz | `invented` | -3 dB bandwidth of the weakly damped (high-amplitude) alpha mode | wake_ec, rem |
| `alpha_bandwidth_broad` | — *(pending T1-M1; runs on 8)* | Hz | `invented` | -3 dB bandwidth of the strongly damped (low-amplitude) alpha mode | wake_ec, rem |
| `alpha_mode_dwell` | — *(pending T1-M1; runs on 4)* | s | `invented` | mean dwell time in each alpha amplitude mode | wake_ec, rem |
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
| `delta_amp` | — *(pending T1-M1; runs on 50)* | uV_pp | `invented` | output-side HMC fit; explicitly not derived from the 75 uV AASM criterion | n3 |
| `so_freq` | <1 | Hz | `invented` | distinct from the AASM delta band; uncited | n3 |
| `so_rate` | — *(pending T1-M1; runs on 9)* | 1/min | `invented` | the source scheduler rate is not the same quantity as detector events per channel-minute; it is obtained by output-side inversion | n3 |
| `so_amp` | 100–200 *(uncertainty)* | uV_pp | `invented` | uncited | n3 |
| `background_rms_uv` | 6–10 *(uncertainty)* | uV | `invented` | broadband RMS of the aperiodic background | all |
| `background_gain_n3` | — *(pending T1-M1; runs on 1.9)* | — | `invented` | state-specific aperiodic level required after delta_amp stopped carrying the entire N3 amplitude | n3 |
| `amp_pp_to_rms` | 2.828 | — | `invented` | peak-to-peak to RMS for a quasi-sinusoidal rhythm: 2*sqrt(2) | all |
| `osc_carrier_flatten` | 0.75 | — | `invented` | exponent alpha in dividing the carrier by its own smoothed envelope^alpha before imposing burst structure | all |
| `filter_order` | 4 | — | `chosen` | Butterworth bandpass | all |

**`alpha_band`.** Re-standed definitional -> chosen on import: a convention in wide use is not a named standard. Same for beta_band, theta_band.

**`alpha_bandwidth_sharp`.** Damping, not filter width. A damped oscillator's bandwidth IS its damping: r = exp(-pi*B/fs). Narrow means weakly damped, long phase memory, a genuine oscillation; wide means heavily damped and noise-like. One parameter spans both regimes, which is what makes "alpha is a real oscillation, unlike the rest of the signal" expressible rather than asserted.

**`alpha_bandwidth_broad`.** The second mode exists because alpha amplitude is BISTABLE, bursting between high- and low-amplitude states rather than diffusing about one mean (Freyer et al. 2009, 2011; mechanism a subcritical Hopf bifurcation). A single linear mode has a Rayleigh envelope -- measured CV 0.521 against Rayleigh's exact 0.523 -- which is precisely the distribution that finding contradicts. In the matched output comparison the retained two-mode fit gives a bimodality coefficient of 0.528 against 0.549 in EEGMAT; this is a distributional comparison, not a thresholded claim that every record is bimodal.

**`alpha_burst_dur`.** SUPERSEDED by the damped-oscillator model (DECISIONS D13). Alpha burst structure now EMERGES from bistable damping rather than being imposed by an envelope, so nothing reads this row. Retained rather than deleted because the burst-envelope machinery still exists for rhythms whose damping is unfitted, and because deleting it would erase the record of why it was tried.

**`alpha_burst_rate`.** SUPERSEDED by DECISIONS D13; nothing reads this row. Rate and duration are not independent: together they fix the DUTY CYCLE, which is the quantity with physiological meaning. At alpha_burst_dur's midpoint of 1.25 s, 20-30/min gives 42-63% — eyes-closed posterior alpha is the dominant rhythm and is present much of the time, so a duty cycle near half is more defensible than the 25% an earlier 8-16/min produced. T1-M1 should fit the duty cycle and one of the two, not all three independently.

**`alpha_interburst_level`.** SUPERSEDED by DECISIONS D13; nothing reads this row. Not zero. Alpha becomes hard to see between bursts rather than provably absent, and a hard-gated envelope would put switching transients into the band -- a spectral artefact manufactured by the realism fix.

**`alpha_shape_triangularity`.** Occipital alpha reads as TRIANGULAR in raw traces -- its extrema are sharper than a sinusoid's rounded ones -- while the sensorimotor mu rhythm is arciform. This project's alpha is posterior (topo_expect_alpha = O1/O2/Pz), so triangular is the right target and mu's arciform shape is not. The VALUE is invented: the shape literature reports log sharpness and steepness ratios per cycle rather than a blend coefficient, so no published number maps onto this parameter directly. T1-M2 must fit it by matching bycycle's rise-decay and peak-trough symmetry against a corpus, not by eye.

**`alpha_shape_rdsym`.** 0.5 is symmetric; below 0.5 is a steeper rise, above is a steeper decay. Stated as the MEASURED QUANTITY rather than as a signed deviation, because the deviation form was got wrong twice in one sitting -- the registry note inverted the formula, and independently the implementation used a phase warp that produced no asymmetry at all while appearing to. A parameter that IS the measurement cannot be misread, and test/oscillations.test.ts pins it against the generated signal. BOTH THE MAGNITUDE AND THE DIRECTION ARE UNFITTED. The shape literature reports log sharpness and steepness ratios per cycle, not rdsym for occipital alpha specifically, and no source consulted gives a direction for posterior alpha. 0.42 is a mild steeper rise, chosen to be visibly non-sinusoidal without asserting a direction the data does not support. T1-M2 fits it against a corpus with bycycle.

**`delta_amp`.** Given a Tier 0 value on import; see Execution-Scheme D10. Left blank, this row and snr_nominal are under-determined by one degree of freedom and the calibration absorbs it, setting delta amplitude from the 75 uV figure through the back door — the exact circularity D5 exists to close, re-entering through the one row D5's prose leaves empty. The AASM number appears in gate_aasm_n3 and nowhere else. UNITS CORRECTED to uV_pp on review: the textbook 100-200 figure for slow waves is peak-to-peak, and it had been placed on a row declared in plain uV. Read as peak it is 200-400 uV p-p, which at snr_null_offset = -6 dB still clears the 75 uV criterion — so G5's null could not have failed, and under D9 that null is G5's only failable arm. D10's claim that fixing this row "makes snr_nominal a genuine single-scalar solve" is FALSE and is withdrawn: so_amp (100-200 uV, so_freq < 1 Hz) also lands inside gate_aasm_n3_band, the aperiodic offset b has no registry row at all, and the interval-to-point reduction rule is unregistered with zero Dv rows in the registry. At least three further degrees of freedom remain. See Execution-Scheme section 7. Finding 34 supersedes the invented 100-200 range with a 50 uV_pp continuous-delta source fitted jointly with discrete slow-wave rate against HMC, independently of G5.

**`background_rms_uv`.** Added on measurement. It had been a bare literal (20) inside compose.ts — exactly the hidden constant the acceptance check exists to forbid, in the file that sets the denominator of every SNR in the project. It is also the scale `snr_nominal` is solved against, so it belongs beside the amplitudes rather than in code. NOTE this row is in RMS while every oscillation amplitude is peak-to-peak; the conversion is amp_pp_to_rms.

**`background_gain_n3`.** Multiplies the complete N3 aperiodic background after spatial mixing and unit-RMS temporal modulation; does not scale spindles or slow-oscillation event morphology. Finding 35 subsequently added the fast-timescale component: the held-out G5 fraction moved to 0.083 but remains inside the real HMC IQR 0.039-0.364, so this gain was not circularly retuned.

**`amp_pp_to_rms`.** Added on measurement, and the measurement is worth recording. Feeding the textbook oscillation ranges to the generator AS RMS gave wake_ec an alpha source at 35 uV RMS against a 20 uV background — 1.75x the entire broadband signal — and G1a's recovered chi was +1.22 off the injected value, against -0.03 to +0.11 for the states with no strong oscillation. The generator was correct; the number handed to it was not. Textbook figures for a visible rhythm are peak-to-peak. 2*sqrt(2) is exact for a sinusoid; narrowband filtered noise has a higher crest factor, so this OVERSTATES the RMS somewhat and is marked invented rather than derived. T1-M1 must fit amplitude distributions directly and retire this conversion instead of refining it.

**`osc_carrier_flatten`.** Added on measurement, and it fixes a defect that affects every burst-structured rhythm, not just alpha. Narrowband-filtered noise carries an INTRINSIC Rayleigh envelope whose timescale is set by the bandwidth (~1/B, i.e. 0.25 s for an 8-12 Hz band). Multiplying that carrier by a burst envelope does NOT impose burst structure, because the intrinsic fluctuation survives underneath: measured, imposed 1.25 s bursts still read as 0.25 s runs at 40/min, with a third of the envelope's power above 1 Hz. Dividing by the carrier's own smoothed envelope raised to this exponent suppresses the beat before the burst envelope is applied. 0 leaves it untouched; 1 flattens it completely, which would make the carrier a frequency-modulated near-sinusoid and reintroduce the tell that "never a pure sinusoid" exists to prevent. 0.75 is a compromise picked by eye and marked accordingly. THIS APPLIES TO SPINDLES TOO, where duration is a DEFINITIONAL AASM criterion (spindle_dur_min = 0.5 s) that G3 tests against YASA. A spindle generator whose events read as 0.25 s to a detector would fail G3 for a reason that has nothing to do with spindle morphology.

## 5. Topography and geometry

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `event_topography_spread` | — *(pending T1-M1; runs on 0.5)* | — | `invented` | no source consulted quantifies how much slow-wave or spindle topography varies event to event at 10-20 resolution | n2, n3 |
| `topo_centre_resp_artifact_x` | 0 | normalized_10_20 | `invented` | midline by symmetry: the chest is not lateralised | all |
| `topo_centre_resp_artifact_y` | 0.55 | normalized_10_20 | `invented` | frontal: the artifact is largest where the leads run and where frontal electrodes sit furthest from the reference | all |
| `topo_sigma_resp_artifact` | 0.9 | normalized_10_20 | `invented` | broad: a mechanical artifact is not focal, and nothing measured constrains the width | all |
| `bem_source_mindist_mm` | 5 | mm | `chosen` | MNE's default exclusion distance between a source and the inner skull surface; kept rather than chosen independently, because departing from a forward-modelling package's default is a claim needing its own justification | all |
| `coupling_lag_ms` | 20 | ms | `chosen` | inside the documented cortico-cortical conduction range; the demonstration's value is that the lag is KNOWN, not that it is typical of any particular pathway | all |
| `coupling_strength` | 0.6 | — | `chosen` | fraction of the target's variance carried by the delayed driver; chosen high enough to be visible and below 1 so the target keeps independent variance | all |
| `coupling_amp` | 10–30 *(uncertainty)* | uV_pp | `invented` | amplitude of the injected coupled pair; nothing constrains it because the pair is a demonstration rather than a modelled rhythm | all |
| `cortical_coherence_mm` | — *(pending T1-M1; runs on 40)* | mm | `invented` | no source consulted gives a cortical coherence length for a specific rhythm at this resolution; it is the ONE spatial shape parameter left after the lead field replaced 31 | all |
| `patch_mode_variance` | 0.99 | — | `chosen` | how much of a patch's spatial variance the retained eigenmodes must carry; a truncation tolerance, not a physical quantity | all |
| `channel_local_share` | — *(pending T1-M1; runs on 0.2)* | — | `invented` | an independent-EQUIVALENT share under this model, not a measured physiological quantity; part of it is certainly model mismatch | all |
| `background_envelope_depth` | — *(pending T1-M1; runs on 0.35)* | — | `invented` | the mechanism is generic stochastic gain modulation; this depth is an output-side fit awaiting the completed sweep | all |
| `background_envelope_rate` | 0.1 | Hz | `chosen` | sets changes on a several-second scale resolved by the two-second temporal-texture benchmark | all |
| `ap_axis_span` | 180 | mm | `invented` | anterior-posterior extent used for the travel delay in 3.5 | n3 |
| `so_travel_v` | 1–7 *(uncertainty)* | m/s | `literature` | Massimini et al. 2004, *J Neurosci* | n3 |
| `topo_expect_spindle_fast` | C3/C4/Cz | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — central maximum for fast spindles | n2 |
| `topo_expect_spindle_slow` | F3/Fz/F4 | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — frontal maximum for slow spindles | n2 |
| `topo_expect_kc` | Fz/F3/F4 | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — K-complex frontal maximum | n2 |
| `topo_expect_alpha` | O1/O2/Pz | — | `literature` | AASM Manual for the Scoring of Sleep and Associated Events — posterior dominant rhythm, occipital maximum | wake_ec |
| `so_travel_v_used` | 3 | m/s | `chosen` | point value drawn from the so_travel_v literature interval 1-7 m/s | n3 |

**`event_topography_spread`.** EVERY SLOW WAVE USED TO HAVE THE SAME TOPOGRAPHY, and in N3 that is most of the signal -- visible at a 5 s window as one large wave repeated in all 19 lanes, worth 0.21 of effective rank. Real slow waves originate at varying cortical sites, so the events should differ. A patch's channel covariance is sum_m w_m w_m^T over its eigenmodes, so drawing c_m ~ N(0,1) and forming sum_m c_m w_m samples an anatomically admissible field for that patch. Doing exactly that, however, varies each event's amplitude at any FIXED electrode a great deal, and the AASM criterion is measured at one derivation: G5's positive arm fell from 0.75 to 0.33 of held-out epochs. Real N3 meets that criterion by definition, so an unconstrained draw makes N3 less like N3, not more. This row keeps the dominant mode at full strength and admixes the higher ones: every event is recognisably the patch's field, and they differ. At 0 the behaviour is exactly the single fixed topography this replaced, which makes the cost of the variability measurable rather than assumed. IT TRADES AGAINST G5 AND MUST NOT BE FITTED TO IT. The trade is reported in Finding 21.

**`topo_centre_resp_artifact_x`.** THE ONE TOPOGRAPHY THAT IS DELIBERATELY NOT CORTICAL. Mechanism (a) is mechanical -- electrode movement and impedance change with the chest -- so a cortical forward model is the wrong instrument for it and it keeps an electrode-space Gaussian. THESE THREE ROWS BRIEFLY LEFT THE REGISTRY AND THAT WAS A DEFECT. When the projection producer moved from tools/make_projection.mjs to prep/leadfield/make_projection.py they became a Python constant, because tools/lint/literals.mjs only scans .ts and .mjs -- the guard that exists to catch exactly this was switched off by the migration that needed it. The linter now covers the producer.

**`topo_centre_resp_artifact_y`.** See topo_centre_resp_artifact_x. Deliberately unlike any neural generator's centre, because Build Plan 5.1 requires the three respiratory mechanisms stay separable -- if the artifact shared a topography with a rhythm, no montage could tell them apart.

**`topo_sigma_resp_artifact`.** See topo_centre_resp_artifact_x. Wide compared with any cortical patch, which is the point: a movement artifact spreads across the montage rather than peaking over a generator.

**`bem_source_mindist_mm`.** Sources closer than this to the inner skull are dropped from the forward solution. It is a NUMERICAL SAFEGUARD, not a physiological statement: the BEM potential diverges as a dipole approaches a conductivity boundary, so nearby sources would otherwise dominate every topography with an artefact of the discretisation. FOUND BY THE LINTER, not by review. It was an inline 5.0 in the producer, and it is a modelling parameter that shapes every weight vector in data/projection_10_20.json -- the only unregistered scientific value the new Python coverage turned up, which is the argument for that coverage existing.

**`coupling_lag_ms`.** THE LAG OF AN INJECTED, SPECIFIABLE CONNECTION -- not a claim about the brain. Every source in this generator is projected instantaneously, so all inter-channel coupling is zero-lag volume conduction and debiased wPLI correctly reports almost nothing (Finding 25). That makes the connectivity panel unfalsifiable: a blank dwPLI map could mean the measure is rejecting volume conduction, or that it never shows anything. This row supplies the positive control. One patch drives another at a known lag and known strength, so dwPLI has something real to find and a reader can see it separate the true connection from the volume-conducted fakes coherence reports everywhere. IT IS THE FIELD'S STANDARD DESIGN, not an invention here: a two-source model with a time-delayed linear influence of one on the other is what the connectivity-benchmarking literature uses precisely because the ground truth is exact and specifiable. Results from it are comparable with published method comparisons. OFF BY DEFAULT, like mains interference, and for the same reason -- it is an injection, not physiology. Enabled, it perturbs no existing draw: the coupled pair is additional signal.

**`coupling_strength`.** The target's signal is c * driver(t - lag) + sqrt(1 - c^2) * independent, so the target's total variance is unchanged by c and only its SHARED fraction moves. At 0 the two patches are independent and dwPLI between them should fall to chance -- which is the matched null for the coupling gate, and the reason the row is a fraction rather than a gain.

**`coupling_amp`.** Sized to sit within the montage rather than dominate it. It is deliberately NOT fitted against a corpus: the injected pair is a positive control whose value is that its parameters are known, and fitting it to real data would make it a claim about brains instead.

**`cortical_coherence_mm`.** THE ONLY REMAINING FREE PARAMETER OF THE SPATIAL MODEL, and that is the point of D19. It sets the source covariance inside a patch, C_s(i,j) = exp(-d(i,j)/this), so it decides how many spatial eigenmodes a patch has and therefore how many dimensions a rhythm occupies. At 0 every dipole is independent and the patch spans as many modes as the montage can resolve; at infinity the patch collapses to one mode and the model is separable again -- which is the defect Finding 19 measured. Distances are Euclidean rather than geodesic, which makes coherence slightly too high across a sulcus. Registered as a known approximation, not silently.

**`patch_mode_variance`.** Sets how many modes each patch contributes: enough to carry this fraction of its covariance trace. It is a numerical tolerance and belongs to the file format rather than to the head -- raising it adds modes that carry almost no variance, lowering it discards real structure. NOT a knob for tuning effective rank. Rank is a PREDICTION of the forward model under D19, and adjusting this until the rank matched would restore exactly the circularity D19 forbids.

**`channel_local_share`.** REAL EEG IS LESS SPATIALLY CORRELATED THAN A LEAD FIELD PREDICTS, and nothing in the source model can produce that. Coherence between sources only ever RAISES inter-channel correlation; only signal that is independent per electrode lowers it. Measured under average reference: the parameter-free lead field gives near-pair 0.553 and far-pair 0.376 against a real 0.413 and 0.257, and a 0.20 independent share brings them to 0.403 and 0.302 -- mean relative error 0.125 against 0.250 for the 31-row Gaussian mixture it replaces (Finding 20). NOT AMPLIFIER NOISE. `sensor_noise_rms` is 1.5 uV against a 20 uV background, 0.56% of variance. This is the non-neural signal a real scalp recording carries independently at each site: local muscle tone, skin potential, electrode drift, contact impedance. IT CARRIES THE BACKGROUND'S APERIODIC EXPONENT rather than being white. White noise at 20% of variance would flatten the measured spectrum and move chi, turning a spatial fix into a spectral defect. HONESTY ABOUT THE NUMBER: it is what the montage needs given fsaverage as a template head, a 2-D near/far split, and a white-cortex source model. Some of it is model mismatch rather than scalp physiology, and it must not be cited as the latter.

**`background_envelope_depth`.** A bounded multiplier on the entire distributed aperiodic background, normalized to unit RMS. It adds waxing and waning without changing average background power or lead-field weights. Finding 32 found generated two-second band-power CV only 0.56-0.73x the real HMC median in wake_ec, N1, N2 and REM. One shared depth is intentionally more parsimonious than a separate intermittency parameter for every state and band.

**`background_envelope_rate`.** Envelope corner, not a physiological oscillation; the depth carries the fitted effect size.

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
| `spindle_fast_fraction` | — *(pending T1-M1; runs on 0.2)* | — | `invented` | the four HMC derivations preferentially detect central fast spindles, so the source mixture must be solved through the detector | n2, n3 |
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
| `resp_rate_wake` | 16.8 | 1/min | `literature` | Gutierrez et al. 2016, *Physiological Reports* | wake_eo, wake_ec |
| `resp_rate_n1` | 15.7 | 1/min | `literature` | Gutierrez et al. 2016, *Physiological Reports* | n1 |
| `resp_rate_n2` | 15.5 | 1/min | `literature` | Gutierrez et al. 2016, *Physiological Reports* | n2 |
| `resp_rate_n3` | 15.9 | 1/min | `literature` | Gutierrez et al. 2016, *Physiological Reports* | n3 |
| `resp_rate_rem` | 15.2 | 1/min | `literature` | Gutierrez et al. 2016, *Physiological Reports* | rem |
| `resp_subject_rate_cv` | — *(pending T1-M1; runs on 0.143)* | — | `invented` | the source reports cross-sectional spread, while the controller needs a stable subject effect | all |
| `resp_ie_ratio` | 1.5–2 *(uncertainty)* | — | `invented` | expiration:inspiration duration ratio; uncited | all |
| `resp_ie_ratio_cv` | — *(pending T1-M1; runs on 0.1)* | — | `invented` | uncalibrated morphology variability | all |
| `resp_inhale_pause_probability` | 0.3 | — | `chosen` | Noto et al. 2018, *BreathMetrics reference implementation* | all |
| `resp_exhale_pause_probability` | 0.3 | — | `chosen` | Noto et al. 2018, *BreathMetrics reference implementation* | all |
| `resp_pause_duration_s` | 0.2 | s | `chosen` | Noto et al. 2018, *BreathMetrics reference implementation* | all |
| `resp_period_cv_wake` | — *(pending T1-M1; runs on 0.16)* | — | `invented` | state ordering is reported, exact CV not read out | wake_eo, wake_ec |
| `resp_period_cv_n1` | — *(pending T1-M1; runs on 0.1)* | — | `invented` | exact CV not read out | n1 |
| `resp_period_cv_n2` | — *(pending T1-M1; runs on 0.08)* | — | `invented` | exact CV not read out | n2 |
| `resp_period_cv_n3` | — *(pending T1-M1; runs on 0.06)* | — | `invented` | exact CV not read out | n3 |
| `resp_period_cv_rem` | — *(pending T1-M1; runs on 0.14)* | — | `invented` | exact CV not read out | rem |
| `resp_fast_tau_breaths` | — *(pending T1-M1; runs on 2)* | breaths | `invented` | AR(1) reduction of reported short-timescale structure | all |
| `resp_slow_tau_s` | — *(pending T1-M1; runs on 120)* | s | `invented` | model reduction of a broad reported range | all |
| `resp_fast_variance_fraction` | — *(pending T1-M1; runs on 0.55)* | — | `invented` | uncalibrated latent variance allocation | all |
| `resp_slow_fraction_wake` | — *(pending T1-M1; runs on 0.25)* | — | `invented` | direction externally reported; magnitude provisional | wake_eo, wake_ec |
| `resp_slow_fraction_n1` | — *(pending T1-M1; runs on 0.1)* | — | `invented` | magnitude provisional | n1 |
| `resp_slow_fraction_nrem` | — *(pending T1-M1; runs on 0.03)* | — | `invented` | direction reported by Rostig and Zschocke; magnitude provisional | n2, n3 |
| `resp_slow_fraction_rem` | — *(pending T1-M1; runs on 0.3)* | — | `invented` | direction reported by Rostig and Zschocke; magnitude provisional | rem |
| `resp_depth_cv_wake` | — *(pending T1-M1; runs on 0.2)* | — | `invented` | uncalibrated belt-depth variability | wake_eo, wake_ec |
| `resp_depth_cv_n1` | — *(pending T1-M1; runs on 0.16)* | — | `invented` | uncalibrated belt-depth variability | n1 |
| `resp_depth_cv_n2` | — *(pending T1-M1; runs on 0.12)* | — | `invented` | uncalibrated belt-depth variability | n2 |
| `resp_depth_cv_n3` | — *(pending T1-M1; runs on 0.08)* | — | `invented` | uncalibrated belt-depth variability | n3 |
| `resp_depth_cv_rem` | — *(pending T1-M1; runs on 0.22)* | — | `invented` | uncalibrated belt-depth variability | rem |
| `resp_depth_timing_correlation` | — *(pending T1-M1; runs on 0.35)* | — | `invented` | uncalibrated latent coupling | all |
| `resp_artifact_amp` | 5–25 *(uncertainty)* | uV | `invented` | amplitude of the mechanical respiratory movement artifact; uncited | all |
| `resp_amp_mod_depth` | — *(pending T1-M1; runs on 0.35)* | — | `invented` | Kluger & Gross 2021 report respiration modulates band amplitude; depth not read out | all |
| `chi_mod_depth` | — *(pending T1-M1; runs on 0.15)* | — | `invented` | Kluger et al. 2023 Fig. 2 reports this but the value has not been read out | all |
| `chi_mod_phi0_wake` | 2.99 | rad | `literature` | Sánchez Corzo et al. 2026, *Progress in Neurobiology 256:102857* | wake_eo, wake_ec |
| `chi_mod_phi0_n1` | -2.7 | rad | `literature` | Sánchez Corzo et al. 2026, *Progress in Neurobiology 256:102857* | n1 |
| `chi_mod_phi0_n2` | -1.33 | rad | `literature` | Sánchez Corzo et al. 2026, *Progress in Neurobiology 256:102857* | n2 |
| `chi_mod_phi0_n3` | -1.78 | rad | `literature` | Sánchez Corzo et al. 2026, *Progress in Neurobiology 256:102857* | n3 |
| `chi_mod_phi0_rem` | -1.45 | rad | `literature` | Sánchez Corzo et al. 2026, *Progress in Neurobiology 256:102857* | rem |
| `periodic_mod_phi0_low` | 3.14159265358979 | rad | `derived` | Kluger & Gross 2021 report low-frequency amplitude highest at the beginning/end of a peak-inspiration-centred cycle and lowest at peak inspiration; the cosine encoding therefore peaks at pi. | all |
| `periodic_mod_phi0_high` | 0 | rad | `derived` | Kluger & Gross 2021 report that the high-frequency temporal modulation pattern reverses the low-frequency pattern; the cosine encoding therefore peaks at peak inspiration, phase zero. | all |
| `periodic_mod_depth_high` | — *(pending T1-M1; runs on 0.1)* | — | `invented` | Kluger & Gross 2021 establish high-band modulation but the magnitude has not been converted to this log-amplitude parameter | all |
| `resp_so_pref_phase` | -0.164060949687467 | rad | `literature` | Schreiner et al. 2023, *Nature Communications 14:8351* | n3 |
| `resp_so_resultant_length` | 0.51 | — | `literature` | Schreiner et al. 2023, *Nature Communications 14:8351* | n3 |
| `resp_so_hazard_kappa` | 1.1910453273513 | — | `derived` | Unique non-negative solution of I1(kappa)/I0(kappa) = resp_so_resultant_length for a von Mises event hazard. | n3 |
| `resp_spindle_fast_pref_phase` | 0.295833308213039 | rad | `literature` | Schreiner et al. 2023, *Nature Communications 14:8351* | n2, n3 |
| `resp_spindle_fast_resultant_length` | 0.52 | — | `literature` | Schreiner et al. 2023, *Nature Communications 14:8351* | n2, n3 |
| `resp_spindle_fast_hazard_kappa` | 1.22349789246669 | — | `derived` | Unique non-negative solution of I1(kappa)/I0(kappa) = resp_spindle_fast_resultant_length for a von Mises event hazard. | n2, n3 |
| `resp_spindle_slow_hazard` | — *(absent)* | — | `absent` | Schreiner et al. 2023, *Nature Communications 14:8351, Supplementary Figure 3* | n2, n3 |
| `nasal_oral_factor` | — *(pending T1-M1; runs on 0.3)* | — | `invented` | Zelano et al. 2016 shows attenuation; magnitude unread | all |
| `tilt_n_poles` | 12 | — | `derived` | Measured: 4 cascaded log-spaced pole-zero pairs per decade over 0.1-115 Hz gives peak-to-peak ripple of ~15% of delta-chi across 1-45 Hz, and relative ripple is depth-independent. 1/decade gives ~100%; 8/decade gives ~10% for double the sections. See docs/Tier0-Estimator-Probe.md Finding 4. | all |
| `tilt_pole_spacing` | logarithmic, 4 pole-zero pairs per decade across 0.1-115 Hz (1 decade of pad either side of the 1-45 Hz band) | — | `chosen` | a first-order shelf cannot give uniform slope change across the band | all |
| `tilt_mod_settling_ratio` | — *(absent)* | — | `absent` | The chosen interpolation scheme is the one whose G4 f2 coupling sits below the surrogate null. Compared as a documented experiment at T0-M4. | all |

**`resp_rate_wake`.** Mean spontaneous respiratory rate in 38 adults with AHI < 5; reported SD 2.4/min. The same wake mean is used for eyes open and closed because the study did not separate them.

**`resp_rate_n1`.** Group mean; reported SD 2.8/min.

**`resp_rate_n2`.** Group mean; reported SD 2.2/min.

**`resp_rate_n3`.** Group mean; reported SD 2.4/min. N3 is more regular, not necessarily slower than every other NREM stage.

**`resp_rate_rem`.** Group mean; reported SD 3.0/min. REM irregularity belongs in breath timing, not in a widened mean-rate interval.

**`resp_ie_ratio`.** Source markdown wrote '1:1.5 - 1:2'. Normalized to a numeric ratio.

**`resp_inhale_pause_probability`.** Matches the reference implementation default. It is an interoperability choice, not a claim that every healthy cohort has this pause frequency.

**`resp_exhale_pause_probability`.** Matches the reference implementation default. It is an interoperability choice, not a claim that every healthy cohort has this pause frequency.

**`resp_pause_duration_s`.** Matches the reference implementation's average inhale- and exhale-pause length. This establishes feature parity with that simulator, not a universal physiological mean.

**`resp_artifact_amp`.** Build Plan 5.1(a): "Respiratory movement artifact. Mechanical, at the respiratory rate. GENUINE ARTIFACT; high-passing it out is correct." This is the mechanism a clinical high-pass actually destroys, and its absence is why the filter demonstration showed 93% -> 91% across the whole cutoff range (Finding 10). It sits AT the respiratory rate, i.e. below every hpf_options cutoff except 0.01 Hz, so a 0.5-1 Hz high-pass removes it essentially completely. That is the filter working correctly, and it is half the lesson: high-pass filtering trades a known artifact for a known distortion.

**`resp_amp_mod_depth`.** Low-frequency PERIODIC-power coupling, distinct from the aperiodic-exponent path. R3 replaces the old linear 1 + d*cos gain with exp(m*cos)/sqrt(I0(2m)), so this row is the log-amplitude concentration m and each breath preserves mean squared rhythm amplitude by construction. The phase course is periodic_mod_phi0_low; breath depth scales the realized value. A clinical high-pass does not remove this coupling because it removes carriers in its stopband, not the respiratory sidebands around a passed rhythm. Its absolute magnitude remains pending and must not be promoted from generated recovery. See Findings 10 and 39.

**`chi_mod_depth`.** Routed to T1-M1 but the source names a specific figure — reading it out is an afternoon, not 8 days of corpus work. Flagged for early conversion to literature.

**`chi_mod_phi0_wake`.** Group mean direction of maximum 1/f slope, 171.09 degrees, under the paper's phase convention: peak inspiration = 0, inspiration -pi..0, expiration 0..pi.

**`chi_mod_phi0_n1`.** Group mean direction -154.60 degrees; N1 remains wake-like.

**`chi_mod_phi0_n2`.** Group mean direction -76.43 degrees; the phase reversal begins in N2.

**`chi_mod_phi0_n3`.** Published as SWS; group mean direction -102.14 degrees.

**`chi_mod_phi0_rem`.** Group mean direction -83.33 degrees.

**`periodic_mod_phi0_low`.** The source is awake resting MEG. Applying this temporal form to sleep is an explicit provisional generalization, not a literature claim about sleep-stage magnitude.

**`periodic_mod_phi0_high`.** Periodic and aperiodic phase courses are deliberately separate, as directly demonstrated by Kluger et al. 2023.

**`resp_so_pref_phase`.** Mean respiratory phase of SO downstates across significant electrodes: -9.4 degrees, with peak inspiration at zero. The study pooled NREM; the generator applies SO events only in N3.

**`resp_so_resultant_length`.** Mean vector length reported for the preferred SO respiratory phase across significant electrodes. Used as the target of the event-level von Mises prefix; that translation is a modelling assumption.

**`resp_spindle_fast_pref_phase`.** Mean respiratory phase of fast-spindle onsets across significant electrodes: +16.95 degrees after peak inspiration. The paper pooled NREM, so one profile is used in N2 and N3.

**`resp_spindle_fast_resultant_length`.** Mean vector length reported for fast-spindle onset phase across significant electrodes. Used as an event-level target provisionally.

**`resp_spindle_slow_hazard`.** Absence means no injected respiratory hazard, not proof that biological slow spindles are universally uncoupled. Girin et al. 2024 report both slow and fast spindles during expiration in full-night PSG.

**`tilt_n_poles`.** Resolves pending decision P2. MUST be realized as second-order sections: direct-form transfer-function realization of this cascade overflows to non-finite values at this order (Finding 3). The PSD exponent is -2g where zeros sit at pole * D^g; pin that sign with a unit test, because it is the sign that silently inverts the wake/sleep reversal.

**`tilt_mod_settling_ratio`.** Resolves pending decision P3 by showing it is not answerable as posed. Build both interpolation schemes behind one interface and let G4 choose.

## 9. Observables

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `chi_est_band` | 2–40 *(band_edges)* | Hz | `derived` | Chosen by measured minimum detectable chi_mod_depth at the respiratory rate, over five candidate estimators on identical windows of identical records. An ordinary least-squares log-log slope over 2-40 Hz gives 0.048, against 0.058 for the two-band ratio it replaces, 0.098 for specparam over the same band, 0.271 for an LS slope over 30-45 Hz and 0.547 for specparam over 30-45 Hz. log(MDD) correlates -0.85 with the band's log-frequency leverage, so the band is what sets the variance. 2-40 Hz spans 1.30 decades against the two-band ratio's effective 0.80 and G1b's 0.18. See Finding 16; prep/reference/t1m2_chi_estimators.py. | all |
| `chi_est_mdd_resp` | 0.048 | — | `derived` | Measured minimum detectable chi modulation depth at the respiratory rate for the adopted estimator: depth x floor / recovered over 2 seeds x 300 s, N3, Pz, at chi_est_band and chi_est_window_s. See Finding 16; prep/reference/t1m2_chi_estimators.py. | all |
| `chi_est_window_s` | 2 | s | `derived` | Smallest measured minimum detectable depth at the respiratory rate: 0.048 at 2 s against 0.052 at 4 s for the adopted estimator. A longer window attenuates the modulation being measured (|sinc(fW)|, Finding 15); a shorter one has fewer spectral bins to fit. See Finding 16. | all |

**`chi_est_band`.** THE BAND chi(t) IS ESTIMATED OVER, and the single choice that decides whether respiratory coupling is measurable at all. It is NOT `fit_band_broad` (1-45 Hz): the top of that band is above the anti-alias roll-off at this fs and its bottom is where the N3 slow oscillation dominates, and it is not `fit_band_narrow` (30-45 Hz), whose 0.18 decades of leverage Finding 14 already showed cannot resolve the chi spacing between states. LEVERAGE, NOT SOPHISTICATION. Measured at this band, a plain least-squares slope BEATS specparam by 2x on variance (0.048 vs 0.098) and is also closer on bias (DC chi 1.637 against an injected 1.66, where specparam reads 1.73). Peak modelling costs per-window variance and buys nothing here, because modulation depth is an AC measurement: any static bias cancels in the line at the modulation frequency.

**`chi_est_mdd_resp`.** THE SMALLEST chi MODULATION DEPTH THIS ESTIMATOR CAN SEE AT ALL, and therefore the effect-size floor below which no claim about chi modulation can be supported or refuted. It is used as G4's null arm requires: a difference smaller than the estimator's own detection limit is not evidence of leakage, however consistently signed. WHY THAT CLAUSE EXISTS. D14 specified the null arm as a paired sign test alone, and a sign test detects DIRECTION, NOT MAGNITUDE. When Finding 16 lowered the estimator's variance, a 0.1% paired difference at one sideband became "significant" (1/12 seeds, p = 0.0063) while the effect ratio was 0.999 -- the gate reported LEAKAGE and, in the same line, that the largest effect was 0.003 in ratio terms. Pairing removes variance, so with enough precision any systematic difference clears a sign test. An effect-size floor is what makes the arm a statement about consequence rather than about resolution.

**`chi_est_window_s`.** The sliding-window length for chi(t). Harness section 4's warning applies directly: "a window at or above the respiratory period averages the very modulation being measured away." At the 0.25 Hz respiratory rate the period is 4 s, so a 4 s window is exactly the pathological case the spec names -- and the measurement confirms it costs ~8%.

## 6. Tilt filter

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `tilt_block_s` | 0.75 | s | `derived` | The SMALLEST BLOCK THAT STILL HIDES ITS OWN SETTLING TRANSIENT, then confirmed not to deposit a comb. Lower bound: each block filters from zero state, so its startup transient is masked only while the crossfade region (overlap = B/4) exceeds the pole cascade's t99 = 0.164 s (Finding 5), giving B >= 4 * 0.164 = 0.66 s. Among viable block lengths, 0.75 s maximises detectability at the respiratory rate: measured minimum detectable chi_mod_depth 0.061 at B = 0.75 s against 0.129 at B = 2.0 s, a 2.1x gain, with the noise floor unchanged. Verified comb-free: narrowband excess at the hop rate and its first two harmonics is -0.03 dB at B = 0.75 s against +0.20 dB at B = 2.0 s. See Finding 15; prep/reference/t1m2_tilt_block_sweep.py and t1m2_tilt_block_comb.py. | all |

**`tilt_block_s`.** THE COEFFICIENT-HOLD LENGTH OF THE BLOCKWISE TILT SCHEME, and it decides how much of a requested chi modulation is generated AT ALL. `tiltBlockwise` averages delta-chi over each block and applies one fixed tilt, then overlap-adds at a hop of 0.75*B -- two stacked smoothings. At the previously hardcoded 2.0 s only 48% of the requested modulation survived at the RESPIRATORY RATE of 0.25 Hz, and 11% at 0.40 Hz. That loss is entirely generator-side, before any estimator sees the signal, which is why it went unnoticed through all of Tier 0. G4 COULD NOT HAVE CAUGHT IT. The gate runs at g4_f1 = 0.10 Hz, where the 2.0 s hold retains 95%; the defect lives at the respiratory rate, which G4 deliberately keeps clear of so that f1 and f2 stay separable. A gate can only see the frequencies it probes. THE LITERAL LINTER COULD NOT HAVE CAUGHT IT EITHER. The constant was written `Math.round(2 * fs)`, and `2` is on the linter's arithmetic-furniture allowlist. This is the documented cost of that allowlist, paid: the most consequential unregistered constant in the generator was a `2`. Recorded in D15's own limitations rather than left implicit.

## 8. Cardiac

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `hr_mean_wake` | 68.3 | 1/min | `fitted` | Median across subjects of mean HR from quality-controlled ECG R-R intervals in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | wake_eo, wake_ec |
| `hr_mean_n1` | 63.1 | 1/min | `fitted` | Median across subjects of mean HR from quality-controlled ECG R-R intervals in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n1 |
| `hr_mean_n2` | 61.6 | 1/min | `fitted` | Median across subjects of mean HR from quality-controlled ECG R-R intervals in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n2 |
| `hr_mean_n3` | 62.1 | 1/min | `fitted` | Median across subjects of mean HR from quality-controlled ECG R-R intervals in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n3 |
| `hr_mean_rem` | 65.1 | 1/min | `fitted` | Median across subjects of mean HR from quality-controlled ECG R-R intervals in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | rem |
| `cardiac_subject_hr_cv` | 0.21 | — | `fitted` | One parsimonious lognormal subject-phenotype CV fitted to the 0.19-0.23 cross-subject CV range across five HMC stages; prep/reference/r2_hmc_cardiac.py. | all |
| `rr_sdnn_wake` | 0.1175 | s | `fitted` | Median per-subject SDNN after ECG QRS detection and local RR quality control in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | wake_eo, wake_ec |
| `rr_sdnn_n1` | 0.107 | s | `fitted` | Median per-subject SDNN after ECG QRS detection and local RR quality control in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n1 |
| `rr_sdnn_n2` | 0.0767 | s | `fitted` | Median per-subject SDNN after ECG QRS detection and local RR quality control in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n2 |
| `rr_sdnn_n3` | 0.0613 | s | `fitted` | Median per-subject SDNN after ECG QRS detection and local RR quality control in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | n3 |
| `rr_sdnn_rem` | 0.0818 | s | `fitted` | Median per-subject SDNN after ECG QRS detection and local RR quality control in 19 scored HMC nights; prep/reference/r2_hmc_cardiac.py. | rem |
| `rsa_rr_amp_rem` | — *(pending T1-M5; runs on 0.03)* | s | `invented` | HMC has no respiration channel and the literature source supplies relative stage changes rather than an absolute RR amplitude | all |
| `rsa_relative_wake` | 0.9 | — | `literature` | Penzel et al. 2016, *Frontiers in Physiology 7:460* | wake_eo, wake_ec |
| `rsa_relative_n1_n2` | 1.33 | — | `literature` | Penzel et al. 2016, *Frontiers in Physiology 7:460* | n1, n2 |
| `rsa_relative_n3` | 1.37 | — | `literature` | Penzel et al. 2016, *Frontiers in Physiology 7:460* | n3 |
| `rsa_relative_rem` | 1 | — | `definitional` | Penzel et al. 2016 normalization — REM reference equals one | rem |
| `rsa_phase_offset` | — *(pending T1-M5; runs on 0)* | rad | `invented` | the sign of RSA is established but its phase course varies by subject and breathing pattern | all |
| `cardiac_fast_variance_fraction` | — *(pending T1-M5; runs on 0.1)* | — | `invented` | uncalibrated latent variance allocation | all |
| `cardiac_fast_tau_beats` | — *(pending T1-M5; runs on 2)* | beats | `invented` | uncalibrated AR(1) reduction | all |
| `cardiac_slow_tau_s` | — *(pending T1-M5; runs on 120)* | s | `invented` | uncalibrated AR(1) reduction | all |
| `cardiac_rr_min_s` | 0.35 | s | `chosen` | numerical and physiological guard against a negative or implausibly short RR interval under combined latent excursions | all |
| `ecg_r_amp` | — *(pending T1-M5; runs on 1000)* | uV | `invented` | uncited; amplitude depends entirely on lead placement | all |
| `ecg_wave_shape` | Five Gaussians (P, Q, R, S, T) on the beat phase. Per wave, (phase in cycles from the R peak, amplitude relative to ecg_r_amp, width in cycles): P (-0.20, +0.12, 0.030), Q (-0.025, -0.16, 0.0060), R (0, +1.00, 0.0075), S (+0.030, -0.28, 0.0090), T (+0.22, +0.31, 0.045). | — | `literature` | McSharry, Clifford, Tarassenko & Smith 2003, *IEEE Transactions on Biomedical Engineering 50(3):289-294* — A dynamical model for generating synthetic electrocardiogram signals. The five-Gaussian PQRST form is theirs; the numbers here are that structure re-expressed in cycles-from-R and normalised to the R peak. | all |

**`hr_mean_wake`.** HMC supplies scored nocturnal wake and cannot separate eyes open from eyes closed. Clinical-referral corpus; IQR 60.2-75.2 bpm.

**`hr_mean_n1`.** Clinical-referral corpus; IQR 56.7-72.8 bpm.

**`hr_mean_n2`.** Clinical-referral corpus; IQR 54.8-70.2 bpm.

**`hr_mean_n3`.** Clinical-referral corpus; IQR 54.9-72.2 bpm.

**`hr_mean_rem`.** Clinical-referral corpus; IQR 55.6-70.5 bpm.

**`cardiac_subject_hr_cv`.** A seed keeps this multiplier across states. It captures between-subject rate spread, not beat-to-beat HRV.

**`rr_sdnn_wake`.** IQR 0.0918-0.1374 s; total RR variability including RSA.

**`rr_sdnn_n1`.** IQR 0.0870-0.1344 s; total RR variability including RSA.

**`rr_sdnn_n2`.** IQR 0.0568-0.0969 s; total RR variability including RSA.

**`rr_sdnn_n3`.** IQR 0.0446-0.0767 s; total RR variability including RSA.

**`rr_sdnn_rem`.** IQR 0.0614-0.1102 s; total RR variability including RSA.

**`rsa_relative_wake`.** RSA strength normalized to REM = 1.00 in Penzel et al. Table 1.

**`rsa_relative_n1_n2`.** Light-sleep RSA strength normalized to REM = 1.00.

**`rsa_relative_n3`.** Deep-sleep RSA strength normalized to REM = 1.00.

**`ecg_r_amp`.** ROUGHLY 50x A LARGE EEG DEFLECTION, which is why the ECG cannot share the trace's uV/mm scale and gets its own lane with its own stated scale.

**`ecg_wave_shape`.** THE FORM IS TRANSCRIBED, THE NUMBERS ARE ADAPTED. McSharry et al. specify the five-Gaussian PQRST structure and give angles, amplitudes and widths for a 60 bpm exemplar; the values here are their structure re-expressed in cycles-from-R and normalised to the R peak so that ecg_r_amp carries the scale. Standing is `literature` for the FORM. The individual numbers have not been validated against neurokit2.ecg_simulate or a real recording -- that is the third step of the risk register's mitigation and it is TODO(T1-M5). A procedure row rather than fifteen scalars, because they are one model and fitting them independently would be meaningless.

## 8a. Infra-slow potentials and coupling

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `isf_overview_duration_options` | 120 or 300 or 600 | s | `chosen` | Lazy full-band overview lengths: 120 s makes the mode usable on modest devices, while 300 s and 600 s expose progressively more of the sub-0.1 Hz time scale. These are display choices, not validation-record lengths. | all |
| `isf_overview_rate` | 2 | Hz | `chosen` | Display-only summary rate: twenty samples per cycle at the 0.1 Hz upper ISF edge, after explicit anti-alias filtering. | all |
| `isf_overview_antialias_hz` | 0.8 | Hz | `chosen` | Display-only anti-alias cutoff below the 1 Hz Nyquist limit of the 2 Hz overview; it preserves the complete registered 0.008-0.1 Hz band with margin. | all |
| `isf_spectrum_range` | 0.005–1 *(ui_domain)* | Hz | `chosen` | Log-frequency domain for the full-band interface. The lower axis edge extends below the 0.008 Hz literature band; actual resolvable frequency remains limited by 1 / record duration and is stated in the interface. | all |
| `isf_comparison_hpf` | 0.1 | Hz | `chosen` | Fixed comparison against the conventional lower edge already used by the ordinary filter panel; the purpose is to reveal what that high-pass removes, not to fit a physiological parameter. | all |
| `isf_band` | 0.008–0.1 *(band_edges)* | Hz | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | all |
| `isf1_band` | 0.008–0.05 *(band_edges)* | Hz | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | all |
| `isf2_band` | 0.05–0.1 *(band_edges)* | Hz | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | all |
| `isf_probe_record_length` | 1250 | s | `derived` | Ten cycles at the 0.008 Hz lower edge: 10 / 0.008 = 1250 s. The live 15-60 s display is not an infra-slow validation record. | all |
| `isf_temporal_model` | band_limited_power_law_state_space | — | `chosen` | ISF-1 comparison: the power-law state-space family matched the broad irregular-period prefix and exact chunk continuity without adding a resonance frequency, mixture weight or oscillator-Q parameter. | all |
| `isf_controller_rate` | 2 | Hz | `chosen` | Numerical controller rate: 20 samples per cycle at the 0.1 Hz upper edge, later interpolated to EEG fs; this is a computation choice, not a physiological frequency. | all |
| `isf_temporal_exponent` | — *(pending T1-M5; runs on 1)* | — | `invented` | No eligible public full-band record identifies the exponent; one is the parsimonious provisional member of the selected family. | all |
| `isf_temporal_pole_count` | — *(pending T1-M5; runs on 9)* | — | `invented` | Numerical approximation order pending a formal convergence sweep. | all |
| `isf_resonance_fraction` | — *(absent)* | — | `absent` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | all |
| `isf_spatial_model` | fsaverage_bem_patch_covariance_modes | — | `chosen` | ISF-2 reuses the existing anatomical forward-model seam: fixed-normal cortical sources in Desikan-Killiany patches, projected by the fsaverage three-shell BEM and represented by covariance eigenmodes. | all |
| `isf_source_families` | frontomedial_association or sensorimotor or posterior_visual | — | `chosen` | Smallest broad anatomical basis spanning anterior association, central sensorimotor and posterior visual/association systems. Network-specific full-band components reject one global source; no external observation currently requires a fourth family. | all |
| `isf_lateral_family` | — *(absent)* | — | `absent` | Parsimony stop rule: add a source family only for an external observation the current anatomical basis cannot reproduce, never to tune rank, PC1 variance or channel correlation separately. | all |
| `isf_modulation_gain_model` | lognormal_unit_mean_square | — | `derived` | For a unit-Gaussian infra-slow driver z and log-amplitude depth m, use g(z) = exp(m z - m^2). Then E[g^2] = exp(-2m^2) E[exp(2mz)] = 1 analytically, so coupling does not become a hidden carrier-power control. | all |
| `isf_band_variance_fraction` | — *(pending T1-M5; runs on 0.5)* | — | `invented` | No eligible public full-band spectrum identifies the split. | all |
| `isf_modulation_target_map` | In wake, modulate represented canonical rhythms through the nearest anatomical ISF family: posterior alpha and sensorimotor beta. Aggregate NREM uses one frontomedial controller family for its represented canonical rhythms, matching the reported frontal power emphasis without imposing a channel-space gain. Do not modulate the distributed aperiodic background, channel-local residuals or discrete events: doing so allowed the background alone to satisfy an AASM slow-wave criterion after the named slow-wave sources were attenuated. REM copies the wake anatomical rule as an explicit extrapolation. | — | `chosen` | Smallest source-level map that makes broad fast-rhythm coupling executable while preserving the independent slow-wave null. | all |
| `isf_pac_preferred_phase` | — *(absent)* | rad | `absent` | Estimate under an explicit external phase convention; do not choose the sign that maximizes recovered coupling. | all |
| `isf_mechanism_arms` | Matched seed and carrier arms: mechanism off; additive BEM voltage only; source-level mean-square-preserving modulation only; both; and a pi-inverted-driver modulation null. Respiration remains on an independent controller and substream. | — | `chosen` | Separately switchable causal paths and matched nulls are an identifiability requirement, not a fitted physiological quantity. | all |
| `isf_power_state_contrast` | Compare aggregate NREM (N1-N3) with aggregate wake; require the externally reported direction NREM > wake for infra-slow relative power, broadly distributed with a frontal emphasis. Do not infer an ordering among N1, N2 and N3 from this source. | — | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | wake_eo, wake_ec, n1, n2, n3 |
| `isf_pac_plv_wake_reference` | 0.178 | — | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | wake_eo, wake_ec |
| `isf_pac_plv_nrem_reference` | 0.211 | — | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | n1, n2, n3 |
| `isf_pac_channel_fraction_wake` | 0.05–0.15 *(uncertainty)* | — | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | wake_eo, wake_ec |
| `isf_pac_channel_fraction_nrem` | 0.05–0.35 *(uncertainty)* | — | `literature` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | n1, n2, n3 |
| `isf_cortical_rms_wake` | — *(pending T1-M5; runs on 2)* | uV_rms | `invented` | Engineering prior; available studies establish the mechanism but do not identify cortical-source RMS. | wake_eo, wake_ec |
| `isf_cortical_rms_nrem` | — *(pending T1-M5; runs on 3)* | uV_rms | `invented` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* — Literature anchors the direction and frontal emphasis, not the 1.5x magnitude. | n1, n2, n3 |
| `isf_cortical_rms_rem` | — *(pending T1-M5; runs on 2)* | uV_rms | `invented` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | rem |
| `isf_shared_source_fraction` | — *(absent)* | — | `absent` | Hiltunen et al. 2014, *Journal of Neuroscience 34:356-362* | all |
| `isf_source_delay_s` | — *(absent)* | s | `absent` | Must be estimated from full-band multichannel recordings, not selected to make an animation look like a travelling wave. | all |
| `isf_pac_depth_wake` | — *(pending T1-M5; runs on 0.4)* | — | `invented` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | wake_eo, wake_ec |
| `isf_pac_depth_nrem` | — *(pending T1-M5; runs on 0.3)* | — | `invented` | Väyrynen et al. 2023, *Clinical Neurophysiology 156:207-219* | n1, n2, n3 |
| `isf_pac_depth_rem` | — *(pending T1-M5; runs on 0.4)* | — | `invented` | No healthy REM anchor; provisional value copies wake rather than inventing a REM contrast. | rem |
| `electrode_dc_drift_rms` | — *(absent)* | uV_rms | `absent` | Tallgren et al. 2005, *Clinical Neurophysiology 116:799-806* | all |
| `reference_dc_drift_rms` | — *(absent)* | uV_rms | `absent` | Tallgren et al. 2005, *Clinical Neurophysiology 116:799-806* | all |

**`isf_overview_duration_options`.** The 1250 s validation probe remains separate. At the 0.008 Hz lower edge these choices contain 0.96, 2.4 and 4.8 cycles respectively, so the interface states that none replaces the registered ten-cycle gate record.

**`isf_overview_antialias_hz`.** Applied equally to the raw and 0.1 Hz high-passed overview traces; it is not part of generated data or exported truth.

**`isf_comparison_hpf`.** Zero-phase and the registry filter order, so the comparison is explicit and reproducible.

**`isf_band`.** Full-band EEG definition used for the wake-versus-NREM comparison. This is distinct from the 0.1-1 Hz slow range, the 0.2-2 Hz sleep slow-wave range, and the separately measured respiratory rhythm. A conventional 0.1 Hz high-pass removes most of this direct voltage.

**`isf1_band`.** Primary phase-amplitude-coupling band in the source study; periods span 20-125 s.

**`isf2_band`.** Secondary band reported separately by the source study. The shared 0.05 Hz boundary is an analysis convention; an implementation must not create a line or discontinuity there.

**`isf_temporal_model`.** MODEL FAMILY ONLY. The ISF-1 candidate fixture used representative internal settings to compare forms, but none of those settings is promoted. The selected controller remains unitless and outside composeState until ISF-2 supplies BEM source families.

**`isf_spatial_model`.** This selects a spatial representation, not a voltage amplitude. Every neural infra-slow channel weight is generated by prep/leadfield/make_projection.py. The runtime does not contain an electrode-level infra-slow topography.

**`isf_source_families`.** Atlas membership is fixed in prep/leadfield/make_projection.py before amplitude fitting. The emitted projection IDs are isf_frontomedial, isf_sensorimotor and isf_posterior. The number of modes per family is derived from patch_mode_variance and is not another parameter.

**`isf_modulation_gain_model`.** ISF-3 fixes the gain algebra only. The depth m, target-source map and preferred phase remain absent. A finite record may have realized gain RMS different from one; truth records it.

**`isf_pac_plv_wake_reference`.** Mean ISF1-phase-to-fast-amplitude PLV under the paper's estimator; reported SD 0.014. This is an external reference metric, not a generator modulation depth and not interchangeable with a PLV recovered under another filtering or surrogate pipeline.

**`isf_pac_plv_nrem_reference`.** Aggregate-sleep mean under the paper's estimator; reported SD 0.022. The study does not license separate N1, N2 and N3 values, and contains no REM anchor.

**`isf_pac_channel_fraction_wake`.** IQR across subjects of the fraction of electrodes with significant ISF-fast coupling under time-shifted surrogates.

**`isf_pac_channel_fraction_nrem`.** Aggregate-sleep IQR; supports a wider spatial extent than wake, not a stage-by-stage ordering.

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
| `line_noise_amp` | — *(pending T1-M1; runs on 3)* | uV | `invented` | uncited; mains amplitude depends on electrode impedance, grounding and environment rather than on physiology | all |
| `line_noise_gain_cv` | — *(pending T1-M1; runs on 0.4)* | — | `invented` | uncited; sets how spatially non-uniform the interference is | all |
| `line_amp` | 1–10 *(uncertainty)* | uV | `invented` | uncited | all |
| `notch_q` | 30 | — | `chosen` | notch filter quality factor | all |

**`blink_rate`.** Added on import; the blink generator needs a rate and none was registered.

**`emg_amp_wake`.** Added on import.

**`emg_rem_level`.** Source markdown gave 'near zero', which is not machine-readable. Encoded as a fraction of emg_amp_wake.

**`line_freq`.** Re-standed definitional -> chosen: 'regional mains' names no standard.

**`line_noise_amp`.** Peak amplitude of the mains sine, per channel, OFF BY DEFAULT. Build Plan section 1 lists line noise in Tier 0's scope (WP-J) and it was the last of that group unbuilt. IT IS NOT PURELY SHARED. Real mains pickup varies per electrode with impedance, so the generator gives each channel an independent phase and a per-channel gain drawn about this amplitude -- a single identical sine on every channel would be removable by any spatial filter, i.e. exactly the wrong lesson about why line noise is annoying. WHY IT IS A UI TOGGLE RATHER THAN ALWAYS ON: at 60 Hz it sits above every band this project measures, so leaving it on would add a conspicuous artifact that changes no observable and teaches nothing. As a toggle it demonstrates what the notch filter is for.

**`line_noise_gain_cv`.** Per-channel variation in mains pickup. Zero would make the interference a single shared source removable by one spatial component; this makes it inhomogeneous, which is why real line noise needs a notch rather than a reference change.

**`line_amp`.** Added on import.

**`notch_q`.** Added on import.

## 10. Filter and analysis controls

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `hpf_default` | 0.005 | Hz | `chosen` | Opening display edge at the filter control floor: retains 97.7% amplitude at the named 0.008 Hz ISF lower edge under the default fourth-order zero-phase response, while keeping the high-pass visibly enabled as requested. | all |
| `lpf_default` | 40 | Hz | `chosen` | conventional clinical low-pass, and BELOW both line_freq options so mains is in the stopband at either mains frequency | all |
| `filter_ui_range` | 0.005–100 *(ui_domain)* | Hz | `chosen` | the draggable frequency domain of the filter panel: below the 0.008 Hz infra-slow band edge to above every band this project measures, and inside the Nyquist of fs = 256 | all |
| `filter_order_options` | 2 or 4 or 8 | — | `chosen` | Butterworth orders spanning gentle to steep; even orders only, because the biquad cascade is built from second-order sections | all |
| `hpf_options` | 0.01 or 0.1 or 0.5 or 1 | Hz | `chosen` | spans clinical and ERP practice | all |
| `welch_nperseg` | 1024 | samples | `chosen` | 4 s at fs=256; 0.25 Hz resolution | all |
| `welch_noverlap` | 512 | samples | `chosen` | 50% overlap | all |
| `welch_window` | hann | — | `chosen` |  | all |
| `spectrum_low_min_segments` | 4 | segments | `chosen` | Display-estimator variance control: four 50%-overlapped windows produce a usable slow-frequency trend from the 90 s live buffer without presenting a single periodogram as stable physiology. | all |
| `spectrum_low_smooth_radius_bins` | 2 | bins | `chosen` | Two adjacent bins on each side give a five-bin triangular frequency average after long-window Welch; enough to suppress residual estimator teeth without fitting a parametric curve or erasing broad sub-1-Hz structure. | all |
| `spectrum_hybrid_blend` | 0.5–1 *(band_edges)* | Hz | `chosen` | Smooth handoff from the long-window slow-frequency estimate to ordinary four-second Welch across the upper slow-wave range. | all |
| `specparam_peak_width_limits` | 1–12 *(band_edges)* | Hz | `chosen` | specparam algorithm_settings; in 2.0 these moved out of the constructor | all |
| `specparam_max_n_peaks` | 6 | — | `chosen` | specparam algorithm_settings | all |
| `specparam_peak_threshold` | 2 | — | `chosen` | specparam algorithm_settings, in SD | all |
| `lz_band` | 1–45 *(band_edges)* | Hz | `chosen` | bandpass applied before the Hilbert transform | all |
| `lz_channel_order` | montage order as declared in data/montage_10_20.json; column-wise concatenation | — | `chosen` | the parse result depends on concatenation order, so it must be pinned | all |
| `lz_binarize` | binarize around the median of the Hilbert amplitude | — | `chosen` | method described in a 2024 eNeuro slope-versus-LZc comparison; author not recorded | all |
| `lz_surrogate` | time_shuffled | — | `chosen` | DECISIONS D1. Destroys the spectrum, so surrogate complexity depends only on length and density — chi-dependence is zero by construction, caching is legal, no characterization needed. | all |
| `lz_parse` | — *(absent)* | — | `absent` | Decide by which parse the landmark literature used. Settle before citing any published value. | all |

**`hpf_default`.** Where the panel's high-pass handle starts. It equals filter_ui_range.lo so the opening trace retains the released infra-slow mechanism. The reader can raise it to demonstrate loss, and can switch it off to distinguish a very low cutoff from no high-pass at all.

**`lpf_default`.** Where the panel's low-pass handle starts. 40 Hz is the usual clinical choice and it sits below both 50 and 60 Hz, so switching the mains toggle on with the low-pass enabled puts the interference in the stopband either way -- which is the demonstration the two controls make together.

**`filter_ui_range`.** A UI DOMAIN, not a signal parameter -- the accessor is `uiDomain`, which throws if this is read as band edges. It bounds what a reader can drag to, and nothing else. The low end sits below both hpf_options' 0.01 Hz setting and the named 0.008 Hz infra-slow band deliberately: a cutoff a reader cannot reach is a cutoff they cannot compare against, and the panel's whole point is comparison. At finite display lengths, a selectable cutoff does not imply that the live window contains enough cycles to estimate a response at that frequency.

**`filter_order_options`.** ORDER IS THE SECOND AXIS OF THE DEMONSTRATION, beside zero-phase versus causal. A steeper filter rolls off faster AND rings longer, and Demo 3 already shows the ringing -- putting order under the reader's hand lets them see both halves of that trade move together instead of being told about it. Even orders only: `butterworthQs` throws on an odd order because a cascade of second-order sections cannot express one.

**`welch_nperseg`.** Added on import. 7 mandates a Welch PSD and 8 budgets 5.0 ms per second for it, but no Welch settings were registered — and they determine recovered chi as much as band and mode do.

**`welch_noverlap`.** Added on import.

**`welch_window`.** Added on import.

**`spectrum_low_min_segments`.** At fs=256 and display_buffer_s=90 this selects radix-2 windows of 8192 samples (32 s), giving 0.03125 Hz resolution. It is a display estimator, not a generator parameter.

**`spectrum_low_smooth_radius_bins`.** A display-estimator setting only; frequencies are unchanged and the unresolved region remains explicit. At the 32 s live estimator this is a compact 0.15625 Hz support, with greatest weight at the centre bin.

**`spectrum_hybrid_blend`.** The overlap is blended in log power with smoothstep; neither edge is a physiological boundary.

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
| `g4_n_surrogates` | — *(absent)* | — | `absent` | withdrawn with the circular-shift null | all |
| `g4_n_seeds` | 12 | — | `chosen` | 12 paired seeds give an exact one-sided sign-test p of 1/4096 at k = n, comfortably below 0.05, and cost ~25 s of the fast tier at 3 exports per seed | all |
| `g4_percentile_level` | 95 | percent | `chosen` | the percentile LEVEL is a convention — 99 would serve as well | all |
| `g4_threshold_value` | — *(absent)* | — | `absent` | No threshold. See gate_g4_criterion and gate_g4_seed_aggregation. | all |
| `g4_f1_neighbourhood_halfwidth` | — *(absent)* | bins | `absent` | withdrawn with D8's f1 null | all |
| `g4_fixture_chi_mod_depth` | 2 | — | `derived` | Smallest depth on a 0.8-2.0 sweep at which the f1 line clears its own depth-0 null in >=95% of seeds. Measured: prep/reference/probe_g4_fixture.py, 40 seeds, 300 s, N3, Fz, linked mastoid. | all |

**`g4_n_seeds`.** G4 caps at its own seed count rather than consuming n_seeds. Each seed costs THREE 300 s exports (observed, detection null, leakage null) because the comparisons are paired, so the runner's default 20 would put the gate over the fast tier's 2-minute budget on its own. The cap is stated in the report rather than left implicit — harness section 9: a workflow that silently truncates coverage reads as having covered everything.

**`g4_percentile_level`.** Split from g4_percentile on import. The level and the threshold value at that level have different standings; as one derived row the UI renders the level read-only and the report prints the wrong threshold standing for the gate whose provenance matters most.

**`g4_fixture_chi_mod_depth`.** THE DEPTH G4 INJECTS, WHICH IS NOT THE DEPTH THE GENERATOR SHIPS. chi_mod_depth's provisional value is 0.15, and at 0.15 the recovered line is 1.02x its own null -- invisible. Measured detection rates: 0.8 -> 0.25, 1.0 -> 0.35, 1.25 -> 0.50, 1.5 -> 0.65, 1.75 -> 0.90, 2.0 -> 0.97. This is legitimate because of what G4 asks: whether the estimator attributes a DETECTABLE line to the RIGHT FREQUENCY. A line has to be detectable before that question means anything, so the fixture supplies one. It is 13x the shipped depth, and the gate therefore DOES NOT establish that the shipped modulation is recoverable. It is not — that is a property of the cheap two-band chi proxy in src/analysis/coupling.ts, whose floor over a 300 s record is ~0.10 in its own units. Replacing that estimator is T1-M2 work.

## 12. Gate criteria

| Key | Value | Units | Standing | Source | States |
|---|---|---|---|---|---|
| `gate_aasm_n3_min_fraction` | 0.2 | — | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — N3 requires >=20% of the epoch occupied by slow wave activity | n3 |
| `gate_aasm_n3_min_amp` | 75 | uV_pp | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — slow wave amplitude >=75 uV peak-to-peak | n3 |
| `gate_aasm_n3_band` | 0.5–2 *(band_edges)* | Hz | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — slow wave activity band | n3 |
| `gate_aasm_n3_reference` | referenced to contralateral mastoid (reference_channels) | — | `definitional` | AASM Manual for the Scoring of Sleep and Associated Events — derivation reference | n3 |
| `gate_g5_null_ordering` | pass_fraction(N3 @ snr_nominal) > pass_fraction(N2) AND > pass_fraction(N3 @ snr_nominal + snr_null_offset) | — | `derived` | A strict ordering needs no invented threshold. See Execution-Scheme D9. | n2, n3 |
| `gate_g4_criterion` | PAIRED per seed. Detection arm: depth(f1) with chi modulation ON exceeds depth(f1) with it OFF, same seed, everything else identical. Selectivity arm: depth(f1) exceeds depth(f2) within the same record. Both aggregate by gate_g4_seed_aggregation. | — | `derived` | Sign test against p = 0.5, which holds under the null by the pairing itself and is not a chosen number. See D14. | all |
| `gate_g4_seed_aggregation` | Exact binomial sign test on the paired per-seed comparisons. Positive arms: one-sided P(K >= k | n, 0.5) < 0.05. Null arm: leakage is declared only if BOTH two-sided p < 0.05 AND the paired median absolute difference exceeds chi_est_mdd_resp, the estimator's own detection floor -- a sign test detects direction, not magnitude. | — | `derived` | Under H0 a paired difference is positive with probability 0.5. The 0.5 comes from the pairing, not from a choice. | all |
| `gate_topography` | argmax over electrodes matches the topo_expect_* rows | — | `derived` | structural — no tolerance required; expectations are literature and independent of the projection file | all |
| `gate_determinism` | bit-identical, within-platform and within-version only | — | `chosen` | This project's definition of determinism. No external standard fixes it. | all |
| `gate_chi_tol_knee` | — *(absent)* | — | `absent` | T1-M2 estimator characterization | all |
| `gate_chi_tol_fixed` | — *(absent)* | — | `absent` | T1-M2 estimator characterization | all |
| `gate_spindle_f1` | — *(absent)* | — | `absent` | T1 sets the criterion by roll-off shape against MODA's per-event agreement counts | n2 |
| `gate_g1_null_zero` | On synthetic white noise: |MEAN chi_hat| < 0.10 in both modes and |mean knee parameter k| < 1.0 in knee mode, over 12 realisations of 300 s. | — | `chosen` | Numerical resolution of a 300 s Welch estimate, from Tier0-Estimator-Probe Finding 1: white noise returns chi +0.010 fixed, +0.0098 knee, knee parameter -0.024. The bounds sit an order of magnitude above the measured values. | all |
| `gate_g1b_null_zero` | On synthetic white noise: |MEAN chi_hat| < 0.10 in fixed mode over 30-45 Hz, across 12 realisations of 300 s. No knee clause -- fixed mode has none to invent. | — | `chosen` | Numerical resolution of a 300 s Welch estimate, from Tier0-Estimator-Probe Finding 1: white noise returns chi +0.010 in fixed mode. | all |
| `gate_g3_null_fp_rate` | YASA run on the same background with graphoelements suppressed must detect fewer events than it does with them present, by a paired comparison across seeds, and its absolute count must be a small fraction of the injected count. | — | `derived` | Paired sign test against p = 0.5, as for G4 (D14): each seed is measured twice, with and without graphoelements in the mix, everything else identical. The 0.5 comes from the pairing. | n2 |
| `gate_alpha_ratio` | >3 | — | `invented` |  | wake_ec |
| `gate_pac_tol` | — *(absent)* | deg | `absent` | Derive the required event count from the target precision, or gate on resultant length rather than preferred phase. Tier 1. | n3 |
| `gate_coupling_depth_tol` | — *(absent)* | — | `absent` | Characterize SPRiNT's transfer function first. T1-M2. | all |
| `gate_hpf_loss` | — *(absent)* | — | `absent` | T1-M2 | all |

**`gate_aasm_n3_min_fraction`.** Split from gate_aasm_n3 on import, which hid four separately-typed constants in one prose cell. The acceptance check could not authorize any of them, so the linter would have had to flag the project's single definitional threshold as a magic number or exempt the file wholesale.

**`gate_aasm_n3_min_amp`.** THE AASM NUMBER APPEARS HERE AND NOWHERE ELSE. delta_amp must not be set from it — that would generate N3 to satisfy the check meant to test it.

**`gate_aasm_n3_reference`.** Evaluating under average reference gives a different number and would silently miscalibrate everything downstream.

**`gate_g5_null_ordering`.** G5's positive arm is RECORD-ONLY: it reports a pass fraction with no threshold, because any threshold on that fraction would be invented or read from our own generator's spread, both prohibited. The null carries the verdict — which D5 already says carries the discriminative weight.

**`gate_g4_criterion`.** TWO ARMS BECAUSE 'appears at f1 and not at f2' IS TWO CLAIMS. Detection alone would pass an estimator that smears a real line across every low frequency; selectivity alone would pass one that reports nothing anywhere, since 0 > 0 is false but so is any comparison on noise. Measured under the fixture: detection 40/40, selectivity 40/40.

**`gate_g4_seed_aggregation`.** REPLACES the exact-binomial-against-5% construction, which D12 measured as false: the per-seed false-exceedance rate of a percentile null is a function of respiration regularity, not of the percentile, and ran 0.317 at the provisional resp_period_cv_n3. Pairing removes the dependency entirely — the seed is its own control, so seed-to-seed variance cancels instead of having to be modelled. THE NULL ARM IS ABSENCE OF EVIDENCE and the report says so: it establishes that leakage is not gross, not that it is zero. Measured, mechanism (a) shifts the f2 line by 0.2% of the null median, far below what a sign test at these n could resolve.

**`gate_determinism`.** Build Plan 9 groups G2 with the record-only gates, but bit-identity has no distribution to record and a determinism gate that cannot fail is worthless. It is also the root of the dependency graph. Canonically PASS/FAIL; see Execution-Scheme section 1. RE-STANDED definitional -> chosen on review. It had been sourced to "IEEE 754 binary64", which defines float64 representation and arithmetic but says nothing about one seed producing identical output -- that is a property of OUR implementation and its draw ordering, which is exactly why the Build Plan strikes any cross-implementation clause. That was a re-sourcing by guess, the remedy this registry's own discipline forbids, and it sat on the criterion of a failable gate. No numeric tolerance is invented here, so `chosen` is adequate for a structural criterion -- as it is for gate_topography.

**`gate_chi_tol_knee`.** The source markdown expected G1a's error to EXCEED G1b's. Measured on clean aperiodic signal the ordering is reversed by two orders of magnitude: G1a median |error| 0.005, G1b 0.417. See Tier0-Estimator-Probe Finding 2. Re-measure under the full generator before amending DECISIONS D3.

**`gate_chi_tol_fixed`.** G1b's bias is STRUCTURAL: measured error 0.417 against an analytic prediction of 0.429 from the generative form itself. It comes from our modelled 20 Hz knee, not from the literature's unmodelled 45 Hz one, so its magnitude is a function of the invented k_* rows. That is a weaker claim than DECISIONS D3's comparability argument.

**`gate_g1_null_zero`.** THESE ARE NOT THE TOLERANCES G1 IS MISSING, and the distinction is the reason this row exists separately rather than reusing gate_chi_tol_knee. That row is `absent` because a Tier 0 tolerance on RECOVERY ERROR would have to be invented or read from our own generator's spread. The bounds here are of a different kind: they answer "did the fit return zero", at the numerical resolution of the estimate, on a signal whose correct answer is known analytically rather than measured from anything we built. Standing is `chosen` — a convention about what counts as zero — not `derived`, because no procedure computes 0.10 from anything; Finding 1 only establishes that the true values are far below it. The null is a check on the harness's PSD-and-fit path, NOT on the generator: it synthesises white noise because no generated state has chi = 0, and inventing one to satisfy a gate would be the circularity section 1 prohibits.

**`gate_g1b_null_zero`.** Split from gate_g1_null_zero because G1a and G1b are separate gates with separate criteria, and one shared row would have to declare a single gate id. TESTED ON THE MEAN, NOT PER SEED, and that was a measured correction rather than a preference. A per-seed bound at 0.10 FAILED on its first real run: measured over 12 white-noise realisations, the fixed-mode fit over 30-45 Hz has sd 0.18-0.23, so individual seeds routinely exceed 0.10 while the estimator is behaving correctly. The band is only 0.176 decades wide and a slope estimated over that span scatters however long the record. That sd matters more than this criterion does: it EXCEEDS THE CHI SPACING BETWEEN ADJACENT STATES (chi_wake_ec 1.10 vs chi_n1 1.40), so no state ordering is supportable from narrowband chi on a single record. See Finding 14; constrains P10.

**`gate_g3_null_fp_rate`.** The harness spec asks for "false-positive rate near zero", which is not directly testable as written: 'near zero' has no stated value and any number chosen for it would be invented. What IS testable without inventing anything is the PAIRED contrast — the same background, the same seed, the same everything, with and without the events — and that is the stronger claim anyway, because it attributes the detections to the events rather than to the record. The suppression happens at the summation, not at the draw, so the background is bit-identical between the two arms (see suppressGraphoelements in compose.ts). Without that the null would differ from the gate by more than the thing being tested.

**`gate_alpha_ratio`.** THE RECORDED QUANTITY NOW CONTRADICTS THIS BOUND, and that is recorded rather than quietly reconciled. Posterior/frontal alpha weight ratio measured 1049.77 before volume conduction was modelled -- frontal alpha was absent, so the ratio was nearly unbounded -- and measures 1.95 after (D18). The invented bound of > 3 was therefore set against a generator with no far field at all, and it is not evidence about the new value. IT DOES NOT FAIL ANYTHING: the row is `invented` and record-only, so G6's verdict rests on the structural argmax check alone, which is the whole reason D6 made it record-only. It is also not directly comparable to the fitted target -- the fit matched PROMINENCE excess (real 0.271, i.e. ~3.7 posterior/frontal) while this row is a raw WEIGHT ratio, and the two differ by the background each channel carries. T1-M2 must settle which quantity the bound is about before giving it a value. RECORDED, NOT A PASS CRITERION, until T1-M2. G6 uses structural argmax instead.

**`gate_pac_tol`.** Encoded as absent rather than as an invented value of 15, so that no code path can read a number the registry's own note declares impossible. A registry able to hold a refuted value with no machine-readable refutation is one import away from using it.

## Standing tally

*`invented` rows are the Tier 1 work plan. `chosen` rows are deliberately not.*

| Standing | Rows |
|---|---|
| `definitional` | 12 |
| `chosen` | 78 |
| `literature` | 34 |
| `derived` | 21 |
| `fitted` | 11 |
| `invented` | 116 |
| `absent` | 19 |
| **total** | **291** |
