/**
 * The single source of WHOSE profile a request touches: two modules resolving different
 * keys would silently split one user's settings across two records. `/server` only:
 * the ambient request info pulls in `node:async_hooks`.
 */
import { resolveCaller } from "@miragon/mcp-toolkit-core"
import { z } from "zod"
import { getMcpRequestInfo } from "./request-context.js"

/** Only an explicitly declared local caller (stdio, tests); never an HTTP request. */
export const ANONYMOUS_PROFILE_KEY = "anonymous"

/** Narrower than `ProfileStore`: a module has no business with `delete` or another module's slice. */
export interface ProfileSource {
  get(key: string): Promise<ProfileSlice | undefined>
  save?(
    key: string,
    input: { modules: Record<string, unknown> },
    opts?: { userId?: string },
  ): Promise<unknown>
}

export interface ProfileSlice {
  language?: string
  modules?: Record<string, unknown>
}

/**
 * Fail-closed: the OAuth caller (an authenticated `ctx` decides ALONE, never a fallback),
 * else the ambient info (ctx-less pipeline steps), else the declared anonymous caller,
 * else `undefined`. `ctx` is `unknown` because mcp-use's handler context shape isn't stable.
 */
export function resolveProfileKey(ctx?: unknown): string | undefined {
  const caller = resolveCaller(ctx)
  if (caller) return caller.userId
  const info = getMcpRequestInfo()
  if (info?.authUserId) return info.authUserId
  return info?.anonymousCaller ? ANONYMOUS_PROFILE_KEY : undefined
}

/** Never the anonymous key; save paths stamp it as the record's owner. */
export function resolveAuthUserId(ctx?: unknown): string | undefined {
  const caller = resolveCaller(ctx)
  return caller ? caller.userId : getMcpRequestInfo()?.authUserId
}

/** Zod 4 re-applies defaults THROUGH `.partial()`, so a defaulted save input would silently reset omitted fields. */
export function withoutDefaults(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => {
      if (!(schema instanceof z.ZodDefault)) return [key, schema]
      const inner = schema.unwrap() as z.ZodType
      return [key, schema.description ? inner.describe(schema.description) : inner]
    }),
  )
}
