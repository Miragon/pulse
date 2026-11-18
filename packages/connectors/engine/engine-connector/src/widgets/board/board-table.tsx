import type { BoardTableProps } from "@miragon/pulse-blocks"
import { Td } from "@miragon/pulse-ui"
import { ListRow, ListTable } from "@miragon/pulse-widget-shell/widgets"

/**
 * The cockpit's table of a tile: widget-shell's `ListTable` (its scroll region, the inline fit,
 * which shows the rows the card has room for and offers the rest) whose rows open their view here
 * on a click or Enter and copy their id on Ctrl or Cmd with C, one row convention with the
 * webview's table slot; a row that opens none (an engine no view of the cockpit reads) is a plain
 * row. The tile owns the columns, the cells, the words and the notes under the rows, and what a
 * row's copy holds: its toast names it, and where it is no id (an incident's message) the rows tell
 * a screen reader so (`copyHint`).
 */
export function BoardTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  onOpen,
  opens,
  rowLabel,
  copyOf,
  copyHint,
  empty,
  footer,
}: BoardTableProps<Row>) {
  return (
    <div className="flex min-w-0 flex-col">
      {rows.length === 0 ? (
        empty
      ) : (
        <ListTable
          ariaLabel={label}
          columns={columns.map((column) => ({ label: column.label }))}
          copyHint={copyHint}
        >
          {rows.map((row) => (
            <ListRow
              key={rowKey(row)}
              label={rowLabel(row)}
              onOpen={opens?.(row) === false ? undefined : () => onOpen(row, { toSide: false })}
              copy={copyOf(row).text}
              copyLabel={copyOf(row).label}
            >
              {/* One line per cell, as DataTable draws a row: the row keeps the row height and the
                  table scrolls in its region where the card is short of room. */}
              {columns.map((column) => (
                <Td key={column.key} className="whitespace-nowrap">
                  {column.cell(row)}
                </Td>
              ))}
            </ListRow>
          ))}
        </ListTable>
      )}
      {/* The notes under the rows as pulse-ui's DataTable sets a footer, which the webview's
          table slot renders: centred in the cell gutter, under an empty table too. */}
      {footer !== undefined && <div className="px-cell flex justify-center py-2">{footer}</div>}
    </div>
  )
}
