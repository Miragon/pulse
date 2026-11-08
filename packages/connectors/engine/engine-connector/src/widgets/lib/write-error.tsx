import { ErrorState, useLocale } from "@miragon/pulse-ui"
import { describeError } from "@miragon/pulse-widget-shell/widgets"

/**
 * A failed write at the control that ran it, as its dialog shows one: what happened and the way
 * out, the engine's own text only under "Details". The toast names the object (#322 U9).
 */
export function WriteError({ error, className }: { error: unknown; className?: string }) {
  const locale = useLocale()
  if (!error) return null
  const described = describeError(error, locale)
  return (
    <ErrorState
      variant="inline"
      title={described.title}
      description={described.hint}
      details={described.details ?? undefined}
      className={className}
    />
  )
}
