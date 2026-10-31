import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { postgresReadinessCheck, runMigrations, type Migration } from "./postgres.js"
import { PROFILE_STORE_MIGRATIONS } from "./profile-store-postgres.js"

// Runs only with TEST_DATABASE_URL (`pnpm test:pg`); an own schema isolates it from other suites.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const TEST_SCHEMA = "widget_shell_migrations_test"

describe.skipIf(!TEST_DATABASE_URL)("runMigrations", () => {
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

  const appliedNames = async () =>
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name`).map(
      (row) => row.name,
    )

  // The cases run in order: each builds on the database the one before left.
  it("applies pending migrations in order and records them by name", async () => {
    const applied = await runMigrations(sql, PROFILE_STORE_MIGRATIONS)
    expect(applied).toEqual(["001_user_profiles", "003_drop_dashboards"])
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_profiles`
    expect(rows[0].n).toBe(0)
    expect((await sql`SELECT to_regclass('dashboards') AS t`)[0].t).toBeNull()
  })

  it("is idempotent on a second run", async () => {
    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual([])
  })

  it("passes over an applied name it no longer knows (a retired migration)", async () => {
    // A migration an earlier release ran and a later one retired stays recorded.
    await sql`INSERT INTO schema_migrations (name) VALUES ('000_retired')`
    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual([])
    expect(await appliedNames()).toEqual([
      "000_retired",
      "001_user_profiles",
      "003_drop_dashboards",
    ])
  })

  it("runs a new migration's statements in one transaction with its record", async () => {
    const broken: Migration = {
      name: "999_broken",
      statements: ["CREATE TABLE half_done (id INT)", "SELECT * FROM no_such_table"],
    }
    await expect(runMigrations(sql, [...PROFILE_STORE_MIGRATIONS, broken])).rejects.toThrow()
    expect(await appliedNames()).toEqual([
      "000_retired",
      "001_user_profiles",
      "003_drop_dashboards",
    ])
    const tables = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = ${TEST_SCHEMA} AND table_name = 'half_done'
    `
    expect(tables[0].n).toBe(0)
  })
})

describe.skipIf(!TEST_DATABASE_URL)("003_drop_dashboards", () => {
  const SCHEMA = "widget_shell_drop_dashboards_test"
  let sql: postgres.Sql

  /** The retired dashboard store's migration, verbatim, as earlier releases ran it. */
  const RETIRED_002: Migration = {
    name: "002_dashboards",
    statements: [
      `CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        record JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS dashboards_list_idx
        ON dashboards (user_id, updated_at DESC)`,
    ],
  }
  const BEFORE = [
    ...PROFILE_STORE_MIGRATIONS.filter((migration) => migration.name === "001_user_profiles"),
    RETIRED_002,
  ]

  beforeAll(() => {
    sql = postgres(TEST_DATABASE_URL!, {
      max: 2,
      onnotice: () => {},
      connection: { search_path: SCHEMA },
    })
  })

  beforeEach(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await sql.unsafe(`CREATE SCHEMA ${SCHEMA}`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  const appliedNames = async () =>
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name`).map(
      (row) => row.name,
    )
  const count = async (table: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(table)}`)[0].n

  it("drops the table this server created and forgets its record", async () => {
    await runMigrations(sql, BEFORE)
    await sql`INSERT INTO dashboards (id, user_id, record, updated_at)
      VALUES ('d1', 'user-1', '{}', now())`
    await sql`INSERT INTO user_profiles (key, profile) VALUES ('user-1', '{}')`

    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual(["003_drop_dashboards"])
    expect((await sql`SELECT to_regclass('dashboards') AS t`)[0].t).toBeNull()
    expect((await sql`SELECT to_regclass('dashboards_list_idx') AS t`)[0].t).toBeNull()
    expect(await appliedNames()).toEqual(["001_user_profiles", "003_drop_dashboards"])
    expect(await count("user_profiles")).toBe(1)
  })

  it("keeps a foreign dashboards table the server never created", async () => {
    await sql`CREATE TABLE dashboards (id INT PRIMARY KEY, title TEXT)`
    await sql`INSERT INTO dashboards (id, title) VALUES (1, 'theirs')`

    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual([
      "001_user_profiles",
      "003_drop_dashboards",
    ])
    expect(await count("dashboards")).toBe(1)
  })

  it("keeps a foreign table 002 adopted and forgets only the record", async () => {
    await sql`CREATE TABLE dashboards (user_id TEXT, updated_at TIMESTAMPTZ, title TEXT)`
    await sql`INSERT INTO dashboards (user_id, updated_at, title) VALUES ('u', now(), 'theirs')`
    await runMigrations(sql, BEFORE)

    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual(["003_drop_dashboards"])
    expect(await count("dashboards")).toBe(1)
    expect(await appliedNames()).toEqual(["001_user_profiles", "003_drop_dashboards"])
  })

  it("forgets a record whose table is already gone", async () => {
    await runMigrations(sql, BEFORE)
    await sql`DROP TABLE dashboards`

    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual(["003_drop_dashboards"])
    expect(await appliedNames()).toEqual(["001_user_profiles", "003_drop_dashboards"])
  })

  it("is a no-op on a second run", async () => {
    await runMigrations(sql, PROFILE_STORE_MIGRATIONS)
    expect(await runMigrations(sql, PROFILE_STORE_MIGRATIONS)).toEqual([])
  })

  it("runs under another runner on a database without schema_migrations", async () => {
    for (const migration of PROFILE_STORE_MIGRATIONS) {
      for (const statement of migration.statements) await sql.unsafe(statement)
    }
    expect(await count("user_profiles")).toBe(0)
    expect((await sql`SELECT to_regclass('schema_migrations') AS t`)[0].t).toBeNull()
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
