import { useMemo, useState, type ReactNode } from "react"

import {
  CountBadge,
  GROUP_CARD_INSET,
  GroupCard,
  SearchField,
  SectionHeading,
  Toolbar,
  cn,
  DrillButton,
  TableEmptyState,
  formatCount,
  formatNumber,
} from "@miragon/pulse-ui"
import type {
  IncidentsDashboardActivity,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
} from "../../view-models.js"

import { useNav } from "../navigation.js"
import { ENGINE_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff } from "../lib/hand-off.js"
import { MoreActions } from "../lib/more-actions.js"
import { useT } from "../../messages/use-t.js"
import { ActivityTable } from "./activity-table.js"
import { dashboardScope, incidentsFeed } from "./scope.js"
import { TimeAgo } from "./time-ago.js"

import {
  HandOffButton,
  OpenInCockpitLink,
  ViewDataState,
  WidgetShell,
  useViewData,
  type ViewDataResult,
} from "@miragon/pulse-widget-shell/widgets"

/** On a type-filtered dashboard the filter travels as an id and the count as the matching incidents. */
export function processRootCauseHandOff(
  process: IncidentsDashboardProcess,
  engine: string,
  filters: IncidentsDashboardData["filters"],
): HandOff {
  const { incidentType } = dashboardScope(filters)
  return {
    intent: "askAi.incidents.processRootCause",
    ids: { engine, processDefinitionKey: process.processDefinitionKey, incidentType },
    // All versions of the key (#335 N61); null facts are left out, never a 0.
    facts: {
      countScope: "allVersions",
      latestVersion: process.latestVersion,
      openRootIncidents: incidentType ? undefined : process.incidentCount,
      matchingRootIncidents: incidentType ? process.incidentCount : undefined,
      affectedActivities: process.affectedActivityCount,
      latestIncident: process.latestIncident,
      runningInstances: process.runningInstances,
    },
    untrusted: [{ label: "processName", text: process.processDefinitionName }],
  }
}

/**
 * The group's name in its toggle: the full process name, never cut, its key quiet in mono after
 * it, so the toggle is named by the process.
 */
function ProcessTitle({ process }: { process: IncidentsDashboardProcess }) {
  return (
    <span className="text-dense min-w-0 font-semibold break-words">
      {process.processDefinitionName ?? process.processDefinitionKey}
      {process.processDefinitionName && (
        <span className="text-muted-foreground text-small ms-2 font-mono font-normal">
          {process.processDefinitionKey}
        </span>
      )}
    </span>
  )
}

/**
 * #322 U20: two lines, the group's toggle (its chevron and the process) with its count, then its
 * facts and its actions, lined up with the name after the chevron; the cockpit link and hand-off
 * behind "more". The actions sit beside the toggle, never inside it.
 */
