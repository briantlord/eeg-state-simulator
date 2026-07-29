/**
 * Registry accessors (seam 6).
 *
 * Code reads the registry. The accessors are typed so that the three incompatible readings of
 * an interval cannot be confused, and so that a `pending` row's provisional number cannot
 * reach arithmetic without saying so at the call site.
 *
 * Source of truth: registry/parameters.yaml -> gen/registry.json
 */
import registryJson from '../../gen/registry.json' with { type: 'json' };
import type { ParamKey, StateId, Standing } from '../../gen/registry.d.ts';

export type { ParamKey, StateId, Standing };

type IntervalMeaning = 'band_edges' | 'uncertainty' | 'ui_domain';

type Value =
  | { kind: 'scalar'; v: number }
  | { kind: 'interval'; lo: number; hi: number; meaning: IntervalMeaning }
  | { kind: 'enum'; options: (string | number)[] }
  | { kind: 'bound'; op: 'lt' | 'gt' | 'le' | 'ge'; v: number }
  | { kind: 'electrodes'; labels: string[] }
  | { kind: 'ordering'; text: string; relations: [StateId, StateId][] }
  | { kind: 'procedure'; text: string }
  | { kind: 'solved'; procedure: string; artifact: string }
  | { kind: 'pending' }
  | { kind: 'absent'; reason: string };

export interface ParamRecord {
  value: Value;
  units: string | null;
  standing: Standing;
  source: Record<string, unknown>;
  states: 'all' | StateId[];
  section: string;
  note?: string;
  milestone?: string;
  provisional?: { v: number; basis: string; expires_at_milestone: string; constrained_by?: string };
  gate?: { id: string; arm: 'positive' | 'null'; failable: boolean };
}

const REG = registryJson as unknown as {
  schema_version: number;
  generator_version: string;
  states: StateId[];
  toolchain: Record<string, { version: string; prerelease: boolean; gates: string[] }>;
  params: Record<string, ParamRecord>;
};

export const GENERATOR_VERSION = REG.generator_version;
export const STATES: readonly StateId[] = REG.states;
export const TOOLCHAIN = REG.toolchain;

export function record(key: ParamKey): ParamRecord {
  const r = REG.params[key];
  if (!r) throw new Error(`registry: no row '${key}'`);
  return r;
}

export function standing(key: ParamKey): Standing {
  return record(key).standing;
}

/** True when the row is not empirically constrained. The UI MUST mark these. */
export function isInvented(key: ParamKey): boolean {
  return record(key).standing === 'invented';
}

function expect<K extends Value['kind']>(key: ParamKey, kind: K): Extract<Value, { kind: K }> {
  const v = record(key).value;
  if (v.kind !== kind) {
    throw new Error(
      `registry: '${key}' is a ${v.kind} row, not ${kind}. ` +
        `Use the ${kind === 'scalar' ? 'right' : 'matching'} accessor — the kinds are not interchangeable.`,
    );
  }
  return v as Extract<Value, { kind: K }>;
}

export function scalarValue(key: ParamKey): number {
  return expect(key, 'scalar').v;
}

/**
 * Both endpoints simultaneously in force — a filter passband. Throws on an `uncertainty`
 * interval, because reading `alpha_amp` 20-50 uV as band edges builds a 20-50 Hz filter.
 */
export function bandEdges(key: ParamKey): { lo: number; hi: number } {
  const v = expect(key, 'interval');
  if (v.meaning !== 'band_edges') {
    throw new Error(
      `registry: '${key}' is an interval with meaning '${v.meaning}', not band_edges. ` +
        'A spread the generator must reduce to a point is not a passband.',
    );
  }
  return { lo: v.lo, hi: v.hi };
}

/** A spread the generator reduces to a point plus Dv. Throws on band edges or a UI domain. */
export function uncertainty(key: ParamKey): { lo: number; hi: number } {
  const v = expect(key, 'interval');
  if (v.meaning !== 'uncertainty') {
    throw new Error(`registry: '${key}' is an interval with meaning '${v.meaning}', not uncertainty.`);
  }
  return { lo: v.lo, hi: v.hi };
}

/** A control's slider range. Never a signal parameter. */
export function uiDomain(key: ParamKey): { lo: number; hi: number } {
  const v = expect(key, 'interval');
  if (v.meaning !== 'ui_domain') {
    throw new Error(`registry: '${key}' is an interval with meaning '${v.meaning}', not ui_domain.`);
  }
  return { lo: v.lo, hi: v.hi };
}

export function enumValue(key: ParamKey): (string | number)[] {
  return expect(key, 'enum').options;
}

export function boundValue(key: ParamKey): { op: 'lt' | 'gt' | 'le' | 'ge'; v: number } {
  const b = expect(key, 'bound');
  return { op: b.op, v: b.v };
}

export function electrodeSet(key: ParamKey): string[] {
  return expect(key, 'electrodes').labels;
}

export function ordering(key: ParamKey): { text: string; relations: [StateId, StateId][] } {
  const o = expect(key, 'ordering');
  return { text: o.text, relations: o.relations };
}

/**
 * The ONLY path to a pending row's number.
 *
 * `P.chi_n2` has no numeric accessor, so `scalarValue('chi_n2')` throws. Every call site that
 * uses a provisional number therefore says so in the source, which is what stops a placeholder
 * from silently becoming the value of record.
 */
export function provisionalValue(key: ParamKey): number {
  const r = record(key);
  if (r.value.kind !== 'pending') {
    throw new Error(`registry: '${key}' is not pending — read it with its own accessor.`);
  }
  if (!r.provisional) throw new Error(`registry: pending row '${key}' has no provisional value`);
  return r.provisional.v;
}

/** Value solved by a one-time procedure (currently `snr_nominal`), read from its artifact. */
export function solvedValue(key: ParamKey, artifactLookup: (path: string) => number): number {
  const v = expect(key, 'solved');
  return artifactLookup(v.artifact);
}

/** Rows a state applies to. */
export function appliesTo(key: ParamKey, state: StateId): boolean {
  const s = record(key).states;
  return s === 'all' || s.includes(state);
}

/** Every row whose standing requires the UI to mark it "not empirically constrained". */
export function inventedKeys(): ParamKey[] {
  return (Object.keys(REG.params) as ParamKey[]).filter((k) => REG.params[k]?.standing === 'invented');
}
