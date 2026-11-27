import { useMemo } from "react"
import type {
  ScreenIdProps,
  ScreenPlainTableProps,
  ScreenSlots,
  ScreenTableProps,
} from "@miragon/pulse-blocks"
import type { ScreenTarget } from "@miragon/pulse-screens"
import { Button, NamedId, TableEmptyState, Td } from "@miragon/pulse-ui"
import { ListRow, ListTable } from "@miragon/pulse-widget-shell/widgets"
import type { Navigate } from "../router/page-link.js"
import { screenUrlOf, urlOf } from "../router/routes.js"
import { tenantFieldOf } from "./process/screen-process.js"

/**
 * The page's table of a screen's block: widget-shell's `ListTable` (its named scroll region, the
 * sticky head, a column a narrow region drops) at the height its screen leaves it, its rows
 * scrolling in that region, with a `ListRow` per row in the one row convention
 * (a click or Enter opens it, Ctrl or Cmd with C copies its id and says so), each row a link to
 * what it opens, so Ctrl or Cmd with a click and a middle click open it in a new tab. The block
 * owns the columns, the cells and the words; an empty table is the kit's empty state with the way
 * out the block offers (`emptyAction`), and the block's footer (a list's Load more) stands under
 * the rows' region. The page selects no row: it fills no write slot (`onToggle`).
 */
function PageTable<Row>(props: ScreenTableProps<Row>) {
  const { rows, empty, emptyAction, footer } = props
  if (rows.length === 0) {
    return (
      <TableEmptyState
        action={
          emptyAction && (
            <Button type="button" variant="outline" size="sm" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </Button>
          )
        }
      >
        {empty}
      </TableEmptyState>
    )
  }
  return (
    <>
      <PageRows {...props} />
      {footer !== undefined && (
        <div className="border-border flex shrink-0 justify-center border-t py-1">{footer}</div>
      )}
    </>
  )
}

/** The rows of the page's table in their region: a `ListRow` each, linked to what it opens. */
function PageRows<Row>({
  label,
  columns,
  rows,
  rowKey,
  onOpen,
  linkOf,
  rowLabel,
  copyOf,
}: ScreenTableProps<Row>) {
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

/**
 * The page's table whose rows open nothing (an instance's history, its waits, its variables; what
 * runs where across engines): widget-shell's `ListTable` (its named scroll region, the sticky head,
 * a column a narrow region drops) at the height its screen leaves it, its rows scrolling in that
 * region; an empty table is the kit's empty state. The block owns the columns, the cells and the
 * words.
 */
export function PagePlainTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  empty,
}: ScreenPlainTableProps<Row>) {
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
      {rows.map((row) => (
        <tr key={rowKey(row)}>
          {columns.map((column) => (
            <Td key={column.key}>{column.cell(row)}</Td>
          ))}
        </tr>
      ))}
    </ListTable>
  )
}

/** The page's id in a cell: the name, then the id quiet in mono (`NamedId`, inline in a table). */
function PageId({ id, name }: ScreenIdProps) {
  return <NamedId name={name} id={id} />
}

/**
 * The address of a target: an engine's processes, a process (its latest version) or one of its
 * versions, the page's process screen, or an instance, the page's instance screen, with a root
 * incident of it in focus where the target names one.
 */
export function targetUrl(target: ScreenTarget): string {
  switch (target.kind) {
    case "engine":
      return urlOf({ view: "overview", engine: target.engine })
    case "process":
      return screenUrlOf({
        kind: "process",
        engine: target.engine,
        process: target.bpmnProcessId,
        ...tenantFieldOf(target.tenantId),
        filter: { scope: "running" },
      })
    case "version":
      return screenUrlOf({
        kind: "process",
        engine: target.engine,
        process: target.bpmnProcessId,
        ...tenantFieldOf(target.tenantId),
        version: target.version,
        filter: { scope: "running" },
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
