import {
  TableEmptyState,
  PagedListFooter,
  SearchField,
  SegmentedControl,
  Toolbar,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
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
import { ENGINE_PROCESS_INSTANCES_DATA } from "../../tool-names.js"
import { InstancesHeader } from "./list-header.js"
import { InstanceRow } from "./instance-row.js"
import { useHandOff } from "../lib/hand-off.js"
import { SUBJECT_COLUMN } from "../lib/identity.js"
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
 * Server-side filters, so the scope and the search cover the whole result set, not the loaded
 * page. The route's engine and process scope every page, never the default engine. The feed maps
 * `false` onto its complement, so the Suspended scope sends `suspended: true` alone.
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
    key: ["engine:process-instances", engine, processDefinitionKey ?? null],
    tool: ENGINE_PROCESS_INSTANCES_DATA,
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
      <WidgetShell>
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

  const scopedKey = data.processDefinitionKey
  const title = data.processDefinitionName ?? scopedKey ?? t("processInstances.allTitle")
  // The echo of the page on screen, never the request: an in-flight or failed query still shows the previous result.
  const listFilters = data.filters

  // Each segment counts what it lists on the page's scope and search, whichever is checked: the
  // payload on screen, never the request. The count with an incident alarms by its icon, never
  // by a coloured number (invariant 6); its label already says why, so a screen reader hears the
  // label and the exact count, as the webview's segment reads ("With incident 54").
  const scopes: SegmentedControlOption<InstanceChip>[] = [
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

  return (
    <WidgetShell
      header={
        <>
          <InstancesHeader
            title={title}
            processName={data.processDefinitionName ?? null}
            scopedKey={scopedKey}
            total={paged.total}
            engine={engine}
            filters={listFilters}
          />
          {/* The list's filters under the view's bar, from edge to edge: the scope segments
              first, then the search (the webview's filter bar). Busy while a scope's page
              loads. */}
          <Toolbar>
            <SegmentedControl
              ariaLabel={t("processInstances.scopeLabel")}
              options={scopes}
              value={activeChip}
              onChange={setActiveChip}
              busy={paged.refreshing}
            />
            <SearchField
              value={search}
              onChange={setSearch}
              delayMs={0}
              placeholder={t("processInstances.searchPlaceholder")}
              aria-label={t("processInstances.searchLabel")}
            />
          </Toolbar>
        </>
      }
    >
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
              // The instance whole while there is room; the process gives way first.
              { label: t("processInstances.colBusinessKey"), className: SUBJECT_COLUMN },
              // The state and an open incident on one line in one column, right after the ids as
              // the webview has it, so a narrow chat that scrolls the table sideways still shows it.
              { label: t("processInstances.colState") },
              scopedKey
                ? { label: t("processInstances.colVersion") }
                : { label: t("processInstances.colProcess") },
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
    </WidgetShell>
  )
}

/** The instances route: a view of its own, its bar, the filters and the list. */
export function ProcessInstancesWidget(props: {
  data: ProcessInstancesData | null
  processDefinitionKey?: string
  engine: string
}) {
  return <ProcessInstancesView {...props} />
}
