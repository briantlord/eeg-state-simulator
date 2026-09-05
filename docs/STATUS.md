# Current status — 0.11.0

Updated 4 September 2026. This is the current capability/evidence ledger. The previous mixed
status and historical measurements are preserved in [the archive](archive/STATUS-before-0.11.md).

The browser, exporter, calibration, and operational slow-wave scorer now have shared, tested
contracts. The model remains provisional: integration correctness and physiological realism
are separate questions. See [stabilization results](Stabilization-0.11.0.md) for the repairs and
independent measurements, and [the scoring contract](Scoring-Contract.md) for exact semantics.

| Area | Current state | Evidence/limitation |
| --- | --- | --- |
| Released configuration | Shared `physiology-v1` | Browser stream/default exporter compared byte-for-byte at identical seed/state/duration |
| Calibration | 3.4836158752441406 dB | Stored fixture replays 0.20338541666666668 occupancy; content fingerprints enforced |
| Scoring | TypeScript/SciPy contract reconciled | Same filtered samples and occupancy on common fixtures; central half-wave operational proxy |
| Trace and spectrum | Repaired | State/seed/reference/filter/segment refresh, endpoint seek, negative-up EEG, and startup timing regressions |
| Continuous full-band view | Integrated | 120/300/600 s; separate cortical-voltage/source-gain switches; unsupported causal comparison hidden |
| Respiratory/cardiac controllers | Preserved | Chunk/save/restore and physiological mechanism tests pass |
| Infra-slow sources | Provisional | Named projected voltage/source gain; recording drift remains a deferred fixture |
| Events | Schema 2 | Random `inclusionTag` has no quality meaning; G3 reports all-event recovery |
| Export | Schema 7 | Resolved profile/options and source/calibration fingerprints; invalid input fails before output creation |
| Verification | Nine configured checks passed | 104 TypeScript, 50 Python, 3 browser tests passed; all failable gate/null arms pass |
| State realism | Record-only | Corrected development analysis plus five reserved HMC nights; N1/REM spectral mismatch remains |
| Released-strength coupling | Record-only | Full-mixture on/off probe; N2 readout is not specific to exponent modulation |
| Registry | 291 rows | 116 invented, 19 absent, 74 pending flags across standings; see generated parameter ledger |

The current held-out-seed G5 occupancy fraction is 0.44 (N2 0.00; attenuated N3 0.03). G3 all-event
median F1 is 0.569. G1a/G1b and the positive G3/G5 arms remain record-only. G4's passing fixture
uses enlarged modulation and does not establish shipped-strength recovery.

New empirical evidence uses a frozen protocol and publisher-verified data. Five newly reserved
nights are kept in `prep/realdata/hmc_holdout`, separate from the 19 fitting nights. The current
code was not tuned on those reserved results. Both cohorts have been evaluated with six generated
seeds, and the full reports retain per-subject/per-seed measurements and provenance.

Next modeling work: spectral allocation on the development cohort, with declared artifact and
recording-condition handling; full-montage sleep covariance; event-quality labels; and interpretation
of mixed-mechanism coupling. Next engineering work: BEM cache derivation fingerprints, portability
of older exploratory scripts, and smaller composition/UI modules. A clean Linux run and cold
head-model derivation were not executed locally during this stabilization.
