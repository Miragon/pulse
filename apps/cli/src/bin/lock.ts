/**
 * An exclusive lock file (design §16.10) for the OAuth token cache: concurrent operate processes
 * must not refresh with the same refresh token. The holder records how long it may keep the lock
 * (`staleAt`); a waiter breaks the lock only after that, so processes with different timeouts
 * never break a live holder's lock. Breaking and releasing compare the content first: a lock a
 * newer holder took is never removed.
 */

import { randomUUID } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';

const POLL_MS = 50;
/** A lock file without a readable `staleAt` (holder died between open and write) after this long. */
const UNREADABLE_STALE_MS = 60_000;

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function pause(ms: number): Promise<void> {
  // a referenced timer: a waiting process must not exit
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The file content, or undefined when it does not exist. */
async function readLock(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function staleAtOf(content: string): number | undefined {
  try {
    const value: unknown = JSON.parse(content);
    const staleAt =
      typeof value === 'object' && value !== null && 'staleAt' in value ? value.staleAt : undefined;
    return typeof staleAt === 'number' ? staleAt : undefined;
  } catch {
    return undefined;
  }
}

async function isStale(path: string, content: string): Promise<boolean> {
  const staleAt = staleAtOf(content);
  if (staleAt !== undefined) return Date.now() > staleAt;
  try {
    return Date.now() - (await stat(path)).mtimeMs > UNREADABLE_STALE_MS;
  } catch {
    return false;
  }
}

/** Removes the lock when its holder's `staleAt` passed and nobody took it meanwhile. */
async function breakIfStale(path: string): Promise<void> {
  const content = await readLock(path);
  if (content === undefined || !(await isStale(path, content))) return;
  // two waiters must not remove a lock a third process just took
  if ((await readLock(path)) === content) await rm(path, { force: true });
}

/** Creates the lock file exclusively; resolves to its content, or undefined when it exists. */
async function tryAcquire(path: string, holdMs: number): Promise<string | undefined> {
  const content = JSON.stringify({
    pid: process.pid,
    staleAt: Date.now() + holdMs,
    id: randomUUID(),
  });
  try {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return content;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return undefined;
    throw error;
  }
}

async function acquire(path: string, holdMs: number): Promise<string> {
  const deadline = Date.now() + 2 * holdMs;
  for (;;) {
    const content = await tryAcquire(path, holdMs);
    if (content !== undefined) return content;
    await breakIfStale(path);
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${2 * holdMs} ms waiting for the lock ${path}`);
    }
    await pause(POLL_MS);
  }
}

/** Removes the lock only while it still holds this holder's content. */
async function release(path: string, content: string): Promise<void> {
  if ((await readLock(path)) === content) await rm(path, { force: true });
}

export async function withLock<T>(
  path: string,
  holdMs: number,
  action: () => Promise<T>,
): Promise<T> {
  const content = await acquire(path, holdMs);
  try {
    return await action();
  } finally {
    await release(path, content);
  }
}
