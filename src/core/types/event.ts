/**
 * Seam 1 — the event list is the primary output; the waveform is derived.
 *
 * Events carry time, type, amplitude and provenance. Schema 2 renames the old random
 * prominence field to inclusionTag; it was never a measure of event quality.
 *
 * Two fields beyond the five the source documents name, both needed by gates that already
 * exist:
 *   - `channels` — G3 matches YASA's PER-CHANNEL spindle detections against this list, and G6
 *     needs to know where an event was projected. Without it a detection cannot be matched.
 *   - `provenance` — seed, substream name, generator id. Without it a discrepancy found by a
 *     gate cannot be traced back to the generator that produced it.
 */
import type { StateId } from './state.ts';

export type EventType =
  | 'spindle_fast'
  | 'spindle_slow'
  | 'kcomplex'
  | 'slow_oscillation'
  | 'blink'
  | 'emg_burst';

/** Arbitrary triangular random tag in [0, 1]; not morphology, SNR, or scorer agreement. */
export type InclusionTag = number;

export interface EventProvenance {
  /** Root seed of the run. */
  readonly seed: number;
  /** Substream name, i.e. the generator's stable identifier passed to `Rng.substream`. */
  readonly substream: string;
  /** Generator module id, for tracing a discrepancy back to code. */
  readonly generator: string;
}

export interface GeneratedEvent {
  readonly type: EventType;
  /** Seconds from the start of the run. */
  readonly onset: number;
  readonly duration: number;
  /**
   * Peak amplitude in microvolts, AT THE SOURCE, before projection to channels.
   * The per-channel amplitude is this times the projection weight.
   */
  readonly amplitude: number;
  readonly inclusionTag: InclusionTag;
  /** State in force when the event was injected. */
  readonly state: StateId;
  /** Channels the event projects to with non-negligible weight, strongest first. */
  readonly channels: readonly string[];
  readonly provenance: EventProvenance;
  /**
   * Type-specific parameters, e.g. a spindle's centre frequency or an SO's travel delay.
   * Kept open so adding a graphoelement does not change this type.
   */
  readonly params: Readonly<Record<string, number>>;
}

/** The run's primary output. Sorted by onset; the waveform is derived from it. */
export interface EventList {
  readonly events: readonly GeneratedEvent[];
  readonly schemaVersion: number;
}

export const EVENT_SCHEMA_VERSION = 2;

export function makeEventList(events: readonly GeneratedEvent[]): EventList {
  return {
    events: [...events].sort((a, b) => a.onset - b.onset),
    schemaVersion: EVENT_SCHEMA_VERSION,
  };
}

/** Events overlapping [from, to) in time. */
export function eventsInWindow(
  list: EventList,
  from: number,
  to: number,
): readonly GeneratedEvent[] {
  return list.events.filter((e) => e.onset < to && e.onset + e.duration > from);
}

/** Filter by the arbitrary tag for reproducible subsampling, never quality stratification. */
export function eventsAboveInclusionTag(list: EventList, threshold: number): readonly GeneratedEvent[] {
  return list.events.filter((e) => e.inclusionTag >= threshold);
}
