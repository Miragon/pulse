import { useLocale } from "@miragon/mcp-toolkit-ui"
import {
  ArrowLeftRight,
  Braces,
  Bug,
  ClipboardList,
  FileSearch,
  Gauge,
  Hourglass,
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
import type { LucideIcon } from "./icon.js"
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
  analyzePerformance: Gauge,
  explainBottleneck: Hourglass,
  prioritize: ListOrdered,
  compareEngines: ArrowLeftRight,
} as const satisfies Record<string, LucideIcon>

export type HandOffAction = keyof typeof HAND_OFF_ACTIONS

/** `title` overrides name and tooltip when a row needs its subject in them. */
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
