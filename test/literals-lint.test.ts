/**
 * The literal linter's own tokenizer, tested.
 *
 * The linter is the acceptance check for the register's top-rated risk, and it is only as
 * trustworthy as its masking: a masker that mis-handles a string, comment or template
 * expression either passes a real magic number or flags an imaginary one. Both failures are
 * silent in normal use -- the linter goes green -- so the masker is pinned here rather than
 * trusted. The cases are the exact ones a regex-based masker gets wrong, which is why the
 * linter uses a state machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// The linter is a build tool (untyped .mjs); it is imported here to exercise its runtime
// tokenizer, so the shapes are annotated at the call sites rather than pulled from a .d.ts.
// @ts-expect-error — no declaration file for the build-tool module, by design.
import { maskCode, maskHtml, literalsIn, ALLOW } from '../tools/lint/literals.mjs';

interface Lit { value: number; raw: string; line: number; col: number }

/** Values of the free-standing numeric literals the linter would see in `code`. */
function values(code: string): number[] {
  return (literalsIn(maskCode(code)) as Lit[]).map((l) => l.value);
}

test('a bare magic number is seen', () => {
  assert.deepEqual(values('const x = 0.37;'), [0.37]);
});

test('numbers inside strings and comments are NOT seen', () => {
  assert.deepEqual(values("const s = 'freq 9.9 Hz'; // and 8.8 too"), []);
  assert.deepEqual(values('/* block 7.7 */ const y = 1;').filter((v) => v !== 1), []);
});

test('a number inside a template EXPRESSION is seen; template text is not', () => {
  // The text "3.3 Hz" is masked; the 4.4 in the interpolation is real code.
  assert.deepEqual(values('const t = `3.3 Hz ${x * 4.4}`;'), [4.4]);
});

test('digits that are part of an identifier are not literals', () => {
  assert.deepEqual(values('const a = Float64Array; const b = background_0; xoshiro128pp();'), []);
});

test('hex, scientific and separators parse to their value', () => {
  assert.deepEqual(values('const a = 0x3f;'), [0x3f]);
  assert.deepEqual(values('const b = 1e-3;'), [1e-3]);
  assert.deepEqual(values('const c = 2_000;'), [2000]);
});

test('a regex literal is a known blind spot the linter waives, not a silent miss', () => {
  // The masker does not parse regex, so /[13579]$/ surfaces 13579 as a "literal". That is why
  // the two such lines in the codebase carry @lit-ok waivers rather than being silently
  // dropped. This asserts the surfacing so the waiver stays necessary and honest.
  assert.ok(values('const m = /[13579]$/.test(s);').includes(13579));
});

test('the allowlist is only arithmetic furniture', () => {
  // If this set ever grows, it is a deliberate widening of what ships unjustified — make it
  // fail loudly so that widening is a decision, not a drift.
  assert.deepEqual([...ALLOW].sort((a, b) => a - b), [-1, 0, 0.5, 1, 2, 100]);
});

test('HTML masking keeps attribute values and drops text and CSS', () => {
  const html = [
    '<style>.a { width: 320px; }</style>',
    '<p>measured 1.02 times</p>',
    '<input max="90" />',
  ].join('\n');
  // 320 (CSS) and 1.02 (prose) are dropped; 90 (an attribute) survives.
  assert.deepEqual((literalsIn(maskHtml(html)) as Lit[]).map((l) => l.value), [90]);
});
