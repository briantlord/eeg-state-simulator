# EEG State Simulator

A browser-based simulator of multichannel EEG, respiration, and ECG, with reproducible signal
generation and a command-line exporter. Use it to explore how arousal state, physiological
mechanisms, referencing, and filtering affect synthetic signals.

**All displayed waveforms are synthetic.** The generator records its injected events and
mechanism settings so analysis can be compared with known inputs. Those inputs describe the
model; they do not establish that its output reproduces human physiology.

Current version: **0.11.0**, using the shared **`physiology-v1`** configuration.
See the [current status](docs/STATUS.md) and [stabilization report](docs/Stabilization-0.11.0.md)
for measured results and remaining limitations.

## Run the browser app

Requires **Node.js 22.12 or newer** and npm. Python and reference recordings are unnecessary
for running the app or exporting synthetic EEG. The required projection weights, parameter
registry, and calibration are committed in the repository.

```sh
git clone https://github.com/briantlord/eeg-state-simulator.git
cd eeg-state-simulator
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.
To build and preview the static app:

```sh
npm run build
npx vite preview --host 127.0.0.1
```

Preview normally uses `http://127.0.0.1:4173`. The build first checks the saved calibration and
then writes `dist/`. Serve that directory over HTTP; opening `index.html` directly from disk
can fail because of browser module restrictions. Relative asset paths support hosting in a
subdirectory, including a GitHub Pages project path. The GitHub workflow runs verification;
publishing a site is a separate step.

The production app generates and analyzes signals locally in the browser. It has no backend,
account requirement, or runtime request for recordings. Vite's development server additionally
provides development assets and live reload.

## What the app provides

| Area | Current behavior |
| --- | --- |
| States | Wake with eyes open (`wake_eo`), wake with eyes closed (`wake_ec`), N1 (`n1`), N2 (`n2`), N3 (`n3`), and REM (`rem`). Select one state at a time; changing state restarts the signal. |
| EEG | 19 scalp channels plus generated A1/A2 mastoids, sampled at 256 Hz. The mixture includes aperiodic activity, state-dependent rhythms, graphoelements, and provisional cortical infra-slow activity. |
| Events | Spindles, K-complexes, and slow oscillations are marked at their injected times. These markers are generator truth, not detector output. |
| Respiration and ECG | Separate auxiliary lanes show breathing and cardiac activity. Natural/regular breathing and movement-artifact controls expose different mechanisms. Respiratory phase also drives cardiac timing and configured EEG modulation. |
| References | As generated, linked mastoid, contralateral mastoid, average, and a nearest-neighbor Laplacian. The selected reference affects the EEG trace and spectrum. |
| Filters | Adjustable high-pass/low-pass cutoffs and order, zero-phase or causal filtering, a raw overlay, and a Pz spectrum with the filter response. |
| Transport and display | Pause, reset, scrub within the current segment, change the visible window and voltage scale, show mastoids/auxiliaries, and enable 50/60 Hz mains interference. EEG uses negative-up polarity. |
| Continuous full-band view | A separately generated 120, 300, or 600-second record: Fz voltage, a fixed 0.1 Hz high-pass comparison, and a spectrum. Cortical infra-slow voltage and source gain have separate switches. The comparison is available in zero-phase mode. |

The default configuration enables natural respiration, respiratory movement/amplitude/exponent
modulation, respiratory event timing, and both cortical infra-slow mechanisms. Mains interference
is off. The browser and default exporter resolve these settings through the same release profile.

The scrolling display uses 90-second segments and a presentation-only correction at segment
boundaries. Use a continuous export or the continuous full-band view for analysis across long
durations. The full-band record is generated separately; it is not a recording of the scroll.
Its infra-slow switches also update the scrolling signal, while its high-pass comparison stays fixed.

Reproduction requires the same seed, state, duration, options, generator version, and platform.
A seed changes the random realization, not the template head anatomy. Historical complexity,
effective-rank, exponent, and filter-demo readouts are retained in
[archived markup](docs/archived-panels.html); they are not part of the current page.

## Export synthetic EEG

From the repository root:

```sh
npm run export -- --seed 20260728 --state n3 --epochs 10 --out prep/out/run_n3
```

This generates **one continuous 300-second record**, then slices it into ten 30-second epochs.
Choose a new output directory for each run.

```text
prep/out/run_n3/
  manifest.json          version, seed, channels, resolved options, and input fingerprints
  events.json            complete event list with run-relative times
  physiology.json        detailed respiratory, cardiac, and infra-slow generator truth
  epoch_00000/
    signal.f64           channel-major float64, little-endian, microvolts
    signal.csv           human-readable signal copy
    sidecar.json         shape, timing, state, injected truth, and overlapping events
  epoch_00001/ ...
```

Signal files contain the 19 scalp channels and two mastoids **before display filtering and
re-referencing**. Respiration/ECG waveform lanes are not exported as additional signal columns;
their timing and mechanism truth are recorded in `physiology.json`. The Python harness reads
the binary signal rather than the rounded CSV copy.

