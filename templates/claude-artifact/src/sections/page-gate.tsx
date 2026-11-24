import type { ReactNode } from "react"
import { ErrorState, useLocale } from "@miragon/pulse-ui"
import { describeEngineError } from "../engine/errors.ts"
import { useEngine } from "../engine/use-engine.tsx"

/**
 * The page's sections, or its ONE state when the runtime refuses the page as a whole, as the
 * cockpit's refused engine is its view's one state: a read met a refusal of the viewer's connector
 * itself (no sign-in, no connector, no approval). Every section would fail alike, so none mounts,
 * and the bar shows no failure of its own. Its Try again, where one can help, is the bar's
 * Refresh: the gate opens, then every section reads again.
 */
export function PageGate({ children }: { readonly children: ReactNode }) {
  const { gate, refresh } = useEngine()
  const locale = useLocale()
  if (gate.status !== "refused") return children
  const words = describeEngineError(gate.error, locale)
  return (
    <ErrorState
      titleAs="h2"
      title={words.title}
      description={words.hint}
      details={words.details}
      onRetry={words.permanent ? undefined : refresh}
    />
  )
}
