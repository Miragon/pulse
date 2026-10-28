import { useMemo } from "react"
import { useLocale } from "@miragon/mcp-toolkit-ui"
import {
  askAiPrompt,
  modelContextText,
  type AskAiPrompt,
  type HandOffParts,
  type ModelContextSpec,
  type ToolSurface,
} from "@miragon/pulse-widget-shell/widgets"
import type { Camunda7AskAiKey } from "../../messages/en.ask-ai.js"
import { translator } from "../../messages/index.js"
import { useModelToolsAnswer, type ModelToolsAnswer } from "../widget-actions.js"
import { useAnalyticsActive } from "../cockpit-app/analytics-probe.js"

export type Camunda7AskAiIntent = Exclude<Camunda7AskAiKey, `${string}Label`>

export interface HandOff extends Omit<HandOffParts, "surface"> {
  intent: Camunda7AskAiIntent
}

export type ViewContext = Omit<ModelContextSpec, "surface">

/**
 * The engine stores a bare generated id when `<key>:<version>:<id>` exceeds 64 chars
 * (`data/definition-info.ts`); no key filter matches it, so the caller scopes by definition id.
 */
export function scopingDefinitionKey(
  key: string | null | undefined,
  definitionId: string | null | undefined,
): string | undefined {
  return key && key !== definitionId ? key : undefined
}

/**
 * `camunda7_*`: this deployment's model-visible tools; `analytics_*`: once its probe confirms it.
 * Fails closed while the feeds load; an `"unknown"` camunda7 feed builds the hand-off without tool names.
 */
export function camunda7Surface(
  modelTools: ModelToolsAnswer,
  analyticsActive: boolean,
): ToolSurface {
  return {
    has: (tool) => {
      if (tool.startsWith("analytics_")) return analyticsActive
      if (modelTools === "unknown") return tool.startsWith("camunda7_") ? undefined : false
      return modelTools !== "pending" && modelTools.includes(tool)
    },
  }
}

export function useCamunda7Surface(): ToolSurface {
  const modelTools = useModelToolsAnswer()
  const analytics = useAnalyticsActive()
  return useMemo(() => camunda7Surface(modelTools, analytics), [modelTools, analytics])
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
  const surface = useCamunda7Surface()
  const locale = useLocale()
  return useMemo(() => bindHandOff(locale, surface), [locale, surface])
}
