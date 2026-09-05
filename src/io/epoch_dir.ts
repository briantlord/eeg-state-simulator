/**
 * Seam 9 — export writes a DIRECTORY of fixed-schema epochs, not a single file.
 *
 * This is also the boundary the harness measures (DECISIONS D7): `/prep` invokes the headless
 * CLI and reads what lands here. Two consequences that shaped the format:
 *
 *  1. **The harness-facing signal is binary float64, not CSV.** Build Plan section 8 says CSV;
 *     harness section 8 requires float64. G2's bit-identity check run through a lossy
 *     serializer tests the serializer rather than the generator — the same argument harness
 *     section 8 uses to reject EDF. A CSV is written alongside for human inspection and is
 *     never read back by a gate.
 *  2. **The sidecar carries injected ground truth.** Every recovery gate needs it. Without it
 *     the harness would have to reimplement generator internals to reconstruct truth, and at
 *     Tier 2 that means the Python package and the harness must agree on the reconstruction —
 *     reintroducing the parity requirement the plan strikes.
 *
 * @lit-ok-file: the binary float64 epoch-directory format — 8 bytes per sample, the 0x3f
 * high-byte little-endian probe, CSV precision of 9 significant figures, a 5-digit zero-padded
 * epoch index. Serialization layout, no signal parameter.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventList, GeneratedEvent } from '../core/types/event.ts';
import type { StateId } from '../core/types/state.ts';
import type { ComposeResult } from '../core/generators/compose.ts';
import { GENERATOR_VERSION, scalarValue } from '../core/registry.ts';
import { RNG_IDENTITY } from '../core/rng/xoshiro128pp.ts';

// v2 added the full aperiodic mixture. v3 added respiratory aperiodic loading/phase and
// per-band periodic modulation. v4 adds respiratory event hazards and realized event-marker
// phases. v5 adds realized respiratory, cardiac and event-phase summaries. v6 adds the
// released cortical infra-slow source and modulation truth. Legacy primary fields stay so
// older analyses remain meaningful.
export const EPOCH_SCHEMA_VERSION = scalarValue('export_schema_version');

type RespirationTruth = ComposeResult['truth']['respiration'];
type CardiacTruth = ComposeResult['truth']['cardiac'];
type EventPhaseSummary = ComposeResult['truth']['eventPhaseSummaries'];
type InfraSlowTruth = ComposeResult['truth']['infraSlow'];

/** Variable-length physiology is written once per run, never copied into every epoch. */
export interface RunPhysiologyTruth {
  readonly schemaVersion: number;
  readonly respiration: RespirationTruth;
  readonly cardiac: CardiacTruth;
  readonly eventPhaseSummaries: EventPhaseSummary;
  /** Complete source-level ISF truth, or null when the matched mechanism-off arm is used. */
  readonly infraSlow: InfraSlowTruth | null;
}

/** Ground truth as INJECTED, not as recovered. The harness compares against this. */
export interface InjectedTruth {
  /** Aperiodic exponent actually used for synthesis, per state. */
  readonly chi: number;
  /** Knee parameter k. Knee frequency is k^(1/chi). Encodes the ~20 Hz knee only (D3). */
  readonly knee: number;
  /** Every aperiodic component actually synthesized, including its share of background variance. */
  readonly aperiodicComponents: readonly {
    chi: number;
    knee: number;
    rmsFraction: number;
  }[];
  /** Mix parameter in dB relative to `snr_nominal`. */
  readonly snrDb: number;
  /** Respiration-chi modulation depth in chi units, 0 when the mechanism is off. */
  readonly chiModDepth: number;
  /** State-specific phi_0 in chi(t) = chi_state + A*cos(phi_resp - phi_0). */
  readonly chiModPhi0: number;
  /** Lead-field-derived modulation-depth loading, in channel order. */
  readonly chiSpatialLoading: readonly number[];
  /** Periodic log-amplitude coupling actually applied to each represented rhythm. */
  readonly periodicModulations: readonly {
    generator: string;
    band: readonly [number, number];
    depth: number;
    phi0: number;
  }[];
  /** Respiration frequency in Hz. */
  readonly respFreq: number;
  /** Respiratory event-hazard configuration; realized marker phase lives on each event. */
  readonly respEventCoupling: {
    enabled: boolean;
    soPreferredPhase: number;
    soHazardKappa: number;
    fastSpindlePreferredPhase: number;
    fastSpindleHazardKappa: number;
    slowSpindleHazardKappa: number;
  };
  /** Compact run summary; the variable-length breath list lives in `physiologyFile`. */
  readonly respiration: Omit<RespirationTruth, 'breaths'>;
  /** Compact run summary; R peaks and RR intervals live in `physiologyFile`. */
  readonly cardiac: Omit<CardiacTruth, 'rPeaksS' | 'rrIntervalsS'>;
  /** Circular summaries of event markers whose respiratory phases are in the event list. */
  readonly eventPhaseSummaries: EventPhaseSummary;
  /**
   * Compact ISF index. Per-mode amplitudes and modulation depths live once in
   * `physiologyFile`, avoiding a large copy in every epoch sidecar.
   */
  readonly infraSlow: null | {
    readonly fixture: boolean;
    readonly profile: 'explicit_fixture' | 'provisional_release';
    readonly extrapolated: boolean;
    readonly sourceModeIds: readonly string[];
    readonly modulationTargets: readonly string[];
    readonly electrodeDriftEnabled: boolean;
  };
  /** Run-relative path to detailed physiology truth, stored once rather than per epoch. */
  readonly physiologyFile: 'physiology.json';
  /**
   * Frequency of an INDEPENDENT chi modulator, decoupled from respiration. Non-null only in
   * the G4 fixture: harness section 5 requires modulating chi at f1 while respiration runs at
   * f2, and Build Plan section 5.2 defines chi(t) as driven by respiration, so this capability
   * exists nowhere in the shipped UI. See DECISIONS D8.
   */
  readonly independentChiModFreq: number | null;
  /** Per-generator channel weights actually applied, from the projection file. */
  readonly projectionWeights: Readonly<Record<string, readonly number[]>>;
  /**
   * Which respiratory mechanisms were enabled (Build Plan 5.1 a/b/c).
   *
   * FIVE FLAGS FOR FOUR MECHANISMS, because (c) has two halves that behave differently
   * enough that recording them as one would lose the distinction the sidecar exists to
   * preserve: `amplitudeModulation` moves 0.5-4 Hz power, which overlaps chi-hat's 2-8 Hz low
   * band and therefore produces a legitimate line at the respiratory rate, while
   * `chiModulation` acts on the spectral slope. G4's fixture needs the first OFF and the
   * second ON; a reader who cannot tell them apart cannot reproduce the gate.
   */
  readonly respMechanisms: {
    movementArtifact: boolean;
    rmbo: boolean;
    amplitudeModulation: boolean;
    chiModulation: boolean;
    eventTiming: boolean;
  };
  /**
   * True when graphoelements were omitted from the channel mix (G3's matched null).
   *
   * RECORDED RATHER THAN INFERRED. The event list still describes what would have been
   * injected, so a reader comparing events against the signal would find every one of them
   * missing and have no way to tell a deliberate null from a broken generator.
   */
  readonly graphoelementsSuppressed: boolean;
}

