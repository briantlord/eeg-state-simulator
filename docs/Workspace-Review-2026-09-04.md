# Workspace review — 4 September 2026

**Snapshot note:** this review describes the workspace before stabilization. Subsequent repairs
and new measurements are recorded in [Stabilization 0.11.0](Stabilization-0.11.0.md).

The project has a strong foundation for a research simulator. The recent physiological-controller, source-projection, and provenance work is substantial, and the validation framework is unusually explicit about what its results do and do not establish. The immediate need is integration and validation repair: the browser, exporter, calibration artifact, and independent estimators do not yet describe one consistently verified configuration.

I would preserve the architecture and stabilize it before adding more mechanisms. The present snapshot is useful for experimentation; its passing verification result should not be treated as evidence that the complete interactive product or all physiological claims have been validated.

## Scope and evidence

Reviewed the working tree, recent work/history, application and rendering paths, generator and DSP architecture, registry and projections, export/calibration pipeline, tests, validation gates and nulls, research scripts, CI, and project documentation. This includes the substantial uncommitted work beyond HEAD `e6fc5f6`, rather than only the last committed version. Critical paths received execution probes; research scripts and historical findings received targeted inspection. This is not an assertion that every historical experiment or literature claim was independently replicated.

No application, generator, parameter, or test source was changed for this review. Review output and diagnostic files were added; build and verification regenerated ignored outputs.

| Check | Observed result |
| --- | --- |
| Production build | Passed; JavaScript bundle approximately 296 kB, 80 kB gzip |
| `npm run verify` | Passed all seven configured checks |
| Registry/projection checks | Fixed points passed: 291 registry rows, 94 projection entries, 21 channels |
| TypeScript tests | 99 passed |
| Python tests | 36 passed |
| Validation harness | All failable arms passed; G1a, G1b, G3, and G5 positive arms remain record-only |
| Expanded typecheck of `prep/reference/**/*.mts` | Failed with 12 unchecked-index diagnostics in `r0_respiration_baseline.mts` and `r3_eeg_coupling.mts`; these scripts are excluded from the normal typecheck |
| Browser inspection | Application loaded without observed console warnings/errors; state/spectrum synchronization defect reproduced |
| Targeted probes | Calibration replay and estimator disagreement, stream-default mismatch, endpoint seek defect, and short-record scheduling hang reproduced |

The full run is recorded in [the verification log](../prep/out/workspace-review-verify.log) and [the gate report](../prep/out/report/report.txt). It reports generator `0.10.0`, registry digest `e8b7ce85c7f28c2d`, and timestamp `2026-09-04T22:38:25Z`. These are local ignored artifacts and may be overwritten by later runs. Export truth schema is v6; the package version remains 0.1.0.

Verification used the installed Windows environment, Node 25.5.0 and the existing Python 3.11 environment, with MNE's temporary home redirected to the workspace. The existing lead-field cache was available. A clean Linux CI run, cold head-model derivation, full empirical corpus analysis, and every historical sweep were not rerun.

## What is working well

- **Scientific assumptions are visible.** The registry distinguishes definitional, derived, fitted, literature, chosen, invented, and absent values. Generated types, fixed-point checks, and truth sidecars make those distinctions usable in code. The current registry has 116 invented and 19 absent rows, with 74 pending flags across standings. That is a useful uncertainty inventory, not a reason by itself to reject the model.
- **The source model has meaningful structure.** Lead-field projection, multiple source families, independent named random streams, and separate event/background/artifact contributions are a better foundation than drawing plausible traces directly on the screen.
- **The recent controller work is valuable.** Continuous respiratory and cardiac controllers, respiratory event timing, infra-slow voltage and gain pathways, and save/restore tests address real limitations of independently generated chunks. The distinction between cortical infra-slow sources and recording drift is particularly useful.
- **The harness can falsify claims.** Matched nulls, held-out calibration seeds, external estimators, and explicit record-only results are strengths. The decision not to deliver a directed gate that failed its own null is good scientific judgment.
- **The application is lightweight.** A static TypeScript application and a separate headless exporter keep deployment and experimentation relatively simple. Unit coverage has grown materially with the new physiology work.

These strengths justify incremental repair. A broad rewrite would put working scientific machinery at unnecessary risk.

## Findings requiring correction

