import type { ReactElement } from "react"
import { ExternalLink, Inbox } from "lucide-react"
import {
  Button,
  CountFigure,
  CountPill,
  DataTable,
  DrillButton,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  GroupCard,
  KpiGrid,
  KpiGridSkeleton,
  Input,
  ListFooter,
  LivePill,
  LocaleProvider,
  PagedListFooter,
  rowSelection,
  SearchField,
  SectionHeading,
  SegmentedControl,
  StatusBadge,
  ToastProvider,
  useColumnSizing,
  useLocale,
  WidgetHeader,
  type DataTableColumn,
} from "./index.js"
import { BLOCK_RENDER_CASES } from "./render-cases-blocks.js"
import { PRIMITIVE_RENDER_CASES, type RenderCase } from "./render-cases-primitives.js"

export type { RenderCase } from "./render-cases-primitives.js"

/**
 * SSR render cases for every kit primitive and component. DATA module, not a
 * test: `i18n-coverage.test.tsx` renders each case via `react-dom/server`'s
 * `renderToStaticMarkup` (SSR is the house render path) in a marked locale.
 *
 * Each case mounts the component with minimal realistic props and, where the
 * markup can carry one, a distinctive `marker` string. The primitive cases
 * live in `render-cases-primitives.tsx` (file-length budget); this module
 * aggregates them with the composed and provider cases.
 */

const noop = (): void => {}

/** Proves LocaleProvider actually provides: reads the locale from context. */
function LocaleProbe(): ReactElement {
  const locale = useLocale()
  return <span>RC:LocaleProvider {locale}</span>
}

interface CaseRow {
  name: string
  state: string
  choose: string
}

/** A table with every kit word it has: the sizing grips and menus, the selection head. */
function SizedTable({
  label,
  columns,
  rows,
  footer,
}: {
  label: string
  columns: DataTableColumn<CaseRow>[]
  rows: CaseRow[]
  footer: ReactElement
}) {
  const sizing = useColumnSizing()
  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.name}
      sizing={sizing}
      selection={rowSelection<CaseRow>({
        isSelected: () => false,
        onToggle: noop,
        all: "indeterminate",
        onToggleAll: noop,
        rowLabel: (row) => row.choose,
      })}
      onActivate={noop}
      footer={footer}
    />
  )
}

