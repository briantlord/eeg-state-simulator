# Retained validation evidence — 0.11.0

These are snapshots from the 4 September 2026 stabilization. Normal reruns write ignored
`prep/out` files and do not overwrite this archive.

- [Gate report](gates.txt) and [machine-readable gate results](gates.json): all failable arms
  pass; positive G1a/G1b/G3/G5 measurements remain record-only.
- [Reserved HMC cohort](state-realism-holdout.json): five new subjects, per-subject measurements,
  six generated seeds, hashes, protocol, toolchain, and distribution summaries.
- [Development cohort](state-realism-development.json): corrected reprocessing of the 19
  previously used nights with the same generated comparisons.
- [Released-strength coupling](released-coupling.json): natural breathing and paired
  exponent-modulation on/off arms at the released depth, with other mechanisms retained.

Input protocol: [state_realism_protocol.json](../../../prep/fixtures/state_realism_protocol.json).
No real waveforms are redistributed. HMC attribution: Alvarez-Estevez and Rijsman (2022),
[Haaglanden Medisch Centrum sleep staging database, version 1.1](https://doi.org/10.13026/t79q-fr32),
PhysioNet, CC BY 4.0. Raw files were verified against the publisher's checksum list.

The checksums and per-subject IDs describe public anonymized dataset records. Results apply to
the declared clinical cohort, derivations, preprocessing, seeds, and configuration, and do not
establish a general physiological realism threshold. See [the stabilization report](../../Stabilization-0.11.0.md).
