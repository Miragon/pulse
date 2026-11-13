import { useLocale, type LucideIcon } from "@miragon/pulse-ui"
import {
  Braces,
  Bug,
  ClipboardList,
  FileSearch,
  ListChecks,
  ListOrdered,
  Route,
  ScanSearch,
  Stethoscope,
  Timer,
  Workflow,
  Wrench,
} from "lucide-react"
import { AskAiButton, type AskAiVariant } from "./ask-ai-button.js"
import type { AskAiPrompt } from "./ask-ai-prompt.js"
import { kitLabels } from "./kit-labels.js"

/** One icon per function, no icon for two (CI U4: never a sparkle); labels are the kit's `handOff`. */
export const HAND_OFF_ACTIONS = {
  assess: ListChecks,
  findCause: ScanSearch,
  explainError: FileSearch,
  planFix: Wrench,
  draftTicket: ClipboardList,
  explainTimeline: Route,
  explainDuration: Timer,
  checkVariables: Braces,
  explainDiagram: Workflow,
  checkHealth: Stethoscope,
  analyzeFailures: Bug,
  prioritize: ListOrdered,
} as const satisfies Record<string, LucideIcon>

export type HandOffAction = keyof typeof HAND_OFF_ACTIONS

/**
 * `title` overrides name and tooltip when a row needs its subject in them; `variant="toolbar"`
 * puts it in a view's bar beside the other toolbar buttons.
 */
export function HandOffButton({
  action,
  prompt,
  variant = "subtle",
  title,
}: {
  action: HandOffAction
  prompt: AskAiPrompt | null
  variant?: AskAiVariant
  title?: string
}) {
  const locale = useLocale()
  return (
    <AskAiButton
      icon={HAND_OFF_ACTIONS[action]}
      label={kitLabels(locale).handOff[action]}
      prompt={prompt}
      variant={variant}
      title={title}
    />
  )
}
