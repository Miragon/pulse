import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import {
  ListTable,
  PagedRows,
  QueryFallback,
  TableEmptyState,
  TableSkeleton,
  WidgetShell,
  usePagedListView,
} from "@miragon/pulse-widget-shell/widgets"
import { useState } from "react"
import { FilterBar, PagedListFooter, type FilterChip } from "@miragon/mcp-toolkit-ui"
import type { ProcessInstanceRow, ProcessInstancesData } from "../../view-models.js"
import type { ProcessInstancesFilters } from "../../feed-contracts.js"
import { useNav } from "../navigation.js"
import { CAMUNDA7_PROCESS_INSTANCES_DATA } from "../../tool-names.js"
import { InstancesHeader } from "./list-header.js"
import { InstanceRow } from "./instance-row.js"
import { useHandOff } from "../lib/hand-off.js"
import { describeInstancesView, type InstanceChip } from "./hand-offs.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT } from "../../messages/use-t.js"

const PAGE_SIZE = 50

export type { ProcessInstancesData }

const CHIP_ALL: InstanceChip = "all"
const CHIP_INCIDENTS: InstanceChip = "incidents"
const CHIP_SUSPENDED: InstanceChip = "suspended"

/** Type-only import, so no runtime zod in the widget bundle. */
type InstancesFilterArgs = Partial<ProcessInstancesFilters> & { engine?: string }

function deriveInstancesScope({
  initialData,
  processDefinitionKey,
  engine,
}: {
  initialData: ProcessInstancesData | null
  processDefinitionKey?: string
  engine?: string
}) {
  const pdk = processDefinitionKey ?? initialData?.processDefinitionKey
  // Standalone gets only `data`, so loadMore/search must page the echoed engine and filters, not the default.
  const echoed = initialData?.filters
  const feedEngine = engine ?? initialData?.engineId
  return { pdk, echoed, feedEngine }
}

type RunState = Pick<InstancesFilterArgs, "active" | "suspended">

/**
 * The feed maps `false` onto its complement (`active: false` = only suspended), so the pair
 * travels as given; props win over the echo as a pair so they never contradict.
 */
function deriveRunState(
  activeChip: InstanceChip,
  props: RunState,
  echoed: ProcessInstancesData["filters"] | undefined,
): RunState {
  if (activeChip === CHIP_SUSPENDED) return { suspended: true }
  if (props.active !== undefined || props.suspended !== undefined) return props
  return { active: echoed?.active, suspended: echoed?.suspended }
}

// Server-side filters, so chips and search cover the whole result set, not the loaded page.
function deriveInstancesFilters({
  activeChip,
  echoed,
  active,
  suspended,
  withIncidents,
  businessKeyLike,
}: {
  activeChip: InstanceChip
  echoed: ProcessInstancesData["filters"] | undefined
  active?: boolean
  suspended?: boolean
  withIncidents?: boolean
  businessKeyLike?: string
}) {
  const runState = deriveRunState(activeChip, { active, suspended }, echoed)
  const wantIncidents = activeChip === CHIP_INCIDENTS || !!(withIncidents ?? echoed?.withIncidents)
  const baseBusinessKey = businessKeyLike ?? echoed?.businessKeyLike
  return { runState, wantIncidents, baseBusinessKey }
}

function buildInstancesFilterArgs(
  scope: ReturnType<typeof deriveInstancesScope>,
  filters: ReturnType<typeof deriveInstancesFilters>,
): InstancesFilterArgs {
  // No definition scope: the engine-wide list the overview KPI drills into.
  const filterArgs: InstancesFilterArgs = {}
  if (scope.pdk) filterArgs.processDefinitionKey = scope.pdk
  if (scope.feedEngine) filterArgs.engine = scope.feedEngine
  if (filters.runState.active !== undefined) filterArgs.active = filters.runState.active
  if (filters.runState.suspended !== undefined) filterArgs.suspended = filters.runState.suspended
  if (filters.wantIncidents) filterArgs.withIncidents = true
  if (filters.baseBusinessKey) filterArgs.businessKeyLike = filters.baseBusinessKey
  return filterArgs
}

