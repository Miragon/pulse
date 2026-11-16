import type { BoardIdProps, BoardSlots, BoardTableProps, BoardTarget } from "@miragon/pulse-blocks"
import type { WebviewIntent } from "../../../core/protocol/index.js"
import { DataTable } from "../../components/data-table.js"
import { IdLabels } from "../../format/id-labels.js"
import { useHost } from "../../host/host-context.js"
import { BoardDiagram } from "./board-diagram.js"

class BoardIntents {
  static open(target: BoardTarget, toSide: boolean): WebviewIntent {
    if (target.kind === "instance") {
      return {
        type: "openBoardInstance",
        engine: target.engine,
        instanceId: target.instanceId,
        toSide,
      }
    }
    if (target.bpmnProcessId === undefined) {
      return { type: "openBoardEngine", engine: target.engine, toSide }
    }
    return {
      type: "openBoardProcess",
      engine: target.engine,
      bpmnProcessId: target.bpmnProcessId,
      filter: target.filter,
      toSide,
    }
  }
}

function BoardTable<Row>(props: BoardTableProps<Row>) {
  const host = useHost()
  const { label, columns, rows, rowKey, onOpen, copyOf, empty, footer } = props
  return (
    <DataTable
      label={label}
      columns={columns.map((column) => ({
        key: column.key,
        label: column.label,
        render: column.cell,
      }))}
      rows={rows}
      rowKey={rowKey}
      actions={{
        onActivate: (row, toSide) => {
          onOpen(row, { toSide })
        },
        onCopy: (row) => {
          const copy = copyOf(row)
          host.post({ type: "copy", text: copy.text, label: copy.label })
        },
      }}
      empty={empty}
      footer={footer}
    />
  )
}

function BoardId({ id }: BoardIdProps) {
  return <code className="text-muted-foreground">{IdLabels.short(id)}</code>
}

export function useBoardSlots(): BoardSlots {
  const host = useHost()
  return {
    Table: BoardTable,
    Id: BoardId,
    Diagram: BoardDiagram,
    onOpen: (target, how) => {
      host.post(BoardIntents.open(target, how.toSide))
    },
    onOpenFile: () => {
      host.post({ type: "openBoardFile" })
    },
    opensToSide: true,
  }
}
