import {
  announcePersistence,
  createPostgresProfileStore,
  createSql,
  persistenceFromEnv,
  postgresReadinessCheck,
  PROFILE_STORE_MIGRATIONS,
  profileStoreFromEnv,
  runMigrations,
  type ProfileStore,
  type ReadinessCheck,
} from "@miragon/pulse-widget-shell/server"
import { SERVER_LABEL } from "../server-label.js"

/**
 * Everything the composition root wires that depends on the deployment's
 * persistence choice. `initRuntime` below is the ONLY place environment
 * variables are translated into backend selections — a customer packaging
 * that needs a different mix (other database) either sets different env vars
 * or replaces this one module. The backends themselves are NOT app code: the
 * Postgres client, the migration runner and the Postgres profile store live in
 * `@miragon/pulse-widget-shell/server`, so a composed server gets the same
 * persistence by importing them instead of forking this file.
 */
export interface RuntimeBackends {
  profileStore: ProfileStore
  /** Closes owned resources (DB pool); wired to SIGTERM/SIGINT in index.ts. */
  shutdown(): Promise<void>
  /**
   * What `/health/ready` verifies: the store dependencies THIS deployment
   * has (the database when Postgres is selected; nothing for the file/memory
   * stores — a missing directory fails loudly at the first save instead).
   */
  readiness: Record<string, ReadinessCheck>
}

/**
 * The non-database profile store selection — the shared `profileStoreFromEnv`
 * (filesystem when `MCP_PROFILE_DIR` is set, in-memory otherwise). Also the
 * default `setup.ts` falls back to when `getPlugins()` is called without an
 * explicit store (tests), so the selection logic exists exactly once.
 */
export function createDefaultProfileStore(env: NodeJS.ProcessEnv = process.env): ProfileStore {
  return profileStoreFromEnv(env)
}

/**
 * Select and initialize the profile store. Precedence: `DATABASE_URL`
 * (Postgres) beats the filesystem knob `MCP_PROFILE_DIR`, which beats the
 * in-memory default. Every path logs its selection; a `NODE_ENV=production`
 * boot that keeps the profiles in memory warns loudly (`announcePersistence`)
 * — but still boots. With Postgres the pending migrations run here, before
 * the server starts listening — the container/Fly healthcheck grace periods
 * (15–30s) comfortably cover the small table.
 */
export async function initRuntime(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeBackends> {
  const announced = {
    env,
    label: SERVER_LABEL,
    remedy:
      "Set DATABASE_URL (Postgres), or MCP_PROFILE_DIR to a directory on a persistent volume.",
  }
  const databaseUrl = env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    announcePersistence(persistenceFromEnv(env), announced)
    return {
      profileStore: createDefaultProfileStore(env),
      shutdown: () => Promise.resolve(),
      readiness: {},
    }
  }

  if (env.MCP_PROFILE_DIR) {
    console.warn(
      `[${SERVER_LABEL}] DATABASE_URL is set — ignoring MCP_PROFILE_DIR; profiles persist to Postgres.`,
    )
  }

  const sql = await createSql(databaseUrl)
  let applied: string[]
  try {
    applied = await runMigrations(sql, PROFILE_STORE_MIGRATIONS)
  } catch (error) {
    // The boot fails here, so nothing else will ever end this client: close
    // it. The production entry (`node dist/index.js`) exits on the rejected
    // top-level await regardless; a caller that SURVIVES the rejection — an
    // in-process `createApp` boot in the e2e suites, a composed server that
    // catches it, `mcp-use dev` re-importing the entry — would otherwise keep
    // the pool's connections and their database sessions open. The migration
    // error is what the operator needs — a failing close must not replace it.
    await sql.end({ timeout: 5 }).catch(() => {})
    throw error
  }
  if (applied.length > 0) {
    console.log(`[${SERVER_LABEL}] applied database migrations: ${applied.join(", ")}`)
  }
  announcePersistence({ profiles: "postgres" }, announced)

  return {
    profileStore: createPostgresProfileStore({ sql }),
    shutdown: () => sql.end({ timeout: 5 }),
    readiness: { database: postgresReadinessCheck(sql) },
  }
}
