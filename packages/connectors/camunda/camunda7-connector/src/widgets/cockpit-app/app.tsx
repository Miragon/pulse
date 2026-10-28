import { useReducer, type ReactNode } from "react"
import {
  Button,
  cn,
  EmptyState,
  FOCUS_RING,
  useCallTool,
  useLocale,
  useToolQuery,
} from "@miragon/mcp-toolkit-ui"
import { HostModelContext, WidgetRenderer } from "@miragon/mcp-toolkit-ui/app"
import {
  filterLayoutToWidgets,
  Icon,
  type LucideIcon,
  NativeSelect,
  NavigationFocus,
  useHostWidgets,
  useResetOnChange,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { Layers, LayoutDashboard, Settings, TriangleAlert } from "lucide-react"
import type { CockpitAppData } from "../../view-models.js"
import { groupEnginesByEnvironment } from "../../lib/environments.js"
import { EngineChromeProvider, EnvironmentChip, environmentIn } from "../lib/engine-context.js"
import { NavProvider, type NavIntent, type OnNavigate } from "../navigation.js"
import {
  buildViewParams,
  type CockpitScope,
  type CockpitView,
  intentToView,
  popTo,
  pushView,
} from "../nav-core.js"
import { camunda7BaseWidgets } from "../registry.js"
import { useHandOff } from "../lib/hand-off.js"
import { cockpitContext, fleetContext, landingContext } from "./model-context.js"
import { translator } from "../../messages/index.js"
import { CAMUNDA7_LIST_ENGINES } from "../../tool-names.js"
import { FleetCrumbs, NavBreadcrumb, navigationOf } from "./breadcrumb.js"
import { cockpitViews } from "./views.js"
import { useAnalyticsActive } from "./analytics-probe.js"
import { FleetView } from "./fleet-view.js"
import { LandingChooser, LandingHeader } from "./landing.js"
import { CockpitRefreshButton } from "./refresh-button.js"

export type { CockpitAppData }

interface EnginesResult {
  engines: Array<{ id: string; environment?: string }>
  defaultEngineId: string | null
}

type TopSection = "overview" | "incidents" | "settings"

const SECTIONS: Array<{ id: TopSection; intent: NavIntent; icon: LucideIcon }> = [
  { id: "overview", intent: { type: "overview" }, icon: LayoutDashboard },
  { id: "incidents", intent: { type: "incidents" }, icon: TriangleAlert },
  { id: "settings", intent: { type: "settings" }, icon: Settings },
]

function isTopSection(section: CockpitView["section"]): section is TopSection {
  return section === "overview" || section === "incidents" || section === "settings"
}

/** `scope` alone decides which cockpit shows; `stack` is the real history, so "back" returns where the user came from. */
interface CockpitState {
  scope: CockpitScope
  stack: CockpitView[]
  /** Said on screen until the next scope change. */
  goneEngineId: string | null
}

type CockpitAction =
  | NavIntent
  | { type: "enter-engine"; id: string }
  | { type: "switch-engine"; id: string }
  | { type: "to-fleet" }
  | { type: "to-landing" }
  | { type: "pop"; to?: number }
  | ({ type: "reconcile" } & ScopeFix)

const ROOT_STACK: CockpitView[] = [{ section: "overview" }]

/** Opens on the bootstrap's resolved engine (`camunda7_open_cockpit`), else the chooser. */
function initialState(bootEngineId: string | null): CockpitState {
  return {
    scope: bootEngineId ? { kind: "engine", engineId: bootEngineId } : { kind: "landing" },
    stack: ROOT_STACK,
    goneEngineId: null,
  }
}

interface ScopeFix {
  scope: CockpitScope
  gone: string | null
}

/**
 * The engine list reloads (curated away in Settings, a racing bootstrap): a gone engine
 * falls back explicitly instead of querying a stale id. Chooser and fleet need two engines.
 */
function reconcileScope(scope: CockpitScope, engineIds: readonly string[]): ScopeFix | null {
  if (engineIds.length === 0) return null
  const sole = engineIds.length === 1 ? engineIds[0] : null
  const fallback: CockpitScope = sole ? { kind: "engine", engineId: sole } : { kind: "landing" }
  if (scope.kind === "engine") {
    return engineIds.includes(scope.engineId) ? null : { scope: fallback, gone: scope.engineId }
  }
  return sole ? { scope: fallback, gone: null } : null
}

function cockpitReducer(state: CockpitState, action: CockpitAction): CockpitState {
  switch (action.type) {
    case "enter-engine":
    case "switch-engine":
      // Drill state carried over would resolve ids of another engine.
      return initialState(action.id)
    case "to-fleet":
      return { scope: { kind: "fleet" }, stack: ROOT_STACK, goneEngineId: null }
    case "to-landing":
      return initialState(null)
    case "reconcile":
      return { scope: action.scope, stack: ROOT_STACK, goneEngineId: action.gone }
    case "pop":
      return { ...state, stack: popTo(state.stack, action.to) }
    default: {
      const view = intentToView(action)
      // Cockpit-only policy; the shared pushView never resets.
      if (isTopSection(view.section)) return { ...state, stack: [view] }
      return { ...state, stack: pushView(state.stack, view) }
    }
  }
}

/** #322 U4: environment chip plus engine select, optgroups by environment. */
function EngineSwitch({
  engineId,
  environment,
  engineGroups,
  onSwitch,
}: {
  engineId: string
  environment: string | null
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>
  onSwitch: (id: string) => void
}) {
  const locale = useLocale()
  const engines = engineGroups.flatMap((g) => g.engines)
  return (
    <div data-slot="engine-context" className="flex min-w-0 items-center gap-2">
      {environment && <EnvironmentChip environment={environment} />}
      {engines.length > 1 ? (
        <NativeSelect
          aria-label={translator(locale, "cockpit.aria.activeEngine")}
          value={engineId}
          onChange={(e) => onSwitch(e.target.value)}
          className="h-8 max-w-56 font-semibold"
        >
          {engineGroups.length > 1
            ? engineGroups.map((g) => (
                <optgroup key={g.id} label={g.id.toUpperCase()}>
                  {g.engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id}
                    </option>
                  ))}
                </optgroup>
              ))
            : engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))}
        </NativeSelect>
      ) : (
        <span className="text-dense text-foreground truncate font-semibold">{engineId}</span>
      )}
    </div>
  )
}

