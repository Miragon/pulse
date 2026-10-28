import type postgres from "postgres"
import { parseStoredProfile } from "./profile-migrations.js"
import { mergeStoredProfile, type ProfileStore } from "./profile-store.js"

/** One JSONB column: the record is tiny and its shape is governed by `schemaVersion`, not columns. */
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