function ProcessSummary({
  toggle,
  process,
  engineId,
  vendor,
  filters,
  onOpenDetail,
}: {
  toggle: ReactNode
  process: IncidentsDashboardProcess
  vendor: string
  engineId: string
  filters: IncidentsDashboardData["filters"]
  onOpenDetail: () => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const handOffs = useHandOffsShown()
  const cockpitUrl = process.cockpitUrl
  const name = process.processDefinitionName ?? process.processDefinitionKey
  const facts = [
    process.affectedActivityCount === null
      ? `${formatCount(null)} ${t("incidentsList.activitiesLabel")}`
      : t("incidentsList.activities", { count: formatNumber(process.affectedActivityCount) }),
    t("incidentsList.instancesCount", { count: formatNumber(process.runningInstances) }),
  ]

  return (
    <div className="px-cell py-cell min-h-entry flex flex-col justify-center gap-1.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{toggle}</div>
        {/* A neutral count with the incident's icon, never a coloured number (invariant 6). */}
        <CountBadge
          count={process.incidentCount}
          situation={process.incidentCount > 0 ? "openIncident" : undefined}
          label={t("procIncHeader.openIncidents", { count: formatNumber(process.incidentCount) })}
        />
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", GROUP_CARD_INSET)}>
        <span className="text-muted-foreground text-small min-w-0 flex-1">
          {facts.join(" · ")}
          {" · "}
          {/* A time ago, its instant in its title, as the process view's bar says its last event. */}
          <TimeAgo iso={process.latestIncident}>
            {(time) => t("incidentsList.lastSeen", { time })}
          </TimeAgo>
        </span>
        <div className="flex items-center gap-1">
          <DrillButton
            size="xs"
            onDrill={onOpenDetail}
            ariaLabel={t("incidentsList.openDetailAria", { name })}
          >
            {t("incidentsList.open")}
          </DrillButton>
          {/* A menu only while one of its entries shows. */}
          {(cockpitUrl || handOffs) && (
            <MoreActions label={t("incidentsList.moreActions", { name })}>
              {cockpitUrl && (
                <OpenInCockpitLink url={cockpitUrl} vendor={vendor} variant="menuitem" />
              )}
              <HandOffButton
                action="findCause"
                variant="menuitem"
                prompt={ask(processRootCauseHandOff(process, engineId, filters))}
              />
            </MoreActions>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * From the newest-first recency scan, so a partial scan says so; exact counts are in the definition
 * view. The group's body lies on the ground, nested under its summary on the card and indented by
 * the gutter, its table's head and rules too (as a process's activity groups): forced colours drop
 * the ground, the indent stays.
 */
function ActivityList({
  process,
  onOpen,
}: {
  process: IncidentsDashboardProcess
  onOpen: (activity: IncidentsDashboardActivity) => void
}) {
  const t = useT()
  return (
    <div className="bg-muted ps-gutter [--table-surface:var(--muted)]">
      {process.scannedIncidentCount < process.incidentCount && (
        <p className="text-muted-foreground border-border text-small px-cell py-cell border-b">
          {t("incidentsList.breakdownPartial", {
            scanned: formatNumber(process.scannedIncidentCount),
            total: formatNumber(process.incidentCount),
          })}
        </p>
      )}
      <ActivityTable
        processName={process.processDefinitionName ?? process.processDefinitionKey}
        activities={process.activities}
        onOpen={onOpen}
      />
    </div>
  )
}

function matchesSearch(activity: IncidentsDashboardActivity, q: string): boolean {
  return (
    (activity.activityName ?? "").toLowerCase().includes(q) ||
    activity.activityId.toLowerCase().includes(q) ||
    (activity.representativeMessage ?? "").toLowerCase().includes(q)
  )
}

/** The search narrows the list, never the numbers: a sum over a partial scan would understate. */
function filterProcesses(
  processes: IncidentsDashboardProcess[],
  search: string,
): IncidentsDashboardProcess[] {
  const q = search.trim().toLowerCase()
  return processes
    .map<IncidentsDashboardProcess | null>((p) => {
      const processMatches =
        (p.processDefinitionName ?? "").toLowerCase().includes(q) ||
        p.processDefinitionKey.toLowerCase().includes(q)
      if (q.length === 0 || processMatches) return p
      const activities = p.activities.filter((a) => matchesSearch(a, q))
      return activities.length === 0 ? null : { ...p, activities }
    })
    .filter((p): p is IncidentsDashboardProcess => p !== null)
}

/** One widget so the search stays with the list. */
function IncidentProcessListView({
  view,
  engine,
}: {
  view: ViewDataResult<IncidentsDashboardData>
  engine: string
}) {
  const go = useNav()
  const t = useT()
  const { data, loading, error, refetch } = view

  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filteredProcesses = useMemo<IncidentsDashboardProcess[]>(
    () => (data ? filterProcesses(data.processes, search) : []),
    [data, search],
  )

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          onRetry={refetch}
          loadingText={t("incidentsList.loading")}
          emptyText={t("incidentsList.noData")}
        />
      </WidgetShell>
    )
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openDetail(process: IncidentsDashboardProcess) {
    go({
      type: "process-incidents",
      processDefinitionKey: process.processDefinitionKey,
      label: process.processDefinitionName ?? undefined,
    })
  }

  return (
    <WidgetShell
      header={
        // The search under the view's bar, from edge to edge; the bar above names the open root
        // incidents in words, the cards count them per process.
        <Toolbar>
          <SearchField
            value={search}
            onChange={setSearch}
            delayMs={0}
            placeholder={t("incidentsList.searchPlaceholder")}
            aria-label={t("incidentsList.searchLabel")}
          />
        </Toolbar>
      }
    >
      <section>
        <SectionHeading as="h2" title={t("incidentsList.groupedByProcess")} />

        {filteredProcesses.length === 0 ? (
          <TableEmptyState>
            {data.processes.length === 0
              ? t("incidentsList.noOpenIncidents")
              : t("incidentsList.noMatch")}
          </TableEmptyState>
        ) : (
          filteredProcesses.map((p) => (
            <GroupCard
              key={p.processDefinitionKey}
              as="h3"
              expanded={expanded.has(p.processDefinitionKey)}
              onToggle={() => toggleExpanded(p.processDefinitionKey)}
              title={<ProcessTitle process={p} />}
              summary={(toggle) => (
                <ProcessSummary
                  toggle={toggle}
                  process={p}
                  engineId={engine}
                  vendor={data.engineVendor}
                  filters={data.filters}
                  onOpenDetail={() => openDetail(p)}
                />
              )}
            >
              <ActivityList
                process={p}
                onOpen={(activity) =>
                  go({
                    type: "cluster-detail",
                    activityId: activity.activityId,
                    incidentType: activity.incidentType,
                    label: activity.activityName ?? undefined,
                  })
                }
              />
            </GroupCard>
          ))
        )}
      </section>
    </WidgetShell>
  )
}

/**
 * The list under the route's bar, over the same feed (one query, shared): a failed read is the
 * bar's to say, once, with its Try again, which reads it for both.
 */
export function IncidentProcessList({
  data,
  engine,
}: {
  data: IncidentsDashboardData | null
  engine: string
}) {
  const feed = incidentsFeed(engine)
  const view = useViewData<IncidentsDashboardData>(
    data,
    feed.key,
    ENGINE_INCIDENTS_DATA,
    feed.args,
    true,
  )
  if (!view.data && view.error) return null
  return <IncidentProcessListView view={view} engine={engine} />
}
