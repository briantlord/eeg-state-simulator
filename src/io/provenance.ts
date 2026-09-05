/** Node-only content identity for the model and its calibration inputs. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
}

export function modelFingerprint() {
  const textDigest = (path: string): string => createHash('sha256')
    .update(readFileSync(join(ROOT, path), 'utf8').replaceAll('\r\n', '\n')).digest('hex');
  const files: string[] = ['src/analysis/aasm.ts'];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  };
  walk('src/core');
  const implementation = createHash('sha256');
  for (const path of files.map((p) => relative(ROOT, join(ROOT, p)).replaceAll('\\', '/')).sort()) {
    // Canonical newlines make a source identity portable across Git's Windows checkout policy.
    implementation.update(path + '\0').update(readFileSync(join(ROOT, path), 'utf8').replaceAll('\r\n', '\n'));
  }
  return {
    registrySha256: textDigest('gen/registry.json'),
    projectionSha256: textDigest('data/projection_10_20.json'),
    implementationSha256: implementation.digest('hex'),
  };
}
