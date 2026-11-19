import type { WaitRow } from "../../core/protocol/index.js"
import { DataTable, type Column } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { NoValue } from "../components/no-value.js"
import { TimeLabels } from "../format/time-labels.js"
import { CalledInstanceLink, LinkButton } from "./called-instance-link.js"

export interface WaitingTabProps {
  readonly waitStates: readonly WaitRow[]
  readonly elementName: (elementId: string) => string
  readonly onShowElement?: ((elementId: string) => void) | undefined
}

export function TimeCell({
  iso,
  precise = false,
}: {
  readonly iso: string | undefined
  readonly precise?: boolean
}) {
  if (iso === undefined) {
    return <NoValue />
  }
  return (
    <span className="tabular-nums" title={TimeLabels.tooltip(iso)}>
      {precise ? TimeLabels.precise(iso) : TimeLabels.clock(iso)}
      <span className="text-muted-foreground"> · {TimeLabels.relative(iso)}</span>
    </span>
  )
}

function ElementCell({
  row,
  elementName,
  onShowElement,
}: {
  readonly row: WaitRow
  readonly elementName: (elementId: string) => string
  readonly onShowElement: ((elementId: string) => void) | undefined
}) {
  const name =
    row.elementName ??
    (row.calledInstance === undefined ? elementName(row.elementId) : row.elementId)
  if (row.calledInstance === undefined && onShowElement !== undefined) {
    return (
      <LinkButton
        title="Show on the diagram"
        onClick={() => {
          onShowElement(row.elementId)
        }}
      >
        {name}
      </LinkButton>
    )
  }
  if (row.calledInstance === undefined) {
    return <span>{name}</span>
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span className="truncate">{name}</span>
      <span className="text-muted-foreground">
        in <CalledInstanceLink link={row.calledInstance} />
      </span>
    </span>
  )
}

export function WaitingTab({ waitStates, elementName, onShowElement }: WaitingTabProps) {
  const columns: readonly Column<WaitRow>[] = [
    {
      key: "element",
      label: "Waiting at",
      render: (row) => (
        <ElementCell row={row} elementName={elementName} onShowElement={onShowElement} />
      ),
    },
    { key: "kind", label: "Kind", render: (row) => row.kindLabel },
    { key: "detail", label: "Detail", render: (row) => row.detail ?? <NoValue /> },
    { key: "since", label: "Since", render: (row) => <TimeCell iso={row.since} /> },
    { key: "due", label: "Due", render: (row) => <TimeCell iso={row.dueAt} /> },
  ]
  return (
    <DataTable
      label="Waiting at"
      resizeId="waiting"
      columns={columns}
      rows={waitStates}
      rowKey={(row) =>
        `${row.calledInstance?.instanceId ?? ""}:${row.elementId}:${row.since ?? ""}`
      }
      empty={<EmptyHint text="This instance isn't waiting anywhere." />}
    />
  )
}
