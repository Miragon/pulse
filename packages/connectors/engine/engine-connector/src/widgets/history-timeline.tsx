import { useMemo, type ReactNode } from "react"
import {
  StatusBadge,
  PagedListFooter,
  WidgetHeader,
  TableEmptyState,
  formatClock,
  formatDuration,
  formatInstant,
} from "@miragon/pulse-ui"
import {
  FreshnessStamp,
  HandOffButton,
  WidgetShell,
  PagedRows,
  usePagedViewData,
  useViewData,
  HostModelContext,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"
import { HISTORY_PAGE_SIZE, type HistoryTimelineData } from "../view-models.js"
import { ENGINE_HISTORY_TIMELINE_DATA } from "../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { durationOutliers } from "./lib/duration-outliers.js"
import { instanceName } from "./lib/write-feedback.js"
import { useT } from "../messages/use-t.js"
import { HistoryTable, instanceStateLabel, type HistoryEntry } from "./history-steps.js"

export type { HistoryTimelineData }

type TimelineInstance = NonNullable<HistoryTimelineData["processInstance"]>

export function explainInstanceHandOff(
  instance: TimelineInstance,
  engineId: string | undefined,
  activityCount: number,
): HandOff {
  return {
    intent: "askAi.history.explainInstance",
    ids: {
      engine: engineId,
      processInstanceId: instance.id,
      processDefinitionKey: instance.processDefinitionKey,
    },
    facts: { durationMs: instance.durationInMillis, state: instance.state, activityCount },
    untrusted: [{ label: "processName", text: instance.processDefinitionName }],
  }
}

export interface TimelineInstanceRef {
  id?: string
  processDefinitionKey?: string | null
}

export function explainActivityHandOff(
  activity: HistoryEntry,
  instance: TimelineInstanceRef | null | undefined,
  engineId: string | undefined,
): HandOff {
  return {
    intent: "askAi.history.explainActivity",
    ids: {
      engine: engineId,
      processInstanceId: instance?.id,
      processDefinitionKey: instance?.processDefinitionKey ?? undefined,
      activityId: activity.activityId,
    },
    facts: { durationMs: activity.durationInMillis, activityType: activity.activityType },
    untrusted: [{ label: "activityName", text: activity.activityName }],
  }
}

/**
 * Shell-less activity history: the one steps table (`HistoryTable`), its "explain duration"
 * hand-off at the end of the slowest steps' rows only, so the table is not cluttered
 * (`durationOutliers`), and only where the host shows hand-offs.
 */
function HistorySteps({
  activities,
  instanceRef,
  engineId,
  incidentActivityIds,
}: {
  activities: HistoryEntry[]
  /** The instance the rows belong to, for their hand-offs. */
  instanceRef?: TimelineInstanceRef
  engineId: string
  /** Activities with an open incident on this instance: their running step is marked. */
  incidentActivityIds?: readonly string[] | null
}) {
  const t = useT()
  const { ask } = useHandOff()
  const handOffs = useHandOffsShown()
  if (activities.length === 0) {
    return <TableEmptyState>{t("historyTimeline.empty")}</TableEmptyState>
  }
  const isOutlier = durationOutliers(activities.map((a) => a.durationInMillis))
  const explains = handOffs && activities.some((a) => isOutlier(a.durationInMillis))
  return (
    <HistoryTable
      entries={activities}
      incidentIds={new Set(incidentActivityIds ?? [])}
      renderActions={
        explains
          ? (activity) =>
              isOutlier(activity.durationInMillis) && (
                <HandOffButton
                  action="explainDuration"
                  variant="icon"
                  size="xs"
                  prompt={ask(explainActivityHandOff(activity, instanceRef, engineId))}
                />
              )
          : undefined
      }
    />
  )
}

/** Returns a `{ items, totalCount }` envelope. */
const HISTORY_QUERY_TOOL = "engine_query_historic_activity_instances"

interface HistoryPage {
  items?: HistoryEntry[]
  totalCount?: number
}

/**
 * Pages the history query with Load more instead of one capped fetch; `initialPage` skips the
 * self-fetch. The history route, an instance's History tab and an incident's show it alike.
 */
export function PagedHistoryView({
  processInstanceId,
  engine,
  initialPage = null,
  processDefinitionKey,
  incidentActivityIds,
}: {
  processInstanceId: string
  /** The route's engine: a page never reads the default engine. */
  engine: string
  processDefinitionKey?: string | null
  initialPage?: HistoryPage | null
  /** Activities with an open incident on this instance: their running step is marked. */
  incidentActivityIds?: readonly string[] | null
}) {
  const t = useT()
  const args = { processInstanceId, sortBy: "startTime", sortOrder: "asc", engine }
  const paged = usePagedViewData<HistoryEntry, HistoryPage>({
    initialData: initialPage,
    key: ["engine:instance-history", engine, processInstanceId],
    tool: HISTORY_QUERY_TOOL,
    args,
    pageSize: HISTORY_PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.items ?? [],
    selectTotal: (d) => d.totalCount ?? 0,
  })

  if (!paged.firstPage) {
    return (
      <ViewDataState
        loading={paged.loading}
        error={paged.error}
        onRetry={paged.retry}
        errorTitle={t("historyTimeline.loadError")}
        loadingText={t("historyTimeline.loading")}
        emptyText={t("historyTimeline.noData")}
        retryLabel={t("viewState.retry")}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The rows fit as ONE list: the table hands its body to it. */}
      <PagedRows paged={paged}>
        <HistorySteps
          activities={paged.items}
          instanceRef={{ id: processInstanceId, processDefinitionKey }}
          engineId={engine}
          incidentActivityIds={incidentActivityIds}
        />
      </PagedRows>
      <PagedListFooter
        paged={paged}
        noun={(total) => t("historyTimeline.footerNoun", { count: total })}
        labels={paged.footerLabels}
      />
    </div>
  )
}

/** The feed returns one capped page; the rest is a "Load more" away on the same engine, never silently cut. */
function describeHistoryTimeline(data: HistoryTimelineData): ViewContext {
  const pi = data.processInstance
  return {
    summary: pi
      ? "The operator is viewing the activity history timeline of one process instance."
      : "The operator is viewing an activity history timeline.",
    ids: {
      engine: data.engineId,
      processInstanceId: pi?.id,
      processDefinitionKey: pi?.processDefinitionKey,
    },
    facts: {
      state: pi?.state,
      activities: data.totalActivities,
      startTime: pi?.startTime,
      endTime: pi?.endTime,
      stillRunning: pi ? pi.endTime === null : undefined,
    },
    untrusted: [{ label: "processName", text: pi?.processDefinitionName }],
  }
}

function HistoryModelContext({ data }: { data: HistoryTimelineData }) {
  const { context } = useHandOff()
  return (
    <HostModelContext content={context(describeHistoryTimeline(data))}>{null}</HostModelContext>
  )
}

/** The history route: the instance's timeline, ended instances included, seeded by the start view. */
export function HistoryTimelineWidget({
  data: initialData = null,
  processInstanceId,
  engine,
  title,
}: {
  data?: HistoryTimelineData | null
  processInstanceId: string
  engine: string
  /** The route's title while no instance names it: loading, failed or not found. */
  title?: string
}) {
  const t = useT()
  // The route's engine, never the default engine.
  const view = useViewData<HistoryTimelineData>(
    initialData,
    ["engine:history-timeline", engine, processInstanceId],
    ENGINE_HISTORY_TIMELINE_DATA,
    { processInstanceId, engine },
    true,
  )
  const data = view.data
  // Stable identity per payload: the paged hook resets on a new page 0.
  const initialPage = useMemo<HistoryPage | null>(
    () => (data ? { items: data.activities, totalCount: data.totalActivities } : null),
    [data],
  )
  const routeBar = title && <WidgetHeader title={title} />
  if (!data) {
    return (
      <WidgetShell header={routeBar}>
        <ViewDataState
          loading={view.loading}
          error={view.error}
          loadingText={t("historyTimeline.loading")}
          emptyText={t("historyTimeline.noData")}
          onRetry={view.refetch}
          retryLabel={t("viewState.retry")}
        />
      </WidgetShell>
    )
  }
  const instance = data.processInstance
  // When the server read the history, once at the bar's end, as on every route.
  const freshness = <FreshnessStamp at={data.fetchedAt} />
  return (
    <WidgetShell
      header={
        instance ? (
          <HistoryHeader
            instance={instance}
            engineId={engine}
            total={data.totalActivities}
            freshness={freshness}
          />
        ) : (
          title && <WidgetHeader title={title} freshness={freshness} />
        )
      }
    >
      <HistoryModelContext data={data} />
      {instance ? (
        <PagedHistoryView
          processInstanceId={instance.id}
          engine={engine}
          initialPage={initialPage}
          processDefinitionKey={instance.processDefinitionKey}
          incidentActivityIds={data.incidentActivityIds}
        />
      ) : (
        // Unknown to history: nothing to page (and no id to scope a page by).
        <HistorySteps
          activities={data.activities}
          engineId={engine}
          incidentActivityIds={data.incidentActivityIds}
        />
      )}
    </WidgetShell>
  )
}

/**
 * The history route's bar: the instance by its one label (its business key, else its short id,
 * #322 U13), its state, and in its facts its process, its start to the second with its instant in
 * the title, and its duration.
 */
function HistoryHeader({
  instance,
  engineId,
  total,
  freshness,
}: {
  instance: TimelineInstance
  engineId: string
  total: number
  freshness: ReactNode
}) {
  const t = useT()
  const { ask } = useHandOff()
  // Its one action is a hand-off: where the host hides it, the bar has no action group.
  const handOffs = useHandOffsShown()
  const state = instanceStateLabel(t, instance.state)
  return (
    <WidgetHeader
      badge={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
      // The whole id in its title, never a second name beside it.
      title={<span title={instance.id}>{instanceName(instance.id, instance.businessKey)}</span>}
      sub={
        <>
          <span>{instance.processDefinitionName ?? instance.processDefinitionKey}</span>
          <time dateTime={instance.startTime} title={formatInstant(instance.startTime)}>
            {t("historyTimeline.started", { time: formatClock(instance.startTime) })}
          </time>
          {instance.durationInMillis != null && (
            <span>
              {t("historyTimeline.duration", {
                duration: formatDuration(instance.durationInMillis),
              })}
            </span>
          )}
        </>
      }
      actions={
        handOffs && (
          <HandOffButton
            action="explainTimeline"
            variant="toolbar"
            prompt={ask(explainInstanceHandOff(instance, engineId, total))}
          />
        )
      }
      freshness={freshness}
    />
  )
}
