import type { ReactNode } from "react"
import { CountPill } from "@miragon/mcp-toolkit-ui"
import { countTone, formatNumber } from "@miragon/pulse-widget-shell/widgets"

/**
 * U17: "—" means not measured, never 0 or "not deployed" (an empty cell). The
 * reason is text, not only a tooltip, so screen readers and touch get it too.
 */
export function Figure({
  value,
  format = formatNumber,
  why,
}: {
  value: number | null
  format?: (value: number) => string
  why: string
}) {
  if (value === null) {
    return (
      <span title={why} data-figure="missing">
        <span aria-hidden="true">{formatNumber(null)}</span>
        <span className="sr-only">{why}</span>
      </span>
    )
  }
  return <>{format(value)}</>
}

/** A count that is a state (decision f), on the kit's `countTone` ladder like camunda7. */
export function StateCount({ value, why }: { value: number | null; why?: string }) {
  if (countTone(value) === "danger") {
    return <CountPill tone="danger">{formatNumber(value)}</CountPill>
  }
  return why === undefined ? <>{formatNumber(value)}</> : <Figure value={value} why={why} />
}

export function Legend({ children }: { children: ReactNode }) {
  return (
    <p data-legend="" className="text-muted-foreground text-small mt-2">
      {children}
    </p>
  )
}

/** Puts the dash's meaning on screen, no hover needed; `false` skips a reason. */
export function FigureLegend({
  reasons,
}: {
  reasons: ReadonlyArray<string | false | null | undefined>
}) {
  const lines = [...new Set(reasons.filter((why): why is string => !!why))]
  return (
    <>
      {lines.map((why) => (
        <Legend key={why}>
          <span className="text-foreground font-medium">{formatNumber(null)}</span> {why}
        </Legend>
      ))}
    </>
  )
}
