#!/usr/bin/env node
/**
 * The numeric-literal acceptance check (Build Plan §6, risk register's top-rated risk).
 *
 *   node tools/lint/literals.mjs            enforce; exit 1 on any unauthorised literal
 *   node tools/lint/literals.mjs --audit    list every literal, grouped by value, no verdict
 *
 * THE RULE, from the registry header: "No numeric constant may appear in source or UI copy that
 * is absent from this registry." The registry is read through typed accessors that take a STRING
 * key -- `scalarValue('fs')`, `uncertainty('alpha_amp')`. A correctly sourced constant is
 * therefore a string in the source, not a number. It follows that ANY numeric literal in the
 * scanned code is, by construction, not registry-sourced, and this linter's whole job is to
 * decide which of those literals are scientific constants masquerading as code.
 *
 * WHY THIS FILE HAD TO EXIST BEFORE THE CLAIM COULD BE MADE. The registry and PARAMETERS.md both
 * once asserted this check was "enforced by tools/lint/literals.mjs" while the file did not
 * exist. That is worse than no claim, for the same reason the harness spec gives about gates: a
 * stated check that does not run licenses exactly the drift it pretends to prevent. The claim
 * was removed (D12) and is restored only now that the check runs.
 *
 * WHAT IT CANNOT DO, stated because a linter that overclaims is the failure mode it exists to
 * prevent. It cannot tell a structural literal from a scientific one by inspection -- `2` might
 * be a pairing or a time constant. So it does not try to be clever: a tiny universal allowlist
 * of arithmetic furniture passes silently, and EVERY other literal must either move into the
 * registry (becoming a string key) or carry an inline `@lit-ok` waiver naming why it is not a
 * parameter. The waiver is not an escape hatch -- it is the same justification discipline the
 * rest of the project runs on, applied one literal at a time and grep-able forever after.
 *
 * SCOPE is the shipped generator and its UI: src/**\/*.ts, bin/*.mts, index.html. NOT the
 * Python harness (prep/, a measurement tool whose bookkeeping bounds are documented inline and,
 * where they act as criteria, registered as gate_g1_null_zero / gate_g3_null_fp_rate), NOT tests
 * (assertions carry literals by nature), NOT tools/ or gen/ (build tooling and generated
 * output), NOT data/ (the sanctioned home for numbers -- seam 3's projection weights live there
 * precisely so they are data, not code).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

// --------------------------------------------------------------------- config

/** Roots to walk, and the extensions that are "scanned code" within them. */
const SCAN = [
  { dir: 'src', exts: ['.ts'] },
  { dir: 'bin', exts: ['.mts'] },
  // PRODUCERS OF SHIPPED ARTIFACTS, whatever language they are written in.
  //
  // prep/ is excluded below as a measurement tool, and that exclusion got read as "Python is out
  // of scope". It is not: prep/leadfield/make_projection.py GENERATES data/projection_10_20.json,
  // which the runtime loads. When the projection producer moved there from tools/*.mjs it left
  // this linter's reach, and three registry rows became a Python constant in the same commit --
  // the guard that exists to catch exactly that was switched off by the migration that needed it.
  // The line is "does it produce something the generator ships", not "what extension is it".
];
/** Single files scanned directly. */
const SCAN_FILES = [
  'index.html',
  // The PRODUCER of data/projection_10_20.json, named individually rather than by directory.
  // Its neighbours in prep/leadfield are probes -- measurement tools, excluded for the same
  // reason the rest of prep/ is. The distinction is "does it produce something the generator
  // ships", not what language it is written in or which folder it sits in.
  'prep/leadfield/make_projection.py',
];

