import { z } from "zod"
import { PERIODS } from "@miragon/pulse-analytics-client"
import { parseModuleSlice } from "@miragon/pulse-widget-shell/server"
import type { ProfileSource } from "./server-locale.js"
import { resolveSettingsKey } from "./server-locale.js"

/** Read fail-soft: a stale or hand-edited slice yields the defaults, never a broken tool. */
export const analyticsSettingsSchema = z.object({
  defaultPeriod: z
    .enum(PERIODS)
    .default("7d")
    .describe("Default look-back window applied when an analytics call omits `period`."),
  minBucketSize: z
    .number()
    .int()
    .min(1)
    .default(10)
    .describe(
      "Default minimum per-window instance count before comparison results are flagged `suppressed`, applied when a compare call omits `minBucketSize`.",
    ),
})

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>

/**
 * Default-free, and spelled out by hand rather than via `withoutDefaults`
 * because the save descriptions ("Omitted → unchanged") differ from the schema's.
 */
export const analyticsSettingsSaveInput = z.object({
  defaultPeriod: z
    .enum(PERIODS)
    .optional()
    .describe("New default look-back period. Omitted → unchanged."),
  minBucketSize: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("New minimum comparison bucket size. Omitted → unchanged."),
})

/** No zod default, so an omitted value can fall back to the user's saved default first. */
export const optionalPeriod = z
  .enum(PERIODS)
  .optional()
  .describe("Analysis time period. Omitted → the user's saved analytics default (else 7d).")

export const optionalMinBucketSize = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    "Minimum per-window instance count before results are flagged `suppressed`. Omitted → the user's saved analytics default (else 10).",
  )

export const ANALYTICS_MODULE_KEY = "analytics"

/** Lenient per FIELD, so one invalid value keeps the other saved preference. */
export function parseAnalyticsSettings(
  modules: Record<string, unknown> | undefined,
): AnalyticsSettings {
  return parseModuleSlice(analyticsSettingsSchema, modules?.[ANALYTICS_MODULE_KEY])
}

/** Fail-soft: a profile-store outage must never fail a read that only needs Prometheus. */
export async function settingsFor(
  store: ProfileSource | undefined,
  ctx?: unknown,
): Promise<AnalyticsSettings> {
  if (!store) return analyticsSettingsSchema.parse({})
  const key = resolveSettingsKey(ctx)
  if (!key) return analyticsSettingsSchema.parse({})
  try {
    const profile = await store.get(key)
    return parseAnalyticsSettings(profile?.modules)
  } catch {
    return analyticsSettingsSchema.parse({})
  }
}
