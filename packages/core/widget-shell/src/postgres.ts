import type postgres from "postgres"
import type { ReadinessCheck } from "./health.js"

/**
 * An unreachable database fails the boot once the 10 s `connect_timeout` runs out.
 * The DYNAMIC import is load-bearing: `postgres` is an OPTIONAL peer and `/server` re-exports this
 * module, so a static import would crash disk/memory consumers with ERR_MODULE_NOT_FOUND.
 */
export async function createSql(databaseUrl: string): Promise<postgres.Sql> {
  const { default: postgres } = await import("postgres")
  return postgres(databaseUrl, {
    // Every store call is one short statement or one SELECT…FOR UPDATE transaction.
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    // NOTICEs (e.g. from CREATE TABLE IF NOT EXISTS) are noise on the server log.
    onnotice: () => {},
  })
}

/** A database that goes away after boot turns the server not ready instead of failing the next save. */
export function postgresReadinessCheck(sql: postgres.Sql): ReadinessCheck {
  return async () => {
    await sql`SELECT 1`
  }
}

/**
 * Plain SQL strings: .sql files would not survive `pnpm deploy` packaging. `name` is the permanent
 * key in `schema_migrations`: a rename re-runs the DDL, a reused name skips it. Array order decides.
 */
export interface Migration {
  name: string
  statements: readonly string[]
}

// Stable key ("mira" in hex); serializes concurrently booting instances, not tables.
const MIGRATION_LOCK_KEY = 0x6d697261

/** One transaction under `pg_advisory_xact_lock`, so booting instances cannot interleave DDL. */
export async function runMigrations(
  sql: postgres.Sql,
  migrations: readonly Migration[],
): Promise<string[]> {
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`
    await tx.unsafe(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    )
    const appliedRows = await tx<{ name: string }[]>`SELECT name FROM schema_migrations`
    const applied = new Set(appliedRows.map((row) => row.name))
    const newlyApplied: string[] = []
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue
      for (const statement of migration.statements) {
        await tx.unsafe(statement)
      }
      await tx`INSERT INTO schema_migrations (name) VALUES (${migration.name})`
      newlyApplied.push(migration.name)
    }
    return newlyApplied
  })
}