export const RENDER_CASES: RenderCase[] = [
  ...PRIMITIVE_RENDER_CASES,
  ...BLOCK_RENDER_CASES,

  // ── Composed components ──
  {
    name: "KpiGrid",
    marker: "RC:KpiGrid",
    render: () => (
      <KpiGrid
        boxed
        header={{ label: "RC:KpiGrid", badge: "live" }}
        cells={[
          {
            label: "Open",
            value: (
              <CountFigure situation="openIncident" label="Has open incidents">
                7
              </CountFigure>
            ),
            trend: "+2 vs yesterday",
            trendDirection: "up",
          },
          { label: "Done", value: 12, fraction: "/19" },
          { label: "Total", value: 19, onClick: noop, actionHint: "Shows all orders" },
        ]}
      />
    ),
  },
  {
    // A skeleton has no text; the marker is its busy state.
    name: "KpiGridSkeleton",
    marker: 'aria-busy="true"',
    render: () => <KpiGridSkeleton cells={4} boxed />,
  },
  {
    name: "LivePill",
    marker: "RC:LivePill",
    render: () => <LivePill tone="success">RC:LivePill</LivePill>,
  },
  {
    name: "CountPill",
    marker: "RC:CountPill",
    render: () => <CountPill tone="warning">RC:CountPill</CountPill>,
  },
  {
    name: "StatusBadge",
    marker: "RC:StatusBadge",
    render: () => <StatusBadge tone="warning">RC:StatusBadge</StatusBadge>,
  },
  {
    name: "SectionHeading",
    marker: "RC:SectionHeading",
    render: () => <SectionHeading title="RC:SectionHeading" hint="3 shown" />,
  },
  {
    name: "WidgetHeader",
    marker: "RC:WidgetHeader",
    render: () => (
      <WidgetHeader
        as="h2"
        title="RC:WidgetHeader"
        badge={<StatusBadge tone="info">Running</StatusBadge>}
        sub={<LivePill>Live</LivePill>}
        actions={
          <Button size="sm" variant="ghost" onClick={noop}>
            Refresh
          </Button>
        }
      />
    ),
  },
  {
    name: "GroupCard",
    marker: "RC:GroupCard",
    render: () => (
      <GroupCard expanded onToggle={noop} summary={<div>RC:GroupCard</div>}>
        <div>Expanded body row</div>
      </GroupCard>
    ),
  },
  {
    // The search marker lands in the input's value attribute.
    name: "FilterBar",
    marker: "RC:FilterBar",
    render: () => (
      <FilterBar
        search="RC:FilterBar"
        searchPlaceholder="Filter tasks…"
        onSearchChange={noop}
        chips={[
          { id: "high", label: "high", count: 2, active: true },
          { id: "low", label: "low" },
        ]}
        onChipToggle={noop}
      />
    ),
  },
  {
    // Text in it, so the clear button renders with its catalog name; the placeholder and the
    // field's name come from the catalog too.
    name: "SearchField",
    marker: "RC:SearchField",
    render: () => <SearchField value="RC:SearchField" onChange={noop} />,
  },
  {
    // Counts exact, capped and unknown, their words from the catalog; a note as a title.
    name: "SegmentedControl",
    marker: "RC:SegmentedControl",
    render: () => (
      <SegmentedControl
        ariaLabel="Order scope"
        options={[
          { value: "all", label: "RC:SegmentedControl", count: 12 },
          {
            value: "open",
            label: "Open",
            count: { atLeast: 500 },
            note: "Counted up to 500 orders.",
          },
          { value: "late", label: "Late", count: null, tone: "warning", countLabel: "late orders" },
          { value: "claims", label: "Claims", count: undefined },
        ]}
        value="all"
        busy
        onChange={noop}
      />
    ),
  },
  {
    name: "Field",
    marker: "RC:Field",
    render: () => (
      <Field label="RC:Field" hint="Names are case sensitive." error="Enter a name.">
        <Input defaultValue="orderId" />
      </Field>
    ),
  },
  {
    name: "DataTable",
    marker: "RC:DataTable",
    render: () => (
      <SizedTable
        label="RC:DataTable"
        columns={[
          { key: "name", label: "Order", cell: (row) => row.name },
          { key: "state", label: "State", cell: (row) => row.state },
          { key: "rest", label: "Note", cell: () => null },
        ]}
        rows={[{ name: "Order 1001", state: "Running", choose: "Choose order 1001" }]}
        footer={<Button size="sm">Load more orders</Button>}
      />
    ),
  },
  {
    name: "DrillButton",
    marker: "RC:DrillButton",
    render: () => (
      <DrillButton onDrill={noop} icon={<ExternalLink />} size="sm" ariaLabel="Open order o-1001">
        RC:DrillButton
      </DrillButton>
    ),
  },
  {
    name: "ListFooter",
    marker: "of 42 tasks",
    render: () => <ListFooter shown={8} total={42} hasMore onLoadMore={noop} noun="tasks" />,
  },
  {
    name: "PagedListFooter",
    marker: "of 3 orders",
    render: () => (
      <PagedListFooter
        paged={{
          items: ["o-1", "o-2"],
          total: 3,
          hasMore: true,
          loadMore: noop,
          refreshing: true,
          firstPage: {},
          loadMoreError: new Error("HTTP 503"),
        }}
        noun="orders"
      />
    ),
  },

  // ── Feedback and states ──
  {
    // The provider renders its children plus the (empty) live region.
    name: "ToastProvider",
    marker: "RC:ToastProvider",
    render: () => (
      <ToastProvider>
        <div>RC:ToastProvider</div>
      </ToastProvider>
    ),
  },
  {
    name: "EmptyState",
    marker: "RC:EmptyState",
    render: () => (
      <EmptyState
        icon={<Inbox />}
        title="RC:EmptyState"
        description="No orders in this period."
        action={
          <Button size="sm" onClick={noop}>
            New order
          </Button>
        }
      />
    ),
  },
  {
    name: "ErrorState",
    marker: "RC:ErrorState",
    render: () => (
      <ErrorState
        title="RC:ErrorState"
        description="Check the connection and try again."
        details="HTTP 503 Service Unavailable"
        onRetry={noop}
      />
    ),
  },

  // ── Providers ──
  {
    name: "LocaleProvider",
    marker: "RC:LocaleProvider de",
    render: () => (
      <LocaleProvider locale="de">
        <LocaleProbe />
      </LocaleProvider>
    ),
  },
]
