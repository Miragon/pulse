import { useId, useState } from "react"
import {
  formatNumber,
  FilterBar,
  ListFooter,
  useDebouncedValue,
  DrillButton,
  SectionHeading,
} from "@miragon/pulse-ui"
import { ViewDataState, WidgetShell, useViewData } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData } from "../../view-models.js"
import { buildRows } from "./lib.js"
import { useNav } from "../navigation.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { useT } from "../../messages/use-t.js"
import {
  ProcessDefinitionsTableView,
  type ProcessDefinitionsTableRow,
} from "../process-definitions-table-view.js"

const PAGE_SIZE = 50

/**
 * Client-side search and paging on purpose: `/process-definition/statistics` is uncapped, has
 * no filter/offset params, and engine-side paging would lose the issue-first sort.
 */
function ProcessDefinitionsSection({
  data: initialData = null,
  engine,
}: {
  data?: CockpitDashboardData | null
  engine: string
}) {
  const t = useT()
  const go = useNav()
  const headingId = useId()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 300)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [prevSearch, setPrevSearch] = useState(debouncedSearch)
  if (debouncedSearch !== prevSearch) {
    setPrevSearch(debouncedSearch)
    setLimit(PAGE_SIZE)
  }
  // Shares the health KPI's query key, so one fetch.
  const { data, loading, error, refetch } = useViewData<CockpitDashboardData>(
    initialData,
    ["engine:cockpit-overview", engine],
    ENGINE_COCKPIT_OVERVIEW_DATA,
    { engine },
    true,
  )

  if (!data) {
    return (
      <ViewDataState
        loading={loading}
        error={error}
        onRetry={refetch}
        loadingText={t("cockpitDefs.loading")}
        emptyText={t("cockpitDefs.noData")}
      />
    )
  }

  const allRows: ProcessDefinitionsTableRow[] = buildRows(data).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    version: row.latestVersion,
    counts: {
      instances: row.instances,
      failedJobs: row.failedJobs,
      totalIncidents: row.totalIncidents,
    },
  }))
  const filtered = debouncedSearch
    ? allRows.filter(
        (row) =>
          (row.name ?? "").toLowerCase().includes(debouncedSearch) ||
          row.key.toLowerCase().includes(debouncedSearch),
      )
    : allRows
  const rows = filtered.slice(0, limit)

  return (
    // A real heading on the same step as the failure clusters above it (#322 U27): the compact
    // section caption (13 px at 600), never above the 13 px view bar.
    <section aria-labelledby={headingId}>
      <SectionHeading
        as="h2"
        id={headingId}
        title={t("cockpitDefs.heading")}
        hint={t("cockpitDefs.deployedHint", { count: formatNumber(allRows.length) })}
        className="mb-2"
      />
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("cockpitDefs.searchPlaceholder")}
        searchAriaLabel={t("cockpitDefs.searchLabel")}
        chips={[]}
        onChipToggle={() => undefined}
        // A bar inside the content reaches the card's edges, as a view's tab bar does.
        className="-mx-gutter mb-2"
      />
      <ProcessDefinitionsTableView
        rows={rows}
        ariaLabel={t("cockpitDefs.tableAria")}
        emptyText={debouncedSearch ? t("cockpitDefs.noMatch") : t("cockpitDefs.emptyState")}
        renderActions={(row) => (
          <>
            <DrillButton
              size="xs"
              onDrill={() => go({ type: "process-instances", processDefinitionKey: row.key })}
              ariaLabel={t("cockpitDefs.viewInstancesAria", { name: row.name ?? row.key })}
            >
              {t("cockpitDefs.instancesAction")}
            </DrillButton>
            <DrillButton
              size="xs"
              onDrill={() =>
                go({
                  type: "process-detail",
                  processDefinitionKey: row.key,
                  label: row.name ?? undefined,
                })
              }
              ariaLabel={t("cockpitDefs.openDetailAria", { name: row.name ?? row.key })}
            >
              {t("cockpitDefs.openAction")}
            </DrillButton>
          </>
        )}
      />
      <ListFooter
        shown={rows.length}
        total={filtered.length}
        hasMore={rows.length < filtered.length}
        onLoadMore={() => setLimit((prev) => prev + PAGE_SIZE)}
        noun={t("cockpitDefs.footerNoun")}
      />
    </section>
  )
}

export function ProcessDefinitionsTable({
  data,
  engine,
}: {
  data: CockpitDashboardData | null
  engine: string
}) {
  return (
    <WidgetShell>
      <ProcessDefinitionsSection data={data} engine={engine} />
    </WidgetShell>
  )
}
