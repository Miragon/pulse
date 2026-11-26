import { EmptyState, NavigationFocus, useLocale, ViewBarSlots } from "@miragon/pulse-ui"
import { useHostChrome, ViewDataState, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import { translator } from "../../messages/use-t.js"
import { navigationKeyOf } from "./breadcrumb.js"
import { LandingBar, LandingHeader } from "./landing.js"
import { BoardScope, FleetScope, LandingScope } from "./app-scopes.js"
import { EngineScope } from "./engine-scope.js"
import { type Cockpit, useCockpit } from "./use-cockpit.js"

export type { CockpitAppData }

/**
 * #322 U15: an empty engine list is the app-level "no engines" surface. On a page with chrome of
 * its own its title is the view bar's (`LandingBar`).
 */
function EnginesEmptyState({
  enginesQuery,
  chrome,
}: {
  enginesQuery: { isError: boolean; error: Error | null; data: unknown; refetch: () => unknown }
  chrome: boolean
}) {
  const locale = useLocale()
  const loading = !enginesQuery.isError && enginesQuery.data === undefined
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
    <WidgetShell header={chrome && <LandingBar />}>
      <div className="gap-section flex flex-col">
        {!chrome && <LandingHeader />}
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

/**
 * The cockpit. On a page with chrome of its own (`useHostChrome`: the page's navigation holds the
 * sections, the engine switch and the view across engines) it leaves its head to the page: every
 * view bar shows the page's menu first, an engine's bar the cockpit's Refresh first among its
 * actions, an engine without sections a bar of its own (its name, the Refresh) over its one state,
 * and an app-level title is the bar's title. In a chat it keeps its head.
 */
export function CockpitApp({ data }: { data: CockpitAppData | null }) {
  const chrome = useHostChrome()
  const app = <CockpitScopes data={data} chrome={chrome !== undefined} />
  return chrome ? <ViewBarSlots lead={chrome.menu}>{app}</ViewBarSlots> : app
}

/** The scope the cockpit is at: the chooser, the view across engines, a board or an engine. */
function ScopeView({
  cockpit,
  data,
  chrome,
}: {
  cockpit: Cockpit
  data: CockpitAppData | null
  chrome: boolean
}) {
  const { scope } = cockpit.state
  switch (scope.kind) {
    case "landing":
      return <LandingScope cockpit={cockpit} />
    case "fleet":
      return <FleetScope cockpit={cockpit} chrome={chrome} />
    case "board":
      return <BoardScope cockpit={cockpit} view={scope.view} data={data} />
    case "engine":
      return <EngineScope cockpit={cockpit} engineId={scope.engineId} data={data} chrome={chrome} />
  }
}

function CockpitScopes({ data, chrome }: { data: CockpitAppData | null; chrome: boolean }) {
  const cockpit = useCockpit(data)
  const { scope, stack } = cockpit.state

  // A place the page shows itself (its engine screen): the page takes over as it reads the report.
  if (cockpit.claimed) return null

  // Bootstrap engines let us proceed when the engines query failed.
  if (cockpit.engines.length === 0) {
    return <EnginesEmptyState enginesQuery={cockpit.enginesQuery} chrome={chrome} />
  }

  // #344 N107: one frame for every scope, so navigation moves focus to the new view's heading.
  return (
    <NavigationFocus viewKey={navigationKeyOf(scope, stack)}>
      <ScopeView cockpit={cockpit} data={data} chrome={chrome} />
    </NavigationFocus>
  )
}