/** Never descend into these. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'gen', 'tools', 'data', 'test', '.venv',
  // Committed derived artifacts (the fsaverage lead field), not code.
  'cache',
  // The measurement harness proper. `prep/leadfield` is listed in SCAN above and reached
  // directly, so removing 'prep' from this set would pull in the probes as well.
  'reference', 'gates', 'nulls', 'fixtures', 'out', 'realdata',
]);
/** Never scan these even if the extension matches (e.g. tests colocated in src). */
const SKIP_FILE = (rel) => rel.endsWith('.test.ts') || rel.endsWith('.d.ts');

/**
 * Arithmetic furniture: values that are structural in effectively every occurrence, allowed
 * without a waiver. Kept DELIBERATELY SMALL. Each earns its place by being a constant of the
 * arithmetic itself rather than of the domain:
 *
 *   0, 1, -1  identity, first index, increment, empty, sign flip.
 *   2         pairing, doubling and halving, the 2 in 2*PI and in a quadratic.
 *   0.5       the midpoint -- Hann windows, rounding, split-the-difference.
 *   100       percent.
 *
 * Everything else, including seemingly innocent values like 3 or 1000, must be justified. A `3`
 * is a pairing count in one place and a filter order in another, and only the author knows
 * which; the waiver makes them say.
 */
export const ALLOW = new Set([0, 1, -1, 2, 0.5, 100]);

/** A literal is waived if its physical line contains this token. Text after it is the reason. */
export const WAIVER = '@lit-ok';

/**
 * A whole file is exempt if it contains this token, which must be followed by a reason. For
 * files that are ALL structure and no signal: an RNG implementation whose every constant is the
 * xoshiro128++/FNV algorithm, a radix-2 FFT, the canvas renderer's layout geometry, the binary
 * float64 format. A file-level waiver is more honest than twenty identical inline ones AND it is
 * a stronger claim -- "no signal parameter lives here at all" -- so it is used sparingly and
 * never on a file in the generator's signal path.
 */
const FILE_WAIVER = '@lit-ok-file';

// ------------------------------------------------------------------ tokenizer

/**
 * The same masking for Python: `#` comments, single- and triple-quoted strings.
 *
 * Separate from `maskCode` rather than generalised, because the two languages disagree about
 * exactly the constructs a masker gets wrong. Python has no template literals and no block
 * comments, but it has triple-quoted strings that span lines and contain `#` freely — and this
 * project's producer opens with a 120-line docstring full of numbers, including a measured
 * sensitivity table. Mis-masking that would bury one real finding under dozens of imaginary ones
 * on the very first run, which is how a linter gets switched off instead of fixed.
 */
export function maskPython(src) {
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] === '\n' ? '\n' : src[i];
  const blank = (from, to) => {
    for (let i = from; i < to && i < src.length; i++) if (src[i] !== '\n') out[i] = ' ';
  };
  const TRIPLES = ['"""', "'''"];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const three = src.slice(i, i + 3);
      const delim = TRIPLES.includes(three) ? three : c;
      const isTriple = delim.length === 3;
      let j = i + delim.length;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src.startsWith(delim, j)) break;
        // An unterminated single-quoted string ends at the newline; without this a stray
        // apostrophe in a comment-free line would swallow the rest of the file.
        if (!isTriple && src[j] === '\n') break;
        j++;
      }
      blank(i, Math.min(j + delim.length, src.length));
      i = j + delim.length;
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Replace every comment and string with spaces of equal length, so line and column numbers of
 * what survives are unchanged. Template-literal TEXT is masked, but the code inside `${...}` is
 * NOT -- a real literal hidden in an interpolation must still be caught.
 *
 * A hand-written state machine rather than a regex, because comments-inside-strings and
 * strings-inside-template-expressions are exactly the cases a regex gets wrong, and a linter
 * that mis-masks either passes real literals or flags imaginary ones.
 */