Priority P1 means fix before relying on a released configuration or its validation claims. P2 means a concrete correctness or evidence-quality issue to address during stabilization. These priorities concern this simulator's intended use, not a claim of clinical risk assessment.

### 1. P1 — Persisted calibration fails its own defining check

In [the calibrator](../bin/eegsim-calibrate.mts), line 98 writes `Number(snrNominal.toFixed(4))`, while `achieved_fraction` is computed before that rounding. The bisection correctly retains the passing upper bracket, but serialization can move the stored value back across a discontinuous occupancy threshold.

The current artifact stores 3.2887 dB and reports occupancy 0.206641 against a 0.20 target. Replaying its named seed, state, epoch, and neutral infra-slow gain with that stored number gives **0.190625**, which fails. At 3.28874 dB the same probe gives 0.206640625.

**Repair:** retain sufficient precision or round toward the passing side, then recompute and assert the result using the exact serialized value. Record registry, projection, and implementation identity with the calibration. Add a regression that reads the saved artifact and reproduces its stated result; testing only the search procedure misses this failure.

### 2. P1 — Calibration and the independent gate disagree on identical samples

[TypeScript scoring](../src/analysis/aasm.ts), line 80, uses [the biquad filter](../src/core/dsp/biquad.ts), whose bandpass is a high-pass/low-pass cascade and whose forward/reverse filtering starts from zero state. [Python scoring](../prep/gates/g5_aasm_n3.py), lines 79–80, uses SciPy's bandpass design and padded `filtfilt`. Despite comments describing a match, these operations are not equivalent; half-wave boundary handling also differs.

On the exact calibration samples from finding 1, TypeScript reports **0.190625**, while Python reports **0.205859375**. The same waveform consequently falls on opposite sides of the target. The common input is retained locally as `prep/out/workspace-review-calibration.f64` with its channel-label JSON.

**Repair:** specify filter response, edge handling, derivation, and occupancy semantics, and verify both implementations against common numerical fixtures. An independently authored validator is valuable, but disagreement must be characterized if it is intentional; it cannot be described as a mirrored calculation. Keep calibration and held-out evaluation conceptually separate after resolving this measurement mismatch.

### 3. P1 — Browser and exporter have different default model configurations

[Browser initialization](../src/ui/app.ts), lines 112–127, does not pass `snrDb`, so [composition](../src/core/generators/compose.ts), line 1025, uses 0 dB. [The exporter](../bin/eegsim-export.mts), line 82, defaults to the saved 3.2887 dB calibration. That is approximately a **1.46× amplitude multiplier** for the affected rhythms/events. The browser also enables respiratory movement, amplitude, and exponent modulation, whereas those exporter switches require explicit flags.

This makes it unsafe to assume the standard headless gate report characterizes the configuration a person sees in the browser. It also makes visible behavior harder to reproduce in research scripts.

**Repair:** define a shared, named configuration consumed by both entry points, with deliberate fixture overrides. Record all resolved options in exports. Add a parity check using identical seed, duration, and options. Do not require different record lengths to produce identical FFT-generated realizations. A missing or invalid calibration should be an explicit configuration state rather than a silent fallback to zero.

### 4. P2 — Spectrum can remain attached to the previous state

[`updateObservables`](../src/ui/app.ts), line 384, immediately returns when `c-chi` is absent. That element belongs to an archived panel and is absent from the current page. The spectrum redraw and reference-note update still sit behind this guard at lines 470–471. Restart and reference-related paths call this guarded function.

In the browser, changing Wake EC to N3 resets the trace but leaves the spectrum unchanged. Changing the filter order forces the spectrum to refresh. This is a visible mismatch between the signal and its displayed measurement, and it is not covered by the unit suite.

**Repair:** give the spectrum and reference label their own refresh lifecycle. Test state, seed, reference, filter, and segment changes through the actual page, asserting that each visible measurement corresponds to the current data.

### 5. P2 — Seeking to the segment endpoint desynchronizes the stream

[`SignalStream.seekTo`](../src/ui/stream.ts), lines 243–245, allows exactly `segmentS` without advancing the buffers. The UI exposes this endpoint. For a new 90-second stream, `seekTo(90)` produces elapsed 90, position 0, but segment index 0. After `advance(1)`, elapsed is 91 and position 1 while index remains 0: the usual boundary-crossing logic never runs because the seek already crossed the clock boundary.

