import { useMemo } from "react"
import { useLocale } from "@miragon/pulse-ui"
import {
  askAiPrompt,
  modelContextText,
  type AskAiPrompt,
  type HandOffParts,
  type ModelContextSpec,
} from "@miragon/pulse-widget-shell/widgets"
import type { Camunda7AskAiKey } from "../../messages/en.ask-ai.js"
import { translator } from "../../messages/use-t.js"

export type Camunda7AskAiIntent = Exclude<Camunda7AskAiKey, `${string}Label`>

/** A hand-off names no tool: the module instructions and the tool descriptions steer the model. */
export interface HandOff extends HandOffParts {
  intent: Camunda7AskAiIntent
}

export type ViewContext = ModelContextSpec

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

/** The hook's body, testable without React. */
export function bindHandOff(locale: string) {
  return {
    /** Null only for an empty intent. */
    ask: (handOff: HandOff): AskAiPrompt | null =>
      askAiPrompt({ ...handOff, intent: translator(locale, handOff.intent), locale }),
    context: (view: ViewContext): string => modelContextText(view),
  }
}

export function useHandOff() {
  const locale = useLocale()
  return useMemo(() => bindHandOff(locale), [locale])
}
