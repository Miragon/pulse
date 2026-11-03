import { useMemo } from "react"
import { useLocale } from "@miragon/pulse-ui"
import {
  askAiPrompt,
  type AskAiPrompt,
  type HandOffParts,
} from "@miragon/pulse-widget-shell/widgets"
import type { AnalyticsAskAiKey } from "../messages/en.ask-ai.js"
import { translator } from "../messages/use-t.js"

export interface HandOff extends HandOffParts {
  intent: AnalyticsAskAiKey
}

/** The hook's body, testable without React. */
export function bindHandOff(locale: string) {
  return {
    /** Null only for an empty intent. */
    ask: (handOff: HandOff): AskAiPrompt | null =>
      askAiPrompt({ ...handOff, intent: translator(locale, handOff.intent), locale }),
  }
}

export function useHandOff() {
  const locale = useLocale()
  return useMemo(() => bindHandOff(locale), [locale])
}

/**
 * The server-resolved `engines` echo (#336), never a cell prop: the scope named
 * must be the scope of the numbers shown.
 */
export function engineIdsOf(engines: readonly string[] | null): string | string[] | undefined {
  if (!engines || engines.length === 0) return undefined
  return engines.length === 1 ? engines[0] : [...engines]
}

export function isAggregate(engines: readonly string[]): boolean {
  return engines.length > 1
}
