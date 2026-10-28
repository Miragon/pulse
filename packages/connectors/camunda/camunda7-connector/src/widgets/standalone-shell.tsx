import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useCallTool, useLocale, useToolQuery } from "@miragon/mcp-toolkit-ui"
import {
  HostModelContext,
  WidgetRenderer,
  useHostBridge,
  useHostActions,
} from "@miragon/mcp-toolkit-ui/app"
import {
  DisplayModeToggle,
  filterLayoutToWidgets,
  NavigationFocus,
  useHostWidgets,
  useResetOnChange,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { translator } from "../messages/index.js"
import { NavBreadcrumb } from "./cockpit-app/breadcrumb.js"
import { cockpitViews } from "./cockpit-app/views.js"
import {
  buildViewParams,
  crumbLabel,
  intentToView,
  popTo,
  pushView,
  viewToIntent,
  type CockpitView,
} from "./nav-core.js"
import { navigateViaHost, NavProvider, type OnNavigate } from "./navigation.js"
import { camunda7BaseWidgets } from "./registry.js"
import { useHandOff } from "./lib/hand-off.js"
import { drillContext } from "./cockpit-app/model-context.js"
import { CAMUNDA7_LIST_ENGINES } from "../tool-names.js"

interface EnginesResult {
  engines: Array<{ id: string }>
  defaultEngineId: string | null
}

// Payloads echo the answering engine, so a drill stays on it without an extra call. Exported: the fixture harness cannot inject a production-shaped `toolOutput`.
export function findStepEngineId(toolOutput: unknown): string | undefined {
  if (!toolOutput || typeof toolOutput !== "object") return undefined
  const context = (toolOutput as { context?: { stepData?: unknown } }).context
  const stepData = context?.stepData
  if (!stepData || typeof stepData !== "object") return undefined
  for (const step of Object.values(stepData)) {
    const data = (step as { data?: unknown } | null)?.data
    const engineId = (data as { engineId?: unknown } | null)?.engineId
    if (typeof engineId === "string" && engineId) return engineId
  }
  return undefined
}

// Not null or a transient partial global.
function isViewResult(output: unknown): boolean {
  if (!output || typeof output !== "object") return false
  return "layout" in output || "context" in output
}

function engineFromQuery(queried: EnginesResult | undefined): string | undefined {
  return (
    queried?.defaultEngineId ??
    (queried && queried.engines.length === 1 ? queried.engines[0].id : undefined)
  )
}

// No transport, engines query failed, or multi-engine without a saved default: fall back to the
// conversational transport, the only path that still emits a prompt. Settled data only (`isFetching`).
function isEngineUnresolvable({
  needsEngine,
  engineId,
  queryCallTool,
  enginesQuery,
  queried,
  queriedEngineId,
}: {
  needsEngine: boolean
  engineId: string | undefined
  queryCallTool: unknown
  enginesQuery: { isFetching: boolean; isError: boolean }
  queried: EnginesResult | undefined
  queriedEngineId: string | undefined
}): boolean {
  return (
    needsEngine &&
    !engineId &&
    (!queryCallTool ||
      (!enginesQuery.isFetching &&
        (enginesQuery.isError || (queried !== undefined && !queriedEngineId))))
  )
}

/**
 * Client-side drill-in for standalone renders. Depth 0 is the original render; a drill renders the
 * cockpit view while the origin stays mounted (hidden) so "back" is instant. An app-level
 * `<HostModelContext>` keeps the model informed on silent navigation. The cockpit's own deeper
 * `NavProvider` shadows this one. Belongs inside `AppShellProviders`: a second query client would
 * leave the origin view and the profile stale after a drilled write.
 */
export function Camunda7StandaloneShell({ children }: { children: ReactNode }) {
  // The `toolInput` fallback is gone with `useWidget()`: a per-call `engine` override survives only via the payload's engine echo.
  const bridge = useHostBridge()
  const output = bridge.getWidgetData<unknown>()
  const host = useHostActions()
  const locale = useLocale()
  const { context } = useHandOff()
  // Absent without in-widget tools/call: drills then fall back to the conversational transport.
  const queryCallTool = useCallTool()
  const [stack, setStack] = useState<CockpitView[]>([])

  // A new tool result (e.g. Apps-SDK fullscreen follow-up) obsoletes the trail; guarded to complete
  // view results so transient host-global re-emissions don't clear it.
  useResetOnChange(output, () => {
    if (isViewResult(output)) setStack([])
  })

  // Host widgets under our own (own ids win), so a drilled composed view (settings) resolves another
  // module's section; without the provider unresolvable cells are dropped below.
  const hostWidgets = useHostWidgets()
  const drillWidgets = { ...hostWidgets, ...camunda7BaseWidgets }

  const stepEngineId = useMemo(() => findStepEngineId(output), [output])
  // Only consulted when a drill has no engine echo.
  const enginesQuery = useToolQuery<EnginesResult>(
    ["camunda7:engines"],
    CAMUNDA7_LIST_ENGINES,
    {},
    { enabled: stack.length > 0 && !stepEngineId },
  )
  const queried = enginesQuery.data
  const queriedEngineId = engineFromQuery(queried)
  const engineId = stepEngineId ?? queriedEngineId

  const current = stack.length > 0 ? stack[stack.length - 1] : undefined
  const needsEngine = current !== undefined && current.section !== "settings"

  const engineUnresolvable = isEngineUnresolvable({
    needsEngine,
    engineId,
    queryCallTool,
    enginesQuery,
    queried,
    queriedEngineId,
  })
  // Handing back to the host is an external call, and emptying the trail is the other half of that handover.
  useEffect(() => {
    if (engineUnresolvable && current) {
      navigateViaHost(host, viewToIntent(current))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- half of the handover above
      setStack([])
    }
  }, [engineUnresolvable, current, host])

  const navigate: OnNavigate = (intent) => {
    setStack((prev) => pushView(prev, intentToView(intent)))
  }

  // Not structuredContent.title: server titles are untranslated and a mixed-language trail reads broken.
  const originLabel = translator(locale, "cockpit.crumb.origin")

  // #344 N107: focus moves to the shown view and its name is announced.
  const viewKey = JSON.stringify(stack)
  const viewLabel = current ? crumbLabel(current, locale) : originLabel

  return (
    <NavProvider value={navigate}>
      <NavigationFocus viewKey={viewKey} label={viewLabel}>
        {/* The origin render stays mounted while a drill view is shown — "back"
          is instant and keeps its state (paging, search, expanded rows). */}
        <div hidden={current !== undefined}>{children}</div>
        {current !== undefined && (
          <WidgetShell>
            {/* Outside the engine conditional on purpose: the way back to the
              origin must exist even while (or if) the engines query never
              settles — a drill must never trap the user on a loading state.
              The origin's toolbar is hidden with it, so the drill brings its
              own fullscreen switch (#344 N109). */}
            <div className="flex min-w-0 items-start justify-between gap-3">
              <NavBreadcrumb
                stack={stack}
                locale={locale}
                rootLabel={originLabel}
                onPop={(to) => setStack((prev) => (to < 0 ? [] : popTo(prev, to)))}
              />
              <DisplayModeToggle />
            </div>
            {!needsEngine || engineId ? (
              <>
                <HostModelContext content={context(drillContext(current, engineId))}>
                  {null}
                </HostModelContext>
                <WidgetRenderer
                  layout={filterLayoutToWidgets(
                    cockpitViews[current.section](buildViewParams(current, engineId ?? "")),
                    drillWidgets,
                  )}
                  keys={{}}
                  errors={[]}
                  widgets={drillWidgets}
                />
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
