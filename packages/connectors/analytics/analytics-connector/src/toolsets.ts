/**
 * `read-only` lacks only the settings save. No admin tier: analytics never
 * writes to an engine, so there is nothing wider to name.
 */
import { createToolsetVocabulary } from "@miragon/pulse-widget-shell/server"

export const ANALYTICS_TOOLSETS = ["read-only", "standard"] as const
export type AnalyticsToolset = (typeof ANALYTICS_TOOLSETS)[number]

export const analyticsToolsets = createToolsetVocabulary(
  "analytics",
  ANALYTICS_TOOLSETS,
  "read-only",
  {
    authenticatedDefault: "standard",
  },
)

export function isAnalyticsToolset(value: string): value is AnalyticsToolset {
  return analyticsToolsets.isKnown(value)
}

/** `analytics_save_settings` is registered outside the registrar, so it gates itself here. */
export function allowsDurableWrites(toolset?: string): boolean {
  return analyticsToolsets.allowsDurableWrites(analyticsToolsets.resolve(toolset))
}
