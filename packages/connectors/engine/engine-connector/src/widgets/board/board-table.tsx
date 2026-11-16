import type { BoardTableProps } from "@miragon/pulse-blocks"
import { DrillButton, Td } from "@miragon/pulse-ui"
import { ListTable } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/use-t.js"

/**
 * The cockpit's table of a tile: widget-shell's `ListTable` (its scroll region, the inline fit,
 * which shows the rows the card has room for and offers the rest, the pinned row actions) with an
 * xs `DrillButton` per row, so the row keeps the row height (invariant 6). The tile owns the
 * columns, the cells, the words and the notes under the rows; a row's copy is its id's.
 */
export function BoardTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  onOpen,
  openLabel,
  empty,
  footer,
}: BoardTableProps<Row>) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-col">
      {rows.length === 0 ? (
        empty
      ) : (
        <ListTable
          ariaLabel={label}
          columns={[
            ...columns.map((column) => ({ label: column.label })),
            // Pinned from 40rem up only: a narrower card scrolls the actions with the row.
            { label: t("board.colActions"), align: "right" as const, sticky: "sm" as const },
          ]}
        >
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {/* One line per cell, as DataTable draws a row: the row keeps the row height and the
                  table scrolls in its region where the card is short of room. */}
              {columns.map((column) => (
                <Td key={column.key} className="whitespace-nowrap">
                  {column.cell(row)}
                </Td>
              ))}
              <Td align="right">
                <DrillButton
                  size="xs"
                  onDrill={() => onOpen(row, { toSide: false })}
                  ariaLabel={openLabel(row)}
                >
                  {t("board.open")}
                </DrillButton>
              </Td>
            </tr>
          ))}
        </ListTable>
      )}
      {/* The notes under the rows as pulse-ui's DataTable sets a footer, which the webview's
          table slot renders: centred in the cell gutter, under an empty table too. */}
      {footer !== undefined && <div className="px-cell flex justify-center py-2">{footer}</div>}
    </div>
  )
}
