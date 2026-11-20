import {
  BadgeLegend,
  InstanceFilterBar,
  InstanceFilters,
  InstanceTable,
  type ScreenSlots,
} from "@miragon/pulse-blocks"
import type { InstanceListFilterData, VariableConditionKindCode } from "@miragon/pulse-screens"
import { Button, Icon, TableEmptyState } from "@miragon/pulse-ui"
import { isSessionEnded, ViewDataState } from "@miragon/pulse-widget-shell/widgets"
import { RefreshCw } from "lucide-react"
import { useT } from "../../messages/index.js"
import { CanvasBadge } from "./canvas-badge.js"
import { isListRefusal, type InstancePages } from "./instance-pages.js"
import { isRefusedCondition } from "./process-feed.js"

export interface InstanceListProps {
  readonly engine: string
  /** The number of the version the list shows, which the legend names. */
  readonly version: number
  readonly filter: InstanceListFilterData
  readonly list: InstancePages
  /** The names the engine knows for the version's variables, once read. */
  readonly names: readonly string[] | undefined
  /** The kinds of condition the engine refuses, once a read named them. */
  readonly refused: readonly VariableConditionKindCode[] | undefined
  /** The condition dialog opens: the screen reads the variable names now. */
  readonly onSuggest: () => void
  readonly elementName: (elementId: string) => string
  /** A filter a pick of a scope, a search, a chip, a condition or the empty state asks for. */
  readonly onFilter: (filter: InstanceListFilterData) => void
  /** The screen reads again: the scopes say so, and Load more waits. */
  readonly busy: boolean
  readonly slots: ScreenSlots
}

/**
 * A version's instance list on the process screen, the blocks the editors' definition view renders
 * (D10, a pair since 2026-11-20): the filter bar (the scopes with their counts, a lower bound where
 * the engine stopped counting, the element's chip, the exact business key, the variable conditions
 * with their dialog, the kinds the engine refuses offered disabled with their reason, the legend of
 * the diagram's badges), the instance table in the one row convention (a row opens its instance),
 * and Load more under the rows while a page follows (the focus on the page's first row once it
 * shows). Its states are its own: a first read's skeleton, a failure in the kit's words with Try
 * again unless no retry changes it, a condition the engine refuses with the way out of it, a further
 * page that failed beside its Load more (its Try again puts the focus back on Load more). A failed
 * read of the first page over the rows on screen the screen's strip under the bar says. It selects
 * nothing: the table's write slot stays empty.
 */
export function InstanceList(props: InstanceListProps) {
  const { engine, version, filter, list, onFilter, busy, slots } = props
  const t = useT()
  const { data, error } = list.first
  const refreshing = busy || list.first.isFetching
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t("screen.process.instances")}
      data-slot="instance-list"
    >
      {data?.counts && (
        <InstanceFilterBar
          filter={filter}
          counts={data.counts}
          busy={refreshing}
          elementName={props.elementName}
          variables={{
            names: props.names,
            refused: props.refused ?? data.refusedVariableConditions,
            onSuggest: props.onSuggest,
          }}
          legend={<BadgeLegend version={version} Badge={CanvasBadge} />}
          onFilter={onFilter}
        />
      )}
      {data === undefined ? (
        <ListState
          error={error}
          filter={filter}
          onFilter={onFilter}
          onRetry={() => void list.first.refetch()}
        />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy={refreshing || undefined}>
          <InstanceTable
            engine={engine}
            rows={list.rows}
            filter={filter}
            onFilter={onFilter}
            more={
              list.hasMore
                ? {
                    busy: refreshing || list.loadingMore,
                    onMore: list.loadMore,
                    beside: (retry) => <MoreFailed error={list.moreError} onRetry={retry} />,
                  }
                : undefined
            }
            slots={slots}
          />
        </div>
      )}
    </section>
  )
}

/**
 * The list before its first page: loading, failed, or a condition the engine refuses, which says
 * so and offers to clear the conditions (the filter bar comes with the first page that answers).
 */
function ListState({
  error,
  filter,
  onFilter,
  onRetry,
}: {
  readonly error: Error | null
  readonly filter: InstanceListFilterData
  readonly onFilter: (filter: InstanceListFilterData) => void
  readonly onRetry: () => void
}) {
  const t = useT()
  if (error !== null && isRefusedCondition(error)) {
    return (
      <TableEmptyState
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onFilter(InstanceFilters.withoutVariables(filter))
            }}
          >
            {t("screen.process.list.clear")}
          </Button>
        }
      >
        {t("screen.process.list.refused")}
      </TableEmptyState>
    )
  }
  return (
    <ViewDataState
      loading={error === null}
      error={error}
      onRetry={onRetry}
      emptyText=""
      loadingText={t("screen.process.list.loading")}
      errorTitle={t("screen.process.list.failed")}
      retryLabel={t("action.tryAgain")}
    />
  )
}

/**
 * A further page that failed: said beside Load more, with Try again unless no retry changes it; a
 * page's ended session the frame's notice says, once, so the rows and Load more stay without it.
 */
function MoreFailed({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const t = useT()
  if (error === null || isSessionEnded(error)) return null
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2" role="alert">
      {t("screen.process.more.failed")}
      {!isListRefusal(error) && (
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          <Icon icon={RefreshCw} />
          {t("action.tryAgain")}
        </Button>
      )}
    </span>
  )
}
