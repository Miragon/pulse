import { formatClock, formatInstant, formatRelativeTime } from "@miragon/pulse-ui"

/** No value: one quiet em dash, never a 0 or an empty cell. */
export function NoValue() {
  return <span className="text-muted-foreground">—</span>
}

/**
 * A time in a cell: its clock (to the millisecond where runs a few milliseconds apart must stay
 * apart) and quietly how long ago, the whole instant in its title; no value without one.
 */
export function InstanceTime({
  iso,
  precise = false,
}: {
  readonly iso: string | undefined
  readonly precise?: boolean
}) {
  if (iso === undefined) {
    return <NoValue />
  }
  return (
    <span className="tabular-nums" title={formatInstant(iso)}>
      {formatClock(iso, precise ? { milliseconds: true } : { seconds: false })}
      <span className="text-muted-foreground"> · {formatRelativeTime(iso)}</span>
    </span>
  )
}
