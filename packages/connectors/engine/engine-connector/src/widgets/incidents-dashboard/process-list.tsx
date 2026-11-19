import { useMemo, useState, type ReactNode } from "react"

import {
  CountBadge,
  GROUP_CARD_INSET,
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
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
import type {
  IncidentsDashboardActivity,
  IncidentsDashboardData,
  IncidentsDashboardProcess,
} from "../../view-models.js"

import { useNav, type NavIntent } from "../navigation.js"
import { ENGINE_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff } from "../lib/hand-off.js"
import { MoreActions } from "../lib/more-actions.js"
import { useT, type T } from "../../messages/use-t.js"
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

/**
 * The group's name in its toggle: the full process name, never cut, its key quiet in mono after
 * it, so the toggle is named by the process.
 */
function ProcessTitle({ process }: { process: DisplayProcess }) {
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
  process: DisplayProcess
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
    process.last24hCount === null
      ? null
      : t("incidentsList.new24h", { count: formatNumber(process.last24hCount) }),
    t("incidentsList.instancesCount", { count: formatNumber(process.runningInstances) }),
  ].filter((fact): fact is string => fact !== null)

  return (
    <div className="px-cell py-cell min-h-entry flex flex-col justify-center gap-1.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{toggle}</div>
        {/* A neutral count with the incident's icon, never a coloured number (invariant 6). */}
        <CountBadge
          count={process.shownCount}
          situation={(process.shownCount ?? 0) > 0 ? "openIncident" : undefined}
          label={shownCountLabel(t, process)}
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
  process: DisplayProcess
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

const mayHaveLast24h = (count: number | null) => count === null || count > 0

/**
 * Where an activity's row leads, the cause its message names: a root's row its own failure cluster
 * (the activity and the type), a delegated row its root cause's cluster (a cluster lists root
 * incidents alone, so its own would list none of the row's copies) and, with that root beyond the
 * scan, the process's view, whose activity groups list the copies. Never a cluster of none.
 */
function activityTarget(
  process: IncidentsDashboardProcess,
  activity: IncidentsDashboardActivity,
): NavIntent {
  if (!activity.delegated) {
    return {
      type: "cluster-detail",
      activityId: activity.activityId,
      incidentType: activity.incidentType,
      label: activity.activityName ?? undefined,
    }
  }
  const cause = activity.rootCause
  if (!cause) {
    return {
      type: "process-incidents",
      processDefinitionKey: process.processDefinitionKey,
      label: process.processDefinitionName ?? undefined,
    }
  }
  return {
    type: "cluster-detail",
    activityId: cause.activityId,
    incidentType: cause.incidentType,
    messageSignature: cause.messageSignature,
    label: cause.activityName ?? undefined,
  }
}

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
  const [scope, setScope] = useState<IncidentScope>(SCOPE_ALL)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filteredProcesses = useMemo<DisplayProcess[]>(
    () => (data ? filterProcesses(data.processes, search, scope === SCOPE_LAST24H) : []),
    [data, search, scope],
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

  // One pick of two, the instance scope's control: each count from the payload on screen, a
  // neutral number; the bar above names the open incidents in words, the segments count them.
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
    <WidgetShell
      header={
        // The scope segments first, then the search, as the instance list's filters: under the
        // view's bar, from edge to edge.
        <Toolbar>
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
              <ActivityList process={p} onOpen={(activity) => go(activityTarget(p, activity))} />
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
