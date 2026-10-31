import type postgres from "postgres"
import { parseStoredProfile } from "./profile-migrations.js"
import { mergeStoredProfile, type ProfileStore } from "./profile-store.js"

/**
 * One JSONB column: the record is tiny and its shape is governed by `schemaVersion`, not columns.
 * `003_drop_dashboards` DROPS the `dashboards` table that the retired dashboard store created
 * under `002_dashboards`: a root that still serves dashboards from it moves them to a table of
 * its own before it runs this list.
 */
export const PROFILE_STORE_MIGRATIONS: ReadonlyArray<{
  name: string
  statements: readonly string[]
}> = [
  {
    name: "001_user_profiles",
    statements: [
      `CREATE TABLE IF NOT EXISTS user_profiles (
        key TEXT PRIMARY KEY,
        user_id TEXT,
        profile JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    // Retires the dashboard store's table, only where this server's own `002_dashboards` row says
    // it ran that migration AND the table still has the shape 002 created: tables live in the
    // default schema of a possibly shared database, so a foreign `dashboards` table stays. No
    // CASCADE: a foreign object depending on it fails the boot instead of being dropped. Without
    // `schema_migrations` (another runner) nothing recorded 002; plpgsql plans the inner SELECT
    // only when it is reached. A rollback to a release that lists 002 recreates the table, and
    // this migration, already recorded, never runs again: such a table goes by hand.
    name: "003_drop_dashboards",
    statements: [
      `DO $$
      BEGIN
        IF to_regclass('schema_migrations') IS NOT NULL THEN
          IF EXISTS (SELECT 1 FROM schema_migrations WHERE name = '002_dashboards') THEN
            IF (SELECT array_agg(attname::text ORDER BY attname::text COLLATE "C") FROM pg_attribute
                WHERE attrelid = to_regclass('dashboards') AND attnum > 0 AND NOT attisdropped)
               = ARRAY['id', 'record', 'updated_at', 'user_id'] THEN
              DROP TABLE dashboards;
            END IF;
            DELETE FROM schema_migrations WHERE name = '002_dashboards';
          END IF;
        END IF;
      END
      $$`,
    ],
  },
]

/** The caller owns the `sql` client, so this package has no runtime dependency on the driver. */
export function createPostgresProfileStore(options: { sql: postgres.Sql }): ProfileStore {
  const { sql } = options

  return {
    async get(key) {
      const rows = await sql<{ profile: unknown }[]>`
        SELECT profile FROM user_profiles WHERE key = ${key}
      `
      return parseStoredProfile(rows[0]?.profile, key)
    },
    async save(key, input, opts) {
      return await sql.begin(async (tx) => {
        // Advisory lock: a row that doesn't exist yet cannot be row-locked, so two concurrent
        // FIRST saves would both merge over defaults and the second would drop the first's fields.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('user_profiles:' || ${key}, 0))`
        const rows = await tx<{ profile: unknown }[]>`
          SELECT profile FROM user_profiles WHERE key = ${key} FOR UPDATE
        `
        const { document, record } = mergeStoredProfile(
          key,
          rows[0]?.profile,
          input,
          new Date().toISOString(),
          opts,
        )
        // sql.json, not JSON.stringify: a pre-stringified value gets double-encoded into a jsonb string.
        await tx`
          INSERT INTO user_profiles (key, user_id, profile, updated_at)
          VALUES (
            ${key},
            ${record.userId ?? null},
            ${tx.json(document as postgres.JSONValue)},
            ${record.updatedAt}
          )
          ON CONFLICT (key) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            profile = EXCLUDED.profile,
            updated_at = EXCLUDED.updated_at
        `
        return record
      })
    },
    async delete(key) {
      const result = await sql`DELETE FROM user_profiles WHERE key = ${key}`
      return result.count > 0
    },
  }
}
