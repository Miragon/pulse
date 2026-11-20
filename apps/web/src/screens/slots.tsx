import { useMemo } from "react"
import type { ScreenIdProps, ScreenSlots, ScreenTableProps } from "@miragon/pulse-blocks"
import type { ScreenTarget } from "@miragon/pulse-screens"
import { NamedId, TableEmptyState, Td } from "@miragon/pulse-ui"
import { ListRow, ListTable } from "@miragon/pulse-widget-shell/widgets"
import type { Navigate } from "../router/page-link.js"
import { screenUrlOf, urlOf } from "../router/routes.js"

/**
 * The page's table of a screen's block: widget-shell's `ListTable` (its named scroll region, the
 * sticky head, a column a narrow region drops) at the height its screen leaves it, its rows
 * scrolling in that region, with a `ListRow` per row in the one row convention
 * (a click or Enter opens it, Ctrl or Cmd with C copies its id and says so), each row a link to
 * what it opens, so Ctrl or Cmd with a click and a middle click open it in a new tab. The block
 * owns the columns, the cells and the words; an empty table is the kit's empty state.
 */
function PageTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  onOpen,
  linkOf,
  rowLabel,
  copyOf,
  empty,
}: ScreenTableProps<Row>) {
  if (rows.length === 0) return <TableEmptyState>{empty}</TableEmptyState>
  return (
    <ListTable
      ariaLabel={label}
      fill
      columns={columns.map((column) => ({
        label: column.label,
        ...(column.hideBelow === undefined ? {} : { hideBelow: "sm" as const }),
      }))}
    >
      {rows.map((row) => {
        const copy = copyOf(row)
        return (
          <ListRow
            key={rowKey(row)}
            label={rowLabel(row)}
            onOpen={() => {
              onOpen(row, { toSide: false })
            }}
            href={linkOf?.(row)}
            copy={copy.text}
            copyLabel={copy.label}
          >
            {/* One line per cell, so every row keeps the row height. */}
            {columns.map((column) => (
              <Td key={column.key} className="whitespace-nowrap">
                {column.cell(row)}
              </Td>
            ))}
          </ListRow>
        )
      })}
    </ListTable>
  )
}

/** The page's id in a cell: the name, then the id quiet in mono (`NamedId`, inline in a table). */
function PageId({ id, name }: ScreenIdProps) {
  return <NamedId name={name} id={id} />
}

/**
 * The address of a target: an engine's processes, a process or one of its versions, which the page
 * shows as the cockpit's process view (over every version) until it has a screen of its own, or an
 * instance, the page's instance screen, with a root incident of it in focus where the target names
 * one.
 */
export function targetUrl(target: ScreenTarget): string {
  switch (target.kind) {
    case "engine":
      return urlOf({ view: "overview", engine: target.engine })
    case "process":
    case "version":
      return urlOf({
        view: "process-detail",
        engine: target.engine,
        processDefinitionKey: target.bpmnProcessId,
      })
    case "instance":
      return screenUrlOf({
        kind: "instance",
        engine: target.engine,
        instance: target.instanceId,
        ...(target.incidentId === undefined ? {} : { incident: target.incidentId }),
      })
  }
}

/**
 * The slots the page brings to the screens' blocks: its table, its id, its link per target and
 * where a target opens, a new entry of the page's history (`navigate`). The page writes nothing,
 * so it fills no write slot.
 */
export function usePageSlots(navigate: Navigate): ScreenSlots {
  return useMemo(
    () => ({
      Table: PageTable,
      Id: PageId,
      onOpen: (target) => {
        navigate(targetUrl(target))
      },
      linkOf: targetUrl,
    }),
    [navigate],
  )
}
