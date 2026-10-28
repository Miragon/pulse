import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { DashboardOwnershipError, DashboardUnreadableError } from "@miragon/mcp-toolkit-core/tools"
import type { DashboardStore } from "@miragon/mcp-toolkit-core/tools"
import {
  createPostgresDashboardStore,
  DASHBOARD_STORE_MIGRATIONS,
} from "./dashboard-store-postgres.js"
import { postgresReadinessCheck, runMigrations } from "./postgres.js"
import { PROFILE_STORE_MIGRATIONS } from "./profile-store-postgres.js"

const LAYOUT = [{ row: [{ widget: "shell:kpi-grid" }] }]

const validRecord = (id: string) => ({
  id,
  name: id,
  layout: LAYOUT,
  schemaVersion: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
})

/** updatedAt has millisecond precision: space writes out for stable ordering. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

// Runs only with TEST_DATABASE_URL (`pnpm test:pg`); an own schema isolates it from other suites.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TEST_SCHEMA = "widget_shell_dashboard_store_test"

describe.skipIf(!TEST_DATABASE_URL)("postgres persistence", () => {
  let sql: postgres.Sql

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL!, {
      max: 2,
      onnotice: () => {},
      connection: { search_path: TEST_SCHEMA },
    })
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  // Runs first (describes execute in order) and doubles as the table setup, like initRuntime.
  describe("runMigrations", () => {
    it("applies pending migrations in order and records them by name", async () => {
      const applied = await runMigrations(sql, [
        ...PROFILE_STORE_MIGRATIONS,
        ...DASHBOARD_STORE_MIGRATIONS,
      ])
      expect(applied).toEqual(["001_user_profiles", "002_dashboards"])
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM dashboards`
      expect(rows[0].n).toBe(0)
    })

    it("is idempotent on a second run", async () => {
      const applied = await runMigrations(sql, [
        ...PROFILE_STORE_MIGRATIONS,
        ...DASHBOARD_STORE_MIGRATIONS,
      ])
      expect(applied).toEqual([])
    })
  })

  describe("createPostgresDashboardStore", () => {
    let store: DashboardStore

    beforeAll(() => {
      store = createPostgresDashboardStore({ sql })
    })

    beforeEach(async () => {
      await sql`DELETE FROM dashboards`
    })

    it("creates a record with generated id and server-managed metadata", async () => {
      const record = await store.save({ name: "ops", layout: LAYOUT })
      expect(record.id).toBeTruthy()
      expect(record.schemaVersion).toBe(1)
      expect(record.createdAt).toBe(record.updatedAt)
      expect(await store.get(record.id, {})).toEqual(record)
    })

    it("updates by id, preserving createdAt and advancing updatedAt", async () => {
      const created = await store.save({ name: "ops", layout: LAYOUT })
      await tick()
      const updated = await store.save({ id: created.id, name: "renamed", layout: LAYOUT })
      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe("renamed")
      expect(updated.createdAt).toBe(created.createdAt)
      expect(updated.updatedAt > created.updatedAt).toBe(true)
    })

    it("takes the per-id advisory lock before the create branch", async () => {
      // Racing two saves cannot prove the advisory lock (the unique index serializes them anyway), so
      // hold the lock from another session and assert the save WAITS for it.
      const blocker = postgres(TEST_DATABASE_URL!, {
        max: 1,
        onnotice: () => {},
        connection: { search_path: TEST_SCHEMA },
      })
      try {
        await blocker`SELECT pg_advisory_lock(hashtextextended('dashboards:contested', 0))`
        let settled = false
        const pending = store
          .save({ id: "contested", name: "blocked", layout: LAYOUT })
          .finally(() => {
            settled = true
          })
        await new Promise((resolve) => setTimeout(resolve, 250))
        expect(settled).toBe(false)

        await blocker`SELECT pg_advisory_unlock(hashtextextended('dashboards:contested', 0))`
        await expect(pending).resolves.toMatchObject({ id: "contested", name: "blocked" })
      } finally {
        await blocker.end({ timeout: 5 })
      }
    })

    it("rejects a foreign update and never reassigns the owner", async () => {
      const alices = await store.save({ name: "alice's", layout: LAYOUT, userId: "alice" })
      await expect(
        store.save({ id: alices.id, name: "stolen", layout: LAYOUT, userId: "bob" }),
      ).rejects.toBeInstanceOf(DashboardOwnershipError)
      expect(await store.get(alices.id, {})).toEqual(alices)
    })

    // Toolkit 2.6: an owner-less record belongs to no identified caller (2.5 handed it to every caller).
    it("keeps an owner-less record away from identified callers", async () => {
      const global = await store.save({ name: "global", layout: LAYOUT })

      expect(await store.get(global.id, { userId: "bob" })).toBeUndefined()
      await expect(
        store.save({ id: global.id, name: "claimed", layout: LAYOUT, userId: "bob" }),
      ).rejects.toBeInstanceOf(DashboardOwnershipError)
      expect(await store.delete(global.id, { userId: "bob" })).toBe(false)
      expect(await store.get(global.id, {})).toEqual(global)

      // Global scope still reads and writes it, without adopting an owner.
      const written = await store.save({ id: global.id, name: "edited", layout: LAYOUT })
      expect(written).toMatchObject({ name: "edited" })
      expect(written.userId).toBeUndefined()
      expect(await store.delete(global.id, {})).toBe(true)
    })

    it("enforces ownership on get and delete", async () => {
      const alices = await store.save({ name: "alice's", layout: LAYOUT, userId: "alice" })
      expect(await store.get(alices.id, { userId: "bob" })).toBeUndefined()
      expect(await store.get(alices.id, { userId: "alice" })).toEqual(alices)
      expect(await store.delete(alices.id, { userId: "bob" })).toBe(false)
      expect(await store.delete(alices.id, { userId: "alice" })).toBe(true)
      expect(await store.get(alices.id, {})).toBeUndefined()
    })

    it("lists only the caller's own records as owner-stamped summaries, newest first", async () => {
      await store.save({ name: "global", layout: LAYOUT })
      await tick()
      await store.save({ name: "alice's", layout: LAYOUT, userId: "alice" })
      await tick()
      await store.save({ name: "bob's", layout: LAYOUT, userId: "bob" })

      const forAlice = await store.list({ userId: "alice" })
      expect(forAlice.map((s) => s.name)).toEqual(["alice's"])
      // The toolkit's dashboard tools re-check the summary's userId.
      expect(forAlice[0].userId).toBe("alice")
      expect(Object.keys(forAlice[0]).sort()).toEqual([
        "description",
        "id",
        "name",
        "title",
        "updatedAt",
        "userId",
      ])

      const unfiltered = await store.list({})
      expect(unfiltered.map((s) => [s.name, s.userId])).toEqual([
        ["bob's", "bob"],
        ["alice's", "alice"],
        ["global", undefined],
      ])
    })

    // Read as absent, a save with its id would overwrite it and stamp the writer as owner.
    describe("an unreadable row", () => {
      const insertRaw = async (id: string, userId: string | null, record: object) => {
        await sql`
          INSERT INTO dashboards (id, user_id, record, updated_at)
          VALUES (${id}, ${userId}, ${sql.json(record as postgres.JSONValue)}, now())
        `
      }
      const rowOf = async (id: string) =>
        (
          await sql<{ user_id: string | null; record: unknown }[]>`
          SELECT user_id, record FROM dashboards WHERE id = ${id}
        `
        )[0]

      it("refuses get, save and delete for its owner and stays in place", async () => {
        await insertRaw("corrupt", "alice", { name: "no layout", userId: "alice" })
        const before = await rowOf("corrupt")

        await expect(store.get("corrupt", { userId: "alice" })).rejects.toBeInstanceOf(
          DashboardUnreadableError,
        )
        await expect(
          store.save({ id: "corrupt", name: "fresh", layout: LAYOUT, userId: "alice" }),
        ).rejects.toBeInstanceOf(DashboardUnreadableError)
        await expect(store.delete("corrupt", { userId: "alice" })).rejects.toBeInstanceOf(
          DashboardUnreadableError,
        )
        // Global scope addresses every row, so it gets the same conflict.
        await expect(store.get("corrupt", {})).rejects.toBeInstanceOf(DashboardUnreadableError)
        await expect(
          store.save({ id: "corrupt", name: "fresh", layout: LAYOUT }),
        ).rejects.toBeInstanceOf(DashboardUnreadableError)
        expect(await rowOf("corrupt")).toEqual(before)
      })

      it("is invisible to — and never claimable by — another identified caller", async () => {
        await insertRaw("alices-corrupt", "alice", { name: "no layout", userId: "alice" })
        await insertRaw("global-corrupt", null, { name: "no layout" })
        const before = [await rowOf("alices-corrupt"), await rowOf("global-corrupt")]

        for (const id of ["alices-corrupt", "global-corrupt"]) {
          expect(await store.get(id, { userId: "bob" })).toBeUndefined()
          expect(await store.delete(id, { userId: "bob" })).toBe(false)
          await expect(
            store.save({ id, name: "claimed", layout: LAYOUT, userId: "bob" }),
          ).rejects.toBeInstanceOf(DashboardOwnershipError)
        }
        expect(await store.list({ userId: "bob" })).toEqual([])
        expect([await rowOf("alices-corrupt"), await rowOf("global-corrupt")]).toEqual(before)
      })

      // A newer build's ownerless payload: only the mirrored user_id attributes it.
      it("never lets a save turn it into an ownership-free CREATE", async () => {
        await insertRaw("future", "alice", { schemaVersion: 99, name: "v99" })
        await insertRaw("global-future", null, { schemaVersion: 99 })
        const before = [await rowOf("future"), await rowOf("global-future")]

        await expect(
          store.save({ id: "future", name: "stolen", layout: LAYOUT, userId: "bob" }),
        ).rejects.toBeInstanceOf(DashboardOwnershipError)
        // Not even its owner replaces it: a conflict, never an overwrite.
        await expect(
          store.save({ id: "future", name: "mine", layout: LAYOUT, userId: "alice" }),
        ).rejects.toBeInstanceOf(DashboardUnreadableError)
        // A global unreadable row never adopts the writer.
        await expect(
          store.save({ id: "global-future", name: "edited", layout: LAYOUT, userId: "bob" }),
        ).rejects.toBeInstanceOf(DashboardOwnershipError)
        await expect(
          store.save({ id: "global-future", name: "edited", layout: LAYOUT }),
        ).rejects.toBeInstanceOf(DashboardUnreadableError)
        expect([await rowOf("future"), await rowOf("global-future")]).toEqual(before)
      })

      it("is reported in listings where it is attributable, with the reason", async () => {
        await insertRaw("corrupt", "alice", { name: "no layout", userId: "alice" })
        await tick()
        await insertRaw("newer", null, { ...validRecord("newer"), schemaVersion: 99 })

        // The mirrored columns stand in for the unreadable payload.
        const [{ updated_at }] = await sql<{ updated_at: Date }[]>`
          SELECT updated_at FROM dashboards WHERE id = 'corrupt'
        `
        expect(await store.list({ userId: "alice" })).toEqual([
          {
            id: "corrupt",
            name: "corrupt",
            userId: "alice",
            updatedAt: updated_at.toISOString(),
            unreadable: "does not match the current record schema",
          },
        ])

        const unfiltered = await store.list({})
        expect(unfiltered.map((s) => [s.id, s.unreadable])).toEqual([
          ["newer", "written by a newer schemaVersion 99 (this build reads up to 1)"],
          ["corrupt", "does not match the current record schema"],
        ])
      })
    })
  })
})

describe.skipIf(!TEST_DATABASE_URL)("postgresReadinessCheck", () => {
  it("resolves against a reachable database", async () => {
    const sql = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} })
    try {
      await expect(postgresReadinessCheck(sql)()).resolves.toBeUndefined()
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  it("rejects when the database is unreachable", async () => {
    // Nothing listens on port 1; the short connect timeout keeps the test fast.
    const sql = postgres("postgres://127.0.0.1:1/nothing", { max: 1, connect_timeout: 1 })
    try {
      await expect(postgresReadinessCheck(sql)()).rejects.toThrow()
    } finally {
      await sql.end({ timeout: 1 })
    }
  })
})
