/**
 * Seam 1 — the event list is the primary output; the waveform is derived.
 *
 * "Every event carries onset, duration, amplitude, type, AND a graded prominence/quality
 * field. The graded field is what makes the Tier 1 detector-agreement curve possible; adding
 * it later means regenerating every stored result."
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

/**
 * Graded prominence in [0, 1].
 *
 * This is the field G3's F1-vs-inclusion-threshold curve sweeps. It is NOT a detection
 * confidence and NOT a probability — it is how canonical an exemplar of its type the event is,
 * assigned at injection time by the generator that made it. An event at 0.1 is one a human
 * scorer would likely miss; at 1.0 it is textbook.
 */
export type Prominence = number;

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
  readonly prominence: Prominence;
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

export const EVENT_SCHEMA_VERSION = 1;

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

/**
 * Events at or above an inclusion threshold on prominence.
 *
 * G3 sweeps this threshold and reports F1 as a function of it. Tier 0 records the curve and
 * sets no pass band: our ground truth has no label noise, so a realistic generator should
 * score ABOVE the human ceiling, and forcing F1 down would mean injecting events too marginal
 * to be spindles.
 */
export function eventsAboveProminence(
  list: EventList,
  threshold: number,
): readonly GeneratedEvent[] {
  return list.events.filter((e) => e.prominence >= threshold);
}
