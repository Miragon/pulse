import { cn, PagedListFooter } from "@miragon/pulse-ui"
import {
  type PagedViewData,
  PagedRows,
  useCursorViewData,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"

import type { ActivityIncidentsData, IncidentInstance } from "../../view-models.js"
import { ENGINE_ACTIVITY_INCIDENTS_DATA } from "../../tool-names.js"
import { useT } from "../../messages/use-t.js"
import { EngineActionDialog } from "../lib/engine-action-dialog.js"
import { IncidentTable, type IncidentTarget } from "./incident-table.js"
import { useIncidentRecovery } from "./use-incident-recovery.js"

/** Mirrors the feed's server default. */
const INCIDENT_PAGE_SIZE = 10

/** An activity group's body: the ground under its summary on the card, its table's head too. */
const GROUP_GROUND = "bg-muted [--table-surface:var(--muted)]"

/** Where a group's incidents lie, and what a row opens. */
interface PagedIncidentTableProps {
  processDefinitionKey: string
  activityId: string
  /** The route's engine: a page never reads the default engine. */
  engine: string
  vendor?: string
  onAnalyze: (target: IncidentTarget) => void
}

/**
 * The activity's open root incidents, page by page by the cursor of the page before (Load more),
 * under the key the write policy invalidates after a remedy.
 */
function useActivityIncidents({
  processDefinitionKey,
  activityId,
  engine,
}: PagedIncidentTableProps): PagedViewData<IncidentInstance, ActivityIncidentsData> {
  return useCursorViewData<IncidentInstance, ActivityIncidentsData>({
    initialData: null,
    key: ["engine:activity-incidents", engine, processDefinitionKey, activityId],
    tool: ENGINE_ACTIVITY_INCIDENTS_DATA,
    args: { processDefinitionKey, activityId, engine },
    pageSize: INCIDENT_PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.incidents,
    // Read on the first page alone, which always counts.
    selectTotal: (d) => d.totalCount ?? 0,
    selectNext: (d) => d.next,
  })
}

/**
 * Pages `engine_activity_incidents_data` so a group reaches every incident, not just the
 * definition feed's 200-row scan. Success marks reset on THIS feed: the definition feed can
 * answer the invalidation first with pre-write rows and would bring a cleared button back.
 */
export function PagedIncidentTable(props: PagedIncidentTableProps) {
  const { engine, vendor, onAnalyze } = props
  const t = useT()
  const paged = useActivityIncidents(props)
  const recovery = useIncidentRecovery(engine, { resetOn: paged.firstPage })

  if (!paged.firstPage) {
    return (
      <div className={cn(GROUP_GROUND, "px-cell py-cell")}>
        <ViewDataState
          loading={paged.loading}
          error={paged.error}
          onRetry={paged.retry}
          loadingText={t("procIncTable.loading")}
          emptyText={t("procIncTable.noIncidents")}
        />
      </div>
    )
  }

  return (
    <div className={GROUP_GROUND}>
      {/* A page may come back empty with more to read (the feed's bound): no "none" then. */}
      {paged.items.length === 0 && !paged.hasMore && (
        <p className="text-muted-foreground text-dense px-cell py-cell">
          {t("procIncTable.noIncidents")}
        </p>
      )}
      {paged.items.length > 0 && (
        // #396
        <PagedRows paged={paged}>
          <IncidentTable
            incidents={paged.items}
            recovery={recovery}
            onAnalyze={onAnalyze}
            engine={engine}
            vendor={vendor}
          />
        </PagedRows>
      )}
      {/* The footer pads itself on the cell's role, so it lines up with the cells above. */}
      <PagedListFooter
        paged={paged}
        noun={(total) => t("procIncTable.footerNoun", { count: total })}
        labels={paged.footerLabels}
      />
      {/* The per-row button only requests the resolve; the actual
          engine_resolve_incident call runs after this confirmation. The
          dialog stays open until success so a failure is shown right here
          (and inline at the row once dismissed). */}
      <EngineActionDialog action={recovery.resolve} />
    </div>
  )
}
