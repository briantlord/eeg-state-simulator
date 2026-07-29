#!/usr/bin/env node
/**
 * Registry emitter and validator.
 *
 *   node tools/registry/emit.mjs          regenerate every projection
 *   node tools/registry/emit.mjs --check  regenerate in memory and diff (CI)
 *
 * `--check` is the fixed-point check: it is what makes the human-readable table and the
 * machine-readable values incapable of disagreeing, rather than merely expected not to.
 *
 * Grammar: tools/registry/GRAMMAR.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'registry', 'parameters.yaml');
const CHECK = process.argv.includes('--check');

const STANDINGS = ['definitional', 'chosen', 'literature', 'derived', 'fitted', 'invented', 'absent'];
const VALUE_KINDS = ['scalar', 'interval', 'enum', 'bound', 'electrodes', 'ordering', 'procedure', 'solved', 'pending', 'absent'];
const INTERVAL_MEANINGS = ['band_edges', 'uncertainty', 'ui_domain'];

const errors = [];
const fail = (key, msg) => errors.push(`${key}: ${msg}`);

// ---------------------------------------------------------------- validation

function validateValue(key, p) {
  const v = p.value;
  if (!v || typeof v !== 'object') return fail(key, 'missing `value` object');
  if (!VALUE_KINDS.includes(v.kind)) return fail(key, `value.kind '${v.kind}' not in ${VALUE_KINDS.join('|')}`);

  switch (v.kind) {
    case 'scalar':
      if (typeof v.v !== 'number') fail(key, 'scalar requires numeric `v`');
      break;
    case 'interval':
      if (typeof v.lo !== 'number' || typeof v.hi !== 'number') fail(key, 'interval requires numeric `lo` and `hi`');
      else if (v.lo > v.hi) fail(key, `interval lo (${v.lo}) > hi (${v.hi})`);
      if (!INTERVAL_MEANINGS.includes(v.meaning)) {
        fail(key, `interval.meaning '${v.meaning}' not in ${INTERVAL_MEANINGS.join('|')} — ` +
          'band_edges, uncertainty and ui_domain are not interchangeable');
      }
      break;
    case 'enum':
      if (!Array.isArray(v.options) || v.options.length === 0) fail(key, 'enum requires non-empty `options`');
      break;
    case 'bound':
      if (!['lt', 'gt', 'le', 'ge'].includes(v.op)) fail(key, `bound.op '${v.op}' not in lt|gt|le|ge`);
      if (typeof v.v !== 'number') fail(key, 'bound requires numeric `v`');
      break;
    case 'electrodes':
      if (!Array.isArray(v.labels) || v.labels.length === 0) fail(key, 'electrodes requires non-empty `labels`');
      break;
    case 'ordering':
      if (typeof v.text !== 'string') fail(key, 'ordering requires `text`');
      if (!Array.isArray(v.relations)) fail(key, 'ordering requires `relations`');
      break;
    case 'procedure':
      if (typeof v.text !== 'string' || !v.text.trim()) fail(key, 'procedure requires non-empty `text`');
      break;
    case 'solved':
      if (!v.procedure) fail(key, 'solved requires `procedure`');
      if (!v.artifact) fail(key, 'solved requires `artifact` naming where the solved value lives');
      break;
    case 'pending':
      if (!p.provisional) fail(key, 'pending REQUIRES a `provisional` sub-object — a pending row holds no value of its own');
      else {
        for (const f of ['v', 'basis', 'expires_at_milestone']) {
          if (p.provisional[f] === undefined) fail(key, `provisional missing '${f}'`);
        }
      }
      break;
    case 'absent':
      if (!v.reason) fail(key, 'absent requires `reason` — "deliberately unset" must say why');
      break;
  }
  if (v.kind !== 'pending' && p.provisional) {
    fail(key, '`provisional` is only valid on a pending row');
  }
}

/** Source discipline. A row failing this is re-standed, not re-sourced by guess. */
function validateSource(key, p) {
  const s = p.source;
  if (!s || !s.kind) return fail(key, 'missing `source` object');

  if (p.standing === 'definitional') {
    if (s.kind !== 'standard' || !s.name?.trim()) {
      fail(key, "standing 'definitional' REQUIRES source.kind 'standard' with a named standard");
    }
  } else if (p.standing === 'literature') {
    const okCitation = s.kind === 'citation' && s.authors?.trim() && s.year;
    const okStandard = s.kind === 'standard' && s.name?.trim();
    if (!okCitation && !okStandard) {
      fail(key, "standing 'literature' REQUIRES an author AND year, or a named standard. " +
        'A venue and year with no author is a contradiction on its face');
    }
  } else if (p.standing === 'derived') {
    if (s.kind !== 'procedure' || !s.text?.trim()) {
      fail(key, "standing 'derived' REQUIRES source.kind 'procedure' stating the derivation");
    }
  }
}

