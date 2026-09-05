# Stabilization 0.11.0 — 4 September 2026

The browser, exporter, stored calibration, and scoring implementations now share explicit,
tested contracts. The ten actionable findings in the [workspace review](Workspace-Review-2026-09-04.md)
have corresponding repairs. Empirical evaluation was expanded without fitting parameters to
the newly reserved subjects or adding acceptance thresholds from observed results.

## Repairs

| Review finding | Resolution and regression evidence |
| --- | --- |
| Rounded calibration failed replay | Full-precision serialization, immediate replay, and a checked-in-artifact regression with input fingerprints |
| TypeScript/Python scoring mismatch | Explicit filter/edge/half-wave contract; actual filtered samples and occupancy agree on shared fixtures |
| Browser/export default mismatch | Shared `physiology-v1` defaults; initial 90-second record compared byte-for-byte across browser stream and CLI |
| Stale spectrum/reference note | Measurement invalidation independent of archived panels; browser tests cover state, seed, reference, filter, and segment changes |
| Endpoint seek mismatch | Half-open seek range; ordered buffer transitions, including large advances and prefetched physiology |
| Wrong EEG display polarity | Negative-up EEG and raw overlay; renderer-path test also preserves positive-up auxiliary conventions |
| Random prominence interpreted as quality | Renamed to `inclusionTag`, preserving RNG draws; G3 quality sweep retired; all-event recovery and matched null retained |
| Short N3 scheduling hang | Feasible-support check and bounded rejection sampling with an explicit sparse-support fallback |
| Artificial real-data joins | Filter original continuous records first; spectral and texture windows remain inside selected epochs |
| Unexposed full-band capability/zero-taper seam | Continuous 120/300/600-second view integrated, with separate ISF switches; causal mode hides unsupported comparisons. Clinical joins now decay a boundary offset instead of jumping to zero |

Additional fixes include a nonnegative first-frame time delta, numerical/boolean/unknown CLI
argument validation before output creation, maintained research TypeScript in the typecheck,
production/browser checks in verification, and retained CI reports. Vite now limits dependency
discovery to the application entry and ignores generated reports/corpora for file watching.
This prevents report generation from interfering with browser-test startup and page state.

Node support is declared as >=22.12, with Node 22 used in CI. Playwright is a development-only
dependency. A compatible transitive nanoid update resolved the npm audit advisory; npm reported
zero vulnerabilities after that update.

## Calibration and versioned output

- Generator/package **0.11.0**; epoch/physiology schema **7**; event-list schema **2**.
- Saved SNR: **3.4836158752441406 dB**.
- Named calibration occupancy: **0.20338541666666668**, reproduced from the saved value.
- Scorer: `central-halfwave-cascade-v2`, an explicit C3-A2 operational slow-wave proxy.
- Registry, projection, and implementation fingerprints normalize text line endings; the
  export manifest also records the calibration artifact SHA-256 and complete resolved options.
- A stale calibration raises an error. G4 explicitly selects the isolated fixture profile;
  normal exports and the browser use the released profile.

The [scoring contract](Scoring-Contract.md) specifies the approximation and schema migration.
Stored data consumers must migrate `prominence` to `inclusionTag` and remove any quality
interpretation. This tag does not alter the current waveform or express detector confidence.

## Verification

The full **nine-check** `npm run verify` passed, including the production build and all failable
gate/null arms. **104 TypeScript tests**, **50 Python tests**, and **3 browser integration tests**
passed. The Python count includes four additional CLI validation cases run after the full suite;
the final typecheck, literal check, and release regressions were also rerun after those additions.

Verification used Windows, Node 25.5.0, the existing Python 3.11 environment, and the existing
lead-field cache. A clean Linux CI run and cold head-model derivation were not executed locally.
Build outputs and local logs are under `prep/out`; retained numerical evidence is in
[the validation archive](validation/0.11.0/README.md).

