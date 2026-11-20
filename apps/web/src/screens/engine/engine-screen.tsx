import { ListFilterBar, ProcessTable, useProcessList } from "@miragon/pulse-blocks"
import type { ProcessFilterData } from "@miragon/pulse-screens"
import { Button, cn, Icon, StatusStrip, useLocale, WidgetHeader } from "@miragon/pulse-ui"
import {
  describeError,
  FreshnessStamp,
  isPermanentError,
  isSessionEnded,
  OpenInCockpitLink,
  useToolQuery,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw, Server } from "lucide-react"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { READ_AGAIN_AFTER_MS, useReadOnReturn } from "../read-on-return.js"
import { usePageSlots } from "../slots.js"
import { ENGINE_SCREEN_FEED, engineScreenKey, type EngineScreenFeed } from "./engine-feed.js"

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

/**
 * The bar's Refresh: reads the screen again. While it reads it keeps its focus and its place in the
 * tab order (`aria-disabled`), and a second click does nothing.
 */
function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
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
 * The view's bar: the engine's name as the page's heading, its product as the bar's fact, the
 * Refresh and the engine's own web app as the actions (deterministic steps first), when the numbers
 * were read at its end. The page's menu comes first through the frame's `ViewBarSlots`.
 */
function EngineBar({
  engine,
  data,
  refreshing,
  onRefresh,
}: {
  engine: string
  data: EngineScreenFeed | undefined
  refreshing: boolean
  /** Reads the screen again; none before the screen reads. */
  onRefresh: (() => void) | undefined
}) {
  const webApp = data?.webApp
  return (
    <WidgetHeader
      title={engine}
      icon={<Icon icon={Server} />}
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
 * A failed refresh over the numbers on screen: docked under the bar, in the kit's words, Try again
 * unless no retry changes it; a page's ended session the frame's notice says, once.
 */
function RefreshNotice({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
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
        isPermanentError(error)
          ? []
          : [{ label: t("action.tryAgain"), icon: RefreshCw, onClick: onRetry }]
      }
    />
  )
}

/**
 * The web app's engine screen (D10), at the engine's own address: an engine's processes, each with
 * its latest version, its running instances and its instances with incident over every version,
 * from the engine screen's feed, the same numbers the editors' engine tab shows (D2). A row opens
 * its process, a new entry of the page's history (still the cockpit's process view), and copies
 * its BPMN process ID. The scopes and the search derive the rows in the browser and read nothing;
 * the filter is the address's (`filter`, `onFilter`). The bar has the Refresh and when the numbers
 * were read; a read older than 60 s runs again when the reader comes back to the page (its window
 * or its tab, `useReadOnReturn`) or the screen mounts again, and nothing polls. Its states are its
 * own: a first load's skeleton after 400 ms, a failure in the kit's words with Try again unless no
 * retry changes it (a refused profile, an engine whose dialect the server does not read), a failed
 * refresh over the numbers on screen a strip under the bar. It shows no verdict and writes nothing.
 */
export function EngineScreen({
  engine,
  navigate,
  filter,
  onFilter,
  ready = true,
}: {
  engine: string
  navigate: Navigate
  /** The list's scope and search, which the page's address carries. */
  filter: ProcessFilterData
  /** A pick of a scope or a search: the page names its entry anew with it. */
  onFilter: (filter: ProcessFilterData) => void
  /** Whether the screen reads: until then it names the engine in its bar and shows it loading. */
  ready?: boolean
}) {
  const t = useT()
  const query = useToolQuery<EngineScreenFeed>(
    engineScreenKey(engine),
    ENGINE_SCREEN_FEED,
    { engine },
    { staleTime: READ_AGAIN_AFTER_MS, enabled: ready },
  )
  useReadOnReturn(query, ready)
  const { data, error, isFetching } = query
  const refetch = () => void query.refetch()
  // The scopes and the search derive the rows in the browser from the screen loaded: no read.
  const listed = useProcessList(data?.processes ?? NO_PROCESSES, filter)
  const slots = usePageSlots(navigate)
  const refreshing = data !== undefined && isFetching
  const refreshError = data !== undefined ? (error ?? query.failureReason ?? null) : null
  return (
    <main data-slot="engine-screen" className="flex min-w-0 flex-col">
      <WidgetShell
        header={
          <>
            <EngineBar
              engine={engine}
              data={data}
              refreshing={refreshing}
              onRefresh={ready ? refetch : undefined}
            />
            <RefreshNotice error={refreshError} onRetry={refetch} />
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
          <ViewDataState
            loading={error === null}
            error={error}
            onRetry={refetch}
            emptyText=""
            loadingText={t("screen.engine.loading", { engine })}
            errorTitle={t("screen.engine.failed", { engine })}
            retryLabel={t("action.tryAgain")}
          />
        ) : (
          <div className="min-w-0" aria-busy={refreshing || undefined}>
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
