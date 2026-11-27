import { useState } from "react"
import { GroupCard, SectionHeading, TableEmptyState } from "@miragon/pulse-ui"
import { ViewDataState, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import type { IncidentsByProcess, ProcessIncidentsData } from "../../view-models.js"
import { useNav } from "../navigation.js"
import { ActivitySummary, ActivityTitle } from "./activity-summary.js"
import { useDefinitionData, type DefinitionScope } from "./feed.js"
import { PagedIncidentTable } from "./paged-incident-table.js"
import { EmptyStateWithSiblings } from "./empty-state.js"
import { useT } from "../../messages/use-t.js"

function NoIncidentsState({
  data,
  emptyVariant,
  onJumpTo,
}: {
  data: ProcessIncidentsData
  emptyVariant: "siblings" | "note"
  onJumpTo: (sibling: IncidentsByProcess) => void
}) {
  const t = useT()
  const processName = data.processDefinitionName ?? data.processDefinitionKey
  if (emptyVariant === "siblings") {
    return (
      <EmptyStateWithSiblings
        processName={processName}
        siblings={data.siblingsWithIncidents}
        onJumpTo={onJumpTo}
      />
    )
  }
  // A process without a problem is neutral (`SITUATION_TONES`): the kit's empty note, never a
  // green dot or check.
  return <TableEmptyState>{t("procIncList.noIncidentsNote", { processName })}</TableEmptyState>
}

export function ActivityIncidentList({
  emptyVariant = "note",
  ...scope
}: DefinitionScope & {
  /** "note" is the kit's neutral empty note; "siblings" the explorative empty state of the incidents focus. */
  emptyVariant?: "siblings" | "note"
}) {
  const t = useT()
  const go = useNav()
  const { data, loading, error, refetch } = useDefinitionData(scope)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          loadingText={t("procIncList.loading")}
          emptyText={t("procIncList.noData")}
          onRetry={refetch}
          retryLabel={t("viewState.retry")}
        />
      </WidgetShell>
    )
  }

  function jumpToProcess({
    processDefinitionKey,
    tenantId,
    processDefinitionName,
  }: IncidentsByProcess) {
    go({
      type: "process-incidents",
      processDefinitionKey,
      ...(tenantId === undefined ? {} : { tenantId }),
      label: processDefinitionName ?? undefined,
    })
  }

  function analyzeIncident(incidentId: string, activityName: string | null) {
    go({ type: "incident-detail", incidentId, label: activityName ?? undefined })
  }

  function toggleExpanded(activityId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(activityId)) next.delete(activityId)
      else next.add(activityId)
      return next
    })
  }

  return (
    <WidgetShell>
      <section>
        {/* One group per affected activity: their count is the KPI tile's, said once (D6). */}
        <SectionHeading as="h2" title={t("procIncList.groupedHeading")} />
        {data.activities.length === 0 ? (
          <NoIncidentsState data={data} emptyVariant={emptyVariant} onJumpTo={jumpToProcess} />
        ) : (
          data.activities.map((activity) => (
            <GroupCard
              key={activity.activityId}
              as="h3"
              expanded={expanded.has(activity.activityId)}
              onToggle={() => toggleExpanded(activity.activityId)}
              title={<ActivityTitle activity={activity} />}
              summary={(toggle) => <ActivitySummary activity={activity} toggle={toggle} />}
            >
              {/* Rows come from the paged per-activity feed (mounted on
                  expand), not the definition payload: the group reaches every
                  incident, not just the 200-row recency scan. The table owns
                  the rows' remedies, keyed on that feed. */}
              <PagedIncidentTable
                processDefinitionKey={data.processDefinitionKey}
                tenantId={data.tenantId}
                activityId={activity.activityId}
                engine={scope.engine}
                vendor={data.engineVendor}
                onAnalyze={({ incidentId, label }) =>
                  analyzeIncident(incidentId, label ?? activity.activityName)
                }
              />
            </GroupCard>
          ))
        )}
      </section>
    </WidgetShell>
  )
}