The current gate report is narrower than a realism verdict. G5 records **0.44** qualifying
N3 epochs across held-out seeds, against **0.00** in N2 and **0.03** in attenuated N3. G3's
all-event median F1 is **0.569**. G1a/G1b recovery remains biased and record-only; G4 still tests
an intentionally enlarged fixture. No tolerance was weakened to make these results pass.

## Independent state comparison

The protocol was frozen before downloading SN021–SN025 from
[HMC version 1.1](https://physionet.org/content/hmc-sleep-staging/1.1/). Each file was verified
against the publisher's SHA-256 list and kept outside the legacy fitting directory. These five
subjects were absent from the existing workspace cache. All five supplied enough epochs for
every compared state. The 19 previously used development nights were also reprocessed; N1 and
N3 each had 18 qualifying development subjects.

Both cohorts were compared with six fixed generated seeds, 300 seconds per state per seed,
using the same four derivations and analysis passband. Generated measurements were identical
between cohort runs. Real records were filtered continuously before selecting up to 120
30-second epochs per subject/state; spectral windows never bridge nonadjacent selections.
Results are summarized within subject or seed before comparing distributions.

| State | Reserved-cohort RMS (µV) | Generated RMS (µV) | Reserved delta fraction | Generated delta fraction |
| --- | ---: | ---: | ---: | ---: |
| Wake EC comparison | 12.199 | 10.355 | 0.857 | 0.189 |
| N1 | 11.395 | 11.714 | 0.693 | 0.135 |
| N2 | 13.952 | 13.013 | 0.728 | 0.489 |
| N3 | 21.991 | 26.707 | 0.866 | 0.870 |
| REM | 9.948 | 13.516 | 0.591 | 0.097 |

These are medians, not acceptance bounds. N3's delta allocation is close in this comparison,
but its scale is higher. N1/REM spectral allocation remains substantially different. The corrected
development analysis also shows this disagreement: development delta medians are 0.814 in N1
and 0.741 in REM, versus generated 0.135 and 0.097. Agreement in overall RMS alone is insufficient.

HMC is a clinical referral population, includes recording artifacts, and provides four EEG
derivations. Scored wake does not identify eye closure, so its comparison with wake_ec is an
approximation. No post-hoc artifact exclusion was introduced after seeing these results.
Real/generated durations and cohort sizes differ; the archived reports retain sample counts,
IQRs, file hashes, configuration, and tool versions. This evaluates the declared protocol, not
healthy full-montage EEG realism. If these findings inform later model choices, a new untouched
cohort should be reserved for evaluating that later version.

## Coupling at the released strength

An additional probe uses natural respiration, the full released mixture, six seeds, and
300 seconds per state at linked-mastoid Fz. Each pair differs only in exponent modulation;
the injected depth stays **0.15**. The slope estimator is regressed against respiratory phase
at the center of each estimation window.

| State | Median on-arm depth | Median off-arm depth | Median depth of paired estimator difference | On > off |
| --- | ---: | ---: | ---: | ---: |
| Wake EC | 0.03969 | 0.02027 | 0.03714 | 6/6 |
| N2 | 0.17259 | 0.17779 | 0.02524 | 1/6 |
| N3 | 0.21071 | 0.20330 | 0.02031 | 6/6 |

The off arm retains other respiratory mechanisms. Its nonzero coupling is not evidence of
injected exponent modulation. In N2 the on-arm amplitude is usually lower than the off arm,
despite a measurable paired waveform change. This limits the interpretation of a simple
coupling-amplitude readout in the full mixture. The probe is record-only and establishes no
physiological-validity or recovery threshold.

## Remaining work

The next modeling work should address spectral allocation on the development corpus, with
explicit control of recording conditions and artifacts. Full-montage sleep covariance, validated
event-quality labels, and interpretable released-strength coupling remain open scientific work.
Recording drift remains a deferred fixture rather than an asserted cortical source.

Content-aware invalidation of the BEM derivation cache, portability cleanup of older exploratory
scripts, and decomposition of the large composition/UI modules remain engineering improvements.
Their absence does not invalidate the repaired contracts, but cached fixed-point checks should
not be described as a cold reproduction of the head model.
