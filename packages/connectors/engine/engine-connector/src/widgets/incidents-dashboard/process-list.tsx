import { useMemo, useState } from "react"

import {
  CountBadge,
  GroupCard,
  SearchField,
  SectionHeading,
  SegmentedControl,
  Toolbar,
  cn,
  DrillButton,
  TableEmptyState,
  formatCount,
  formatNumber,
  formatTimestamp,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
import type {
  IncidentsDashboardActivity,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
} from "../../view-models.js"

import { useNav } from "../navigation.js"
import { ENGINE_INCIDENTS_DATA } from "../../tool-names.js"
import { GroupSummaryRow } from "../group-summary-row.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { MoreActions } from "../lib/more-actions.js"
import { useT, type T } from "../../messages/use-t.js"
import { dashboardScope, incidentsFeed } from "./scope.js"

import {
  HandOffButton,
  OpenInCockpitLink,
  ViewDataState,
  WidgetShell,
  useViewData,
} from "@miragon/pulse-widget-shell/widgets"

const SCOPE_ALL = "all"
const SCOPE_LAST24H = "last24h"

type IncidentScope = typeof SCOPE_ALL | typeof SCOPE_LAST24H

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
      openIncidents: incidentType ? undefined : process.incidentCount,
      matchingIncidents: incidentType ? process.incidentCount : undefined,
      affectedActivities: process.affectedActivityCount,
      last24h: process.last24hCount,
      latestIncident: process.latestIncident,
      runningInstances: process.runningInstances,
    },
    untrusted: [{ label: "processName", text: process.processDefinitionName }],
  }
}

interface DisplayProcess extends IncidentsDashboardProcess {
  /** Null = unknown. */
  shownCount: number | null
  /** The count is the incidents of the last 24 hours (the Last 24h scope), not every open one. */
  last24h: boolean
}

/** The group's count in words, exact: its open incidents or those of the last 24 hours. */
function shownCountLabel(t: T, process: DisplayProcess): string {
  if (process.shownCount === null) return t("incidentsList.countUnknown")
  const count = formatNumber(process.shownCount)
  return process.last24h
    ? t("incidentsList.new24h", { count })
    : t("procIncHeader.openIncidents", { count })
}

