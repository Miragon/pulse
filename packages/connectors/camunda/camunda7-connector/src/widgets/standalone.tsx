import { useEffect, useState, type ReactNode } from "react"
import { useLocale, NavigationFocus } from "@miragon/pulse-ui"
import {
  HostModelContext,
  useToolQuery,
  ViewErrorBoundary,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { translator } from "../messages/use-t.js"
import { CAMUNDA7_LIST_ENGINES } from "../tool-names.js"
import { CockpitRoute } from "./cockpit-app/routes.js"
import { NavBreadcrumb } from "./cockpit-app/breadcrumb.js"
import { drillContext } from "./cockpit-app/model-context.js"
import { useHandOff } from "./lib/hand-off.js"
import {
  crumbLabel,
  intentToView,
  popTo,
  pushView,
  viewKey,
  viewToIntent,
  type CockpitView,
} from "./nav-core.js"
import { NavProvider, useHostNavigate, type OnNavigate } from "./navigation.js"

interface EnginesResult {
  engines: Array<{ id: string }>
  defaultEngineId: string | null
}

function engineFromQuery(queried: EnginesResult | undefined): string | undefined {
  return (
    queried?.defaultEngineId ??
    (queried && queried.engines.length === 1 ? queried.engines[0].id : undefined)
  )
}

// The engines query failed, or several engines and no saved default: hand the drill to the chat,
// the only path that still reaches the view. Settled data only (`isFetching`).
function isEngineUnresolvable({
  needsEngine,
  engineId,
  enginesQuery,
  queried,
  queriedEngineId,
}: {
  needsEngine: boolean
  engineId: string | undefined
  enginesQuery: { isFetching: boolean; isError: boolean }
  queried: EnginesResult | undefined
  queriedEngineId: string | undefined
}): boolean {
  return (
    needsEngine &&
    !engineId &&
    !enginesQuery.isFetching &&
    (enginesQuery.isError || (queried !== undefined && !queriedEngineId))
  )
}

/**
 * Client-side drill-in for a camunda7 standalone view. Depth 0 is the view itself; a drill renders
 * the cockpit route while the origin stays mounted (hidden), so "back" is instant. `engineId` is
 * the view data's engine echo, so a drill stays on the answering engine without an extra call. An
 * app-level `<HostModelContext>` keeps the model informed on silent navigation. The cockpit's own
 * deeper `NavProvider` shadows this one.
 */
export function Camunda7Standalone({
  engineId: echoedEngineId,
  children,
}: {
  engineId?: string | null
  children: ReactNode
}) {
  const locale = useLocale()
  const { context } = useHandOff()
  const viaHost = useHostNavigate()
  const [stack, setStack] = useState<CockpitView[]>([])

  // Only consulted when a drill has no engine echo.
  const enginesQuery = useToolQuery<EnginesResult>(
    ["camunda7:engines"],
    CAMUNDA7_LIST_ENGINES,
    {},
    { enabled: stack.length > 0 && !echoedEngineId },
  )
  const queried = enginesQuery.data
  const queriedEngineId = engineFromQuery(queried)
  const engineId = echoedEngineId ?? queriedEngineId

  const current = stack.length > 0 ? stack[stack.length - 1] : undefined
  const needsEngine = current !== undefined && current.section !== "settings"

  const engineUnresolvable = isEngineUnresolvable({
    needsEngine,
    engineId,
    enginesQuery,
    queried,
    queriedEngineId,
  })
  // Handing back to the host is an external call, and emptying the trail is the other half of that handover.
  useEffect(() => {
    if (engineUnresolvable && current) {
      viaHost(viewToIntent(current))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- half of the handover above
      setStack([])
    }
  }, [engineUnresolvable, current, viaHost])

  const navigate: OnNavigate = (intent) => {
    setStack((prev) => pushView(prev, intentToView(intent)))
  }

  // Not a server title: server titles are untranslated and a mixed-language trail reads broken.
  const originLabel = translator(locale, "cockpit.crumb.origin")

  // #344 N107: focus moves to the shown view and its name is announced.
  const focusKey = JSON.stringify(stack)
  const viewLabel = current ? crumbLabel(current, locale) : originLabel

  return (
    <NavProvider value={navigate}>
      <NavigationFocus viewKey={focusKey} label={viewLabel}>
        {/* The origin view stays mounted while a drill view is shown: "back"
          is instant and keeps its state (paging, search, expanded rows). */}
        <div hidden={current !== undefined}>{children}</div>
        {current !== undefined && (
          <WidgetShell>
            {/* Outside the engine conditional on purpose: the way back to the
              origin must exist even while (or if) the engines query never
              settles. A drill must never trap the user on a loading state. */}
            <NavBreadcrumb
              stack={stack}
              locale={locale}
              rootLabel={originLabel}
              onPop={(to) => setStack((prev) => (to < 0 ? [] : popTo(prev, to)))}
            />
            {!needsEngine || engineId ? (
              <>
                <HostModelContext content={context(drillContext(current, engineId))}>
                  {null}
                </HostModelContext>
                <ViewErrorBoundary resetKey={viewKey(current)}>
                  <CockpitRoute view={current} engine={engineId ?? ""} />
                </ViewErrorBoundary>
              </>
            ) : (
              <div className="text-muted-foreground text-dense p-6">
                {translator(locale, "cockpit.loading.engines")}
              </div>
            )}
          </WidgetShell>
        )}
      </NavigationFocus>
    </NavProvider>
  )
}
