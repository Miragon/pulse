import { useEffect, useRef } from "react"
import { FindHistoryNotice, FindResults } from "@miragon/pulse-blocks"
import type { FindScreenData } from "@miragon/pulse-screens"
import { EmptyState, formatCount, Icon, TableEmptyState, WidgetHeader } from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  isPermanentError,
  isSessionEnded,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { Search } from "lucide-react"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { SEARCH_TEXT_MOST } from "../../router/search-address.js"
import { EngineFailure } from "../engine-failure.js"
import { RefreshButton } from "../screen-chrome.js"
import { targetUrl, usePageSlots } from "../slots.js"
import { useWide } from "../use-wide.js"
import { MOST_BY_BUSINESS_KEY, type EngineSearch, useSearchReads } from "./search-reads.js"

/**
 * The search's entry of the page's history (the router's): whether the search decided there before
 * whether to leave it for its one hit, and the mark that it did, so a return to the entry (Back,
 * Forward, a reload) never leaves it.
 */
interface SearchEntry {
  readonly seen: () => boolean
  readonly markSeen: () => void
}

/** The oldest time an engine's answer was read at: when the hits on screen were read. */
function oldestAsOf(found: readonly FindScreenData[]): string | undefined {
  return found.map(({ asOf }) => asOf).sort()[0]
}

/** How many instances the engines that answered found. */
function hitsOf(found: readonly FindScreenData[]): number {
  return found.reduce((total, screen) => total + screen.hits.length, 0)
}

/**
 * The bar's facts once every engine settled: how many instances were found, on how many engines
 * the search ran, and that it is exact.
 */
function Facts({ found }: { found: readonly FindScreenData[] }) {
  const t = useT()
  return (
    <span data-slot="search-facts">
      {[
        t("screen.search.found", { count: formatCount(hitsOf(found)) }),
        t("screen.search.searched", { count: formatCount(found.length) }),
        t("screen.search.exact"),
      ].join(" · ")}
    </span>
  )
}

/**
 * Where exactly one instance was found on every engine that could be searched, its address: the
 * page goes there in the search's place, so Back leads to where the search started. An engine that
 * failed for a reason a retry may change (one that did not answer) keeps the search, since it may
 * hold more, and so does one whose history misses running instances, which the search cannot find
 * and whose notice the search shows; a refusal no retry changes (a refused profile) never does.
 */
function onlyHitOf(searches: readonly EngineSearch[]): string | undefined {
  if (searches.some(({ pending }) => pending)) return undefined
  if (searches.some(({ error }) => error !== null && !isPermanentError(error))) return undefined
  if (searches.some(({ found }) => found !== undefined && found.historyGap !== null)) {
    return undefined
  }
  const hits = searches.flatMap(({ engine, found }) =>
    (found?.hits ?? []).map((hit) => ({ engine, hit })),
  )
  const [only] = hits
  return hits.length === 1 && only !== undefined
    ? targetUrl({ kind: "instance", engine: only.engine, instanceId: only.hit.id })
    : undefined
}

/**
 * The state of a search no engine answered: where a call met the page's ended session, which every
 * other call meets too, the quiet line of a view whose content is missing (the frame's notice says
 * why, once); else that no engine could be searched, each engine's strip above saying why. Never
 * that no instance exists.
 */
function Unsearched({
  searches,
  onRetry,
}: {
  searches: readonly EngineSearch[]
  onRetry: () => void
}) {
  const t = useT()
  const [ended] = searches.flatMap(({ error }) =>
    error !== null && isSessionEnded(error) ? [error] : [],
  )
  if (ended !== undefined) {
    return (
      <ViewDataState
        loading={false}
        error={ended}
        onRetry={onRetry}
        emptyText=""
        errorTitle={t("screen.search.unsearched")}
      />
    )
  }
  return (
    <EmptyState
      titleAs="h2"
      title={t("screen.search.unsearched")}
      description={t("screen.search.unsearchedHint")}
    />
  )
}

