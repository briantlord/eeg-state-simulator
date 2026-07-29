/**
 * Seam 2 — `state(t)` is an interface.
 *
 * Tier 0 implements it as "whatever the control says". Tier 2 implements it as a hypnogram
 * with dwell times and transitions. NO GENERATOR MAY READ A GLOBAL `currentState`, and no
 * generator knows which implementation it is talking to — that is the whole content of the
 * seam, and it is why the Tier 2 upgrade is not a rewrite.
 */
import type { StateId } from '../registry.ts';

export type { StateId };

/** The canonical state set, from the registry. Enumerated in exactly one place. */
export const STATE_IDS: readonly StateId[] = [
  'wake_eo',
  'wake_ec',
  'n1',
  'n2',
  'n3',
  'rem',
] as const;

export const STATE_LABELS: Record<StateId, string> = {
  wake_eo: 'Wake (eyes open)',
  wake_ec: 'Wake (eyes closed)',
  n1: 'N1',
  n2: 'N2',
  n3: 'N3',
  rem: 'REM',
};

/**
 * The seam. Every generator takes one of these and asks it for the state at a time.
 *
 * Deliberately NOT a property or a global: a function of `t` is the only shape that a
 * hypnogram can implement without the generators changing.
 */
export interface StateSource {
  /** State at time `t`, in seconds from the start of the run. */
  at(t: number): StateId;
  /**
   * Fractional blend at time `t`, for generators that must cross-fade through a transition
   * rather than switch discontinuously. Tier 0 returns a single state at weight 1.
   */
  weightsAt(t: number): ReadonlyMap<StateId, number>;
  /** Identifies the implementation in the epoch sidecar. */
  readonly kind: string;
}

/** Tier 0: whatever the control says. */
export class FixedState implements StateSource {
  readonly kind = 'fixed';
  private state: StateId;

  constructor(initial: StateId) {
    this.state = initial;
  }

  at(_t: number): StateId {
    return this.state;
  }

  weightsAt(_t: number): ReadonlyMap<StateId, number> {
    return new Map([[this.state, 1]]);
  }

  /** The UI control writes through this. Generators never see it. */
  set(state: StateId): void {
    this.state = state;
  }
}

/**
 * Tier 0 also needs a scripted source so a fixture can hold a state for a known interval —
 * G4 runs a 300 s record and G5 sweeps epochs. This is NOT the Tier 2 hypnogram: it has no
 * dwell-time model and no transition semantics, it just replays a list.
 */
export class ScriptedState implements StateSource {
  readonly kind = 'scripted';
  private readonly segments: readonly { from: number; state: StateId }[];

  constructor(segments: readonly { from: number; state: StateId }[]) {
    if (segments.length === 0) throw new Error('ScriptedState: needs at least one segment');
    const sorted = [...segments].sort((a, b) => a.from - b.from);
    if (sorted[0]!.from > 0) throw new Error('ScriptedState: first segment must start at t=0');
    this.segments = sorted;
  }

  at(t: number): StateId {
    let current = this.segments[0]!.state;
    for (const seg of this.segments) {
      if (seg.from > t) break;
      current = seg.state;
    }
    return current;
  }

  weightsAt(t: number): ReadonlyMap<StateId, number> {
    return new Map([[this.at(t), 1]]);
  }
}

export function isStateId(x: unknown): x is StateId {
  return typeof x === 'string' && (STATE_IDS as readonly string[]).includes(x);
}
