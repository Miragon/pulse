import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  createFileSystemProfileStore,
  mergeStoredProfile,
  type ProfileStore,
} from "./profile-store.js"
import { createPostgresProfileStore, PROFILE_STORE_MIGRATIONS } from "./profile-store-postgres.js"
import { saveModuleSlice } from "./profile-slice.js"

/** Guards against one unknown value or newer record wiping every module's settings on the next save. */

describe("mergeStoredProfile", () => {
  const NOW = "2026-10-09T12:00:00.000Z"

  it("returns the document to persist (raw keys kept) and its typed view", () => {
    const { document, record } = mergeStoredProfile(
      "k",
      {
        id: "k",
        language: "fr",
        theme: "dark",
        extra: 1,
        schemaVersion: 3,
        createdAt: "c",
        updatedAt: "u",
      },
      { modules: { notes: { sortOrder: "asc" } } },
      NOW,
    )
    // The retired theme preference is just another raw key: kept, never read.
    expect(document).toEqual({
      id: "k",
      language: "fr",
      theme: "dark",
      extra: 1,
      modules: { notes: { sortOrder: "asc" } },
      userId: undefined,
      createdAt: "c",
      updatedAt: NOW,
      schemaVersion: 3,
    })
    expect(record).toEqual({
      id: "k",
      language: "system",
      modules: { notes: { sortOrder: "asc" } },
      createdAt: "c",
      updatedAt: NOW,
      schemaVersion: 3,
    })
  })

  it("stamps createdAt on a document that carries none, and adopts a pre-baseline one", () => {
    const { document, record } = mergeStoredProfile(
      "k",
      { analyticsDefaultPeriod: "30d", schemaVersion: 1 },
      {},
      NOW,
    )
    // Adopted at the baseline: the unknown flat key stays raw, out of the view.
    expect(document).toMatchObject({
      createdAt: NOW,
      schemaVersion: 3,
      modules: {},
      analyticsDefaultPeriod: "30d",
    })
    expect(record.modules).toEqual({})
  })

  it("starts a never-saved key from the defaults", () => {
    const { record } = mergeStoredProfile("k", undefined, { language: "de" }, NOW, {
      userId: "u-1",
    })
    expect(record).toMatchObject({ id: "k", language: "de", modules: {}, userId: "u-1" })
  })
})

/** `seedRaw`/`readRaw` reach underneath the store to the persisted JSON. */
interface RawHarness {
  store: ProfileStore
  seedRaw: (key: string, doc: Record<string, unknown>) => Promise<void>
  readRaw: (key: string) => Promise<Record<string, unknown> | undefined>
}

function rawDocumentContract(makeHarness: () => Promise<RawHarness>) {
  const STORED = {
    id: "user-1",
    userId: "user-1",
    language: "fr", // a locale this build does not ship
    theme: "dark", // the retired theme preference an earlier build saved
    futureTopLevel: { nested: true },
    modules: {
      camunda7: { defaultEngineId: "prod-a", futureSliceField: 7 },
      analytics: { defaultPeriod: "30d" },
      notes: { sortOrder: "asc" },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    schemaVersion: 3,
  }

  it("reads a document with one unknown value field by field — only that field degrades", async () => {
    const { store, seedRaw } = await makeHarness()
    await seedRaw("user-1", STORED)
    expect(await store.get("user-1")).toEqual({
      id: "user-1",
      userId: "user-1",
      language: "system",
      modules: STORED.modules,
      createdAt: STORED.createdAt,
      updatedAt: STORED.updatedAt,
      schemaVersion: 3,
    })
  })

  it("round-trips unknown top-level keys and values through a save from ANY module", async () => {
    const { store, seedRaw, readRaw } = await makeHarness()
    await seedRaw("user-1", STORED)

    const slice = await saveModuleSlice(
      store,
      "user-1",
      "analytics",
      { minBucketSize: 25 },
      { userId: "user-1" },
    )

    const modules = { ...STORED.modules, analytics: { defaultPeriod: "30d", minBucketSize: 25 } }
    expect(slice).toEqual(modules.analytics)
    const saved = await store.get("user-1")
    expect(saved?.modules).toEqual(modules)
    expect(saved?.createdAt).toBe(STORED.createdAt)
    expect(await readRaw("user-1")).toEqual({ ...STORED, modules, updatedAt: saved?.updatedAt })
  })

  it("never mangles a document from a NEWER build (rolling-deploy skew)", async () => {
    const { store, seedRaw, readRaw } = await makeHarness()
    const newer = {
      ...STORED,
      language: "de",
      schemaVersion: 99,
      newCoreField: ["written", "by", "v99"],
    }
    await seedRaw("user-1", newer)

    expect(await store.get("user-1")).toMatchObject({
      language: "de",
      modules: STORED.modules,
    })

    const saved = await store.save("user-1", { language: "en" })
    expect(saved).toMatchObject({ language: "en", modules: STORED.modules })
    // Never stamped down, so the newer build reads its document back without re-migrating.
    expect(await readRaw("user-1")).toEqual({
      ...newer,
      language: "en",
      updatedAt: saved.updatedAt,
    })
  })
}

describe("createFileSystemProfileStore (raw documents)", () => {
  rawDocumentContract(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-raw-"))
    const file = (key: string) => path.join(dir, `${encodeURIComponent(key)}.json`)
    return {
      store: createFileSystemProfileStore({ dir }),
      seedRaw: (key, doc) => writeFile(file(key), JSON.stringify(doc), "utf-8"),
      readRaw: async (key) =>
        JSON.parse(await readFile(file(key), "utf-8")) as Record<string, unknown>,
    }
  })
})

// Opt-in: only with TEST_DATABASE_URL (`pnpm test:pg`); an own schema isolates it.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TEST_SCHEMA = "widget_shell_profile_store_raw_test"

describe.skipIf(!TEST_DATABASE_URL)("createPostgresProfileStore (raw documents)", () => {
  let sql: postgres.Sql

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL!, {
      max: 2,
      onnotice: () => {},
      connection: { search_path: TEST_SCHEMA },
    })
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`)
    for (const migration of PROFILE_STORE_MIGRATIONS) {
      for (const statement of migration.statements) {
        await sql.unsafe(statement)
      }
    }
  })

  beforeEach(async () => {
    await sql`DELETE FROM user_profiles`
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  rawDocumentContract(() =>
    Promise.resolve({
      store: createPostgresProfileStore({ sql }),
      seedRaw: async (key, doc) => {
        await sql`
          INSERT INTO user_profiles (key, profile)
          VALUES (${key}, ${sql.json(doc as postgres.JSONValue)})
        `
      },
      readRaw: async (key) => {
        const rows = await sql<{ profile: Record<string, unknown> }[]>`
          SELECT profile FROM user_profiles WHERE key = ${key}
        `
        return rows[0]?.profile
      },
    }),
  )
})
