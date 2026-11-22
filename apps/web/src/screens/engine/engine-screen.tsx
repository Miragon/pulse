import {
  EngineVerdictBadge,
  type EngineVerdict,
  ListFilterBar,
  ProcessTable,
  useProcessList,
} from "@miragon/pulse-blocks"
import type { ProcessFilterData } from "@miragon/pulse-screens"
import { Icon, StatusStrip, WidgetHeader } from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  OpenInCockpitLink,
  useToolQuery,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { Server } from "lucide-react"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { ScreenState } from "../cluster-problem.js"
import { READ_AGAIN_AFTER_MS, useReadOnReturn } from "../read-on-return.js"
import { RefreshButton, RefreshNotice } from "../screen-chrome.js"
import { useWide } from "../use-wide.js"
import { usePageSlots } from "../slots.js"
import { ENGINE_SCREEN_FEED, engineScreenKey, type EngineScreenFeed } from "./engine-feed.js"
import {
  ENGINE_VERDICT_FEED,
  engineVerdictKey,
  type EngineVerdictFeed,
  verdictOf,
} from "./verdict-feed.js"

/** No process yet: the list derives nothing before the screen loaded. */
const NO_PROCESSES: EngineScreenFeed["processes"] = []

/** The engine's product and version, or an em dash where it did not say what it is. */
function Product({ info }: { info: EngineScreenFeed["info"] | undefined }) {
  const t = useT()
  if (info === undefined) return null
  if (info === null) {
    return (
      <span title={t("screen.productUnknown")}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t("screen.productUnknown")}</span>
      </span>
    )
  }
  return <span data-slot="engine-product">{`${info.product} ${info.version}`}</span>
}

/** The figures an engine's state reads beside its verdict: an ok engine with nothing deployed. */
function figuresOf(data: EngineScreenFeed | undefined) {
  if (data === undefined) return undefined
  const incidents = data.processes.reduce((sum, process) => sum + process.incidents, 0)
  return { processes: data.totals.processes, incidents }
}

/**
 * The view's bar: the engine's name as the page's heading, its live state as the header's badge
 * (the verdict the server decided for a Camunda 7 engine, a failed read of it, none for a Camunda 8
 * engine), its product as the bar's fact, the Refresh and the engine's own web app as the actions
 * (deterministic steps first), when the numbers were read at its end. The page's menu comes first
 * through the frame's `ViewBarSlots`.
 */
function EngineBar({
  engine,
  data,
  verdict,
  refreshing,
  onRefresh,
}: {
  engine: string
  data: EngineScreenFeed | undefined
  verdict: EngineVerdict
  refreshing: boolean
  /** Reads the screen again; none before the screen reads. */
  onRefresh: (() => void) | undefined
}) {
  const webApp = data?.webApp
  return (
    <WidgetHeader
      title={engine}
      icon={<Icon icon={Server} />}
      badge={<EngineVerdictBadge verdict={verdict} figures={figuresOf(data)} />}
      sub={<Product info={data?.info} />}
      actions={
        onRefresh && (
          <>
            <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
            {webApp && (
              <OpenInCockpitLink url={webApp.url} vendor={webApp.vendor} variant="toolbar" />
            )}
          </>
        )
      }
      freshness={<FreshnessStamp at={data?.asOf} />}
    />
  )
}

/**
 * The engine's live state where the server decides one (`shown`: Camunda 7), read from the verdict
 * feed apart from the screen once the screen reads (`ready`) and shows its figures (`figures`), so
 * the verdict judges the numbers on screen, a first load that fails says so once (the screen's
 * state, never a second failure in the bar) and the server takes the root incidents from the
 * screen's own read; again when the reader comes back after 60 s and with the screen's Refresh
 * (`refetch`); none where the server decides none.
 */
function useVerdict(
  engine: string,
  ready: boolean,
  figures: EngineScreenFeed | undefined,
  shown: boolean,
) {
  const judged = ready && figures !== undefined
  const enabled = judged && shown
  const query = useToolQuery<EngineVerdictFeed>(
    engineVerdictKey(engine),
    ENGINE_VERDICT_FEED,
    { engine },
    { staleTime: READ_AGAIN_AFTER_MS, enabled },
  )
  useReadOnReturn(query, enabled)
  return {
    verdict: verdictOf(judged ? query : undefined, shown),
    refetch: () => {
      if (enabled) void query.refetch()
    },
  }
}

/**
 * Where an engine of a dialect without the page's Incidents and Jobs (Camunda 8) shows its
 * incidents: at their instances, which its processes lead to.
 */
