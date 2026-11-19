import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { Button, cn, useLocale, Icon } from "@miragon/pulse-ui"
import { useQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw } from "lucide-react"
import { translator } from "../../messages/use-t.js"
import { refreshCockpitData } from "../refresh.js"

interface CockpitRefresh {
  refreshing: boolean
  refresh: () => void
}

const CockpitRefreshContext = createContext<CockpitRefresh | null>(null)

/** #322 U27: one Refresh per engine's cockpit, which its head offers and its route shows. */
export function CockpitRefreshProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(() => {
    setRefreshing(true)
    void refreshCockpitData(client).finally(() => setRefreshing(false))
  }, [client])
  const value = useMemo(() => ({ refreshing, refresh }), [refreshing, refresh])
  return <CockpitRefreshContext.Provider value={value}>{children}</CockpitRefreshContext.Provider>
}

function useCockpitRefresh(): CockpitRefresh {
  const refresh = useContext(CockpitRefreshContext)
  if (!refresh) throw new Error("The cockpit's Refresh needs its CockpitRefreshProvider.")
  return refresh
}

/**
 * The route's region, busy (`aria-busy`) while the cockpit's Refresh reads its feeds again: the
 * content stays on screen, and a screen reader waits for the new numbers (A4).
 */
export function CockpitRefreshRegion({ children }: { children: ReactNode }) {
  const { refreshing } = useCockpitRefresh()
  return (
    <div className="min-w-0" aria-busy={refreshing || undefined}>
      {children}
    </div>
  )
}

/**
 * #322 U27: re-reads every feed of the open view; also the retry of a view stuck in error. While it
 * reads, the button stays in the tab order with its focus (`aria-disabled`, A4) and a click does
 * nothing.
 */
export function CockpitRefreshButton() {
  const locale = useLocale()
  const { refreshing, refresh } = useCockpitRefresh()
  const label = translator(locale, refreshing ? "cockpit.refreshing" : "cockpit.refresh")
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-disabled={refreshing || undefined}
      aria-label={label}
      title={label}
      onClick={refreshing ? undefined : refresh}
    >
      <Icon icon={RefreshCw} className={cn(refreshing && "motion-safe:animate-spin")} />
    </Button>
  )
}
