import { TableEmptyState, FilterBar, PagedListFooter, type FilterChip } from "@miragon/pulse-ui"
import {
  ListTable,
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
  type ProcessInstanceRow,
  type ProcessInstancesData,
} from "../../view-models.js"
import type { ProcessInstancesFilters } from "../../feed-contracts.js"
import { useNav } from "../navigation.js"
import { CAMUNDA7_PROCESS_INSTANCES_DATA } from "../../tool-names.js"
import { InstancesHeader } from "./list-header.js"
import { InstanceRow } from "./instance-row.js"
import { useHandOff } from "../lib/hand-off.js"
import { describeInstancesView, type InstanceChip } from "./hand-offs.js"
import { instanceName } from "../lib/write-feedback.js"
import { useT } from "../../messages/use-t.js"

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
 * Server-side filters, so chips and search cover the whole result set, not the loaded page. The
 * route's engine and process scope every page, never the default engine. The feed maps `false`
 * onto its complement, so the Suspended chip sends `suspended: true` alone.
 */
function instancesFilterArgs(
  engine: string,
  processDefinitionKey: string | undefined,
  activeChip: InstanceChip,
): InstancesFilterArgs {
  // No definition scope: the engine-wide list the overview KPI drills into.
  const args: InstancesFilterArgs = { engine }
  if (processDefinitionKey) args.processDefinitionKey = processDefinitionKey
  if (activeChip === CHIP_SUSPENDED) args.suspended = true
  if (activeChip === CHIP_INCIDENTS) args.withIncidents = true
  return args
}

export function ProcessInstancesView({
  data: initialData = null,
  processDefinitionKey,
  engine,
}: {
  data?: ProcessInstancesData | null
  processDefinitionKey?: string
  engine: string
}) {
  const t = useT()
  const go = useNav()
  const { context } = useHandOff()
  const [activeChip, setActiveChip] = useState<InstanceChip>(CHIP_ALL)

  const { paged, search, setSearch, interacted } = usePagedListView<
    ProcessInstanceRow,
    ProcessInstancesData
  >({
    initialData,
    key: ["camunda7:process-instances", engine, processDefinitionKey ?? null],
    tool: CAMUNDA7_PROCESS_INSTANCES_DATA,
    args: instancesFilterArgs(engine, processDefinitionKey, activeChip),
    searchArg: "search",
    filtersActive: activeChip !== CHIP_ALL,
    pageSize: LIST_PAGE_SIZE,
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
            engine,
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
        engine={engine}
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
                engine={engine}
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
  engine: string
}) {
  return (
    <WidgetShell>
      <ProcessInstancesView {...props} />
    </WidgetShell>
  )
}
