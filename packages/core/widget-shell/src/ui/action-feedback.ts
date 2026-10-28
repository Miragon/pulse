import { useMemo } from "react"
import { useLocale, useToast } from "@miragon/mcp-toolkit-ui"
import { classifyError, describeError } from "./describe-error.js"
import { ERROR_LABELS } from "./error-labels.js"
import { supportedLanguage } from "./host-context.js"

export interface ActionFeedback {
  /** The title names the object ("Einstellungen gespeichert"). */
  succeeded: (title: string, description?: string) => void
  /** A 5 s danger toast naming the object, its second line from {@link failureLine}. */
  failed: (title: string, error: unknown) => void
}

/** A toast has no "Details", so the line quotes the engine's reason, and a write whose answer never came says it may have gone through, so you check before retrying instead of applying it twice. */
export function failureLine(error: unknown, locale: string | undefined): string {
  const described = describeError(error, locale)
  const facts = classifyError(error)
  const toast = ERROR_LABELS[supportedLanguage(locale) ?? "en"].toast
  const happened = described.kind === "unknown" ? "" : `${described.title}. `
  if (facts.mayHaveApplied) return `${happened}${toast.mayHaveApplied()}`
  if (described.kind !== "failed") return `${happened}${described.hint}`
  if (!facts.reason) return `${happened}${toast.failedHint()}`
  const reason = clip(facts.reason)
  return `${toast.reason({ title: described.title, reason })} ${toast.failedHint()}`
}

/** A toast line stays readable: a long engine text (a stack trace's head) is cut. */
const MAX_TOAST_REASON = 200
const clip = (text: string) =>
  text.length > MAX_TOAST_REASON ? `${text.slice(0, MAX_TOAST_REASON).trimEnd()}…` : text

/** Outside a toolkit toast provider (a bare fixture) the calls are no-ops. */
export function useActionFeedback(): ActionFeedback {
  const toast = useToast()
  const locale = useLocale()
  return useMemo(
    () => ({
      succeeded: (title, description) => {
        toast.show({ tone: "success", title, ...(description ? { description } : {}) })
      },
      failed: (title, error) => {
        toast.show({ tone: "danger", title, description: failureLine(error, locale) })
      },
    }),
    [toast, locale],
  )
}