The exporter accepts all six state IDs above. Independent overrides include
`--respiration-mode regular`, `--movement-artifact false`, `--amplitude-modulation false`,
`--chi-modulation false`, `--no-resp-event-coupling`, `--no-infraslow-cortical`,
`--no-infraslow-modulation`, and `--line-noise true --line-freq 50`.
`--profile isolated` disables respiratory movement, amplitude modulation, and exponent
modulation; its other released mechanisms remain enabled.

Epoch/physiology schema is **7** and event-list schema is **2**. The former event field
`prominence` is now `inclusionTag`: it is a random inclusion tag with no event-quality meaning.
See the [scoring, configuration, and migration contract](docs/Scoring-Contract.md) for details.

## Model and evidence

Cortical components use spatial eigenmodes derived from an **fsaverage three-shell BEM forward
model**, with dipoles normal to the cortical surface and patches named in the Desikan–Killiany
atlas. These reduced weights are generated in Python and consumed as JSON by the runtime.
Respiratory electrode-motion artifact has a separate electrode-space topography. Anatomical
projection does not establish the correctness of source amplitudes, timing, or state differences;
many settings remain provisional in the [parameter ledger](docs/PARAMETERS.md).

The [0.11.0 evidence archive](docs/validation/0.11.0/README.md) records:

| Evaluation | Result and scope |
| --- | --- |
| Software verification | Nine checks passed locally, with 104 TypeScript, 50 Python, and three browser tests. This snapshot used Windows, Node 25.5, Python 3.11, and an existing lead-field cache. |
| Calibration and scoring | The saved full-precision SNR replays its fixture. TypeScript and SciPy agree on filtered samples within numerical tolerances and on occupancy for shared fixtures. This is an operational central-derivation slow-wave proxy, not expert sleep staging. |
| Event recovery | G3 records all-event spindle F1 of 0.569 (median). G5 records 44% of evaluated N3 epochs meeting the proxy criterion, versus 0% for N2 and 3% for attenuated N3. Positive G3/G5 arms have no acceptance threshold. |
| State comparison | Corrected analysis of 19 development HMC nights and five newly reserved nights, compared with six generated seeds. N1/REM spectral allocation remains substantially different; N3 delta allocation is close in this comparison but amplitude is higher. |
| Respiratory coupling | The released-strength on/off probe shows that a coupling-amplitude readout in N2 is not specific to exponent modulation. G4's passing fixture uses enlarged modulation and does not establish recovery at the released strength. |

