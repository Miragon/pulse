/**
 * The ONE reader of who calls. mcp-use hands out two `ctx.auth` shapes: middleware gets the SDK
 * `AuthInfo` (the mapped user under `auth.extra.user`), tool, resource and prompt callbacks the
 * flattened `auth.user`; the flattened one wins. Read structurally, so any `ctx` works.
 */
interface Caller {
  /** `user.id`, else `user.userId`, else the token's `payload.sub`. */
  userId?: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }
  return undefined
}

function pick(auth: UnknownRecord, extra: UnknownRecord | undefined, key: string) {
  const own = auth[key]
  if (isRecord(own)) return own
  const nested = extra?.[key]
  return isRecord(nested) ? nested : undefined
}

/**
 * `undefined` only without `ctx.auth`. An authenticated caller whose provider maps no id is still a
 * caller (without `userId`), never the anonymous one.
 */
export function resolveCaller(ctx: unknown): Caller | undefined {
  if (!isRecord(ctx) || !isRecord(ctx.auth)) return undefined
  const extra = isRecord(ctx.auth.extra) ? ctx.auth.extra : undefined
  const user = pick(ctx.auth, extra, "user")
  const payload = pick(ctx.auth, extra, "payload")
  const userId = firstString(user?.id, user?.userId, payload?.sub)
  return userId === undefined ? {} : { userId }
}
