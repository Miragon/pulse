import type { ScreenIdProps, ScreenSlots, ScreenTableProps } from "@miragon/pulse-blocks"
import { NamedId } from "@miragon/pulse-ui"
import { DataTable } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { useHost } from "../host/host-context.js"

function ScreenTable<Row>(props: ScreenTableProps<Row>) {
  const host = useHost()
  const { name, label, columns, rows, rowKey, onOpen, rowLabel, copyOf, empty } = props
  const { emptyAction, footer, onToggle } = props
  return (
    <DataTable
      label={label}
      resizeId={name}
      columns={columns.map((column) => ({
        key: column.key,
        label: column.label,
        render: column.cell,
        ...(column.header === undefined ? {} : { header: column.header }),
        ...(column.width === undefined ? {} : { width: column.width }),
      }))}
      rows={rows}
      rowKey={rowKey}
      actions={{
        onActivate: (row, toSide) => {
          onOpen(row, { toSide })
        },
        rowLabel,
        onCopy: (row) => {
          const copy = copyOf(row)
          host.post({ type: "copy", text: copy.text, label: copy.label })
        },
        ...(onToggle === undefined ? {} : { onToggle }),
      }}
      empty={
        <EmptyHint text={empty} {...(emptyAction === undefined ? {} : { action: emptyAction })} />
      }
      {...(footer === undefined ? {} : { footer })}
    />
  )
}

function ScreenId({ id, name }: ScreenIdProps) {
  return <NamedId name={name} id={id} layout="inline" />
}

export function useProcessSlots(): ScreenSlots {
  const host = useHost()
  return {
    Table: ScreenTable,
    Id: ScreenId,
    onOpen: (target, how) => {
      if (target.kind === "process") {
        const { bpmnProcessId, tenantId } = target
        host.post({
          type: "openProcess",
          bpmnProcessId,
          ...(tenantId === undefined ? {} : { tenantId }),
          toSide: how.toSide,
        })
      } else if (target.kind === "instance") {
        host.post({ type: "openInstance", instanceId: target.instanceId, toSide: how.toSide })
      }
    },
  }
}