**Repair:** use a half-open seek range or a coordinated segment transition. Cover the last sample, exact endpoint, and resume behavior in a stream regression test.

### 6. P2 — EEG rendering reverses the project's stated polarity convention

The graphoelement contract says generators emit ordinary signed voltage and the renderer applies negative-up display. [The renderer](../src/render/trace.ts), line 229, instead uses `mid - v * pxPerUv`. With canvas coordinates increasing downward, that draws positive voltage up and negative voltage down.

**Repair:** make the EEG display sign explicit and verify it with a known signed pulse or K-complex template. Keep auxiliary channel conventions explicit too; changing a shared draw helper blindly could reverse those tracks. This is a pre-existing issue, not solely a regression from the latest work.

### 7. P2 — The prominence field does not measure event quality

[`drawProminence`](../src/core/generators/graphoelements.ts), lines 142–147, assigns an independent random number; `makeEvent` attaches it at line 569 after waveform construction. It does not control the current event's amplitude, morphology, or background contrast. Nevertheless, [G3](../prep/gates/g3_spindles.py) interprets thresholds on this field as inclusion of more or less canonical events.

The curve therefore partitions events by an arbitrary tag rather than the claimed quality dimension. Finding 14 already acknowledges that the prominence curve is not working; the code provides a direct explanation.

**Repair:** define a measurable event-quality quantity or use a parameter that actually changes the injected waveform, with controlled tests relating it to recovery. Otherwise rename the tag and retire the quality interpretation. Overall detector recovery remains meaningful independently of this field.

### 8. P2 — Short N3 records can hang in respiratory event scheduling

[`drawRespiratoryMarkerTime`](../src/core/generators/graphoelements.ts), lines 123–129, retries indefinitely until it finds a time at or after `earliestS`. Some slow-oscillation templates require a marker offset later than every available sample in a short record, leaving no acceptable candidate.

`composeState(28, 'n3', 26)` at the default 256 Hz reproduced a process timeout after three seconds rather than returning. Normal 30–90-second records were unaffected in the checks performed.

**Repair:** validate supported durations, restrict sampling to feasible support, and handle the empty-support case explicitly. Add a bounded short-record test; a valid API call should return or reject, never wait indefinitely.

### 9. P2 — Real-data comparison introduces artificial joins before filtering

[`t1m1_state_realism.py`](../prep/reference/t1m1_state_realism.py), lines 104–114, collects epochs by sleep state, concatenates them, and then filters them inside `metrics`. Epochs assigned the same state can come from nonadjacent portions of the recording. The resulting discontinuities can contaminate band power and temporal variability, while the generated comparison arm is continuous.

This is a method-level defect visible in the code; its numerical effect on the reported empirical results was not quantified in this review.

**Repair:** filter the continuous source before selecting epochs, or process contiguous runs with appropriate edge treatment. Recompute affected summaries before using them as fitting targets. Use multiple generated seeds and a declared held-out subject split for subsequent realism claims; the present comparison generates one seed per state.

### 10. P2 — Full-band release documentation exceeds the current interface

D32 and Finding 48 describe a selectable 120/300/600-second continuous overview and associated controls. [The overview implementation](../src/ui/fullband.ts) exists and has tests, but the current application does not import it or render those controls. The browser still uses the segmented clinical stream.

Furthermore, [the stream taper](../src/ui/stream.ts), lines 230–237, zeroes the first EEG sample at every new segment, including the mixed infra-slow voltage. A checked Fp1 boundary moved from approximately 4.216 µV to 0. Continuous physiological controller state therefore does not establish continuity of the displayed EEG mixture. This is a documented legacy compromise that needs reconsideration for the new low-frequency use case.

**Repair:** either complete the continuous overview integration or correct the release documentation to identify it as an unexposed capability. Treat long-timescale continuity as an integration requirement with a measured boundary test.

## What the current scientific results support

The current gate report is honest but narrower than an overall realism verdict:

