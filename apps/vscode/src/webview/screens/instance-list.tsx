import type { DefinitionView, InstanceListFilter, InstanceRow } from "../../core/protocol/index.js"
import { DataTable } from "../components/data-table.js"
import type { Column } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { IdText } from "../components/id-text.js"
import { IncidentFlag, StateLabel } from "../components/state-label.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"
import { InstanceFilter } from "./instance-filter.js"
import { InstanceFilterBar } from "./instance-filter-bar.js"
import { useSelectionColumn } from "./instance-selection.js"
import { SelectionBar } from "./selection-bar.js"

function StartedCell({ row }: { readonly row: InstanceRow }) {
  if (row.startedAt === undefined) {
    return <span class="muted">–</span>
  }
  return (
    <span title={TimeLabels.tooltip(row.startedAt)}>
      {TimeLabels.clock(row.startedAt)}
      <span class="muted"> · {TimeLabels.relative(row.startedAt)}</span>
    </span>
  )
}

const COLUMNS: readonly Column<InstanceRow>[] = [
  {
    key: "id",
    label: "ID",
    render: (row) => <IdText id={row.id} shortId={row.shortId} label="instance ID" />,
  },
  {
    key: "businessKey",
    label: "Business key",
    render: (row) => row.businessKey ?? <span class="muted">–</span>,
  },
  {
    key: "state",
    label: "State",
    render: (row) => (
      <span class="state-cell">
        <StateLabel state={row.state} />
        {row.hasIncident && <IncidentFlag />}
      </span>
    ),
  },
  { key: "started", label: "Started", render: (row) => <StartedCell row={row} /> },
]

const SCOPE_WORDS: Readonly<Record<InstanceListFilter["scope"], string>> = {
  running: "No running instances",
  withIncident: "No instances with an incident",
  ended: "No ended instances",
  all: "No instances",
}

function NoMatches({
  filter,
  onFilter,
}: {
  readonly filter: InstanceListFilter
  readonly onFilter: (filter: InstanceListFilter) => void
}) {
  if (filter.variables === undefined) {
    return <EmptyHint text="No instances match this filter." />
  }
  return (
    <EmptyHint
      text={`${SCOPE_WORDS[filter.scope]} match these variable conditions.`}
      action={{
        label: "Clear variable conditions",
        onClick: () => {
          onFilter(InstanceFilter.withoutVariables(filter))
        },
      }}
    />
  )
}

export interface InstanceListProps {
  readonly view: DefinitionView
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilter) => void
  readonly refreshing: boolean
  readonly busy: boolean
}

export function InstanceList({ view, elementName, onFilter, refreshing, busy }: InstanceListProps) {
  const host = useHost()
  const selectionColumn = useSelectionColumn(view.instances, view.selection?.count ?? 0)
  const columns = selectionColumn === undefined ? COLUMNS : [selectionColumn, ...COLUMNS]
  const footer = view.hasMoreInstances ? (
    <button
      type="button"
      class="button button--ghost"
      disabled={busy}
      title={busy ? "Wait until the refresh is done" : undefined}
      onClick={() => {
        host.post({ type: "loadMoreInstances" })
      }}
    >
      Load more
    </button>
  ) : undefined
  return (
    <section class="list-region" aria-label="Instances">
      <InstanceFilterBar
        filter={view.filter}
        counts={view.scopeCounts}
        refreshing={refreshing}
        version={view.selectedVersion}
        historyNote={view.historyNote}
        variableLabels={view.variableLabels}
        elementName={elementName}
        onFilter={onFilter}
      />
      {view.selection !== undefined && <SelectionBar selection={view.selection} />}
      <DataTable
        label="Instances"
        resizeId="instances"
        columns={columns}
        rows={view.instances}
        rowKey={(row) => row.id}
        actions={{
          onActivate: (row, toSide) => {
            host.post({ type: "openInstance", instanceId: row.id, toSide })
          },
          onCopy: (row) => {
            host.post({ type: "copy", text: row.id, label: "instance ID" })
          },
          onToggle: (row) => {
            if (row.selectable === true) {
              host.post({
                type: "toggleInstances",
                ids: [row.id],
                selected: row.selected !== true,
              })
            }
          },
        }}
        empty={<NoMatches filter={view.filter} onFilter={onFilter} />}
        footer={footer}
      />
    </section>
  )
}
