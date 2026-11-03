/**
 * The ONE reader of who calls: the MCP middleware's `ctx.auth`, the SDK `AuthInfo` with the
 * provider's mapped user and token payload under `extra`. Read structurally, so any `ctx` works.
 */
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

/** `user.id`, else `user.userId`, else the token's `payload.sub`; `undefined` without OAuth. */
export function callerUserId(ctx: unknown): string | undefined {
  if (!isRecord(ctx) || !isRecord(ctx.auth) || !isRecord(ctx.auth.extra)) return undefined
  const { user, payload } = ctx.auth.extra
  return firstString(
    isRecord(user) ? user.id : undefined,
    isRecord(user) ? user.userId : undefined,
    isRecord(payload) ? payload.sub : undefined,
  )
}
