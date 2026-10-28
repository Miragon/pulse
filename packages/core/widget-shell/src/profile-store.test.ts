import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  createFileSystemProfileStore,
  createInMemoryProfileStore,
  type ProfileStore,
} from "./profile-store.js"
import { createPostgresProfileStore, PROFILE_STORE_MIGRATIONS } from "./profile-store-postgres.js"
import { defaultProfileRecord } from "./profile-record.js"
import { saveModuleSlice } from "./profile-slice.js"

describe("defaultProfileRecord", () => {
  it("returns a complete, defaulted record for an unsaved key", () => {
    const p = defaultProfileRecord("sess-1")
    expect(p).toMatchObject({
      id: "sess-1",
      language: "system",
      modules: {},
      schemaVersion: 3,
    })
    expect(p.userId).toBeUndefined()
    expect(p.createdAt).toBe(p.updatedAt)
  })
})

/** Run against each store so implementations cannot drift; `makeStore` keys start absent. */
function profileStoreContract(makeStore: () => Promise<ProfileStore>) {
  it("returns undefined for an unknown key", async () => {
    const store = await makeStore()
    expect(await store.get("missing")).toBeUndefined()
  })

  it("creates, then merges partial updates without wiping other fields", async () => {
    const store = await makeStore()

    const created = await store.save("sess-1", { language: "de" })
    expect(created.language).toBe("de")
    expect(created.modules).toEqual({})

    const updated = await store.save("sess-1", { modules: { analytics: { defaultPeriod: "7d" } } })
    expect(updated.modules).toEqual({ analytics: { defaultPeriod: "7d" } })
    expect(updated.language).toBe("de")
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt >= created.updatedAt).toBe(true)
  })

  it("merges module slices per namespace without wiping other modules", async () => {
    const store = await makeStore()
    await store.save("sess-1", { modules: { analytics: { defaultPeriod: "30d" } } })
    const updated = await store.save("sess-1", { modules: { other: { flag: true } } })
    expect(updated.modules).toEqual({
      analytics: { defaultPeriod: "30d" },
      other: { flag: true },
    })
    const untouched = await store.save("sess-1", { language: "de" })
    expect(untouched.modules).toEqual(updated.modules)
  })

  it("merges the saved module slice one level deep, leaving siblings intact", async () => {
    const store = await makeStore()
    await store.save("sess-1", {
      modules: { camunda7: { defaultEngineId: "prod-a" }, analytics: { defaultPeriod: "30d" } },
    })
    const updated = await store.save("sess-1", { modules: { camunda7: { pinned: ["d1"] } } })
    expect(updated.modules).toEqual({
      camunda7: { defaultEngineId: "prod-a", pinned: ["d1"] },
      analytics: { defaultPeriod: "30d" },
    })
  })

  it("clears a slice field via explicit undefined and keeps merging afterwards", async () => {
    const store = await makeStore()
    await store.save("sess-1", {
      modules: { camunda7: { defaultEngineId: "prod-a", pinned: ["d1"] } },
    })
    const cleared = await store.save("sess-1", {
      modules: { camunda7: { defaultEngineId: undefined } },
    })
    expect(cleared.modules?.camunda7).toEqual({ pinned: ["d1"] })
    const merged = await store.save("sess-1", { modules: { camunda7: { fresh: true } } })
    expect(merged.modules?.camunda7).toEqual({ pinned: ["d1"], fresh: true })
  })

  it("deletes a stored profile", async () => {
    const store = await makeStore()
    await store.save("sess-1", { language: "de" })
    expect(await store.delete("sess-1")).toBe(true)
    expect(await store.get("sess-1")).toBeUndefined()
    expect(await store.delete("sess-1")).toBe(false)
  })

  it("keeps both of two concurrent saves of disjoint top-level fields", async () => {
    const store = await makeStore()
    // The settings page has two independent save buttons; overlapping saves must both land.
    await Promise.all([
      store.save("sess-1", { modules: { analytics: { defaultPeriod: "30d" } } }),
      store.save("sess-1", { language: "de" }),
    ])
    const profile = await store.get("sess-1")
    expect(profile?.modules).toEqual({ analytics: { defaultPeriod: "30d" } })
    expect(profile?.language).toBe("de")
  })

  it("keeps concurrent saves from DIFFERENT modules — no module's update is lost", async () => {
    const store = await makeStore()
    // The model may fire two modules' save tools in one turn. Repeated, because a lost
    // write shows only when the two calls interleave.
    for (let round = 0; round < 10; round += 1) {
      const key = `user-${round}`
      await store.save(key, { modules: { camunda7: { pinnedDashboardIds: ["d1"] } } })
      await Promise.all([
        saveModuleSlice(store, key, "camunda7", { defaultEngineId: "prod-a" }),
        saveModuleSlice(store, key, "analytics", { defaultPeriod: "30d" }),
        store.save(key, { language: "de" }),
      ])
      const profile = await store.get(key)
      expect(profile?.modules).toEqual({
        camunda7: { pinnedDashboardIds: ["d1"], defaultEngineId: "prod-a" },
        analytics: { defaultPeriod: "30d" },
      })
      expect(profile?.language).toBe("de")
    }
  })

  it("keeps concurrent saves of different fields in the SAME slice: a stale value never wins", async () => {
    const store = await makeStore()
    // A save tool handing the store a slice pre-read outside the lock would write a stale
    // value back over the select's change.
    for (let round = 0; round < 10; round += 1) {
      const key = `user-${round}`
      await store.save(key, { modules: { camunda7: { defaultEngineId: "prod-a", extra: 1 } } })
      await Promise.all([
        saveModuleSlice(store, key, "camunda7", { defaultEngineId: "prod-b" }),
        saveModuleSlice(store, key, "camunda7", { pinnedDashboardIds: ["d1"] }),
      ])
      expect((await store.get(key))?.modules?.camunda7).toEqual({
        defaultEngineId: "prod-b",
        pinnedDashboardIds: ["d1"],
        extra: 1,
      })
    }
  })

  it("saveModuleSlice clears a field patched to undefined and reports the saved slice", async () => {
    const store = await makeStore()
    await saveModuleSlice(store, "sess-1", "camunda7", { defaultEngineId: "prod-a", keep: true })
    const slice = await saveModuleSlice(store, "sess-1", "camunda7", { defaultEngineId: undefined })
    expect(slice).toEqual({ keep: true })
    expect((await store.get("sess-1"))?.modules?.camunda7).toEqual({ keep: true })
  })

  it("stamps the owner and keeps it on later saves without auth context", async () => {
    const store = await makeStore()
    const created = await store.save("user-1", { language: "de" }, { userId: "user-1" })
    expect(created.userId).toBe("user-1")
    const updated = await store.save("user-1", { language: "en" })
    expect(updated.userId).toBe("user-1")
  })
}

