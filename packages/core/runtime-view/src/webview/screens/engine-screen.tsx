import { CountFigure, NamedId, Toolbar } from "@miragon/pulse-ui"
import { RotateCcwIcon } from "lucide-react"
import type { ReactNode } from "react"
import type {
  EngineView,
  ProcessListFilter,
  ProcessRow,
  ProcessScope,
} from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { DataTable, type Column } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { HeaderButton } from "../components/header-button.js"
import { ScopeSegments, type ScopeOption } from "../components/scope-segments.js"
import { SearchField } from "../components/search-field.js"
import { WebUiButton } from "../components/web-ui-button.js"
import { CountLabels } from "../format/count-labels.js"
import { useHost } from "../host/host-context.js"
import { ScreenFrame } from "./screen-frame.js"

export interface EngineScreenProps {
  readonly view: EngineView
  readonly freshness: Freshness
  readonly problem?: ReactNode
}

const PROCESS_SCOPES: readonly ScopeOption<ProcessScope>[] = [
  { scope: "all", label: "All" },
  { scope: "withIncident", label: "With incident" },
]

function IncidentCount({ count }: { readonly count: number }) {
  const text = CountLabels.exact(count)
  return (
    <span data-part="incident-count" data-tone={count > 0 ? "danger" : undefined}>
      {count > 0 ? (
        <CountFigure situation="openIncident" label="Has open incidents">
          {text}
        </CountFigure>
      ) : (
        <CountFigure>{text}</CountFigure>
      )}
    </span>
  )
}

const COLUMNS: readonly Column<ProcessRow>[] = [
  {
    key: "process",
    label: "Process",
    render: (row) => <NamedId name={row.name} id={row.bpmnProcessId} layout="inline" />,
  },
  { key: "version", label: "Latest version", render: (row) => `v${row.latestVersion}` },
  {
    key: "running",
    label: "Running",
    render: (row) => <CountFigure>{CountLabels.exact(row.running)}</CountFigure>,
  },
  {
    key: "withIncident",
    label: "With incident",
    render: (row) => <IncidentCount count={row.withIncident} />,
  },
]

function ProcessFilterBar({
  view,
  refreshing,
}: {
  readonly view: EngineView
  readonly refreshing: boolean
}) {
  const host = useHost()
  const { scope } = view.filter
  const filter = (next: ProcessListFilter): void => {
    host.post({ type: "filterProcesses", filter: next })
  }
  return (
    <div className="contents" data-part="filter-bar">
      <Toolbar summary={view.summary}>
        <ScopeSegments
          label="Show processes"
          options={PROCESS_SCOPES}
          checked={scope}
          counts={view.scopeCounts}
          busy={refreshing}
          onSelect={(next) => {
            filter({ ...view.filter, scope: next })
          }}
        />
        <SearchField
          applied={view.filter.search ?? ""}
          label="Search by name or BPMN process ID"
          placeholder="Name or key"
          onSearch={(search) => {
            filter(search === "" ? { scope } : { scope, search })
          }}
        />
      </Toolbar>
    </div>
  )
}

export function EngineScreen({ view, freshness, problem }: EngineScreenProps) {
  const host = useHost()
  return (
    <div className={ScreenFrame.WITH_STRIPS}>
      <ContextBar
        subject="engine"
        title={view.engine.name}
        engine={view.engine}
        freshness={freshness}
        actions={
          <>
            <HeaderButton
              icon={RotateCcwIcon}
              label="Refresh"
              title={`Read ${view.engine.name} again`}
              intent={{ type: "refresh" }}
            />
            <WebUiButton link={view.webUi} />
          </>
        }
      >
        {view.engine.product !== undefined && (
          <span className="min-w-0 truncate max-[900px]:hidden" data-part="context-key">
            {view.engine.product}
          </span>
        )}
      </ContextBar>
      <div className={ScreenFrame.STRIPS} data-part="strips">
        {problem}
      </div>
      <section className={ScreenFrame.LIST_REGION} aria-label="Process list">
        <ProcessFilterBar view={view} refreshing={freshness.kind === "refreshing"} />
        <DataTable
          label="Processes"
          resizeId="processes"
          columns={COLUMNS}
          rows={view.processes}
          rowKey={(row) => row.bpmnProcessId}
          actions={{
            onActivate: (row, toSide) => {
              host.post({ type: "openProcess", bpmnProcessId: row.bpmnProcessId, toSide })
            },
            onCopy: (row) => {
              host.post({ type: "copy", text: row.bpmnProcessId, label: "BPMN process ID" })
            },
          }}
          empty={<EmptyHint text={view.emptyText} />}
        />
      </section>
    </div>
  )
}