export interface EpochSidecar {
  readonly schemaVersion: number;
  readonly epochIndex: number;
  /** Seconds from the start of the run. */
  readonly tStart: number;
  readonly duration: number;
  readonly fs: number;
  readonly channels: readonly string[];
  readonly state: StateId;
  readonly truth: InjectedTruth;
  /** Events overlapping this epoch. The full list is also written at run level. */
  readonly events: readonly GeneratedEvent[];
  /** Row-major shape of signal.f64: [channels, samples]. */
  readonly shape: readonly [number, number];
  readonly dtype: 'float64';
  readonly byteOrder: 'little';
  readonly units: 'uV';
}

export interface RunManifest {
  readonly schemaVersion: number;
  readonly generatorVersion: string;
  readonly seed: number;
  readonly rng: typeof RNG_IDENTITY;
  readonly fs: number;
  readonly channels: readonly string[];
  readonly referenceChannels: readonly string[];
  readonly nEpochs: number;
  readonly epochDuration: number;
  /**
   * Digest of gen/registry.json. Golden baselines are keyed by generator version AND this,
   * because the registry drives generated output as directly as the code does — a registry
   * edit changes golden values without a code change.
   */
  readonly registryDigest: string;
  readonly stateSourceKind: string;
  readonly configuration?: { readonly profile: string; readonly options: Readonly<Record<string, unknown>> };
  readonly provenance?: {
    readonly registrySha256: string;
    readonly projectionSha256: string;
    readonly implementationSha256: string;
    readonly calibrationSha256: string;
  };
  readonly createdBy: string;
}

/** Channels x samples, row-major, float64 little-endian. */
export function encodeSignal(signal: readonly Float64Array[]): Buffer {
  const nCh = signal.length;
  if (nCh === 0) throw new Error('epoch_dir: no channels');
  const nSamp = signal[0]!.length;
  for (const ch of signal) {
    if (ch.length !== nSamp) throw new Error('epoch_dir: ragged channels');
  }
  const flat = new Float64Array(nCh * nSamp);
  for (let c = 0; c < nCh; c++) flat.set(signal[c]!, c * nSamp);
  // Node is little-endian on every platform this ships to; assert rather than assume.
  if (new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f) {
    return Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength);
  }
  throw new Error('epoch_dir: big-endian host is unsupported');
}

/** Human-readable projection. NEVER read back by a gate — see the note at the top. */
export function encodeCsv(
  signal: readonly Float64Array[],
  channels: readonly string[],
): string {
  const nSamp = signal[0]!.length;
  const lines: string[] = [channels.join(',')];
  for (let i = 0; i < nSamp; i++) {
    const row = new Array<string>(signal.length);
    for (let c = 0; c < signal.length; c++) row[c] = signal[c]![i]!.toPrecision(9);
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

export interface EpochWrite {
  readonly signal: readonly Float64Array[];
  readonly sidecar: EpochSidecar;
}

export function writeEpoch(runDir: string, epoch: EpochWrite): string {
  const dir = join(runDir, `epoch_${String(epoch.sidecar.epochIndex).padStart(5, '0')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'signal.f64'), encodeSignal(epoch.signal));
  writeFileSync(join(dir, 'signal.csv'), encodeCsv(epoch.signal, epoch.sidecar.channels));
  writeFileSync(join(dir, 'sidecar.json'), JSON.stringify(epoch.sidecar, null, 2) + '\n');
  return dir;
}

export function writeManifest(runDir: string, manifest: RunManifest): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

export function writeEventList(runDir: string, list: EventList): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'events.json'), JSON.stringify(list, null, 2) + '\n');
}

export function writePhysiologyTruth(runDir: string, truth: RunPhysiologyTruth): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'physiology.json'), JSON.stringify(truth, null, 2) + '\n');
}

/** Samples per epoch, from the registry. */
export function epochSamples(): number {
  return scalarValue('fs') * scalarValue('epoch_display');
}

export function defaultManifestFields(): Pick<RunManifest, 'schemaVersion' | 'generatorVersion' | 'rng' | 'createdBy'> {
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    rng: RNG_IDENTITY,
    createdBy: 'eegsim-export',
  };
}
