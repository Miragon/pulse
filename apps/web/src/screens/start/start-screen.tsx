import { useEffect } from "react"
import { EngineTable, ProcessesByEngine, type ScreenSlots } from "@miragon/pulse-blocks"
import type { FleetSumsData } from "@miragon/pulse-screens"
import { formatCount, Icon, SectionHeading, WidgetHeader } from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  isPermanentError,
  QueryFallback,
  TableSkeleton,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { Layers } from "lucide-react"
import type { ListedEngines } from "../../engine-list.js"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { urlOf } from "../../router/routes.js"
import { EngineFailure } from "../engine-failure.js"
import { useReadOnReturn } from "../read-on-return.js"
import { RefreshButton } from "../screen-chrome.js"
import { PagePlainTable, usePageSlots } from "../slots.js"
import { StartBoards } from "./start-boards.js"
import { useStartReads, type EngineRead } from "./start-reads.js"

/**
 * Whether an engine's first read still runs without a failure so far: one that failed and is
 * retried quietly counts as read for what the page shows (its row says it, its strip why).
 */
const waiting = ({ pending, error }: EngineRead): boolean => pending && error === null

/** The oldest time an engine's screen was read at: when the numbers on screen were read. */
function oldestAsOf(reads: readonly EngineRead[]): string | undefined {
  return reads.flatMap(({ screen }) => (screen === undefined ? [] : [screen.asOf])).sort()[0]
}

/** The bar's facts: how many engines the server configures, and how many of them it refused. */
function Facts({ list }: { list: ListedEngines }) {
  const t = useT()
  const refused = list.refused?.length ?? 0
  const engines = (list.engines?.length ?? 0) + refused
  const facts = [t("screen.start.engines", { count: formatCount(engines) })]
  if (refused > 0) facts.push(t("screen.start.refused", { count: formatCount(refused) }))
  return <span data-slot="start-facts">{facts.join(" · ")}</span>
}

/**
 * What runs where, once every engine settled: each process on the engines read, its running
 * instances per engine and its instances with incident over all of them, the engines not read named
 * under it; while an engine is read its loading state (the skeleton after 400 ms, the words for a
 * screen reader at once), nothing where no engine could be read.
 */
function RunsWhere({
  reads,
  sums,
  Id,
  onRetry,
}: {
  reads: readonly EngineRead[]
  sums: FleetSumsData
  Id: ScreenSlots["Id"]
  /** Reads every engine again (the fallback's, which shows no failure here: the strips say it). */
  onRetry: () => void
}) {
  const t = useT()
  const pending = reads.some(waiting)
  if (!pending && sums.engines.length === 0) return null
  const engines = sums.engines.map(({ engine }) => engine)
  const unread = reads.map(({ engine }) => engine).filter((engine) => !engines.includes(engine))
  return (
    <section data-part="runs-where">
      <SectionHeading
        as="h2"
        title={t("screen.start.runsWhere")}
        hint={t("screen.start.runsWhereHint")}
      />
      <QueryFallback
        isError={false}
        onRetry={onRetry}
        isLoading={pending}
        skeleton={<TableSkeleton />}
        loadingText={t("screen.start.runsWhereLoading")}
      >
        <ProcessesByEngine
          processes={sums.processes}
          engines={engines}
          unread={unread}
          slots={{ PlainTable: PagePlainTable, Id }}
        />
      </QueryFallback>
    </section>
  )
}

/**
 * The web app's start page (D10, plan 2.4), at `/app`: every engine of the server side by side, a
 * row each with its live state (the verdict the server decides for a Camunda 7 engine, read apart
 * and worded as its engine screen's bar words it; none for a Camunda 8 cluster) and the figures its
 * engine screen shows (its product, processes, running instances, instances with incident and open
 * root incidents: one read per engine of its engine screen's feed, all at once, summed in the
 * browser with `FleetSums`, counts only, never a rate), Camunda 8's clusters among them; what runs where on the engines read; the server's boards. Its bar names it
 * (its h1), how many engines the server configures and refused, the Refresh (every engine again)
 * and when the numbers were read (the oldest answer). An engine whose read failed keeps its row,
 * and a strip under the bar says why in the kit's words; a refused profile is read nothing of, the
 * server's refusal in its words. A row opens its engine's screen, a board its page, by the one row
 * convention. A server of one engine and no board shows that engine in its place (`replace`), as
 * the cockpit's landing did. A read older than 60 s runs again when the reader comes back, and
 * nothing polls. It writes nothing and hands nothing to a chat.
 */
export function StartScreen({ navigate, replace }: { navigate: Navigate; replace: Navigate }) {
  const t = useT()
  const slots = usePageSlots(navigate)
  const { list, only, reads, sums, rows } = useStartReads()
  useEffect(() => {
    if (only !== undefined) replace(urlOf({ view: "overview", engine: only }))
  }, [only, replace])
  const settled = !reads.some(waiting)
  const refreshing = settled && reads.some(({ fetching }) => fetching)
  // The engine list as the page shows it: none before it answered, nor where one engine shows.
  const listed = only === undefined ? list.data : undefined
  const ready = listed !== undefined
  const refetchAll = () => {
    void list.refetch()
    for (const read of reads) void read.refetch()
  }
  useReadOnReturn(
    {
      dataUpdatedAt: Math.min(...reads.map(({ readAt }) => readAt).filter((at) => at > 0)),
      errorUpdatedAt: 0,
      error: null,
      // The return's options reach each read, so its two events join one read per engine.
      refetch: (options) =>
        Promise.all(
          reads
            .filter(({ error }) => error === null || !isPermanentError(error))
            .map(({ refetch }) => refetch(options)),
        ),
    },
    ready,
  )
  const boards = listed?.boards ?? []
  const refusedBoards = listed?.refusedBoards ?? []
  return (
    <main data-slot="start-screen" className="flex min-w-0 flex-col">
      <WidgetShell
        header={
          <>
            <WidgetHeader
              title={t("screen.start.title")}
              icon={<Icon icon={Layers} />}
              sub={listed && <Facts list={listed} />}
              actions={ready && <RefreshButton refreshing={refreshing} onRefresh={refetchAll} />}
              freshness={<FreshnessStamp at={oldestAsOf(reads)} />}
            />
            {reads.map(({ engine, error, screen }) =>
              error === null ? null : (
                <EngineFailure
                  key={engine}
                  engine={engine}
                  error={error}
                  title={t("screen.start.failed", { engine })}
                  stale={screen !== undefined}
                />
              ),
            )}
          </>
        }
      >
        {ready ? (
          <div
            className="gap-section flex flex-col"
            aria-busy={refreshing || !settled || undefined}
          >
            <section data-part="start-engines">
              <SectionHeading as="h2" title={t("screen.start.engines.title")} />
              <EngineTable engines={rows} slots={slots} withVerdict />
            </section>
            {rows.length > 1 && (
              <RunsWhere reads={reads} sums={sums} Id={slots.Id} onRetry={refetchAll} />
            )}
            {boards.length + refusedBoards.length > 0 && (
              <StartBoards
                boards={boards}
                refused={refusedBoards}
                slots={slots}
                navigate={navigate}
              />
            )}
          </div>
        ) : (
          <ViewDataState
            loading={list.error === null}
            error={list.error}
            onRetry={() => void list.refetch()}
            emptyText=""
            loadingText={t("screen.start.loading")}
            errorTitle={t("screen.start.listFailed")}
            retryLabel={t("action.tryAgain")}
          />
        )}
      </WidgetShell>
    </main>
  )
}