describe("createInMemoryProfileStore", () => {
  profileStoreContract(() => Promise.resolve(createInMemoryProfileStore()))
})

describe("createFileSystemProfileStore", () => {
  profileStoreContract(async () =>
    createFileSystemProfileStore({ dir: await mkdtemp(path.join(tmpdir(), "profile-store-")) }),
  )

  it("serializes saves per key across two store instances on the same directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    const a = createFileSystemProfileStore({ dir })
    const b = createFileSystemProfileStore({ dir })
    await Promise.all([
      a.save("sess-1", { modules: { camunda7: { defaultEngineId: "prod-a" } } }),
      b.save("sess-1", { modules: { analytics: { defaultPeriod: "30d" } } }),
    ])
    expect((await a.get("sess-1"))?.modules).toEqual({
      camunda7: { defaultEngineId: "prod-a" },
      analytics: { defaultPeriod: "30d" },
    })
  })

  it("keeps serving the key after a failed save (the lock is released on error)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    // A FILE where the store expects its directory: every write fails.
    const blocked = path.join(dir, "blocked")
    await writeFile(blocked, "", "utf-8")
    const store = createFileSystemProfileStore({ dir: blocked })
    await expect(store.save("sess-1", { language: "de" })).rejects.toThrow()
    await expect(store.save("sess-1", { language: "de" })).rejects.toThrow()
  })

  it("reads a record from before the migration baseline fail-soft and adopts it on save", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    const store = createFileSystemProfileStore({ dir })
    const file = path.join(dir, "early.json")
    await writeFile(file, JSON.stringify(V1_RECORD), "utf-8")

    expect(await store.get("early")).toEqual({
      id: "early",
      language: "de",
      modules: {},
      createdAt: V1_RECORD.createdAt,
      updatedAt: V1_RECORD.updatedAt,
      schemaVersion: 3,
    })

    const saved = await store.save("early", { modules: { analytics: { defaultPeriod: "7d" } } })
    expect(saved).toMatchObject({ language: "de", modules: { analytics: { defaultPeriod: "7d" } } })
    expect(JSON.parse(await readFile(file, "utf-8"))).toMatchObject({
      schemaVersion: 3,
      theme: "dark",
      analyticsDefaultPeriod: "30d",
      modules: { analytics: { defaultPeriod: "7d" } },
    })
  })

  it("reads a record it cannot date (the next save stamps both timestamps)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    const store = createFileSystemProfileStore({ dir })
    await writeFile(path.join(dir, "undated.json"), JSON.stringify({ schemaVersion: 3 }), "utf-8")
    expect(await store.get("undated")).toMatchObject({ id: "undated", updatedAt: "" })
    const saved = await store.save("undated", { language: "de" })
    expect(saved.updatedAt).not.toBe("")
    expect(saved.createdAt).toBe(saved.updatedAt)
  })

  it("treats a file that is not JSON as absent and replaces it on the next save", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    const store = createFileSystemProfileStore({ dir })
    await writeFile(path.join(dir, "broken.json"), "{ not json", "utf-8")
    expect(await store.get("broken")).toBeUndefined()
    expect((await store.save("broken", { language: "de" })).language).toBe("de")
    expect((await store.get("broken"))?.language).toBe("de")
  })

  it("reads a record with the retired theme preference fail-soft and keeps the key inert", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-store-"))
    const store = createFileSystemProfileStore({ dir })
    const file = path.join(dir, "themed.json")
    await writeFile(file, JSON.stringify(THEMED_RECORD), "utf-8")

    const read = await store.get("themed")
    expect(read).toMatchObject({ id: "themed", language: "de", modules: {} })
    expect(read).not.toHaveProperty("theme")

    const saved = await store.save("themed", { language: "en" })
    expect(saved).not.toHaveProperty("theme")
    expect(JSON.parse(await readFile(file, "utf-8"))).toMatchObject({
      language: "en",
      theme: "dark",
    })
  })
})