All gate arms with a pass/fail criterion passed in that snapshot. Positive G1a/G1b/G3/G5 arms
remain **record-only**: their measurements are retained without declaring a pass. Class **V**
means recovery by an external tool; class **C** means a repository-authored check; **U** denotes
no recovery check. Neither an external detector nor a passing internal check establishes
general EEG realism. Current CI results are available in [GitHub Actions](https://github.com/briantlord/eeg-state-simulator/actions/workflows/verify.yml).

HMC is a clinical referral cohort with four EEG derivations and recording artifacts. Scored wake
does not identify eye closure. The reserved comparison does not validate healthy full-montage
sleep covariance. Earlier EEGMAT wake measurements and historical rank results belong to the
[measurement history](docs/Tier0-Estimator-Probe.md), not a new 0.11.0 validation claim.

Remaining work includes state spectral allocation, full-montage sleep covariance, event-quality
labels, interpretation of mixed-mechanism coupling, and content-aware invalidation of the BEM
cache. Automated hypnograms/state transitions and a validated directed-connectivity measure are
not delivered. The [current status](docs/STATUS.md) separates these from implemented features.

## Development and verification

Use **Python 3.11 or 3.12** for the pinned scientific dependencies. Local stabilization used
3.11; CI is configured for Ubuntu, Node 22, and Python 3.12. Run commands from the repository root.

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

macOS/Linux, with Python 3.12 installed:

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are
missing. Local Windows browser tests use installed Microsoft Edge. Keep the virtual environment
active for the Python commands below; npm's verification runner also detects `.venv311` and
`.venv`, preferring `.venv311` when both contain a working interpreter.

The projection check needs anatomical data and a derived lead field. Prepare fsaverage once:

```sh
python -c "from pathlib import Path; import mne; mne.datasets.fetch_fsaverage(subjects_dir=Path.home() / 'mne_data' / 'MNE-fsaverage-data')"
npm run verify
```

The first setup downloads approximately 1 GB of anatomy; the first verification derives the
lead field. Later runs reuse the caches. Neither the anatomy nor `prep/leadfield/cache/` is
committed. A cached projection check is not a cold reproduction of the head model. Real EEG
recordings are not required by `npm run verify`.

Verification runs these nine checks in order and stops on a failed command. A missing
dependency is not counted as a pass.

| Check | Purpose |
| --- | --- |
| Registry fixed point | Confirm generated machine values and parameter documentation match the source registry. |
| Projection fixed point | Re-derive and compare projection weights using the available lead field. |
| Literal acceptance | Flag unregistered numerical literals in audited signal code. |
| Typecheck | Check application, exporter, tests, and maintained TypeScript research probes. |
| Production build | Compile the static browser app. |
| Core tests | Check generators, determinism, mechanism isolation, streaming, and release/calibration contracts. |
| Harness tests | Check exported data, scoring agreement, and scientific-analysis boundaries in Python. |
| Browser integration | Exercise page controls, spectrum refresh, continuous overview, and voltage polarity. |
| Gate ledger | Run seven positive arms and seven matched nulls; a missing arm prevents evaluation. |

Useful commands after setup:

```sh
npm run registry:emit      # after editing registry/parameters.yaml
npm run projection:emit    # after changing spatial-model inputs; requires Python/anatomy
npm run calibrate          # after model/calibration inputs change; writes and replays the artifact
npm run calibration:check  # read-only fingerprint and fixture replay
npm run test:browser       # browser regressions
```

Regenerate affected inputs before recalibrating. The exporter rejects stale calibration;
`npm run build` runs the read-only calibration check before bundling. Edit the source registry,
not generated `gen/` files or `docs/PARAMETERS.md`.

## Reproduce the empirical comparisons

These are optional research runs, separate from CI verification. With the Python environment
active, download the protocol's five reserved HMC nights and evaluate them:

```sh
python -m prep.reference.fetch_hmc_holdout
python -m prep.reference.t1m1_state_realism --cohort holdout
node --experimental-strip-types --no-warnings prep/reference/released_coupling.mts
```

The downloader verifies publisher SHA-256 checksums and stores recordings in the ignored
`prep/realdata/hmc_holdout/` directory. The comparison writes
`prep/out/state_realism_v2_holdout.json`; the coupling probe uses synthetic data only and writes
`prep/out/released_coupling.json`. Neither overwrites the committed evidence archive.

`--cohort development` requires all 19 protocol-listed nights in `prep/realdata/hmc/`, or a
directory supplied with `--cache`. The reserved downloader does not fetch this cohort.
The [frozen protocol](prep/fixtures/state_realism_protocol.json) specifies subjects, seeds,
and epoch counts. Real records are filtered continuously before stage selection; spectral
windows do not bridge unrelated epochs.

The 0.11.0 model was not tuned on the reserved results. If those results inform later model
choices, reserve a fresh cohort to evaluate that later version. These comparisons remain
record-only, without a general physiological-realism acceptance threshold.

## Repository guide

| Path | Purpose |
| --- | --- |
| `registry/`, `gen/` | Source parameter registry and generated runtime values/types. |
| `data/`, `prep/leadfield/` | Committed montage/projection weights and their Python producer. |
| `src/core/` | Signal generators, release defaults, RNG, filters, and types. |
| `src/analysis/`, `src/render/`, `src/ui/` | Analysis functions, canvas rendering, and browser controls. |
| `src/io/`, `bin/` | Versioned export format, provenance, exporter, and calibration CLI. |
| `test/`, `prep/test_*.py`, `prep/gates/`, `prep/nulls/` | Software tests and paired validation arms. |
| `prep/reference/` | Research probes; older exploratory scripts may require local corpora or prior outputs. |
| `docs/validation/0.11.0/` | Retained numerical evidence, tool versions, and provenance. |

Start with the [current status](docs/STATUS.md), [stabilization report](docs/Stabilization-0.11.0.md),
[scoring contract](docs/Scoring-Contract.md), and [parameter ledger](docs/PARAMETERS.md).
The [decisions](docs/DECISIONS.md), [measurement history](docs/Tier0-Estimator-Probe.md),
[build plan](docs/Build-Plan.md), and execution plans retain historical and proposed work;
they are not a current feature list.

## Attribution and license

- **Code:** [BSD-3-Clause](LICENSE).
- **Head model and atlas:** fsaverage, distributed through [MNE-Python](https://mne.tools)
  and derived from [FreeSurfer](https://surfer.nmr.mgh.harvard.edu/), with the Desikan–Killiany
  (`aparc`) parcellation. The committed projection is a reduced derivative; the lead field and
  anatomical files are not redistributed. Portions have been obtained under license from The
  General Hospital Corporation and are subject to the FreeSurfer Software License Agreement.
  Clinical applications are neither recommended nor advised. See [data attribution and terms](LICENSE-DATA.md).
- **Reference recordings:** PhysioNet [EEG During Mental Arithmetic Tasks](https://physionet.org/content/eegmat/)
  and [Haaglanden Medisch Centrum sleep staging database, version 1.1](https://doi.org/10.13026/t79q-fr32).
  Raw recordings are not redistributed. The evidence archive includes numerical summaries and
  public anonymized subject identifiers, with attribution in its [README](docs/validation/0.11.0/README.md).
- **External analysis tools:** [YASA](https://raphaelvallat.com/yasa/) for spindle detection and
  [specparam](https://specparam-tools.github.io/) for aperiodic fits. Dependency versions are
  pinned in [requirements.txt](requirements.txt).
