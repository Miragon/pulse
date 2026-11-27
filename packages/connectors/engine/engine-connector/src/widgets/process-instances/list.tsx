import {
  TableEmptyState,
  PagedListFooter,
  SearchField,
  SegmentedControl,
  Toolbar,
  WidgetHeader,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
import {
  ListTable,
  type ListTableColumn,
  PagedRows,
  QueryFallback,
  TableSkeleton,
  WidgetShell,
  usePagedListView,
  HostModelContext,
} from "@miragon/pulse-widget-shell/widgets"
import { useState } from "react"
import {
  LIST_PAGE_SIZE,
  type ListTenant,
  type ProcessInstanceRow,
  type ProcessInstancesData,
} from "../../view-models.js"
import type { ProcessInstancesFilters } from "../../feed-contracts.js"
import { useNav } from "../navigation.js"
import { ENGINE_PROCESS_INSTANCES_DATA } from "../../tool-names.js"
import { InstancesHeader } from "./list-header.js"
import { InstanceRow } from "./instance-row.js"
import { useHandOff, useHandOffsShown } from "../lib/hand-off.js"
import { describeInstancesView, type InstanceChip } from "./hand-offs.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT, type T } from "../../messages/use-t.js"

export type { ProcessInstancesData }

const CHIP_ALL: InstanceChip = "all"
const CHIP_INCIDENTS: InstanceChip = "incidents"
const CHIP_SUSPENDED: InstanceChip = "suspended"

/** Type-only import, so no runtime zod in the widget bundle. */
type InstancesFilterArgs = Partial<ProcessInstancesFilters> & {
  engine: string
  processDefinitionKey?: string
}

/**
 * The route's scope: a key's instances, narrowed to the runs in one tenant (null: none) where a
 * process whose key holds others opened them.
 */
interface InstancesScope {
  processDefinitionKey?: string | undefined
  onlyTenant?: ListTenant | undefined
}

/**
 * Server-side filters, so the scope and the search cover the whole result set, not the loaded
 * page. The route's engine and process scope every page, never the default engine. The feed maps
 * `false` onto its complement, so the Suspended scope sends `suspended: true` alone.
 */
function instancesFilterArgs(
  engine: string,
  { processDefinitionKey, onlyTenant }: InstancesScope,
  activeChip: InstanceChip,
): InstancesFilterArgs {
  // No definition scope: the engine-wide list the overview KPI drills into.
  const args: InstancesFilterArgs = { engine }
  if (processDefinitionKey) args.processDefinitionKey = processDefinitionKey
  if (processDefinitionKey && onlyTenant !== undefined) args.onlyTenant = onlyTenant
  if (activeChip === CHIP_SUSPENDED) args.suspended = true
  if (activeChip === CHIP_INCIDENTS) args.withIncidents = true
  return args
}

/** The list's columns: the version where it lists one process, else the process. */
function instanceColumns(t: T, scoped: boolean, actions: boolean): ListTableColumn[] {
  return [
    // The instance whole while there is room; the process gives way first.
    { label: t("processInstances.colBusinessKey"), fit: true },
    // The state and an open incident on one line in one column, right after the ids as the
    // webview has it, so a narrow chat that scrolls the table sideways still shows it.
    { label: t("processInstances.colState") },
    // The version as narrow as its chip; the process's name takes the room it needs.
    scoped
      ? { label: t("processInstances.colVersion"), fit: true }
      : { label: t("processInstances.colProcess") },
    // When it started, as the webview's list and a board's: a time on the clock, right-aligned in
    // tabular figures. Below 40rem the ids, the state and the process keep the room.
    { label: t("processInstances.colStarted"), align: "right", fit: true, hideBelow: "sm" },
    // Pinned from 40rem up only, as in the incident tables: in a narrower region the actions
    // scroll with the row, so they never cover the instance or its state. Only while a row of the
    // page has one: the row itself opens the instance.
    ...(actions
      ? [
          {
            label: t("processInstances.colActions"),
            align: "right" as const,
            sticky: "sm" as const,
          },
        ]
      : []),
  ]
}

/**
 * The list on its scope and search, page by page, through the route's engine and process. The
 * scope a segment picks is a server-side filter (`instancesFilterArgs`).
 */
function useInstancesList(
  initialData: ProcessInstancesData | null,
  engine: string,
  scope: InstancesScope,
) {
  const [activeChip, setActiveChip] = useState<InstanceChip>(CHIP_ALL)
  const tenant = scope.onlyTenant === undefined ? "*" : scope.onlyTenant
  const list = usePagedListView<ProcessInstanceRow, ProcessInstancesData>({
    initialData,
    key: ["engine:process-instances", engine, scope.processDefinitionKey ?? null, tenant],
    tool: ENGINE_PROCESS_INSTANCES_DATA,
    args: instancesFilterArgs(engine, scope, activeChip),
    searchArg: "search",
    filtersActive: activeChip !== CHIP_ALL,
    pageSize: LIST_PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.instances,
    selectTotal: (d) => d.totalCount,
  })
  return { ...list, activeChip, setActiveChip }
}

/** What the view's parts read: the list, its page on screen, the view's title and its engine. */
interface InstancesParts {
  list: ReturnType<typeof useInstancesList>
  data: ProcessInstancesData
  title: string
  engine: string
}

/**
 * Each segment counts what it lists on the page's scope and search, whichever is checked: the
 * payload on screen, never the request. The count with an incident alarms by its icon, never by a
 * coloured number (invariant 6); its label already says why, so a screen reader hears the label
 * and the exact count, as the webview's segment reads ("With incident 54").
 */
function instanceScopes(t: T, data: ProcessInstancesData): SegmentedControlOption<InstanceChip>[] {
  return [
    { value: CHIP_ALL, label: t("processInstances.chipAll"), count: data.allCount },
    {
      value: CHIP_INCIDENTS,
      label: t("processInstances.chipWithIncidents"),
      count: data.withIncidentCount,
      tone: data.withIncidentCount > 0 ? "danger" : undefined,
    },
    {
      value: CHIP_SUSPENDED,
      label: t("processInstances.chipSuspended"),
      count: data.suspendedCount,
    },
  ]
}

/**
 * The view's bar, then the list's filters under it, from edge to edge: the scope segments first,
 * then the search (the webview's filter bar). Busy while a scope's page loads.
 */
function InstancesBars({ list, data, title, engine }: InstancesParts) {
  const t = useT()
  const { paged } = list
  return (
    <>
      <InstancesHeader
        title={title}
        processName={data.processDefinitionName ?? null}
        scopedKey={data.processDefinitionKey}
        total={paged.total}
        engine={engine}
        filters={data.filters}
        fetchedAt={data.fetchedAt}
      />
      <Toolbar>
        <SegmentedControl
          ariaLabel={t("processInstances.scopeLabel")}
          options={instanceScopes(t, data)}
          value={list.activeChip}
          onChange={list.setActiveChip}
          busy={paged.refreshing}
        />
        <SearchField
          value={list.search}
          onChange={list.setSearch}
          delayMs={0}
          placeholder={t("processInstances.searchPlaceholder")}
          aria-label={t("processInstances.searchLabel")}
        />
      </Toolbar>
    </>
  )
}

/**
 * Keep the agent aware of what the operator is looking at so it can offer the obvious next steps
 * (drill into an instance, retry/suspend, etc.).
 */
function InstancesModelContext({ list, data, engine }: Omit<InstancesParts, "title">) {
  const { context } = useHandOff()
  const { paged } = list
  return (
    <HostModelContext
      content={context(
        describeInstancesView({
          loadedCount: paged.items.length,
          total: paged.total,
          scopedKey: data.processDefinitionKey,
          processName: data.processDefinitionName ?? null,
          engine,
          filters: data.filters,
          previousResult: paged.stale,
        }),
      )}
    >
      {null}
    </HostModelContext>
  )
}

/** A row's drills: its instance, and its process where the row names one. */
function useRowDrills() {
  const go = useNav()
  return {
    openInstance: (instance: ProcessInstanceRow) =>
      go({
        type: "instance-detail",
        processInstanceId: instance.id,
        label: instanceName(instance.id, instance.businessKey),
      }),
    openProcess: (instance: ProcessInstanceRow) => {
      if (!instance.processDefinitionKey) return
      go({
        type: "process-detail",
        processDefinitionKey: instance.processDefinitionKey,
        ...(instance.tenantId === undefined ? {} : { tenantId: instance.tenantId }),
        label: instance.processDefinitionName ?? undefined,
      })
    },
  }
}

/** The page's rows, each opening its instance and its process; else what says there are none. */
function InstanceRows({
  list,
  data,
  title,
  engine,
  actions,
}: InstancesParts & { actions: boolean }) {
  const t = useT()
  const drills = useRowDrills()
  const { paged } = list
  const scopedKey = data.processDefinitionKey
  if (paged.items.length === 0) {
    return (
      <TableEmptyState
        description={data.filters.search ? t("processInstances.noMatchSearch") : undefined}
      >
        {list.interacted ? t("processInstances.noMatch") : t("processInstances.noRunningInstances")}
      </TableEmptyState>
    )
  }
  return (
    <ListTable
      ariaLabel={
        title === t("processInstances.allTitle")
          ? title
          : t("processInstances.tableAriaLabel", { name: title })
      }
      columns={instanceColumns(t, !!scopedKey, actions)}
    >
      {paged.items.map((row) => (
        <InstanceRow
          key={row.id}
          row={row}
          processDefinitionKey={scopedKey}
          engine={engine}
          showProcessColumn={!scopedKey}
          actions={actions}
          onOpen={drills.openInstance}
          onOpenProcess={drills.openProcess}
        />
      ))}
    </ListTable>
  )
}

export function ProcessInstancesView({
  data: initialData = null,
  processDefinitionKey,
  onlyTenant,
  engine,
}: {
  data?: ProcessInstancesData | null
  processDefinitionKey?: string
  /** The tenant a process opened its instances in (null: none); absent, every tenant's. */
  onlyTenant?: ListTenant
  engine: string
}) {
  const t = useT()
  const handOffs = useHandOffsShown()
  const list = useInstancesList(initialData, engine, { processDefinitionKey, onlyTenant })
  const { paged } = list
  // The page on screen, its filters the echo of that page, never the request: an in-flight or
  // failed query still shows the previous result.
  const data = paged.firstPage

  if (!data) {
    // Loading or failed, the route keeps a title, the page's one heading: its process by key.
    return (
      <WidgetShell
        header={<WidgetHeader title={processDefinitionKey ?? t("processInstances.allTitle")} />}
      >
        <QueryFallback
          isError={!!paged.error}
          error={paged.error}
          errorTitle={t("processInstances.loadError")}
          onRetry={paged.retry}
          skeleton={<TableSkeleton />}
        />
      </WidgetShell>
    )
  }

  const title =
    data.processDefinitionName ?? data.processDefinitionKey ?? t("processInstances.allTitle")
  // A row's one further action is the hand-off of an instance with an open incident.
  const actions = handOffs && paged.items.some((row) => row.hasIncident)
  return (
    <WidgetShell header={<InstancesBars list={list} data={data} title={title} engine={engine} />}>
      <InstancesModelContext list={list} data={data} engine={engine} />
      <PagedRows paged={paged}>
        <InstanceRows list={list} data={data} title={title} engine={engine} actions={actions} />
      </PagedRows>
      {/* Also under an empty result: a failed search keeps the previous
          (empty) rows on screen, and its error + retry live in the footer. */}
      <PagedListFooter
        paged={paged}
        noun={(total) => t("processInstances.footerNoun", { count: total })}
        labels={paged.footerLabels}
      />
    </WidgetShell>
  )
}

/** The instances route: a view of its own, its bar, the filters and the list. */
export function ProcessInstancesWidget(props: {
  data: ProcessInstancesData | null
  processDefinitionKey?: string
  onlyTenant?: ListTenant
  engine: string
}) {
  return <ProcessInstancesView {...props} />
}