const THEMED_RECORD = {
  id: "themed",
  language: "de",
  theme: "dark",
  modules: {},
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  schemaVersion: 3,
}

const V1_RECORD = {
  id: "early",
  language: "de",
  theme: "dark",
  pinnedDashboardIds: [],
  analyticsDefaultPeriod: "30d",
  analyticsMinBucketSize: 25,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 1,
}

// Opt-in: only with TEST_DATABASE_URL (`pnpm test:pg`); an own schema isolates it.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TEST_SCHEMA = "widget_shell_profile_store_test"

describe.skipIf(!TEST_DATABASE_URL)("createPostgresProfileStore", () => {
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

  profileStoreContract(() => Promise.resolve(createPostgresProfileStore({ sql })))

  it("reads a row missing every field best-effort and keeps it on save", async () => {
    const store = createPostgresProfileStore({ sql })
    await sql`
      INSERT INTO user_profiles (key, profile)
      VALUES ('sess-sparse', '{"schemaVersion": 999}'::jsonb)
    `
    expect(await store.get("sess-sparse")).toMatchObject({
      id: "sess-sparse",
      language: "system",
      modules: {},
    })

    const saved = await store.save("sess-sparse", { language: "de" })
    expect(saved.language).toBe("de")
    expect(await store.get("sess-sparse")).toEqual(saved)
  })

  it("reads a row from before the migration baseline fail-soft and adopts it on save", async () => {
    const store = createPostgresProfileStore({ sql })
    await sql`
      INSERT INTO user_profiles (key, profile)
      VALUES ('early', ${sql.json(V1_RECORD)})
    `
    const early = await store.get("early")
    expect(early).toMatchObject({ language: "de", modules: {}, schemaVersion: 3 })
    expect(early).not.toHaveProperty("theme")

    const saved = await store.save("early", { language: "en" })
    expect(saved).toMatchObject({ language: "en", modules: {} })
    expect(saved).not.toHaveProperty("theme")
    const rows = await sql<{ profile: Record<string, unknown> }[]>`
      SELECT profile FROM user_profiles WHERE key = 'early'
    `
    expect(rows[0]?.profile).toMatchObject({
      schemaVersion: 3,
      theme: "dark",
      analyticsDefaultPeriod: "30d",
    })
  })

  it("merges concurrent saves of disjoint fields in the SAME module slice", async () => {
    const store = createPostgresProfileStore({ sql })
    // Both writers pre-read the same empty slice; the merge inside the lock keeps both.
    await Promise.all([
      store.save("sess-2", { modules: { camunda7: { defaultEngineId: "prod-a" } } }),
      store.save("sess-2", { modules: { camunda7: { pinned: ["d1"] } } }),
    ])
    const profile = await store.get("sess-2")
    expect(profile?.modules?.camunda7).toEqual({ defaultEngineId: "prod-a", pinned: ["d1"] })
  })
})
