import { useMemo } from "react"
import {
  Card,
  CardContent,
  Alert,
  AlertDescription,
  StatusBadge,
  TONE_DOT,
  PagedListFooter,
  WidgetHeader,
  cn,
} from "@miragon/mcp-toolkit-ui"
import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import {
  HandOffButton,
  TableEmptyState,
  WidgetShell,
  formatDuration,
  formatTimestamp,
  RowsBudgeted,
  usePagedViewData,
} from "@miragon/pulse-widget-shell/widgets"
import type { HistoryTimelineData } from "../view-models.js"
import { useHandOff, type HandOff, type ViewContext } from "./lib/hand-off.js"
import { durationOutliers } from "./lib/duration-outliers.js"
import { EngineMeta } from "./lib/engine-context.js"
import { useT } from "../messages/use-t.js"
import {
  HistoryTable,
  STEP_TONE,
  StepBadge,
  historyStepState,
  instanceStateLabel,
  type HistoryEntry,
} from "./history-steps.js"

export type { HistoryTimelineData }
export type HistoryActivity = HistoryTimelineData["activities"][number]

type TimelineInstance = NonNullable<HistoryTimelineData["processInstance"]>

/** The baseline is read by key, which the history query refuses, so the key goes with the analytics tools. */
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
    },
    toolIds: {
      analytics_element_bottleneck: { processDefinitionKey: instance.processDefinitionKey },
      analytics_analyze_process_performance: {
        processDefinitionKey: instance.processDefinitionKey,
      },
    },
    facts: { durationMs: instance.durationInMillis, state: instance.state, activityCount },
    untrusted: [{ label: "processName", text: instance.processDefinitionName }],
    tools: [
      "camunda7_query_historic_activity_instances",
      "analytics_element_bottleneck",
      "analytics_analyze_process_performance",
    ],
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
      activityId: activity.activityId,
    },
    toolIds: {
      analytics_element_bottleneck: {
        processDefinitionKey: instance?.processDefinitionKey ?? undefined,
      },
      analytics_analyze_process_performance: {
        processDefinitionKey: instance?.processDefinitionKey ?? undefined,
      },
    },
    facts: { durationMs: activity.durationInMillis, activityType: activity.activityType },
    untrusted: [{ label: "activityName", text: activity.activityName }],
    tools: [
      "camunda7_query_historic_activity_instances",
      "analytics_element_bottleneck",
      "analytics_analyze_process_performance",
    ],
  }
}

