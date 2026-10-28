import { useMemo } from "react"
import { useLocale, useToolQuery } from "@miragon/mcp-toolkit-ui"
import {
  askAiPrompt,
  modelContextText,
  type AskAiPrompt,
  type HandOffParts,
  type ModelContextSpec,
  type ToolSurface,
} from "@miragon/pulse-widget-shell/widgets"
import type { AnalyticsAskAiKey } from "../messages/en.ask-ai.js"
import { translator } from "../messages/index.js"

export interface HandOff extends Omit<HandOffParts, "surface"> {
  intent: AnalyticsAskAiKey
}

export type ViewContext = Omit<ModelContextSpec, "surface">

/** Tier-2 cross-module reference by raw name; fails when camunda7 is not active, so no camunda7 tool is named. */
const CAMUNDA7_SURFACE_FEED = "camunda7_widget_actions_data"

/**
 * `analytics_*`: registered by the read-only floor (pinned by the app's hand-off
 * surface test). `camunda7_*`: only what the feed reports, fail-closed until it answers.
 */
export function analyticsSurface(camunda7ModelTools: readonly string[] | undefined): ToolSurface {
  return {
    has: (tool) => tool.startsWith("analytics_") || (camunda7ModelTools?.includes(tool) ?? false),
  }
}

/** `describeForModel` is pure, so it gets analytics tools only. */
export const ANALYTICS_ONLY_SURFACE = analyticsSurface(undefined)

export function useAnalyticsSurface(): ToolSurface {
  const modelTools = useToolQuery<{ modelTools?: string[] }>(
    ["camunda7-widget-actions"],
    CAMUNDA7_SURFACE_FEED,
    {},
  ).data?.modelTools
  return useMemo(() => analyticsSurface(modelTools), [modelTools])
}

/** The hook's body, testable without React. */
export function bindHandOff(locale: string, surface: ToolSurface) {
  return {
    surface,
    /** Null when nothing in it is available here. */
    ask: (handOff: HandOff): AskAiPrompt | null =>
      askAiPrompt({ ...handOff, intent: translator(locale, handOff.intent), locale, surface }),
    context: (view: ViewContext): string => modelContextText({ ...view, surface }),
  }
}

export function useHandOff() {
  const surface = useAnalyticsSurface()
  const locale = useLocale()
  return useMemo(() => bindHandOff(locale, surface), [locale, surface])
}

/**
 * The server-resolved `engines` echo (#336), never a cell prop: the scope named
 * must be the scope of the numbers shown.
 */
export function engineIdsOf(
  engines: readonly string[] | null | undefined,
): string | string[] | undefined {
  if (!engines || engines.length === 0) return undefined
  return engines.length === 1 ? engines[0] : [...engines]
}

export function isAggregate(engines: readonly string[] | null | undefined): boolean {
  return (engines?.length ?? 0) > 1
}