/**
 * The web app's search across engines (D10, plan 2.4), at `/app/search?q=…`: the instance with the
 * text as its id and those with it as their exact business key, running and ended, up to 20 per
 * engine, on every engine of the server, each asked apart and at once. Its bar names what was
 * searched (its h1), how many instances were found on how many engines, that the search is exact,
 * the Refresh and when the hits were read. Under it a strip per engine that could not be searched
 * (refused, unreachable), beside the hits of the others, and the notice of an engine whose history
 * misses running instances, which the search cannot find. The hits are the blocks' `FindResults`,
 * a row opening its instance screen by the one row convention, shown as they arrive; while no hit
 * is on screen the search says it searches until every engine settled, so it never says an instance
 * is missing that a slower engine may hold. Exactly one hit replaces the address by its instance's
 * (`replace`), decided once for the entry (`entry`), so Back leads to where the search started and a
 * Refresh or a return never leaves it; none says what was searched and that the search is exact,
 * of the engines that could be searched alone where some could not, and a search no engine answered
 * says so. A text longer than an id or a business key can be reads nothing and says so. It writes
 * nothing and hands nothing to a chat.
 */
export function SearchScreen({
  text,
  navigate,
  replace,
  entry,
}: {
  /** What the search searches, trimmed; none shows how to search. */
  text: string
  navigate: Navigate
  /** Goes to an address in the search's place: exactly one hit's instance. */
  replace: Navigate
  entry: SearchEntry
}) {
  const t = useT()
  const wide = useWide()
  const slots = usePageSlots(navigate)
  const tooLong = text.length > SEARCH_TEXT_MOST
  const searched = tooLong ? "" : text
  const { list, searches, refetch } = useSearchReads(searched)
  const found = searches.flatMap(({ found: screen }) => (screen === undefined ? [] : [screen]))
  const settled = searches.every(({ pending }) => !pending)
  const complete = searched !== "" && list.data !== undefined && settled
  const refreshing = searches.some(({ fetching }) => fetching)
  const only = onlyHitOf(searches)
  const decided = useRef(false)
  useEffect(() => {
    if (!complete || decided.current) return
    decided.current = true
    if (entry.seen()) return
    entry.markSeen()
    if (only !== undefined) replace(only)
  }, [complete, only, entry, replace])
  const body = (() => {
    if (tooLong) {
      return (
        <TableEmptyState>
          {t("screen.search.tooLong", { most: formatCount(SEARCH_TEXT_MOST) })}
        </TableEmptyState>
      )
    }
    if (text === "") return <TableEmptyState>{t("screen.search.empty")}</TableEmptyState>
    if (list.data === undefined || (hitsOf(found) === 0 && !settled)) {
      return (
        <ViewDataState
          loading={list.error === null}
          error={list.error}
          onRetry={() => void list.refetch()}
          emptyText=""
          loadingText={t("screen.search.loading", { text })}
          errorTitle={t("screen.search.listFailed")}
          retryLabel={t("action.tryAgain")}
        />
      )
    }
    if (found.length === 0) return <Unsearched searches={searches} onRetry={refetch} />
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-busy={refreshing || !settled || undefined}
      >
        <FindResults
          found={found}
          text={text}
          most={MOST_BY_BUSINESS_KEY}
          partial={searches.some(({ error }) => error !== null)}
          slots={slots}
        />
      </div>
    )
  })()
  return (
    <main data-slot="search-screen" className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <WidgetShell
        fill={wide}
        header={
          <>
            <WidgetHeader
              title={searched === "" ? t("screen.search.title") : text}
              icon={<Icon icon={Search} />}
              sub={settled && found.length > 0 ? <Facts found={found} /> : undefined}
              actions={
                searched !== "" && (
                  <RefreshButton refreshing={refreshing && settled} onRefresh={refetch} />
                )
              }
              freshness={<FreshnessStamp at={oldestAsOf(found)} />}
            />
            {searches.map(({ engine, error }) =>
              error === null ? null : (
                <EngineFailure
                  key={engine}
                  engine={engine}
                  error={error}
                  title={t("screen.search.failed", { engine })}
                />
              ),
            )}
            {found.map((screen) => (
              <FindHistoryNotice key={screen.engine} found={screen} />
            ))}
          </>
        }
      >
        {body}
      </WidgetShell>
    </main>
  )
}