/**
 * Cross-row consistency.
 *
 * Added after review found `k_wake_eo` carrying the value 0.9 under a `basis` string reading
 * "k = knee_freq_low ^ chi" -- which at chi = 0.9 is 14.8, a factor of 16 out. Every k_* row
 * disagreed with its own stated basis, by up to 3783x for N3, and nothing could catch it:
 * per-row validation cannot see that one row contradicts another, and a prose `basis` is not
 * executable. The consequence was not cosmetic -- the analytic 30-45 Hz bias at the registered
 * k is -0.0002 to -0.031, not the -0.42 quoted in three notes and a unit test.
 *
 * Any relationship a `basis` string asserts between rows belongs here, or it is decoration.
 */
function crossCheck(reg) {
  const prov = (key) => reg.params[key]?.provisional?.v;

  for (const state of reg.states) {
    const k = prov(`k_${state}`);
    const fk = prov(`knee_freq_${state}`);
    const chi = prov(`chi_${state}`);
    if (k === undefined || fk === undefined || chi === undefined) continue;
    const expected = Math.pow(fk, chi);
    // 0.1% tolerance: the stored value is rounded for legibility.
    if (Math.abs(k - expected) / expected > 1e-3) {
      fail(
        `k_${state}`,
        `= ${k}, but knee_freq_${state}^chi_${state} = ${fk}^${chi} = ${expected.toFixed(4)}. ` +
          'k is not interpretable without its knee frequency; it must follow from it.',
      );
    }
  }
}

function validate(reg) {
  const states = new Set(reg.states);
  if (!reg.states?.length) errors.push('top level: `states` must enumerate the canonical state set');

  for (const [key, p] of Object.entries(reg.params)) {
    if (!STANDINGS.includes(p.standing)) fail(key, `standing '${p.standing}' not in ${STANDINGS.join('|')}`);
    if (p.units === undefined) fail(key, 'missing `units` (use null for dimensionless)');
    if (!p.section) fail(key, 'missing `section`');
    if (p.states === undefined) fail(key, 'missing `states`');
    else if (p.states !== 'all') {
      if (!Array.isArray(p.states)) fail(key, '`states` must be "all" or a list');
      else for (const st of p.states) if (!states.has(st)) fail(key, `unknown state '${st}'`);
    }
    if ((p.standing === 'invented' || p.value?.kind === 'pending') && !p.milestone) {
      fail(key, 'invented/pending rows REQUIRE a `milestone` — otherwise they are routed nowhere');
    }
    validateValue(key, p);
    validateSource(key, p);

    // The circularity rule, mechanically: a failable gate may not rest on an invented criterion.
    if (p.gate?.failable === true && p.standing === 'invented') {
      fail(key, `gate ${p.gate.id} is failable but its criterion standing is 'invented' — ` +
        'harness section 1 prohibits a pass criterion that is not derived, definitional, or from published ranges');
    }
  }
}

// ------------------------------------------------------------------ emitters

function emitJson(reg) {
  return JSON.stringify({
    schema_version: reg.schema_version,
    generator_version: reg.generator_version,
    states: reg.states,
    toolchain: reg.toolchain,
    params: reg.params,
  }, null, 2) + '\n';
}

const TS_HEADER = `// GENERATED by tools/registry/emit.mjs — do not edit.
// Source of truth: registry/parameters.yaml
`;

