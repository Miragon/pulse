/** Small helpers of the workflow domain. Pure. */

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> }

/**
 * Drops properties whose value is undefined. Needed with exactOptionalPropertyTypes, where an
 * optional property must be absent rather than undefined.
 */
export function compact<T extends object>(value: T): Partial<Defined<T>> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<Defined<T>>
}

/** `Omit` for each member of a union, as a rest pattern types it. */
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * A copy of `value` without its property `key`; every other own property stays, an undefined value
 * included. The rest pattern `{ [key]: _, ...rest }` without a binding that is never read.
 */
export function omit<T extends object, K extends keyof T & string>(
  value: T,
  key: K,
): Without<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Without<T, K>
}

/** True for plain JSON-like objects (not null, not arrays). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Maps every item with `fn`, at most `limit` calls at a time, and resolves to the results in the
 * order of the items (requests of one round of a workflow run like this). Rejects with the first
 * failure; no item starts after it (calls already running finish on their own).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index] as T, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
