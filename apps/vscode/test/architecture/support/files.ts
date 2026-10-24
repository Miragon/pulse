import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}