function emitDts(reg) {
  const keys = Object.keys(reg.params).sort();
  const lines = [TS_HEADER];
  lines.push(`export type StateId = ${reg.states.map((s) => `'${s}'`).join(' | ')};`);
  lines.push('');
  lines.push(`export type ParamKey =\n${keys.map((k) => `  | '${k}'`).join('\n')};`);
  lines.push('');
  lines.push(`export type Standing = ${STANDINGS.map((s) => `'${s}'`).join(' | ')};`);
  lines.push('');
  // Kind per key, so accessors can be type-checked against the actual value kind.
  lines.push('export interface ParamKindMap {');
  for (const k of keys) lines.push(`  '${k}': '${reg.params[k].value.kind}';`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function fmtValue(p) {
  const v = p.value;
  switch (v.kind) {
    case 'scalar': return String(v.v);
    case 'interval': return `${v.lo}–${v.hi} *(${v.meaning})*`;
    case 'enum': return v.options.join(' or ');
    case 'bound': return `${{ lt: '<', gt: '>', le: '≤', ge: '≥' }[v.op]}${v.v}`;
    case 'electrodes': return v.labels.join('/');
    case 'ordering': return v.text;
    case 'procedure': return v.text;
    case 'solved': return `*solved:* ${v.procedure}`;
    case 'pending': return `— *(pending ${p.milestone}; runs on ${p.provisional.v})*`;
    case 'absent': return '— *(absent)*';
    default: return '?';
  }
}

function fmtSource(s) {
  switch (s.kind) {
    case 'standard': return s.name + (s.clause ? ` — ${s.clause}` : '');
    case 'citation': return `${s.authors} ${s.year}${s.venue ? `, *${s.venue}*` : ''}${s.note ? ` — ${s.note}` : ''}`;
    case 'procedure': return s.text;
    case 'none': return s.rationale || '';
    default: return '';
  }
}

function emitMarkdown(reg) {
  const out = [];
  out.push('# PARAMETERS.md — the constant registry');
  out.push('');
  out.push('> **GENERATED FILE — do not edit.** Source of truth: `registry/parameters.yaml`.');
  out.push('> Regenerate with `npm run registry:emit`; `npm run registry:check` fails the build if');
  out.push('> this file and the registry have drifted apart. See `tools/registry/GRAMMAR.md`.');
  out.push('');
  out.push(`Generator version \`${reg.generator_version}\` · schema \`${reg.schema_version}\``);
  out.push('');
  out.push('**Code reads the registry. No numeric constant may appear in source or UI copy that is');
  out.push('absent from it** — a Tier 0 acceptance check. **It is not yet enforced:**');
  out.push('`tools/lint/literals.mjs` does not exist. This document previously asserted that it did.');
  out.push('');
  out.push(`**States.** \`${reg.states.join('` · `')}\``);
  out.push('');

  out.push('## Pinned toolchain');
  out.push('');
  out.push('*A class-V claim has no meaning without a pinned tool version.*');
  out.push('');
  out.push('| Tool | Version | Gates |');
  out.push('|---|---|---|');
  for (const [t, m] of Object.entries(reg.toolchain)) {
    out.push(`| \`${t}\` | ${m.version}${m.prerelease ? ' **(pre-release)**' : ''} | ${m.gates.join(', ') || '—'} |`);
  }
  out.push('');

  const bySection = new Map();
  for (const [key, p] of Object.entries(reg.params)) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push([key, p]);
  }
  for (const [section, rows] of bySection) {
    out.push(`## ${section}`);
    out.push('');
    out.push('| Key | Value | Units | Standing | Source | States |');
    out.push('|---|---|---|---|---|---|');
    for (const [key, p] of rows) {
      const units = p.units === null ? '—' : p.units;
      const states = p.states === 'all' ? 'all' : p.states.join(', ');
      out.push(`| \`${key}\` | ${fmtValue(p)} | ${units} | \`${p.standing}\` | ${fmtSource(p.source)} | ${states} |`);
    }
    out.push('');
    const noted = rows.filter(([, p]) => p.note);
    if (noted.length) {
      for (const [key, p] of noted) {
        out.push(`**\`${key}\`.** ${p.note.trim().replace(/\s+/g, ' ')}`);
        out.push('');
      }
    }
  }

  // Standing tally — the Tier 1 work plan, mechanically.
  const tally = {};
  for (const p of Object.values(reg.params)) tally[p.standing] = (tally[p.standing] || 0) + 1;
  out.push('## Standing tally');
  out.push('');
  out.push('*`invented` rows are the Tier 1 work plan. `chosen` rows are deliberately not.*');
  out.push('');
  out.push('| Standing | Rows |');
  out.push('|---|---|');
  for (const s of STANDINGS) if (tally[s]) out.push(`| \`${s}\` | ${tally[s]} |`);
  out.push(`| **total** | **${Object.keys(reg.params).length}** |`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------- main

const reg = parse(readFileSync(SRC, 'utf8'));
validate(reg);
crossCheck(reg);

if (errors.length) {
  console.error(`\nRegistry validation FAILED — ${errors.length} error(s):\n`);
  for (const e of errors) console.error('  ' + e);
  console.error('');
  process.exit(1);
}

const outputs = [
  [join(ROOT, 'gen', 'registry.json'), emitJson(reg)],
  [join(ROOT, 'gen', 'registry.d.ts'), emitDts(reg)],
  [join(ROOT, 'docs', 'PARAMETERS.md'), emitMarkdown(reg)],
];

let drifted = 0;
for (const [path, content] of outputs) {
  if (CHECK) {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (existing !== content) {
      console.error(`DRIFT: ${path.replace(ROOT, '.')} does not match registry/parameters.yaml`);
      drifted++;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${path.replace(ROOT, '.')}`);
  }
}

if (CHECK) {
  if (drifted) {
    console.error(`\n${drifted} generated file(s) out of date. Run: npm run registry:emit\n`);
    process.exit(1);
  }
  console.log(`registry check OK — ${Object.keys(reg.params).length} rows, all projections current`);
}
