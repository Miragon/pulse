import { PROFILE_SCHEMA_VERSION } from "./profile-constants.js"
import { projectProfileRecord, type ProfileRecord } from "./profile-record.js"

type ProfileMigration = (raw: Record<string, unknown>) => void

/**
 * No history predates v3 (#322): older records are ADOPTED here, never upgraded; their
 * unknown fields stay inert in the raw document, so those preferences read as defaults.
 */
export const PROFILE_MIGRATION_BASELINE = 3

/**
 * Keyed by the version they upgrade FROM; the migrated JSON still passes the per-field
 * `projectProfileRecord`, the actual gate. Exported only for the completeness test.
 */
export const PROFILE_MIGRATIONS: Readonly<Record<number, ProfileMigration>> = {}

interface ProfileMigrationHistory {
  baseline: number
  current: number
  migrations: Readonly<Record<number, ProfileMigration>>
}

const SHIPPED_HISTORY: ProfileMigrationHistory = {
  baseline: PROFILE_MIGRATION_BASELINE,
  current: PROFILE_SCHEMA_VERSION,
  migrations: PROFILE_MIGRATIONS,
}

export interface MigratedProfileDocument {
  doc: Record<string, unknown>
  version: number
}

/**
 * The RAW half of the read gate, shared by read and save paths. A NEWER version (rolling
 * deploy, rollback) passes untouched; a missing migration stops at the stuck version so a
 * fixed build can still upgrade it. Unknown keys always survive.
 */
export function migrateStoredProfile(
  json: unknown,
  history: ProfileMigrationHistory = SHIPPED_HISTORY,
): MigratedProfileDocument | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined
  const doc: Record<string, unknown> = { ...(json as Record<string, unknown>) }

  const { baseline, current, migrations } = history
  const rawVersion = doc.schemaVersion
  let version = Number.isInteger(rawVersion) ? Math.max(rawVersion as number, baseline) : baseline
  doc.schemaVersion = version

  while (version < current) {
    const migrate = migrations[version]
    if (!migrate) {
      console.error(
        `[widget-shell] No profile migration from schema v${version} — reading the stored record best-effort and keeping it un-migrated`,
      )
      break
    }
    migrate(doc)
    version += 1
    doc.schemaVersion = version
  }
  return { doc, version }
}

/**
 * Per-FIELD projection, so one invalid value degrades only that field and a newer build's
 * document reads best-effort instead of as "no record" (which the next save would overwrite).
 */
export function parseStoredProfile(json: unknown, key?: string): ProfileRecord | undefined {
  const migrated = migrateStoredProfile(json)
  if (!migrated) return undefined
  const id = key ?? (typeof migrated.doc.id === "string" ? migrated.doc.id : undefined)
  return id === undefined ? undefined : projectProfileRecord(migrated.doc, id)
}