function IncidentsAtInstances() {
  const t = useT()
  return (
    <StatusStrip
      tone="info"
      title={t("screen.engine.atInstances.title")}
      detail={t("screen.engine.atInstances.detail")}
    />
  )
}

/**
 * The web app's engine screen (D10), at the engine's own address: an engine's processes, each with
 * its latest version, its running instances, its instances with incident and its open root
 * incidents over every version, from the engine screen's feed, the same numbers the editors'
 * engine tab shows (D2), the legend of the counts beside the search. A row opens
 * its process, a new entry of the page's history (still the cockpit's process view), and copies
 * its BPMN process ID. The scopes and the search derive the rows in the browser and read nothing;
 * the filter is the address's (`filter`, `onFilter`). The bar has the Refresh and when the numbers
 * were read; a read older than 60 s runs again when the reader comes back to the page (its window
 * or its tab, `useReadOnReturn`) or the screen mounts again, and nothing polls. Its states are its
 * own: a first load's skeleton after 400 ms, a failure in the kit's words with Try again unless no
 * retry changes it (a refused profile, an engine whose dialect the server does not read), a failed
 * refresh over the numbers on screen a strip under the bar. From 64rem on it fills the window's
 * height and its list scrolls in its own region under its sticky head. A Camunda 7 engine's bar
 * shows its live state (`verdict`: the server's verdict over its open root incidents, read from the
 * verdict feed apart once the figures show, so its failure never hides them and a failed first load
 * shows no state, and with the screen's Refresh and on the reader's return); it writes nothing.
 * An engine whose dialect has no Incidents and Jobs on the page (`atInstances`: Camunda 8) says
 * where its incidents show; a Camunda 8 cluster it cannot read as set up (below the
 * version Pulse reads, without secondary storage) says so with the fix (`ScreenState`).
 */
export function EngineScreen({
  engine,
  navigate,
  filter,
  onFilter,
  ready = true,
  atInstances = false,
  verdict = false,
}: {
  engine: string
  navigate: Navigate
  /** The list's scope and search, which the page's address carries. */
  filter: ProcessFilterData
  /** A pick of a scope or a search: the page names its entry anew with it. */
  onFilter: (filter: ProcessFilterData) => void
  /** Whether the screen reads: until then it names the engine in its bar and shows it loading. */
  ready?: boolean
  /** The engine has no Incidents and Jobs on the page: its incidents show at their instances. */
  atInstances?: boolean
  /** The server decides a verdict for the engine (Camunda 7): its bar shows it. */
  verdict?: boolean
}) {
  const t = useT()
  const wide = useWide()
  const query = useToolQuery<EngineScreenFeed>(
    engineScreenKey(engine),
    ENGINE_SCREEN_FEED,
    { engine },
    { staleTime: READ_AGAIN_AFTER_MS, enabled: ready },
  )
  const { data, error, isFetching } = query
  const judged = useVerdict(engine, ready, data, verdict)
  useReadOnReturn(query, ready)
  const refetch = () => {
    void query.refetch()
    judged.refetch()
  }
  // The scopes and the search derive the rows in the browser from the screen loaded: no read.
  const listed = useProcessList(data?.processes ?? NO_PROCESSES, filter)
  const slots = usePageSlots(navigate)
  const refreshing = data !== undefined && isFetching
  const refreshError = data !== undefined ? (error ?? query.failureReason ?? null) : null
  return (
    <main data-slot="engine-screen" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <WidgetShell
        fill={wide}
        header={
          <>
            <EngineBar
              engine={engine}
              data={data}
              verdict={judged.verdict}
              refreshing={refreshing}
              onRefresh={ready ? refetch : undefined}
            />
            <RefreshNotice error={refreshError} onRetry={refetch} engine={engine} />
            {atInstances && <IncidentsAtInstances />}
            {data !== undefined && (
              <ListFilterBar
                filter={filter}
                counts={listed.counts}
                totals={data.totals}
                busy={refreshing}
                onFilter={onFilter}
              />
            )}
          </>
        }
      >
        {data === undefined ? (
          <ScreenState
            engine={engine}
            loading={error === null}
            error={error}
            onRetry={refetch}
            emptyText=""
            loadingText={t("screen.engine.loading", { engine })}
            errorTitle={t("screen.engine.failed", { engine })}
            retryLabel={t("action.tryAgain")}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy={refreshing || undefined}>
            <ProcessTable
              engine={engine}
              listed={listed}
              filter={filter}
              totals={data.totals}
              slots={slots}
            />
          </div>
        )}
      </WidgetShell>
    </main>
  )
}