export function maskCode(src) {
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] === '\n' ? '\n' : src[i];

  // Template-expression depth is a stack because `${ `${}` }` nests.
  let state = 'code';
  const templateStack = [];
  const blank = (i) => {
    if (out[i] !== '\n') out[i] = ' ';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    switch (state) {
      case 'code':
        if (c === '/' && d === '/') { blank(i); blank(i + 1); i++; state = 'line'; }
        else if (c === '/' && d === '*') { blank(i); blank(i + 1); i++; state = 'block'; }
        else if (c === "'") { blank(i); state = 'single'; }
        else if (c === '"') { blank(i); state = 'double'; }
        else if (c === '`') { blank(i); state = 'template'; }
        else if (c === '}' && templateStack.length && templateStack[templateStack.length - 1] === 'expr') {
          templateStack.pop(); blank(i); state = 'template';
        }
        break;
      case 'line':
        if (c === '\n') state = 'code'; else blank(i);
        break;
      case 'block':
        if (c === '*' && d === '/') { blank(i); blank(i + 1); i++; state = 'code'; }
        else blank(i);
        break;
      case 'single':
        blank(i);
        if (c === '\\') { blank(i + 1); i++; }
        else if (c === "'") state = 'code';
        break;
      case 'double':
        blank(i);
        if (c === '\\') { blank(i + 1); i++; }
        else if (c === '"') state = 'code';
        break;
      case 'template':
        if (c === '\\') { blank(i); blank(i + 1); i++; }
        else if (c === '`') { blank(i); state = 'code'; }
        else if (c === '$' && d === '{') {
          // Leave the ${ and the expression visible; scan resumes in code state.
          templateStack.push('expr'); i++; state = 'code';
        } else blank(i);
        break;
    }
  }
  return out.join('');
}

/**
 * Mask HTML down to just its ATTRIBUTE VALUES, which is where a hardcoded parameter default
 * hides -- a slider's `value`/`min`/`max`, an input's default. Removed: comments, <style> (CSS
 * is layout), <script> (external src; app.ts is scanned on its own), and all TEXT CONTENT
 * between tags.
 *
 * Text content is documentation, not a parameter: a note reading "1.02x its own null" or
 * "300 s record" cites a measured finding, exactly as a code comment does, and the linter skips
 * code comments for the same reason. The risk this check exists for -- an invented parameter
 * shipping unmarked -- lives in a control's attributes, not in a sentence describing a result.
 */
export function maskHtml(src) {
  let masked = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  masked = masked.replace(/<style\b[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, ' '));
  masked = masked.replace(/<script\b[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '));
  // Blank every character outside a tag, so only what sits between < and > (attributes) is scanned.
  const out = masked.split('');
  let inTag = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c === '<') inTag = true;
    else if (c === '>') { inTag = false; continue; }
    if (!inTag && c !== '\n') out[i] = ' ';
  }
  return out.join('');
}

/**
 * Numeric literals in masked text. The negative lookbehind excludes digits that are part of an
 * identifier (`background_0`, `Float64Array`, `xoshiro128pp`) or a property, so only free-standing
 * numbers match.
 */
const NUMBER = /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?\d*|\.\d[\d_]*)(?:[eE][-+]?\d+)?)/g;

export function literalsIn(masked) {
  const lineStart = [0];
  for (let i = 0; i < masked.length; i++) if (masked[i] === '\n') lineStart.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const found = [];
  for (const m of masked.matchAll(NUMBER)) {
    const raw = m[0];
    if (raw === '' || raw === '.') continue;
    const value = Number(raw.replace(/_/g, ''));
    if (!Number.isFinite(value)) continue;
    const line = lineOf(m.index);
    found.push({ raw, value, line, col: m.index - lineStart[line] });
  }
  return found;
}

/** True if `token` occurs in `src` at a position the masker blanked (a comment or string). */
function inMaskedRegion(src, masked, token) {
  let from = 0;
  for (;;) {
    const at = src.indexOf(token, from);
    if (at < 0) return false;
    if (masked.slice(at, at + token.length).trim() === '') return true;
    from = at + 1;
  }
}