/** #322 U20: one compact head row instead of a sidebar that cost ~200 px inline. */
function CockpitHead({
  activeSection,
  onSection,
  engineSwitch,
  onOpenFleet,
}: {
  activeSection: TopSection
  onSection: (intent: NavIntent) => void
  engineSwitch: ReactNode
  onOpenFleet?: () => void
}) {
  const locale = useLocale()
  const crossEngine = translator(locale, "cockpit.nav.crossEngine")
  return (
    <div className="border-border @container mb-4 border-b pb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav
          aria-label={translator(locale, "cockpit.aria.sections")}
          className="flex flex-wrap items-center gap-1"
        >
          {SECTIONS.map((s) => {
            const isActive = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSection(s.intent)}
                className={cn(
                  "text-dense inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors",
                  FOCUS_RING,
                  isActive
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon icon={s.icon} />
                {translator(locale, `cockpit.section.${s.id}`)}
              </button>
            )
          })}
        </nav>
        <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">
          {onOpenFleet && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenFleet}
              aria-label={crossEngine}
              title={crossEngine}
            >
              <Icon icon={Layers} />
              <span className="hidden @4xl:inline">{crossEngine}</span>
            </Button>
          )}
          {engineSwitch}
          <CockpitRefreshButton />
        </div>
      </div>
    </div>
  )
}

function activeSectionOf(stack: CockpitView[]): TopSection {
  const root = stack[0].section
  return root === "incidents" || root === "settings" ? root : "overview"
}

function EngineGoneNotice({ engineId }: { engineId: string | null }) {
  const locale = useLocale()
  if (!engineId) return null
  return (
    <p role="status" className="text-muted-foreground text-dense mb-3">
      {translator(locale, "cockpit.engineGone", { engineId })}
    </p>
  )
}

/** #322 U15: an empty engine list is the app-level "no engines" surface. */
function EnginesEmptyState({
  hasTransport,
  enginesQuery,
}: {
  hasTransport: boolean
  enginesQuery: { isError: boolean; error: Error | null; data: unknown; refetch: () => unknown }
}) {
  const locale = useLocale()
  const loading = hasTransport && !enginesQuery.isError && enginesQuery.data === undefined
  if (loading || enginesQuery.error) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={enginesQuery.error}
          loadingText={translator(locale, "cockpit.loading.engines")}
          emptyText={translator(locale, "cockpit.empty.engines")}
          onRetry={() => void enginesQuery.refetch()}
          retryLabel={translator(locale, "viewState.retry")}
        />
      </WidgetShell>
    )
  }
  return (
    <WidgetShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <LandingHeader />
        <EmptyState
          titleAs="h2"
          title={translator(locale, "cockpit.empty.enginesTitle")}
          description={translator(locale, "cockpit.empty.engines")}
          className="border-border bg-card rounded-md border"
        />
      </div>
    </WidgetShell>
  )
}

/** Both in the render phase, so the chooser never flashes and a stale engine id never reaches a query. */
function useCockpitState(data: CockpitAppData | null, engines: ReadonlyArray<{ id: string }>) {
  const bootEngineId = data?.engineId ?? null
  const [state, dispatch] = useReducer(cockpitReducer, bootEngineId, initialState)
  useResetOnChange(bootEngineId, () => {
    if (bootEngineId) dispatch({ type: "enter-engine", id: bootEngineId })
  })
  const scopeFix = reconcileScope(
    state.scope,
    engines.map((e) => e.id),
  )
  if (scopeFix) dispatch({ type: "reconcile", ...scopeFix })
  return [state, dispatch] as const
}

