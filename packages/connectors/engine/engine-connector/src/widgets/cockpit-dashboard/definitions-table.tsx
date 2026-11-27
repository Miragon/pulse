import { useId, useState } from "react"
import {
  Button,
  formatNumber,
  FilterBar,
  ListFooter,
  useDebouncedValue,
  SectionHeading,
} from "@miragon/pulse-ui"
import {
  ViewDataState,
  WidgetShell,
  useViewData,
  type ViewDataResult,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData, EngineHealthData } from "../../view-models.js"
import { buildRows } from "./lib.js"
import { useNav } from "../navigation.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_HEALTH_DATA } from "../../tool-names.js"
import { useT } from "../../messages/use-t.js"
import {
  ProcessDefinitionsTableView,
  type ProcessDefinitionsTableRow,
} from "../process-definitions-table-view.js"

const PAGE_SIZE = 50

/** A process of the overview as its table's row: its tenant and its key's sharing where it has them. */
function tableRowOf(row: ReturnType<typeof buildRows>[number]): ProcessDefinitionsTableRow {
  return {
    id: row.id,
    key: row.key,
    ...(row.tenantId === undefined ? {} : { tenantId: row.tenantId }),
    ...(row.sharesKey ? { sharesKey: row.sharesKey } : {}),
    name: row.name,
    version: row.latestVersion,
    counts: {
      instances: row.instances,
      failedJobs: row.failedJobs,
      totalIncidents: row.totalIncidents,
    },
  }
}

/**
 * Client-side search and paging on purpose: `/process-definition/statistics` is uncapped, has
 * no filter/offset params, and engine-side paging would lose the issue-first sort.
 */
function ProcessDefinitionsSection({ view }: { view: ViewDataResult<CockpitDashboardData> }) {
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
  const { data, loading, error, refetch } = view

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

  const allRows = buildRows(data).map(tableRowOf)
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
        // The row opens its process, its key in its tenant; its instances are the one further
        // action at its end: its key's, narrowed to its tenant (none for a row without one) only
        // where the key holds other processes, as the row's counts are.
        onOpen={(row) =>
          go({
            type: "process-detail",
            processDefinitionKey: row.key,
            ...(row.tenantId === undefined ? {} : { tenantId: row.tenantId }),
            label: row.name ?? undefined,
          })
        }
        renderActions={(row) => (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              go({
                type: "process-instances",
                processDefinitionKey: row.key,
                ...(row.sharesKey ? { onlyTenant: row.tenantId ?? null } : {}),
              })
            }
            aria-label={t("cockpitDefs.viewInstancesAria", { name: row.name ?? row.key })}
          >
            {t("cockpitDefs.instancesAction")}
          </Button>
        )}
      />
      <ListFooter
        shown={rows.length}
        total={filtered.length}
        hasMore={rows.length < filtered.length}
        onLoadMore={() => setLimit((prev) => prev + PAGE_SIZE)}
        noun={(total) => t("cockpitDefs.footerNoun", { count: total })}
      />
    </section>
  )
}

/**
 * The overview's definitions under its verdict, which reads the same engine through a feed of its
 * own (one query, shared): when both fail, the verdict's state stands for the overview, so an
 * engine that does not answer shows one status box, whose Try again reads both again.
 */
export function ProcessDefinitionsTable({
  data,
  engine,
}: {
  data: CockpitDashboardData | null
  engine: string
}) {
  const view = useViewData<CockpitDashboardData>(
    data,
    ["engine:cockpit-overview", engine],
    ENGINE_COCKPIT_OVERVIEW_DATA,
    { engine },
    true,
  )
  const verdict = useViewData<EngineHealthData>(
    null,
    ["engine:health", engine],
    ENGINE_HEALTH_DATA,
    { engine },
    true,
  )
  if (!view.data && view.error && !verdict.data && verdict.error) return null
  return (
    <WidgetShell>
      <ProcessDefinitionsSection view={view} />
    </WidgetShell>
  )
}
