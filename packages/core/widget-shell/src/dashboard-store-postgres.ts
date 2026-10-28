import { randomUUID } from "node:crypto"
import {
  DASHBOARD_SCHEMA_VERSION,
  DashboardOwnershipError,
  DashboardUnreadableError,
  isDashboardOwnedBy,
  parseDashboardRecord,
  resolveSavedRecord,
} from "@miragon/mcp-toolkit-core/tools"
import type {
  DashboardRecord,
  DashboardStore,
  DashboardSummary,
} from "@miragon/mcp-toolkit-core/tools"
import type postgres from "postgres"
import type { Migration } from "./postgres.js"

/**
 * The record lives in one JSONB column governed by the toolkit's `DASHBOARD_SCHEMA_VERSION`, so a
 * toolkit layout field needs no migration. `user_id`/`updated_at` are mirrored out for SQL filtering
 * and so an unreadable row keeps an owner. The `002_` name is a `schema_migrations` key: never rename.
 */
export const DASHBOARD_STORE_MIGRATIONS: readonly Migration[] = [
  {
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
  },
]

interface DashboardRow {
  id: string
  user_id: string | null
  record: unknown
  updated_at: Date
}

type StoredDashboard =
  | { state: "readable"; record: DashboardRecord }
  | { state: "unreadable"; id: string; reason: string; ownerId?: string; updatedAt: string }

function classifyRow(row: DashboardRow): StoredDashboard {
  const record = parseDashboardRecord(row.record)
  if (record) return { state: "readable", record }
  const payload: { schemaVersion?: unknown } =
    typeof row.record === "object" && row.record !== null ? row.record : {}
  const version = payload.schemaVersion
  return {
    state: "unreadable",
    id: row.id,
    // The toolkit's wording, so both stores report the same reasons.
    reason:
      typeof version === "number" && version > DASHBOARD_SCHEMA_VERSION
        ? `written by a newer schemaVersion ${version} (this build reads up to ${DASHBOARD_SCHEMA_VERSION})`
        : "does not match the current record schema",
    // Written with the record, so it still attributes an unreadable row.
    ...(row.user_id === null ? {} : { ownerId: row.user_id }),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function ownerOf(stored: StoredDashboard): string | undefined {
  return stored.state === "readable" ? stored.record.userId : stored.ownerId
}

function toSummary(stored: StoredDashboard): DashboardSummary {
  if (stored.state === "unreadable") {
    return {
      id: stored.id,
      name: stored.id,
      ...(stored.ownerId === undefined ? {} : { userId: stored.ownerId }),
      updatedAt: stored.updatedAt,
      unreadable: stored.reason,
    }
  }
  const { record } = stored
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    title: record.title,
    userId: record.userId,
    updatedAt: record.updatedAt,
  }
}

/**
 * The multi-writer counterpart to the toolkit's racy filesystem store; the caller owns `sql`.
 * Ownership is the toolkit's rule (`isDashboardOwnedBy`, `resolveSavedRecord`). An unreadable row is
 * a conflict, never "absent", so a save can never overwrite it and hand it a new owner.
 */
export function createPostgresDashboardStore(options: {
  sql: postgres.Sql
  label?: string
}): DashboardStore {
  const { sql, label = "dashboard-store" } = options

  const classify = (row: DashboardRow): StoredDashboard => {
    const stored = classifyRow(row)
    if (stored.state === "unreadable") {
      console.warn(`[${label}] Dashboard "${row.id}" is unreadable: ${stored.reason}.`)
    }
    return stored
  }

  /** Throws `DashboardUnreadableError` when the row is the caller's but unreadable. */
  const ownRecord = (
    row: DashboardRow | undefined,
    userId: string | undefined,
  ): DashboardRecord | undefined => {
    if (!row) return undefined
    const stored = classify(row)
    if (!isDashboardOwnedBy(ownerOf(stored), userId)) return undefined
    if (stored.state === "unreadable") throw new DashboardUnreadableError(row.id, stored.reason)
    return stored.record
  }

  return {
    async save(input) {
      return await sql.begin(async (tx) => {
        // Advisory lock: a not-yet-existing row cannot be row-locked, so two concurrent FIRST saves of a
        // caller-supplied id would both create and the second would skip the ownership check.
        if (input.id) {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended('dashboards:' || ${input.id}, 0))`
        }
        const rows = input.id
          ? await tx<DashboardRow[]>`
              SELECT id, user_id, record, updated_at FROM dashboards
              WHERE id = ${input.id} FOR UPDATE
            `
          : []
        const stored = rows[0] ? classify(rows[0]) : undefined
        if (stored?.state === "unreadable") {
          if (!isDashboardOwnedBy(stored.ownerId, input.userId)) {
            throw new DashboardOwnershipError(
              stored.ownerId
                ? `Access denied: dashboard "${stored.id}" is owned by another user.`
                : `Access denied: dashboard "${stored.id}" has no owner; an owner-less (global-scope) dashboard is not writable by an identified caller.`,
            )
          }
          throw new DashboardUnreadableError(stored.id, stored.reason)
        }
        const now = new Date().toISOString()
        // Ownership semantics come straight from the toolkit (throws DashboardOwnershipError).
        const record: DashboardRecord = resolveSavedRecord(stored?.record, input, now) ?? {
          id: input.id ?? randomUUID(),
          name: input.name,
          description: input.description,
          userId: input.userId,
          keys: input.keys,
          steps: input.steps,
          layout: input.layout,
          title: input.title,
          schemaVersion: DASHBOARD_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        }
        // sql.json, not JSON.stringify: a pre-stringified value is double-encoded into a jsonb string.
        await tx`
          INSERT INTO dashboards (id, user_id, record, updated_at)
          VALUES (
            ${record.id},
            ${record.userId ?? null},
            ${tx.json(record as unknown as postgres.JSONValue)},
            ${record.updatedAt}
          )
          ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            record = EXCLUDED.record,
            updated_at = EXCLUDED.updated_at
        `
        return record
      })
    },
    async list(filter) {
      // Ordering on the mirrored timestamptz matches the toolkit's ISO-string sort.
      const rows = filter.userId
        ? await sql<DashboardRow[]>`
            SELECT id, user_id, record, updated_at FROM dashboards
            WHERE user_id = ${filter.userId}
            ORDER BY updated_at DESC
          `
        : await sql<DashboardRow[]>`
            SELECT id, user_id, record, updated_at FROM dashboards
            ORDER BY updated_at DESC
          `
      // SQL is the fast path, `isDashboardOwnedBy` the authority, in case the mirror diverges.
      return rows
        .map(classify)
        .filter((stored) => isDashboardOwnedBy(ownerOf(stored), filter.userId))
        .map(toSummary)
    },
    async get(id, filter) {
      const rows = await sql<DashboardRow[]>`
        SELECT id, user_id, record, updated_at FROM dashboards WHERE id = ${id}
      `
      return ownRecord(rows[0], filter.userId)
    },
    async delete(id, filter) {
      return await sql.begin(async (tx) => {
        const rows = await tx<DashboardRow[]>`
          SELECT id, user_id, record, updated_at FROM dashboards WHERE id = ${id} FOR UPDATE
        `
        if (!ownRecord(rows[0], filter.userId)) return false
        await tx`DELETE FROM dashboards WHERE id = ${id}`
        return true
      })
    },
  }
}
