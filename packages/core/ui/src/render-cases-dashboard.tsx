import {
  describePageError,
  Panel,
  PanelGrid,
  SectionState,
  SectionStateGroup,
  Skeleton,
  TableEmptyState,
  useUiMessages,
  type PageErrorCode,
} from "./index.js"
import type { RenderCase } from "./render-cases-primitives.js"

/**
 * SSR render cases for the dashboard blocks (Miragon/pulse#664), aggregated by `render-cases.tsx`:
 * a section's read in each of its states (loading, a failure, nothing found, data, a refresh that
 * failed over data) and the panels of a page, so the render half of the i18n guard sees every
 * word they bring. `FreshnessStamp` has no case here: its title is a formatted instant, the
 * formatters' words, which `FreshnessStamp.test.tsx` holds in both languages.
 */

const noop = (): void => {}

/** A section whose read failed with a page error, worded from the catalog in context. */
function FailedSection({
  code,
  detail,
  connector,
  data,
}: {
  code: PageErrorCode
  detail: string
  connector: string
  data?: string[]
}) {
  const messages = useUiMessages()
  return (
    <SectionState
      state={{ error: describePageError({ code, detail }, { messages, connector }), data }}
      onRetry={noop}
    >
      {(rows) => (
        <ul>
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      )}
    </SectionState>
  )
}

export const DASHBOARD_RENDER_CASES: RenderCase[] = [
  {
    name: "SectionState (loading)",
    marker: "RC:SectionState-loading",
    render: () => (
      <SectionState
        state={{ loading: true }}
        onRetry={noop}
        skeleton={<Skeleton className="h-24 w-full">RC:SectionState-loading</Skeleton>}
      >
        {() => null}
      </SectionState>
    ),
  },
  {
    name: "SectionState (error)",
    marker: "RC:SectionState-error",
    render: () => (
      <FailedSection code="unavailable" detail="RC:SectionState-error" connector="Pulse" />
    ),
  },
  {
    name: "SectionState (permanent error)",
    marker: "RC:SectionState-refused",
    render: () => (
      <FailedSection code="not_allowed" detail="RC:SectionState-refused" connector="Pulse" />
    ),
  },
  {
    name: "SectionState (empty)",
    marker: "RC:SectionState-empty",
    render: () => (
      <SectionState
        state={{ data: [] as string[] }}
        onRetry={noop}
        empty={<TableEmptyState>RC:SectionState-empty</TableEmptyState>}
      >
        {(rows) => rows.join(", ")}
      </SectionState>
    ),
  },
  {
    name: "SectionState (data)",
    marker: "RC:SectionState-data",
    render: () => (
      <SectionState
        state={{ loading: true, data: { label: "RC:SectionState-data" } }}
        onRetry={noop}
      >
        {(data) => <p>{data.label}</p>}
      </SectionState>
    ),
  },
  {
    name: "SectionState (failed refresh)",
    marker: "RC:SectionState-kept",
    render: () => (
      <FailedSection
        code="tool_error"
        detail="Engine answered 503"
        connector="Pulse"
        data={["RC:SectionState-kept"]}
      />
    ),
  },
  {
    name: "SectionStateGroup",
    marker: "RC:SectionStateGroup",
    render: () => (
      <SectionStateGroup>
        <FailedSection code="needs_reauth" detail="RC:SectionStateGroup" connector="Pulse" />
        <FailedSection code="needs_reauth" detail="RC:SectionStateGroup" connector="Pulse" />
      </SectionStateGroup>
    ),
  },
  {
    name: "PanelGrid",
    marker: "RC:PanelGrid",
    render: () => (
      <PanelGrid columns={3}>
        <Panel id="per-day" title="RC:PanelGrid" hint="all versions">
          <p>Started per day</p>
        </Panel>
        <Panel title="Outcomes" hint="last 30 days" trailing={<span>Legend</span>}>
          <p>End events</p>
        </Panel>
        <Panel title="Diagram" as="h3" wide>
          <p>The process</p>
        </Panel>
      </PanelGrid>
    ),
  },
]
