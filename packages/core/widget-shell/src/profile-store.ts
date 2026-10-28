import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PROFILE_SCHEMA_VERSION } from "./profile-constants.js"
import { migrateStoredProfile, parseStoredProfile } from "./profile-migrations.js"
import {
  defaultProfileRecord,
  projectProfileRecord,
  type ProfileRecord,
  type ProfileRecordSaveInput,
} from "./profile-record.js"

/**
 * Each key owns exactly its own record; the auth layer keeps unrelated callers on different
 * keys. For composition roots; modules consume the narrow {@link ProfileSource} port.
 */
export interface ProfileStore {
  get(key: string): Promise<ProfileRecord | undefined>
  /** Merges over the RAW stored record atomically per key, so concurrent disjoint saves survive. */
  save(
    key: string,
    input: ProfileRecordSaveInput,
    opts?: ProfileSaveOptions,
  ): Promise<ProfileRecord>
  delete(key: string): Promise<boolean>
}

export interface ProfileSaveOptions {
  userId?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A field explicitly set to `undefined` drops out on serialization: that is how a save tool clears it. */
function mergeModuleSlices(
  prev: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...prev }
  for (const [module, slice] of Object.entries(patch ?? {})) {
    const stored = next[module]
    next[module] = isPlainObject(stored) && isPlainObject(slice) ? { ...stored, ...slice } : slice
  }
  return next
}

export interface MergedProfile {
  /** The RAW stored JSON, unknown keys and invalid values included, with the save applied. */
  document: Record<string, unknown>
  record: ProfileRecord
}

/**
 * Bases on the stored JSON, not its parsed view, so nothing a newer build wrote is dropped
 * (and its `schemaVersion` is never stamped down). Every store calls it INSIDE its per-key
 * serialization. Module-specific normalization happens at the module's save-tool boundary.
 */
export function mergeStoredProfile(
  key: string,
  stored: unknown,
  input: ProfileRecordSaveInput,
  now: string,
  opts?: ProfileSaveOptions,
): MergedProfile {
  const migrated = migrateStoredProfile(stored)
  const prev: Record<string, unknown> = migrated?.doc ?? { ...defaultProfileRecord(key) }
  const prevRecord = projectProfileRecord(prev, key)
  const document: Record<string, unknown> = {
    ...prev,
    ...stripUndefined(input),
    // Merged inside the store's lock so concurrent saves of disjoint slice fields both
    // survive, as long as each carries its patch alone (`saveModuleSlice`).
    modules: mergeModuleSlices(prevRecord.modules, input.modules),
    id: key,
    // A stamped owner sticks: a later save without auth context keeps it.
    userId: opts?.userId ?? prevRecord.userId,
    createdAt: prevRecord.createdAt || now,
    updatedAt: now,
    schemaVersion: migrated?.version ?? PROFILE_SCHEMA_VERSION,
  }
  return { document, record: projectProfileRecord(document, key) }
}

/** Lost on restart, per replica behind a load balancer; each save runs in one microtask, so never interleaves. */
export function createInMemoryProfileStore(): ProfileStore {
  const byKey = new Map<string, Record<string, unknown>>()
  const read = (key: string) => parseStoredProfile(byKey.get(key), key)
  return {
    get(key) {
      return Promise.resolve(read(key))
    },
    save(key, input, opts) {
      return Promise.resolve().then(() => {
        const merged = mergeStoredProfile(key, byKey.get(key), input, nowIso(), opts)
        byKey.set(key, merged.document)
        return merged.record
      })
    },
    delete(key) {
      return Promise.resolve(byKey.delete(key))
    },
  }
}

/** Module-wide, so two store instances on the same directory serialize too. */
const fileLocks = new Map<string, Promise<void>>()

/** A failed operation releases the lock like a successful one. */
function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = path.resolve(file)
  const run = (fileLocks.get(lockKey) ?? Promise.resolve()).then(fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  fileLocks.set(lockKey, tail)
  void tail.then(() => {
    if (fileLocks.get(lockKey) === tail) fileLocks.delete(lockKey)
  })
  return run
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT"

/**
 * Per-key lock so concurrent saves merge instead of last-write-wins; temp file + rename so
 * a crash can't truncate a record. The lock is process-local: SINGLE-WRITER per directory
 * (postgres is the multi-instance answer).
 */
export function createFileSystemProfileStore(options: { dir: string }): ProfileStore {
  const { dir } = options
  const fileFor = (key: string) => path.join(dir, `${encodeURIComponent(key)}.json`)

  const readJson = async (key: string): Promise<unknown> => {
    let raw: string
    try {
      raw = await fs.readFile(fileFor(key), "utf-8")
    } catch (err) {
      if (isMissing(err)) return undefined
      throw err
    }
    // Non-JSON reads as "no record" and the next save replaces it; valid JSON is never discarded.
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }

  return {
    get: async (key) => parseStoredProfile(await readJson(key), key),
    save(key, input, opts) {
      const file = fileFor(key)
      return withFileLock(file, async () => {
        const merged = mergeStoredProfile(key, await readJson(key), input, nowIso(), opts)
        await fs.mkdir(dir, { recursive: true })
        const tmp = `${file}.${randomUUID()}.tmp`
        await fs.writeFile(tmp, JSON.stringify(merged.document, null, 2), "utf-8")
        await fs.rename(tmp, file)
        return merged.record
      })
    },
    delete(key) {
      const file = fileFor(key)
      return withFileLock(file, async () => {
        try {
          await fs.unlink(file)
          return true
        } catch (err) {
          if (isMissing(err)) return false
          throw err
        }
      })
    },
  }
}
