"""The canonical gate ledger.

The source documents disagree three ways on how many Tier 0 gates there are:

  Build Plan section 1 excludes "every gate beyond the four in section 9"
  Build Plan section 9 is titled "Tier 0's six gates"
  Harness section 5 opens "Four gates." and then specifies G1a, G1b, G2, G3, G4, G5, G6

A runner cannot be written against an ambiguous set, so the ledger is frozen HERE and the
runner asserts against it. Six gate ids, seven evaluation arms, each with exactly one matched
null -- fourteen runner entries.

Deviations from the source documents, each recorded in docs/Execution-Scheme.md:

  G2 is PASS/FAIL, not record-only. Build Plan section 9 groups it with "gates 1-3 are
  record-only", but bit-identity has no distribution to record and a determinism gate that
  cannot fail is worthless. It is also the root of the section 7 dependency graph.

  G5's positive arm is RECORD-ONLY and its null is PASS/FAIL (DECISIONS D9). The positive arm
  reports a pass fraction with no threshold, because every candidate threshold would be
  invented or read from our own generator's spread -- both prohibited by harness section 1.
"""
from __future__ import annotations

from ..spec import GateSpec

#: Frozen. `runner.py` refuses to start if the modules present on disk disagree with this.
GATE_LEDGER: dict[str, GateSpec] = {
    "G1a": GateSpec(
        id="G1a",
        title="chi round-trip, knee mode over 1-45 Hz",
        gate_class="V",
        runtime_tier="fast",
        failable=False,
        depends_on=("G2",),
        criterion_key="gate_chi_tol_knee",
        requires_tools=("specparam",),
        provenance_keys=("chi_n2", "k_n2", "fit_band_broad"),
        claim="Records the recovery error distribution for chi and k. Sets no tolerance at "
        "Tier 0; the tolerance is derived at T1-M2 from specparam bias and variance at our "
        "SNR and window.",
    ),
    "G1b": GateSpec(
        id="G1b",
        title="chi round-trip, fixed mode over 30-45 Hz",
        gate_class="V",
        runtime_tier="fast",
        failable=False,
        depends_on=("G2",),
        criterion_key="gate_chi_tol_fixed",
        requires_tools=("specparam",),
        provenance_keys=("chi_n2", "k_n2", "fit_band_narrow"),
        claim="A DIFFERENT quantity from G1a, not a second estimate of the same one. Its bias "
        "is structural and originates in the modelled 20 Hz knee, so its magnitude is a "
        "function of the invented k_* rows -- not evidence of comparability with published "
        "narrowband exponents.",
    ),
    "G2": GateSpec(
        id="G2",
        title="Determinism, bit-identical within platform and version",
        gate_class="C",
        runtime_tier="fast",
        failable=True,
        depends_on=(),
        criterion_key="gate_determinism",
        requires_tools=(),
        claim="The implementation is self-consistent: one seed gives one output. Says nothing "
        "about whether that output resembles EEG.",
    ),
    "G3": GateSpec(
        id="G3",
        title="Spindle detection, F1 vs inclusion threshold",
        gate_class="V",
        runtime_tier="slow",
        failable=False,
        depends_on=("G2",),
        criterion_key="gate_spindle_f1",
        requires_tools=("yasa",),
        provenance_keys=("spindle_amp", "spindle_rate", "spindle_fast_freq"),
        claim="Records the agreement curve. Sets no pass band: our ground truth has no label "
        "noise, so a realistic generator should score ABOVE the human ceiling, and forcing F1 "
        "down would mean injecting events too marginal to be spindles.",
    ),
    "G4": GateSpec(
        id="G4",
        title="Respiration-chi off-frequency null",
        gate_class="C",
        runtime_tier="fast",
        failable=True,
        depends_on=("G2",),
        criterion_key="gate_g4_criterion",
        requires_tools=(),
        provenance_keys=("chi_mod_depth", "tilt_n_poles", "resp_period_cv"),
        claim="The only check that the filter demonstration measures coupling rather than "
        "leakage from a tilt filter modulated at the respiratory rate. Class C -- we wrote the "
        "estimator -- and still the most important gate in Tier 0.",
    ),
    "G5": GateSpec(
        id="G5",
        title="AASM N3 criterion",
        gate_class="C",
        runtime_tier="fast",
        failable=False,
        depends_on=("G2",),
        criterion_key="gate_aasm_n3_min_fraction",
        requires_tools=(),
        provenance_keys=("delta_amp", "so_amp", "snr_nominal"),
        claim="POSITIVE ARM IS RECORD-ONLY (D9). Post-calibration this is largely a regression "
        "check on the amplitude relationship. It is NOT evidence that our N3 resembles real "
        "N3. The null carries the discriminative weight.",
    ),
    "G6": GateSpec(
        id="G6",
        title="Topography, structural argmax",
        gate_class="C",
        runtime_tier="fast",
        failable=True,
        depends_on=("G2",),
        criterion_key="gate_topography",
        requires_tools=(),
        provenance_keys=("topo_expect_spindle_fast", "topo_expect_kc", "topo_expect_alpha"),
        claim="Tests the PROJECTION FILE against an expectation held independently in the "
        "registry. Reading the expectation from the file being tested would make this a check "
        "that argmax works.",
    ),
}

#: Gate ids in dependency order. G2 is the root: harness section 7's graph starts at seed/RNG,
#: and golden baselines presuppose determinism. Harness section 9's "first actions" omits G2
#: entirely, which is an oversight -- nothing downstream means anything without it.
LEDGER_ORDER: tuple[str, ...] = ("G2", "G4", "G6", "G5", "G1a", "G1b", "G3")


def gate_ids() -> tuple[str, ...]:
    return tuple(GATE_LEDGER)
