/**
 * For paths that only PREFER the profile: a preferences outage must never fail an engine tool nor
 * leak the driver's host:port into a result. Save paths stay strict.
 */

/** So an outage logs once instead of once per call. */
const failingStores = new WeakSet<object>()

/** Class and code only: driver messages carry host:port and user names. */
function describeStoreError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err
  const code = (err as { code?: unknown }).code
  return typeof code === "string" || typeof code === "number" ? `${err.name} ${code}` : err.name
}

/** Never throws; logs once per outage and once on recovery. */
export async function readProfileAdvisory<T>(
  store: { get(key: string): Promise<T | undefined> },
  key: string | undefined,
): Promise<T | undefined> {
  if (key === undefined) return undefined
  try {
    const record = await store.get(key)
    if (failingStores.delete(store)) {
      console.warn("[profile-store] reachable again — saved preferences apply again")
    }
    return record
  } catch (err) {
    if (!failingStores.has(store)) {
      failingStores.add(store)
      console.warn(
        `[profile-store] read failed (${describeStoreError(err)}) — preference lookups fall back to defaults until the store recovers`,
      )
    }
    return undefined
  }
}
