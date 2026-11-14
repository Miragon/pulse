import { useId, type PointerEvent } from "react"
import { useUiMessages } from "../locale/locale-provider.js"
import { cn } from "../lib/utils.js"
import { COLUMN_KEY_ATTRIBUTE, type ColumnSizer } from "./column-measure.js"
import { tableMinWidth, type ColumnSizingParts, type ColumnWidths } from "./column-sizing.js"
import {
  ComposedBody,
  FITTED_CELL,
  RowsBody,
  SELECTION_CELL,
  SELECTION_WIDTH,
  SkeletonBody,
} from "./data-table-body.js"
import type { DataTableColumn, DataTableProps, DataTableSelection } from "./data-table-types.js"
import { NamedIdLayoutContext } from "./named-id.js"
import { SortLabel, thClasses } from "./table.js"

/**
 * The region's focus ring as an inward outline on a sibling over it: an outset ring is clipped by
 * a card (WCAG 2.4.7), and row fills and a pinned column paint over the region's own outline.
 */
const REGION_RING =
  "pointer-events-none absolute inset-0 z-[3] rounded-sm peer-focus-visible:outline-(length:--focus-width) peer-focus-visible:outline-solid peer-focus-visible:outline-focus peer-focus-visible:-outline-offset-2"

/** Marks a title the table offered itself, so it never takes over one a cell names. */
const OFFERED_TITLE = "data-offered-title"

/**
 * In a sized table a cell its column cuts offers its whole text on hover (a title), and drops it
 * once the column is wide enough again; a cell that names its own title keeps it.
 */
function offerTitle(event: PointerEvent<HTMLTableElement>) {
  const cell = (event.target as Element).closest("td")
  if (!cell || (cell.hasAttribute("title") && !cell.hasAttribute(OFFERED_TITLE))) return
  if (cell.scrollWidth > cell.clientWidth) {
    cell.title = cell.textContent ?? ""
    cell.setAttribute(OFFERED_TITLE, "")
  } else {
    cell.removeAttribute("title")
    cell.removeAttribute(OFFERED_TITLE)
  }
}

/** The column's name in words: given, the caption's text, else its key. */
function nameOf<Row>(column: DataTableColumn<Row>): string {
  if (column.name) return column.name
  return typeof column.label === "string" ? column.label : column.key
}

/** The column that takes the room the others leave while they fit their content: `fill`, else the last. */
function restKeyOf<Row>(columns: ReadonlyArray<DataTableColumn<Row>>): string | undefined {
  return (columns.find((column) => column.fill) ?? columns.at(-1))?.key
}

/**
 * The columns that fit their content until the table is sized: with drawn `rows` every one but
 * the column that takes the rest, with rows composed by hand the ones marked `fit`.
 */
function fittedKeys<Row>(
  columns: ReadonlyArray<DataTableColumn<Row>>,
  drawn: boolean,
  sized: boolean,
): ReadonlySet<string> {
  if (sized) return new Set()
  const rest = drawn ? restKeyOf(columns) : undefined
  const fits = (column: DataTableColumn<Row>) => (drawn ? column.key !== rest : !!column.fit)
  return new Set(columns.filter(fits).map((column) => column.key))
}

/** The columns that size: neither one of a fixed width, a bare one, nor the last, which takes the rest. */
function sizedKeys<Row>(columns: ReadonlyArray<DataTableColumn<Row>>): string[] {
  return columns
    .slice(0, -1)
    .filter((column) => column.width === undefined && !column.plain)
    .map((column) => column.key)
}

/** What a head that sizes draws by: the table's sizer and the sizing's head. */
interface HeadSizing {
  sizer: ColumnSizer
  Head: ColumnSizingParts["Head"]
}