export function CockpitApp({ data }: { data: CockpitAppData | null }) {
  // Without a host callTool every useToolQuery stays pending, so loading must not wait on it.
  const queryCallTool = useCallTool()

  // Decoupled from the open_cockpit bootstrap so picker and switcher work however the app launched.
  const enginesQuery = useToolQuery<EnginesResult>(["camunda7:engines"], CAMUNDA7_LIST_ENGINES, {})
  const engines = enginesQuery.data?.engines ?? data?.engines ?? []
  const engineGroups = groupEnginesByEnvironment(engines)

  const locale = useLocale()
  const { context } = useHandOff()

  // Composed views reference other modules' widgets by raw id (tier-2); own ids win.
  const hostWidgets = useHostWidgets()
  const cockpitWidgets = { ...hostWidgets, ...camunda7BaseWidgets }

  const [{ scope, stack, goneEngineId }, dispatch] = useCockpitState(data, engines)

  // Fleet analyses need Prometheus, so the cross-engine view waits for analytics.
  const offerFleet = useAnalyticsActive() && engines.length > 1
  const openFleet = offerFleet ? () => dispatch({ type: "to-fleet" }) : undefined

  // Navigation only: the saved default engine changes only via settings or `camunda7_select_engine`.
  const enterEngine = (id: string) => dispatch({ type: "enter-engine", id })
  const switchEngine = (id: string) => dispatch({ type: "switch-engine", id })

  const navigate: OnNavigate = dispatch

  // Bootstrap engines let us proceed when the engines query failed.
  if (engines.length === 0) {
    return <EnginesEmptyState hasTransport={!!queryCallTool} enginesQuery={enginesQuery} />
  }

  // #344 N107: one frame, so navigation moves focus to the new view.
  const nav = navigationOf(scope, stack, locale)

  if (scope.kind === "landing") {
    return (
      <NavigationFocus viewKey={nav.key} label={nav.label}>
        {/* The model hears the picker as the picker — no engine is in scope. */}
        <HostModelContext content={context(landingContext(engineGroups))}>{null}</HostModelContext>
        <LandingChooser
          engines={engines}
          defaultEngineId={enginesQuery.data?.defaultEngineId ?? null}
          onEnterEngine={enterEngine}
          onOpenFleet={openFleet}
          notice={<EngineGoneNotice engineId={goneEngineId} />}
        />
      </NavigationFocus>
    )
  }

  if (scope.kind === "fleet") {
    return (
      <NavigationFocus viewKey={nav.key} label={nav.label}>
        <WidgetShell>
          <HostModelContext content={context(fleetContext(engineGroups))}>{null}</HostModelContext>
          <FleetCrumbs locale={locale} onLanding={() => dispatch({ type: "to-landing" })} />
          <FleetView engines={engines} onEnterEngine={enterEngine} widgets={cockpitWidgets} />
        </WidgetShell>
      </NavigationFocus>
    )
  }

  const engineId = scope.engineId
  const current = stack[stack.length - 1]
  const activeSection = activeSectionOf(stack)

  const environment = environmentIn(engines, engineId)

  return (
    <NavigationFocus viewKey={nav.key} label={nav.label}>
      <WidgetShell>
        <HostModelContext content={context(cockpitContext(engineId, current))}>
          {null}
        </HostModelContext>
        <CockpitHead
          activeSection={activeSection}
          onSection={(intent) => dispatch(intent)}
          onOpenFleet={openFleet}
          engineSwitch={
            <EngineSwitch
              engineId={engineId}
              environment={environment}
              engineGroups={engineGroups}
              onSwitch={switchEngine}
            />
          }
        />

        <main className="min-w-0">
          <EngineGoneNotice engineId={goneEngineId} />
          {/* "Alle Engines" leads back to the chooser (#322 U15) whenever there
            is more than one engine to choose from; a root view with a single
            engine renders no trail (NavBreadcrumb handles that). */}
          <NavBreadcrumb
            stack={stack}
            locale={locale}
            rootLabel={
              engines.length > 1 ? translator(locale, "cockpit.crumb.allEngines") : undefined
            }
            onPop={(to) => dispatch(to < 0 ? { type: "to-landing" } : { type: "pop", to })}
          />

          {/* Every view is a layout of self-fetching widgets rendered through the
            toolkit renderer. The NavProvider is the client-side navigation
            seam: widgets call `useNav()`, which resolves to this in-app router
            instead of a chat follow-up. The head names the engine, so the
            views leave it out of their own meta line (EngineChromeProvider). */}
          <NavProvider value={navigate}>
            <EngineChromeProvider>
              <WidgetRenderer
                layout={filterLayoutToWidgets(
                  cockpitViews[current.section](buildViewParams(current, engineId)),
                  cockpitWidgets,
                )}
                keys={{}}
                errors={[]}
                widgets={cockpitWidgets}
              />
            </EngineChromeProvider>
          </NavProvider>
        </main>
      </WidgetShell>
    </NavigationFocus>
  )
}
