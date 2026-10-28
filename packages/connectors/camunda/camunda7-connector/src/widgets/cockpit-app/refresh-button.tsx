import { useState } from "react"
import { Button, cn, useLocale } from "@miragon/mcp-toolkit-ui"
import { Icon } from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw } from "lucide-react"
import { translator } from "../../messages/index.js"
import { refreshCockpitData } from "../refresh.js"

/** #322 U27: re-reads every feed of the open view; also the retry of a view stuck in error. */
export function CockpitRefreshButton() {
  const locale = useLocale()
  const [refreshing, setRefreshing] = useState(false)
  const label = translator(locale, refreshing ? "cockpit.refreshing" : "cockpit.refresh")
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={refreshing}
      aria-label={label}
      title={label}
      onClick={() => {
        setRefreshing(true)
        void refreshCockpitData().finally(() => setRefreshing(false))
      }}
    >
      <Icon icon={RefreshCw} className={cn(refreshing && "motion-safe:animate-spin")} />
    </Button>
  )
}
