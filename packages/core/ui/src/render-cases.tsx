import type { ReactElement } from "react"
import { ExternalLink, Inbox } from "lucide-react"
import {
  Button,
  CountPill,
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
  SearchField,
  SectionHeading,
  StatusBadge,
  ToastProvider,
  useLocale,
  WidgetHeader,
} from "./index.js"
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

export const RENDER_CASES: RenderCase[] = [
  ...PRIMITIVE_RENDER_CASES,

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
            value: 7,
            tone: "danger",
            trend: "+2 vs yesterday",
            trendDirection: "up",
          },
          { label: "Done", value: 12, fraction: "/19", tone: "success" },
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
    name: "Field",
    marker: "RC:Field",
    render: () => (
      <Field label="RC:Field" hint="Names are case sensitive." error="Enter a name.">
        <Input defaultValue="orderId" />
      </Field>
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
