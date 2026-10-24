/** Temporary directories that are removed after a suite. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  await rm(path, { recursive: true, force: true });
}