/** Shell-less activity history: `"timeline"` (outliers, Ask-AI) or the compact `"table"` of the incident detail. */
export function HistoryTimelineView({
  activities,
  processInstance,
  instanceRef,
  engineId,
  totalActivities,
  incidentActivityIds,
  variant = "timeline",
  attachRows,
}: {
  activities: HistoryEntry[]
  processInstance?: HistoryTimelineData["processInstance"]
  /** The instance the rows belong to, for their hand-offs where no header data is shown. */
  instanceRef?: TimelineInstanceRef
  engineId?: string
  totalActivities?: number
  /** Activities with an open incident on this instance — their running step is marked. */
  incidentActivityIds?: readonly string[] | null
  variant?: "timeline" | "table"
  /** The element whose children are the rows, for the inline fit of a paged timeline. */
  attachRows?: (element: HTMLElement | null) => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const incidentIds = new Set(incidentActivityIds ?? [])
  if (activities.length === 0) {
    return (
      <TableEmptyState>
        {variant === "table" ? t("incidentHistory.empty") : t("historyTimeline.empty")}
      </TableEmptyState>
    )
  }

  if (variant === "table") {
    return <HistoryTable entries={activities} incidentIds={incidentIds} />
  }

  // Duration outliers: the per-row "explain duration" hand-off only on the
  // slowest step(s), so the timeline isn't cluttered (`durationOutliers`).
  const isOutlier = durationOutliers(activities.map((a) => a.durationInMillis))

  return (
    <div className="flex flex-col gap-4">
      {processInstance && (
        <WidgetHeader
          badge={
            <StatusBadge tone={instanceStateLabel(t, processInstance.state).tone}>
              {instanceStateLabel(t, processInstance.state).label}
            </StatusBadge>
          }
          title={processInstance.processDefinitionName ?? processInstance.processDefinitionKey}
          sub={
            <>
              <EngineMeta engineId={engineId} />
              <span>
                {t("historyTimeline.started", {
                  time: formatTimestamp(processInstance.startTime),
                })}
              </span>
              {processInstance.durationInMillis != null && (
                <span>
                  {t("historyTimeline.duration", {
                    duration: formatDuration(processInstance.durationInMillis),
                  })}
                </span>
              )}
            </>
          }
          actions={
            <HandOffButton
              action="explainTimeline"
              prompt={ask(
                explainInstanceHandOff(
                  processInstance,
                  engineId,
                  totalActivities ?? activities.length,
                ),
              )}
            />
          }
        />
      )}

      <ol
        ref={attachRows}
        className="flex flex-col gap-1"
        aria-label={t("historyTimeline.timelineLabel")}
      >
        {activities.map((activity, index) => {
          const state = historyStepState(activity, incidentIds)
          return (
            <li key={activity.id} className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "size-3 rounded-full",
                    TONE_DOT[STEP_TONE[state]],
                    state === "incident" &&
                      "ring-danger ring-offset-background ring-2 ring-offset-2",
                  )}
                  aria-hidden="true"
                />
                {index < activities.length - 1 && (
                  <div className="bg-border h-6 w-0.5" aria-hidden="true" />
                )}
              </div>
              <Card
                className={cn(
                  "flex-1 gap-0 py-0 shadow-none",
                  state === "incident" && "border-danger",
                )}
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-dense font-medium">
                      {activity.activityName ?? activity.activityId}
                    </span>
                    <span className="text-muted-foreground text-small ml-2">
                      {activity.activityType}
                    </span>
                    {activity.assignee && (
                      <span className="text-muted-foreground text-small ml-2">
                        {t("historyTimeline.assignedTo", { assignee: activity.assignee })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {(state === "incident" || state === "running") && <StepBadge state={state} />}
                    {activity.durationInMillis != null && (
                      <span className="text-muted-foreground text-small">
                        {formatDuration(activity.durationInMillis)}
                      </span>
                    )}
                    {isOutlier(activity.durationInMillis) && (
                      <HandOffButton
                        action="explainDuration"
                        variant="icon"
                        prompt={ask(
                          explainActivityHandOff(
                            activity,
                            processInstance ?? instanceRef,
                            engineId,
                          ),
                        )}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Page size for the self-paged history tabs (a timeline rarely exceeds one page). */
const HISTORY_PAGE_SIZE = 100
/** Returns a `{ items, totalCount }` envelope. */
const HISTORY_QUERY_TOOL = "camunda7_query_historic_activity_instances"

interface HistoryPage {
  items?: HistoryEntry[]
  totalCount?: number
}

/** Pages the history query with Load more instead of one capped fetch; `initialPage` skips the self-fetch. */
export function PagedHistoryView({
  processInstanceId,
  engine,
  variant = "timeline",
  initialPage = null,
  processInstance,
  processDefinitionKey,
  incidentActivityIds,
}: {
  processInstanceId: string
  /** Explicit engine routing; omitted → the caller's saved default engine. */
  engine?: string
  processDefinitionKey?: string | null
  variant?: "timeline" | "table"
  initialPage?: HistoryPage | null
  processInstance?: HistoryTimelineData["processInstance"]
  /** Activities with an open incident on this instance — their running step is marked. */
  incidentActivityIds?: readonly string[] | null
}) {
  const t = useT()
  const args: Record<string, unknown> = {
    processInstanceId,
    sortBy: "startTime",
    sortOrder: "asc",
  }
  if (engine) args.engine = engine
  const paged = usePagedViewData<HistoryEntry, HistoryPage>({
    initialData: initialPage,
    key: ["camunda7:instance-history", engine ?? null, processInstanceId],
    tool: HISTORY_QUERY_TOOL,
    args,
    pageSize: HISTORY_PAGE_SIZE,
    ready: !!processInstanceId,
    selectItems: (d) => d.items ?? [],
    selectTotal: (d) => d.totalCount ?? 0,
  })

  if (!paged.firstPage) {
    if (paged.error) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            {t("historyTimeline.loadError", {
              message: paged.error.message || t("viewState.unknownError"),
            })}
          </AlertDescription>
        </Alert>
      )
    }
    return <p className="text-muted-foreground text-dense">{t("historyTimeline.loading")}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The rows fit as ONE list: the table variant hands its body to it. */}
      <RowsBudgeted rows={paged.fit}>
        <HistoryTimelineView
          variant={variant}
          activities={paged.items}
          processInstance={processInstance}
          instanceRef={{ id: processInstanceId, processDefinitionKey }}
          engineId={engine}
          totalActivities={paged.total}
          incidentActivityIds={incidentActivityIds}
          attachRows={paged.fit.attachRows}
        />
      </RowsBudgeted>
      <PagedListFooter
        paged={paged}
        noun={t("historyTimeline.footerNoun")}
        labels={paged.footerLabels}
      />
    </div>
  )
}

/** The show tool returns one capped page; the rest is a "Load more" away on the same engine, never silently cut. */
export function describeHistoryTimeline(data: HistoryTimelineData): ViewContext {
  const pi = data.processInstance
  return {
    summary: pi
      ? "The operator is viewing the activity history timeline of one process instance."
      : "The operator is viewing an activity history timeline.",
    ids: {
      engine: data.engineId,
      processInstanceId: pi?.id,
    },
    toolIds: { analytics_element_bottleneck: { processDefinitionKey: pi?.processDefinitionKey } },
    facts: {
      state: pi?.state,
      activities: data.totalActivities,
      startTime: pi?.startTime,
      endTime: pi?.endTime,
      stillRunning: pi ? pi.endTime === null : undefined,
    },
    untrusted: [{ label: "processName", text: pi?.processDefinitionName }],
    tools: ["camunda7_query_historic_activity_instances", "analytics_element_bottleneck"],
  }
}

function HistoryModelContext({ data }: { data: HistoryTimelineData }) {
  const { context } = useHandOff()
  return (
    <HostModelContext content={context(describeHistoryTimeline(data))}>{null}</HostModelContext>
  )
}

export function HistoryTimelineWidget({ data }: { data: HistoryTimelineData | null }) {
  const t = useT()
  // Stable identity per payload: the paged hook resets on a new page 0.
  const initialPage = useMemo<HistoryPage | null>(
    () => (data ? { items: data.activities, totalCount: data.totalActivities } : null),
    [data],
  )
  if (!data) {
    return (
      <WidgetShell>
        <Alert>
          <AlertDescription>{t("historyTimeline.noData")}</AlertDescription>
        </Alert>
      </WidgetShell>
    )
  }

  return (
    <WidgetShell>
      <HistoryModelContext data={data} />
      {data.processInstance ? (
        <PagedHistoryView
          processInstanceId={data.processInstance.id}
          engine={data.engineId}
          initialPage={initialPage}
          processInstance={data.processInstance}
          incidentActivityIds={data.incidentActivityIds}
        />
      ) : (
        // Unknown to history: nothing to page (and no id to scope a page by).
        <HistoryTimelineView
          activities={data.activities}
          engineId={data.engineId}
          totalActivities={data.totalActivities}
          incidentActivityIds={data.incidentActivityIds}
        />
      )}
    </WidgetShell>
  )
}
