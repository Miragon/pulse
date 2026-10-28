import type { z } from "zod"
import { resolveProfileKey } from "./profile.js"
import type { ProfileSlice, ProfileSource } from "./profile.js"

/**
 * Degrades per FIELD, so one invalid value (say, from a rolled-back newer build) cannot
 * reset the rest. Read-side only: a write must never silently coerce.
 */
export function parseModuleSlice<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  slice: unknown,
): z.output<z.ZodObject<T>> {
  const whole = schema.safeParse(slice ?? {})
  if (whole.success) return whole.data
  const raw = typeof slice === "object" && slice !== null ? (slice as Record<string, unknown>) : {}
  const kept: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    const value = raw[key]
    if (value === undefined) continue
    if ((field as z.ZodType).safeParse(value).success) kept[key] = value
  }
  const recovered = schema.safeParse(kept)
  return recovered.success ? recovered.data : schema.parse({})
}

/** Without OAuth there is no key; writing anyway would share one record across unrelated callers. */
export function requireProfileKey(ctx?: unknown): string {
  const key = resolveProfileKey(ctx)
  if (!key) {
    throw new Error(
      "No caller identity to save the profile under — settings are saved per signed-in user, so the server needs MCP_OAUTH.",
    )
  }
  return key
}

/**
 * Hands the store the PATCH alone, never a slice pre-read outside its lock: the store
 * merges it over the RAW slice inside its per-key serialization, so concurrent saves and
 * a newer build's fields survive. `undefined` clears a field. Reads back when a custom
 * store's `save` returns nothing.
 */
export async function saveModuleSlice(
  store: { get: ProfileSource["get"]; save: NonNullable<ProfileSource["save"]> },
  key: string,
  module: string,
  patch: Record<string, unknown>,
  opts?: { userId?: string },
): Promise<unknown> {
  const saved = await store.save(key, { modules: { [module]: patch } }, opts)
  const record = isProfileSlice(saved) ? saved : await store.get(key)
  return record?.modules?.[module]
}

const isProfileSlice = (value: unknown): value is ProfileSlice =>
  typeof value === "object" && value !== null && "modules" in value
