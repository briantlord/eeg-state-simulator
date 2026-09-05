# Slow-wave scoring and calibration contract

Scorer identity: `central-halfwave-cascade-v2`. Implementations: `src/analysis/aasm.ts` and
`prep/gates/g5_aasm_n3.py`. This is an operational slow-wave occupancy proxy. It does not replace
visual sleep scoring or claim that a central derivation is the universal recommended montage.
The [AASM montage clarification](https://aasm.org/wp-content/uploads/2017/11/Summary-of-Updates-in-v2.1-FINAL.pdf)
distinguishes recommended frontal measurement from central measurement under specified acceptable
montages. The project's named calibration remains C3-A2 for continuity with its stated fixture.

1. Subtract the contralateral mastoid from the named scalp channel. Default: C3-A2.
2. Read the scoring band, order, amplitude threshold, and occupancy threshold from the registry.
3. Cascade an even-order Butterworth high-pass at the lower edge with an equally ordered
   low-pass at the upper edge. This is explicitly different from a frequency-transformed
   Butterworth bandpass. TypeScript uses biquad sections; Python independently designs the
   two filters with SciPy and concatenates their second-order sections.
4. Use forward/reverse filtering with odd reflection and steady-state initial conditions.
   Padding is explicitly `3 * (2 * sectionCount + 1)` samples. This matches the even-order
   convention documented for [SciPy sosfiltfilt](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.sosfiltfilt.html).
   Reject non-finite input and records no longer than the required padding.
5. Split the filtered signal at changes of `sample < 0`; zero is nonnegative. Include the
   final sample in the last half-wave. Ignore half-waves shorter than two samples.
6. Count a half-wave's samples when twice its maximum absolute amplitude meets the registry's
   peak-to-peak threshold. Divide by the complete epoch sample count. This is the project's
   operational amplitude/occupancy approximation, not a claim of equivalence to expert labels.

The TypeScript and SciPy test compares filtered samples as well as final occupancy for silence,
multiple sine amplitudes, offset/edge transients, and the actual calibration record. Floating-point
sample agreement uses numerical tolerances; occupancy must agree exactly for these fixtures.

## Calibration and release configuration

`src/core/profile.ts` owns the released mechanisms. `src/core/release.ts` supplies the calibrated
SNR to the browser, continuous overview, and exporter. Low-level `composeState` remains available
for explicitly constructed experiments. The exporter's `--profile isolated` is a named fixture
with movement, amplitude, and exponent respiratory modulation off; G4 requests it explicitly.
Individual overrides remain independent, including `--respiration-mode natural|regular`.

Calibration uses the released configuration on its named N3 seed/epoch, with infra-slow gain held
neutral. This isolates the carrier/event amplitude from the phase of a partially observed slow
gain cycle. G5 restores released modulation and uses other seeds. Bisection finds a passing point
within a bracket; interference means global monotonicity or a global minimum is not asserted.

The calibration retains full precision and replays the exact serialized value before returning
success. It records the scoring version, generator version, profile, resolved fixture options,
and content fingerprints. `npm run calibration:check` replays the checked-in artifact without
writing; `npm run build` runs that check before bundling. Verification also replays it. Registry, projection,
and implementation fingerprints canonicalize CRLF to LF so Windows checkouts agree with Linux.
The separate calibration-file SHA-256 identifies the actual exported artifact bytes.

Exports record the resolved options, profile and provenance in the manifest. A stale calibration
is an error, not a fallback to 0 dB. The initial clinical segment is tested byte-for-byte against
the exporter at identical seed, state and duration. Later clinical segment joins receive a
presentation-only boundary correction; scientific analysis uses one continuous exported record
or the continuous full-band view.

## Schema migration

Generator/package version: **0.11.0**. Epoch/physiology schema: **7**. Event-list schema: **2**.
The event field `prominence` is renamed `inclusionTag`. Its random draw and random-stream position
are preserved, but it has no morphology, SNR, or human-agreement interpretation. G3 now reports
all-event recovery and its existing matched null. Quality-stratified recovery is unavailable
until an actual event-quality model and corresponding evidence exist.