function HeadCell<Row>({
  column,
  sizing,
  wrap,
  fitted,
}: {
  column: DataTableColumn<Row>
  sizing: HeadSizing | undefined
  /** The caption may wrap (`wrapHeads`). */
  wrap: boolean
  fitted: boolean
}) {
  const align = column.align ?? "left"
  const captionId = useId()
  const caption = column.sort ? (
    <SortLabel sort={column.sort} align={align}>
      {column.label}
    </SortLabel>
  ) : (
    column.label
  )
  return (
    <th
      scope="col"
      aria-sort={column.sort}
      // A sized head names itself by its caption alone: its grip and menu keep their own names.
      aria-labelledby={sizing ? captionId : undefined}
      {...{ [COLUMN_KEY_ATTRIBUTE]: column.key }}
      style={column.width === undefined ? undefined : { width: column.width }}
      className={cn(
        thClasses(align, column.plain ?? false),
        wrap && "whitespace-normal",
        fitted && FITTED_CELL,
        sizing && "group/th relative",
        column.className,
      )}
    >
      {sizing ? (
        <sizing.Head
          caption={<span id={captionId}>{caption}</span>}
          align={align}
          column={nameOf(column)}
          columnKey={column.key}
          sizer={sizing.sizer}
        />
      ) : (
        caption
      )}
    </th>
  )
}

function SelectionHead<Row>({ selection }: { selection: DataTableSelection<Row> }) {
  const { dataTable } = useUiMessages()
  return (
    <th
      scope="col"
      style={{ width: SELECTION_WIDTH }}
      className={cn(thClasses("left", true), SELECTION_CELL)}
    >
      <selection.Box
        aria-label={selection.allLabel ?? dataTable.selectAll}
        checked={selection.all}
        onCheckedChange={() => selection.onToggleAll()}
        className="align-middle"
      />
    </th>
  )
}

/** Widths for each column: a sized one's, a fixed one's, none for the rest. */
function ColumnWidthsGroup<Row>({
  columns,
  widths,
  selection,
}: {
  columns: ReadonlyArray<DataTableColumn<Row>>
  widths: ColumnWidths
  selection: boolean
}) {
  return (
    <colgroup>
      {selection && <col style={{ width: SELECTION_WIDTH }} />}
      {columns.map((column) => {
        const width = column.width ?? widths[column.key]
        return <col key={column.key} style={width === undefined ? undefined : { width }} />
      })}
    </colgroup>
  )
}

function fixedWidth<Row>(columns: ReadonlyArray<DataTableColumn<Row>>, selection: boolean): number {
  return columns.reduce((sum, column) => sum + (column.width ?? 0), selection ? SELECTION_WIDTH : 0)
}

function Body<Row>(props: DataTableProps<Row> & { fitted: (key: string) => boolean }) {
  const { columns, rows, rowKey, skeletonRows, bodyRef, children } = props
  if (skeletonRows !== undefined) {
    const count = columns.length + (props.selection ? 1 : 0)
    return <SkeletonBody columns={count} count={skeletonRows} />
  }
  if (rows === undefined || rowKey === undefined) {
    const fitted = columns.flatMap((column, index) => (props.fitted(column.key) ? [index] : []))
    return (
      <ComposedBody fitted={fitted} bodyRef={bodyRef}>
        {children}
      </ComposedBody>
    )
  }
  return (
    <RowsBody
      columns={columns}
      rows={rows}
      rowKey={rowKey}
      onActivate={props.onActivate}
      onCopy={props.onCopy}
      selection={props.selection}
      bodyRef={bodyRef}
      fitted={props.fitted}
    />
  )
}

