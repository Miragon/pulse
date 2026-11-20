import { Button, cn, Icon, StatusStrip, useLocale } from "@miragon/pulse-ui"
import {
  describeError,
  isPermanentError,
  isSessionEnded,
} from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw } from "lucide-react"
import { useT } from "../messages/index.js"

/**
 * The bar's Refresh: reads the screen again. While it reads it keeps its focus and its place in the
 * tab order (`aria-disabled`), and a second click does nothing.
 */
export function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean
  onRefresh: () => void
}) {
  const t = useT()
  const label = t(refreshing ? "screen.refreshing" : "screen.refresh")
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      aria-disabled={refreshing || undefined}
      title={label}
      onClick={refreshing ? undefined : onRefresh}
    >
      <Icon icon={RefreshCw} className={cn(refreshing && "motion-safe:animate-spin")} />
      {label}
    </Button>
  )
}

/**
 * A failed refresh over the numbers on screen: docked under the bar, in the kit's words, Try again
 * unless no retry changes it; a page's ended session the frame's notice says, once.
 */
export function RefreshNotice({
  error,
  onRetry,
  permanent = isPermanentError,
}: {
  error: Error | null
  onRetry: () => void
  /** Whether no retry changes `error`: the kit's refusals, and a screen's own. */
  permanent?: (error: unknown) => boolean
}) {
  const t = useT()
  const locale = useLocale()
  if (error === null || isSessionEnded(error)) return null
  const described = describeError(error, locale, { followUp: "none" })
  return (
    <StatusStrip
      tone="warning"
      title={t("screen.refreshFailed")}
      detail={`${described.title}. ${t("screen.refreshStale")}`}
      details={described.details ?? undefined}
      actions={
        permanent(error) ? [] : [{ label: t("action.tryAgain"), icon: RefreshCw, onClick: onRetry }]
      }
    />
  )
}
