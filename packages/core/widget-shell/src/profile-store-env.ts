import {
  createFileSystemProfileStore,
  createInMemoryProfileStore,
  type ProfileStore,
} from "./profile-store.js"

/** Roots with a database put `DATABASE_URL` → `createPostgresProfileStore` ahead of this. */
export function profileStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ProfileStore {
  return env.MCP_PROFILE_DIR
    ? createFileSystemProfileStore({ dir: env.MCP_PROFILE_DIR })
    : createInMemoryProfileStore()
}

export type PersistenceBackend = "postgres" | "filesystem" | "memory"

export interface PersistenceSelection {
  profiles: PersistenceBackend
  /** Omitted when the server registers no dashboard builder (`frameworkWritesAllowed`). */
  dashboards?: PersistenceBackend
}

export function persistenceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Required<PersistenceSelection> {
  return {
    profiles: env.MCP_PROFILE_DIR ? "filesystem" : "memory",
    dashboards: env.MCP_DASHBOARD_DIR ? "filesystem" : "memory",
  }
}

/**
 * Announces on every boot so nobody infers volatility from silence. A warning, not a boot
 * failure: failing would break deployments that accept volatile settings today.
 */
export function announcePersistence(
  selection: PersistenceSelection,
  options: { env?: NodeJS.ProcessEnv; label?: string; remedy?: string } = {},
): void {
  const {
    env = process.env,
    label = "persistence",
    remedy = "Set MCP_PROFILE_DIR / MCP_DASHBOARD_DIR to directories on a persistent volume.",
  } = options
  const dashboards = selection.dashboards ? `, dashboards=${selection.dashboards}` : ""
  console.log(`[${label}] persistence: profiles=${selection.profiles}${dashboards}`)
  if (env.NODE_ENV !== "production") return
  const volatile = [
    ...(selection.profiles === "memory" ? ["user profiles"] : []),
    ...(selection.dashboards === "memory" ? ["saved dashboards"] : []),
  ]
  if (volatile.length === 0) return
  console.warn(
    `[${label}] WARNING: ${volatile.join(" and ")} are kept IN MEMORY in a production process — every restart, redeploy or scale-to-zero stop silently drops them. ${remedy}`,
  )
}