// ---------------------------------------------------------------------- walk

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full, exts);
    } else if (exts.includes(extname(name)) && !SKIP_FILE(rel)) {
      yield full;
    }
  }
}

function scanTargets() {
  const files = [];
  for (const { dir, exts } of SCAN) {
    const abs = join(ROOT, dir);
    try {
      if (statSync(abs).isDirectory()) files.push(...walk(abs, exts));
    } catch { /* dir may not exist */ }
  }
  for (const f of SCAN_FILES) files.push(join(ROOT, f));
  return files;
}

// -------------------------------------------------------------------- report

// Only run the scan when invoked as a CLI. When imported (by test/literals-lint.test.ts) the
// pure functions above are exercised in isolation, without walking the tree or exiting.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
const args = new Set(process.argv.slice(2));
const AUDIT = args.has('--audit');

const violations = [];
const audit = new Map(); // value -> [{file, line, raw}]

let fileWaived = 0;
for (const file of scanTargets()) {
  const src = readFileSync(file, 'utf8');
  const ext = extname(file);
  const isHtml = ext === '.html';
  const isPy = ext === '.py';
  // A file-level waiver only counts when it appears inside a comment, so the token cannot be
  // waived into effect by a string literal in the code. Check it against the masked source.
  const masked = isHtml ? maskHtml(src) : isPy ? maskPython(src) : maskCode(src);
  // The token counts only where the masker blanked it — i.e. inside a comment or string —
  // so a bare `@lit-ok-file` written as executable code cannot waive its own file.
  if (!AUDIT && inMaskedRegion(src, masked, FILE_WAIVER)) { fileWaived++; continue; }
  const rawLines = src.split('\n');

  for (const lit of literalsIn(masked)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (AUDIT) {
      if (!audit.has(lit.value)) audit.set(lit.value, []);
      audit.get(lit.value).push({ rel, line: lit.line + 1, raw: lit.raw });
      continue;
    }
    if (ALLOW.has(lit.value)) continue;
    const rawLine = rawLines[lit.line] ?? '';
    if (rawLine.includes(WAIVER)) continue;
    violations.push({
      rel, line: lit.line + 1, col: lit.col + 1, raw: lit.raw,
      text: (rawLines[lit.line] ?? '').trim(),
    });
  }
}

if (AUDIT) {
  const values = [...audit.keys()].sort((a, b) => audit.get(b).length - audit.get(a).length);
  let total = 0;
  for (const v of values) {
    const hits = audit.get(v);
    total += hits.length;
    const where = hits.slice(0, 6).map((h) => `${h.rel}:${h.line}`).join('  ');
    const more = hits.length > 6 ? `  (+${hits.length - 6} more)` : '';
    console.log(`${String(hits.length).padStart(4)}  ${String(v).padEnd(12)} ${where}${more}`);
  }
  console.log(`\n${total} literal(s), ${values.length} distinct value(s), across the scanned set.`);
  console.log(`allowlisted values would silence: ${[...ALLOW].join(', ')}`);
  process.exit(0);
}

if (violations.length === 0) {
  const n = scanTargets().length;
  console.log(`literals OK — ${n} file(s) scanned (${fileWaived} whole-file-waived), every ` +
    `numeric literal is allowlisted, registry-sourced, or waived.`);
  process.exit(0);
}

console.error(`\n${violations.length} unauthorised numeric literal(s):\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}:${v.col}  ${v.raw}`);
  console.error(`      ${v.text}`);
}
console.error(
  `\nEvery scientific constant must live in registry/parameters.yaml and be read through a\n` +
  `typed accessor (scalarValue, uncertainty, ...), which makes it a string key rather than a\n` +
  `number here. If a literal is genuinely structural — a pairing, an index, a mathematical\n` +
  `identity — add a trailing "${WAIVER} <reason>" comment on its line. The allowlist\n` +
  `(${[...ALLOW].join(', ')}) covers only arithmetic furniture.\n`,
);
process.exit(1);
}
