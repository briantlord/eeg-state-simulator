#!/usr/bin/env node
/** Publication guard. Reports locations/categories, never matched values. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const rules = [
  ['personal filesystem path', /(?:[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9][\w.-]*|\/(?:Users|home)\/[A-Za-z0-9][\w.-]*)/i],
  ['private key material', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{70,255})\b/],
  ['provider credential', /\b(?:AKIA[A-Z0-9]{16}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,})\b/],
];
export function isPrivateEmail(email) {
  return !/^(?:[^@]+@(?:users\.)?noreply\.github\.com|noreply@(?:github|anthropic)\.com)$/i.test(email);
}
export function contentFindings(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  const found = [];
  for (const [category, pattern] of rules) {
    const match = pattern.exec(text);
    if (match) found.push({ category, line: text.slice(0, match.index).split('\n').length });
  }
  return found;
}
export function privateFilename(path) {
  if (path.split('/').some(part => part.toLowerCase() === 'secrets')) return true;
  const name = path.split('/').at(-1);
  if (name === '.env.example' || name === '.env.template') return false;
  return /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\..*)?\.json|id_rsa|id_ed25519)$/i.test(name)
    || /\.(?:pem|key|pfx|p12)$/i.test(name) || path.split('/').includes('secrets');
}
const git = (args, options = {}) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024, ...options });

export function main(args = process.argv.slice(2)) {
  const history = args.includes('--history');
  const staged = args.includes('--staged');
  if (args.some(a => !['--history', '--staged'].includes(a))) throw new Error('Unknown privacy-check option');
  let failures = 0, checked = 0;
  const report = (path, findings) => {
    for (const { category, line } of findings) {
      console.error(`${path}${line ? ':' + line : ''}: ${category} (value withheld)`);
      failures++;
    }
  };
  const inspect = (path, bytes) => { checked++; report(path, contentFindings(bytes)); };
  if (staged) {
    const email = git(['config', 'user.email']).toString().trim();
    if (isPrivateEmail(email)) report('Git identity', [{ category: 'use your GitHub noreply commit email' }]);
  }
  if (history) {
    const identities = git(['log', '--all', '--format=%H%x09%ae%x09%ce']).toString().trim().split('\n');
    for (const row of identities.filter(Boolean)) {
      const [oid, author, committer] = row.split('\t');
      if (isPrivateEmail(author) || isPrivateEmail(committer)) report(`commit ${oid.slice(0, 12)}`, [{ category: 'non-noreply commit identity' }]);
    }
    const objects = git(['rev-list', '--objects', '--all']).toString().trim().split('\n');
    const names = new Map(objects.map(row => { const [oid, ...parts] = row.split(' '); return [oid, parts.join(' ')]; }));
    for (const [oid, path] of names) if (path && privateFilename(path)) report(`history ${path} (${oid.slice(0, 12)})`, [{ category: 'credential filename' }]);
    const data = git(['cat-file', '--batch'], { input: [...names.keys()].join('\n') + '\n' });
    let offset = 0;
    while (offset < data.length) {
      const end = data.indexOf(10, offset);
      const [oid, kind, sizeText] = data.subarray(offset, end).toString().split(' ');
      const size = Number(sizeText);
      if (end < 0 || !Number.isSafeInteger(size)) throw new Error('Invalid Git object stream');
      const body = data.subarray(end + 1, end + 1 + size);
      if (kind === 'blob' || kind === 'commit' || kind === 'tag') inspect(`history ${names.get(oid) || kind} (${oid.slice(0, 12)})`, body);
      offset = end + 1 + size + 1;
    }
  } else {
    const paths = git(['ls-files', '-z']).toString().split('\0').filter(Boolean);
    for (const path of paths) {
      if (privateFilename(path)) report(path, [{ category: 'credential filename' }]);
      const bytes = staged ? git(['show', ':' + path]) : readFileSync(path);
      inspect(path, bytes);
    }
  }
  if (failures) throw new Error(`Privacy check failed: ${failures} finding(s); values were withheld`);
  console.log(`Privacy check OK: ${checked} ${history ? 'historical objects' : 'tracked files'}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'Privacy check failed'); process.exitCode = 1; }
}