export function ProcessInstancesView({
  data: initialData = null,
  processDefinitionKey,
  engine,
  active,
  suspended,
  withIncidents,
  businessKeyLike,
}: {
  data?: ProcessInstancesData | null
  processDefinitionKey?: string
  engine?: string
  active?: boolean
  suspended?: boolean
  withIncidents?: boolean
  businessKeyLike?: string
}) {
  const t = useT()
  const go = useNav()
  const { context } = useHandOff()
  const [activeChip, setActiveChip] = useState<InstanceChip>(CHIP_ALL)

  const scope = deriveInstancesScope({ initialData, processDefinitionKey, engine })
  const { pdk, feedEngine } = scope
  const filterArgs = buildInstancesFilterArgs(
    scope,
    deriveInstancesFilters({
      activeChip,
      echoed: scope.echoed,
      active,
      suspended,
      withIncidents,
      businessKeyLike,
    }),
  )

  const { paged, search, setSearch, interacted } = usePagedListView<
    ProcessInstanceRow,
    ProcessInstancesData
  >({
    initialData,
    key: ["camunda7:process-instances", feedEngine ?? null, pdk ?? null],
    tool: CAMUNDA7_PROCESS_INSTANCES_DATA,
    args: filterArgs,
    // The feed lets it replace a handed-in businessKeyLike prefilter.
    searchArg: "search",
    filtersActive: activeChip !== CHIP_ALL,
    pageSize: PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.instances,
    selectTotal: (d) => d.totalCount,
  })
  const data = paged.firstPage

  if (!data) {
    return (
      <QueryFallback
        isError={!!paged.error}
        error={paged.error}
        errorTitle={t("processInstances.loadError")}
        onRetry={paged.retry}
        skeleton={<TableSkeleton />}
      />
    )
  }

  const scopedKey = data.processDefinitionKey
  const title = data.processDefinitionName ?? scopedKey ?? t("processInstances.allTitle")
  // The echo of the page on screen, never the request: an in-flight or failed query still shows the previous result.
  const listFilters = data.filters

  const chips: FilterChip[] = [
    { id: CHIP_ALL, label: t("processInstances.chipAll"), active: activeChip === CHIP_ALL },
    {
      id: CHIP_INCIDENTS,
      label: t("processInstances.chipWithIncidents"),
      active: activeChip === CHIP_INCIDENTS,
    },
    {
      id: CHIP_SUSPENDED,
      label: t("processInstances.chipSuspended"),
      active: activeChip === CHIP_SUSPENDED,
    },
  ]

  return (
    <>
      {/* Keep the agent aware of what the operator is looking at so it can offer
          the obvious next steps (drill into an instance, retry/suspend, etc.). */}
      <HostModelContext
        content={context(
          describeInstancesView({
            loadedCount: paged.items.length,
            total: paged.total,
            scopedKey,
            processName: data.processDefinitionName ?? null,
            engine: feedEngine,
            filters: listFilters,
            previousResult: paged.stale,
          }),
        )}
      >
        {null}
      </HostModelContext>
      <InstancesHeader
        title={title}
        processName={data.processDefinitionName ?? null}
        scopedKey={scopedKey}
        total={paged.total}
        engine={feedEngine}
        filters={listFilters}
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("processInstances.searchPlaceholder")}
        searchAriaLabel={t("processInstances.searchLabel")}
        chips={chips}
        chipsAriaLabel={t("processInstances.chipsLabel")}
        onChipToggle={(id) => setActiveChip(id === activeChip ? CHIP_ALL : (id as InstanceChip))}
      />

      <PagedRows paged={paged}>
        {paged.items.length === 0 ? (
          <TableEmptyState
            description={listFilters.search ? t("processInstances.noMatchSearch") : undefined}
          >
            {interacted ? t("processInstances.noMatch") : t("processInstances.noRunningInstances")}
          </TableEmptyState>
        ) : (
          <ListTable
            ariaLabel={t("processInstances.tableAriaLabel", { name: title })}
            columns={[
              { label: t("processInstances.colBusinessKey") },
              // Engine-wide, the state hides in a chat's narrow column; a scoped list has room for both.
              scopedKey
                ? { label: t("processInstances.colVersion") }
                : { label: t("processInstances.colProcess") },
              scopedKey
                ? { label: t("processInstances.colState") }
                : { label: t("processInstances.colState"), hideBelow: "md" as const },
              { label: t("processInstances.colIncident"), align: "right" as const },
              { plain: true, sticky: true },
            ]}
          >
            {paged.items.map((row) => (
              <InstanceRow
                key={row.id}
                row={row}
                processDefinitionKey={scopedKey}
                engine={feedEngine}
                showProcessColumn={!scopedKey}
                onOpen={(instance) =>
                  go({
                    type: "instance-detail",
                    processInstanceId: instance.id,
                    label: instanceName(instance.id, instance.businessKey),
                  })
                }
                onOpenProcess={(instance) => {
                  if (!instance.processDefinitionKey) return
                  go({
                    type: "process-detail",
                    processDefinitionKey: instance.processDefinitionKey,
                    label: instance.processDefinitionName ?? undefined,
                  })
                }}
              />
            ))}
          </ListTable>
        )}
      </PagedRows>
      {/* Also under an empty result: a failed search keeps the previous
          (empty) rows on screen, and its error + retry live in the footer. */}
      <PagedListFooter
        paged={paged}
        noun={t("processInstances.footerNoun")}
        labels={paged.footerLabels}
      />
    </>
  )
}

export function ProcessInstancesWidget(props: {
  data: ProcessInstancesData | null
  processDefinitionKey?: string
  engine?: string
  active?: boolean
  suspended?: boolean
  withIncidents?: boolean
  businessKeyLike?: string
}) {
  return (
    <WidgetShell>
      <ProcessInstancesView {...props} />
    </WidgetShell>
  )
}
