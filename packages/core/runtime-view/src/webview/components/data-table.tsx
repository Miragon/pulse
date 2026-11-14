import type { KeyboardEvent, ReactNode } from "react"
import {
  DataTable as KitDataTable,
  type DataTableColumn,
  type DataTableSelection,
} from "@miragon/pulse-ui"
import { useColumnSizing } from "./column-sizing.js"
import { TableKeys } from "./table-keys.js"

export interface Column<Row> {
  readonly key: string
  readonly label: string
  readonly render: (row: Row) => ReactNode
  readonly header?: ReactNode
  readonly width?: number
}

interface RowActions<Row> {
  readonly onActivate: (row: Row, toSide: boolean) => void
  readonly onCopy?: (row: Row) => void
  readonly onToggle?: (row: Row) => void
}

export interface DataTableProps<Row> {
  readonly label: string
  readonly columns: readonly Column<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row) => string
  readonly actions?: RowActions<Row>
  readonly empty: ReactNode
  readonly skeletonRows?: number
  readonly footer?: ReactNode
  readonly resizeId?: string
  readonly selection?: DataTableSelection<Row>
}

class TableColumns {
  static kit<Row>(column: Column<Row>): DataTableColumn<Row> {
    const caption = <span data-part="column-label">{column.label}</span>
    return {
      key: column.key,
      name: column.label,
      label: column.header ?? caption,
      cell: column.render,
      ...(column.header === undefined ? {} : { plain: true }),
      ...(column.width === undefined ? {} : { width: column.width }),
    }
  }

  static sized<Row>(columns: readonly Column<Row>[]): string[] {
    return columns
      .slice(0, -1)
      .filter((column) => column.width === undefined && column.header === undefined)
      .map((column) => column.key)
  }

  static isFixed(widths: Readonly<Record<string, number>> | undefined, keys: string[]): boolean {
    return widths !== undefined && keys.length > 0 && keys.every((key) => key in widths)
  }
}

function useToggleKey<Row>(props: DataTableProps<Row>) {
  const toggle = props.actions?.onToggle
  const copies = props.actions?.onCopy !== undefined
  return (event: KeyboardEvent<HTMLDivElement>): void => {
    const row = event.target instanceof HTMLTableRowElement ? event.target : null
    if (row !== null && copies && TableKeys.isCopy(event)) {
      event.stopPropagation()
      return
    }
    if (toggle === undefined || row === null || event.key !== " " || props.selection) {
      return
    }
    const index = TableKeys.indexOf(row)
    const target = props.rows[index]
    if (target !== undefined) {
      event.preventDefault()
      toggle(target)
    }
  }
}

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { label, columns, rows, rowKey, actions, skeletonRows, empty, footer, resizeId } = props
  const sized = TableColumns.sized(columns)
  const sizing = useColumnSizing(
    resizeId,
    columns.filter((column) => column.width === undefined).map((column) => column.key),
  )
  const fixed = resizeId !== undefined && TableColumns.isFixed(sizing.widths, sized)
  const onToggleKey = useToggleKey(props)
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-part="data-table"
      data-state={fixed ? "fixed" : "auto"}
      onKeyDown={onToggleKey}
    >
      <KitDataTable<Row>
        label={label}
        className="min-h-0 flex-1"
        columns={columns.map((column) => TableColumns.kit(column))}
        rows={rows}
        rowKey={rowKey}
        {...(actions === undefined
          ? {}
          : {
              onActivate: (row: Row, how: { toSide: boolean }) => {
                actions.onActivate(row, how.toSide)
              },
            })}
        {...(actions?.onCopy === undefined ? {} : { onCopy: actions.onCopy })}
        {...(props.selection === undefined ? {} : { selection: props.selection })}
        {...(skeletonRows === undefined ? {} : { skeletonRows })}
        {...(resizeId === undefined ? {} : { sizing })}
        empty={<div data-part="table-empty">{empty}</div>}
        {...(footer === undefined ? {} : { footer: <div data-part="table-footer">{footer}</div> })}
      />
    </div>
  )
}
