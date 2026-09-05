import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The publication guard is native Node JavaScript, also run directly by hooks.
import { contentFindings, privateFilename, isPrivateEmail, pushRoots } from '../tools/privacy/check.mjs';

test('privacy findings identify locations without returning the matched secret', () => {
  const secret = ['ghp', 'A'.repeat(36)].join('_');
  const path = ['C:', 'Users', 'example-person', 'project'].join('\\');
  const input = ['ordinary text', secret, path].join('\n');
  const found = contentFindings(input);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((x: { line: number }) => x.line).sort(), [2, 3]);
  assert.ok(!JSON.stringify(found).includes(secret));
  assert.ok(!JSON.stringify(found).includes(path));
});

test('privacy guard catches material in text containing NUL bytes', () => {
  const marker = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  assert.equal(contentFindings(Buffer.from('prefix\0' + marker)).length, 1);
});

test('push guard scans published tips while ignoring deletions and retained local branches', () => {
  const tip = 'a'.repeat(40), zero = '0'.repeat(40);
  assert.deepEqual(pushRoots(`refs/heads/main ${tip} refs/heads/main ${zero}\n(delete) ${zero} refs/heads/old ${tip}\n`), [tip]);
  assert.deepEqual(pushRoots(''), []);
  assert.throws(() => pushRoots('refs/heads/main --all refs/heads/main ' + zero));
});

test('privacy guard distinguishes local credentials from shareable templates', () => {
  for (const path of ['.env', '.env.local', '.npmrc', 'credentials.json', 'secrets/a.txt', 'secrets/.env.example', 'private.key']) assert.equal(privateFilename(path), true);
  for (const path of ['.env.example', '.env.template', 'src/core/profile.ts', 'docs/Scoring-Contract.md']) assert.equal(privateFilename(path), false);
  assert.equal(isPrivateEmail('123+example@users.noreply.github.com'), false);
  assert.equal(isPrivateEmail('noreply@github.com'), false);
  assert.equal(isPrivateEmail(['person', 'example.com'].join('@')), true);
});
