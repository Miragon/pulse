import { formatInstant, formatRelativeTime } from "@miragon/pulse-ui"

/**
 * A time ago ("3h ago", "vor 3 Std."), its instant in its title: "first seen" and "latest" read so
 * on every view, as the process view's activity groups and the cluster's bar read them. An unknown
 * one (the scan holds not all of the incidents) is "—" without a title, never a guess.
 */
export function TimeAgo({
  iso,
  children,
}: {
  iso: string | null
  children?: (time: string) => string
}) {
  const time = formatRelativeTime(iso)
  const text = children ? children(time) : time
  if (!iso) return <>{text}</>
  return (
    <time dateTime={iso} title={formatInstant(iso)}>
      {text}
    </time>
  )
}