/** The part of the table that scrolls: the head, the body and what follows them. */
function TableBody<Row>(
  props: DataTableProps<Row> & { head: HeadSizing | undefined; sized: ReadonlyArray<string> },
) {
  const { label, columns, rows, selection, skeletonRows, head, sized, headRows, foot } = props
  const widths = head?.sizer.widths
  const loading = skeletonRows !== undefined
  const fits = fittedKeys(columns, rows !== undefined, widths !== undefined)
  const fitted = (key: string) => fits.has(key)
  return (
    <table
      aria-label={label}
      style={
        widths ? { minWidth: tableMinWidth(widths, fixedWidth(columns, !!selection)) } : undefined
      }
      onPointerOver={widths ? offerTitle : undefined}
      className={cn(
        "text-dense w-full border-separate border-spacing-0",
        widths &&
          "table-fixed [--named-id-floor:0px] [&>tbody>tr>td]:overflow-hidden [&>tbody>tr>td]:text-ellipsis",
        props.tableClassName,
      )}
    >
      {widths && <ColumnWidthsGroup columns={columns} widths={widths} selection={!!selection} />}
      {!loading && (
        <thead className="sticky top-0 z-[2]">
          {headRows}
          <tr>
            {selection && <SelectionHead selection={selection} />}
            {columns.map((column) => (
              <HeadCell
                key={column.key}
                column={column}
                sizing={sized.includes(column.key) ? head : undefined}
                wrap={props.wrapHeads ?? false}
                fitted={fitted(column.key)}
              />
            ))}
          </tr>
        </thead>
      )}
      <NamedIdLayoutContext.Provider value="inline">
        <Body {...props} fitted={fitted} />
      </NamedIdLayoutContext.Provider>
      {foot}
    </table>
  )
}

/**
 * The kit's data table, in the one compact look (CI §8 tables, the webview's lists): 28 px rows
 * on the density roles, a sticky head of 13 px captions at 600 on the table's surface, a hover
 * fill on `--accent`, and inside a named scroll region a keyboard reaches (WCAG 1.4.10: a wide
 * table scrolls in it, never the document), which keeps a focused row clear of the sticky head
 * (`scroll-padding-top`, WCAG 2.4.11). Two ways to fill it: `rows` drawn by the columns' `cell`s,
 * one line each, the columns fitting their content and one taking the rest (`fill`, else the
 * last), with an optional row target (`onActivate`, one tab stop, the arrows between rows), copy
 * and selection column (`selection` from `rowSelection`); or `children`, rows composed by hand and
 * laid out by their content, where a column marked `fit` fits its one line as a drawn one does.
 * Either way the heads keep one line, a `NamedId` in the body takes one line that gives way first
 * where the region is short of room, the columns can be sized by mouse and keyboard (`sizing`
 * from `useColumnSizing`, with a grip and a menu per head, each head named by its caption), and
 * `skeletonRows` stands in while it loads. The grips, the menus and the selection's boxes come
 * with `sizing` and `selection`, so a table without them never loads them. Props and callbacks
 * only: no host, no tool call; where widths are kept is the caller's (`useColumnSizing`'s `load`,
 * `save`).
 */
export function DataTable<Row = unknown>(props: DataTableProps<Row>) {
  const { label, columns, rows, onActivate, skeletonRows, sizing, empty, footer, className } = props
  const keys = sizedKeys(columns)
  const head =
    sizing && keys.length > 0
      ? { sizer: sizing.parts.sizer(keys), Head: sizing.parts.Head }
      : undefined
  const targets = rows !== undefined && rows.length > 0 && onActivate !== undefined
  const showEmpty = rows !== undefined && rows.length === 0 && skeletonRows === undefined
  return (
    <div
      data-slot="data-table"
      className={cn(
        "relative flex w-full min-w-0 flex-col has-[[data-dragging]]:select-none",
        className,
      )}
    >
      <div
        role="region"
        aria-label={label}
        aria-busy={skeletonRows !== undefined || undefined}
        // A scrollable region a keyboard must reach; rows that take focus reach it themselves.
        // Positioned, so what a cell holds out of flow (a screen reader's text) scrolls and clips
        // with it instead of widening the document.
        tabIndex={targets ? undefined : 0}
        className="peer scroll-pt-row @container relative min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-sm focus-visible:outline-none"
      >
        <TableBody {...props} head={head} sized={keys} />
        {showEmpty && empty}
        {footer !== undefined && <div className="px-cell flex justify-center py-2">{footer}</div>}
      </div>
      <span aria-hidden="true" data-slot="data-table-ring" className={REGION_RING} />
    </div>
  )
}