- G5's held-out N3 qualifying fraction is **0.50** across six seeds and six epochs each. Its contrasts work: N2 is 0.00 and attenuated N3 is 0.03. Positive N3 occupancy remains record-only, and findings 1–3 limit interpretation of calibration and browser transfer.
- G4 detects a fixture using modulation depth **2**, approximately **13 times** the shipped depth. Its passing result demonstrates sensitivity/selectivity at that fixture strength, not recoverability of the shipped coupling.
- G1a reports N3 exponent error around **−1.175**, with an intentionally out-of-band knee unrecoverable in three of six fits. G1b N3 error is approximately **−1.458**. These are estimator/model-characterization results, not validated recovery tolerances.
- G3 reports median F1 approximately **0.567** with all spindles included; the matched null reports no detections. That supports attribution of detections to injected events, while leaving morphology realism and the prominence interpretation unresolved.

The next scientific milestone should connect empirical targets, fitted parameters, held-out recordings, and the actual released configuration. Preserve record-only labels until a defensible acceptance criterion exists. Do not turn current observed spreads into passing thresholds merely to increase the green count.

The scorer should also document its exact montage and operational approximation. The blanket source comment that AASM scoring uses a central primary derivation is too broad: the [AASM's published montage clarification](https://aasm.org/wp-content/uploads/2017/11/Summary-of-Updates-in-v2.1-FINAL.pdf) distinguishes recommended frontal measurement from central measurement under specified acceptable montages. This is a specification/documentation improvement, not a finding that every central derivation is invalid.

## Engineering and documentation improvements

1. **Close integration-test gaps.** Add meaningful regression coverage for the findings above. Include the production build in CI, typecheck the maintained research TypeScript entry points, and retain gate reports as CI artifacts. Keep expensive empirical sweeps separately invocable with clear inputs and run identifiers.
2. **Make regeneration portable and identifiable.** Several research scripts retain machine-specific paths. Centralize data-cache configuration and record corpus selections, subject splits, tool versions, full resolved options, source identity, projection hash, and calibration hash. Projection caches should carry derivation fingerprints rather than relying only on file existence. Validate numerical export arguments before creating output directories/manifests.
3. **Declare the supported runtime accurately.** `engines.node` currently says `>=20`, but scripts use experimental type stripping, which was [introduced in Node 22.6](https://nodejs.org/en/blog/release/v22.6.0); installed Vite also imposes a narrower engine range. Select and test one supported Node baseline, such as 22.12 or newer, and align package metadata, setup instructions, and CI.
4. **Refactor around stable responsibilities after fixing behavior.** Composition and the UI controller have accumulated source synthesis, fixture handling, truth construction, measurement, and presentation concerns. Extract configuration resolution and view refresh ownership first. Consolidate duplicated controller checkpoint/RNG serialization where contracts are genuinely shared. Preserve numerical fixtures during these changes rather than attempting a broad rewrite.
5. **Reconcile the live status with the research history.** README/STATUS still cite 190 registry rows and 89 invented rows; the current counts are 291 and 116. Test counts and completed-feature descriptions also lag. Some docs reference Finding 49 although the findings document currently ends at 48. Keep a short current capability/evidence ledger, generate mechanical counts, and retain historical findings as history. Remove references to archived panels from the visible page.
6. **Improve the interface around scientific interpretation.** Keep signal, spectrum, reference, enabled mechanisms, and calibration identity visibly synchronized. Make long-timescale content discoverable when exposed. The inspected desktop layout is usable, but the spectrum sits low in the right column and leaves substantial unused space beneath the main trace; layout changes should prioritize measurement visibility over decoration.

## Recommended sequence

**First: establish a reproducible configuration.** Repair persisted calibration and measurement parity, then share browser/export defaults and identify the resolved configuration in output.

**Second: stabilize the interface and stream.** Correct spectrum invalidation, endpoint seeking, display polarity, and short-record scheduling. Resolve the full-band integration/documentation mismatch and measure segment continuity.

**Third: strengthen empirical evidence.** Correct real-data preprocessing, replace arbitrary prominence semantics, run held-out comparisons across seeds and subjects, and characterize released-strength mechanisms. Publish limitations beside each result.

**Then: improve portability and maintainability.** Reconcile documentation, pin the supported runtime, capture provenance and CI artifacts, and split large modules along tested boundaries.

The highest-value next increment is a stabilization release whose browser output, exported data, stored calibration, and validation report can be traced to the same explicit configuration.