/** #322 U20: two lines; the full process name, never cut; the cockpit link and hand-off behind "more". */
function ProcessSummary({
  process,
  expanded,
  engineId,
  vendor,
  filters,
  onOpenDetail,
}: {
  process: DisplayProcess
  expanded: boolean
  vendor: string
  engineId: string
  filters: IncidentsDashboardData["filters"]
  onOpenDetail: () => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const cockpitUrl = process.cockpitUrl
  const name = process.processDefinitionName ?? process.processDefinitionKey
  const facts = [
    process.affectedActivityCount === null
      ? `${formatCount(null)} ${t("incidentsList.activitiesLabel")}`
      : t("incidentsList.activities", { count: formatNumber(process.affectedActivityCount) }),
    process.last24hCount === null
      ? null
      : t("incidentsList.new24h", { count: formatNumber(process.last24hCount) }),
    t("incidentsList.instancesCount", { count: formatNumber(process.runningInstances) }),
    t("incidentsList.lastSeen", { time: formatTimestamp(process.latestIncident) }),
  ].filter((fact): fact is string => fact !== null)

  return (
    <div
      className={cn(
        "px-cell py-cell min-h-entry flex flex-col justify-center gap-1.5",
        expanded && "border-border border-b",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="text-foreground text-dense min-w-0 flex-1 font-semibold break-words">
          {name}
          {process.processDefinitionName && (
            <span className="text-muted-foreground text-small ms-2 font-mono font-normal">
              {process.processDefinitionKey}
            </span>
          )}
        </span>
        {/* A neutral count with the incident's icon, never a coloured number (invariant 6). */}
        <CountBadge
          count={process.shownCount}
          situation={(process.shownCount ?? 0) > 0 ? "openIncident" : undefined}
          label={shownCountLabel(t, process)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-muted-foreground text-small min-w-0 flex-1">{facts.join(" · ")}</span>
        <div className="flex items-center gap-1">
          <DrillButton
            size="xs"
            onDrill={onOpenDetail}
            ariaLabel={t("incidentsList.openDetailAria", { name })}
          >
            {t("incidentsList.open")}
          </DrillButton>
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
        </div>
      </div>
    </div>
  )
}

function ActivityRow({ activity }: { activity: IncidentsDashboardActivity }) {
  const t = useT()
  return (
    <GroupSummaryRow
      title={activity.activityName ?? activity.activityId}
      subline={activity.representativeMessage ?? activity.activityId}
      stats={[{ value: formatTimestamp(activity.firstSeen), label: t("incidentsList.firstSeen") }]}
      incidents={activity.scannedIncidentCount}
      className="border-border border-b last:border-b-0"
    />
  )
}

/**
 * From the newest-first recency scan, so a partial scan says so; exact counts are in the definition
 * view. The group's body lies on the ground, nested under its summary on the card and indented by
 * the gutter, its rules too: forced colours drop the ground, the indent stays.
 */
function ActivityList({ process }: { process: DisplayProcess }) {
  const t = useT()
  return (
    <div className="bg-muted ps-gutter">
      {process.scannedIncidentCount < process.incidentCount && (
        <p className="text-muted-foreground border-border text-small px-cell py-cell border-b">
          {t("incidentsList.breakdownPartial", {
            scanned: formatNumber(process.scannedIncidentCount),
            total: formatNumber(process.incidentCount),
          })}
        </p>
      )}
      {process.activities.map((a) => (
        <ActivityRow key={a.activityId} activity={a} />
      ))}
    </div>
  )
}

const mayHaveLast24h = (count: number | null) => count === null || count > 0

function matchesSearch(activity: IncidentsDashboardActivity, q: string): boolean {
  return (
    (activity.activityName ?? "").toLowerCase().includes(q) ||
    activity.activityId.toLowerCase().includes(q) ||
    (activity.representativeMessage ?? "").toLowerCase().includes(q)
  )
}

/** Filters narrow the list, never the numbers: a sum over a partial scan would understate. */
function filterProcesses(
  processes: IncidentsDashboardProcess[],
  search: string,
  showLast24h: boolean,
): DisplayProcess[] {
  const q = search.trim().toLowerCase()
  return processes
    .map<DisplayProcess | null>((p) => {
      if (showLast24h && !mayHaveLast24h(p.last24hCount)) return null
      let activities = showLast24h
        ? p.activities.filter((a) => mayHaveLast24h(a.last24hCount))
        : p.activities
      const processMatches =
        (p.processDefinitionName ?? "").toLowerCase().includes(q) ||
        p.processDefinitionKey.toLowerCase().includes(q)
      if (q.length > 0 && !processMatches) {
        activities = activities.filter((a) => matchesSearch(a, q))
        if (activities.length === 0) return null
      }
      return {
        ...p,
        activities,
        shownCount: showLast24h ? p.last24hCount : p.incidentCount,
        last24h: showLast24h,
      }
    })
    .filter((p): p is DisplayProcess => p !== null)
}

/** One widget so the search and the scope stay with the list. */
function IncidentProcessListView({
  data: initialData = null,
  engine,
}: {
  data?: IncidentsDashboardData | null
  engine: string
}) {
  const go = useNav()
  const t = useT()
  // Shares the overview-kpi feed, so both panels dedupe to one fetch.
  const feed = incidentsFeed(engine)
  const { data, loading, error, refetch } = useViewData<IncidentsDashboardData>(
    initialData,
    feed.key,
    ENGINE_INCIDENTS_DATA,
    feed.args,
    true,
  )

  const [search, setSearch] = useState("")
  const [scope, setScope] = useState<IncidentScope>(SCOPE_ALL)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filteredProcesses = useMemo<DisplayProcess[]>(
    () => (data ? filterProcesses(data.processes, search, scope === SCOPE_LAST24H) : []),
    [data, search, scope],
  )

  if (!data) {
    return (
      <ViewDataState
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingText={t("incidentsList.loading")}
        emptyText={t("incidentsList.noData")}
      />
    )
  }

  // One pick of two, the instance scope's control: each count from the payload on screen (the
  // KPIs above show the same two), a neutral number.
  const scopes: SegmentedControlOption<IncidentScope>[] = [
    { value: SCOPE_ALL, label: t("incidentsList.scopeAll"), count: data.totalCount },
    { value: SCOPE_LAST24H, label: t("incidentsList.scopeLast24h"), count: data.last24hCount },
  ]

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
    <>
      {/* The scope segments first, then the search, as the instance list's filters. A bar inside
          the content reaches the card's edges, as a view's tab bar does. */}
      <Toolbar className="-mx-gutter">
        <SegmentedControl
          ariaLabel={t("incidentsList.scopeLabel")}
          options={scopes}
          value={scope}
          onChange={setScope}
        />
        <SearchField
          value={search}
          onChange={setSearch}
          delayMs={0}
          placeholder={t("incidentsList.searchPlaceholder")}
          aria-label={t("incidentsList.searchLabel")}
        />
      </Toolbar>

      <section>
        <SectionHeading
          title={t("incidentsList.groupedByProcess")}
          hint={t("incidentsList.clickToExpand")}
        />

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
              expanded={expanded.has(p.processDefinitionKey)}
              onToggle={() => toggleExpanded(p.processDefinitionKey)}
              summary={
                <ProcessSummary
                  process={p}
                  expanded={expanded.has(p.processDefinitionKey)}
                  engineId={engine}
                  vendor={data.engineVendor}
                  filters={data.filters}
                  onOpenDetail={() => openDetail(p)}
                />
              }
            >
              <ActivityList process={p} />
            </GroupCard>
          ))
        )}
      </section>
    </>
  )
}

export function IncidentProcessList({
  data,
  engine,
}: {
  data: IncidentsDashboardData | null
  engine: string
}) {
  return (
    <WidgetShell>
      <IncidentProcessListView data={data} engine={engine} />
    </WidgetShell>
  )
}
