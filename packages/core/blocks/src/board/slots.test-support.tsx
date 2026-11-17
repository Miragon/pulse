import type { BoardOpenHow, BoardSlots, BoardTableProps, BoardTarget } from "./slots.js"

/** What the tiles asked of the surface: the targets they opened and how often the file. */
export interface Asked {
  readonly opened: { readonly target: BoardTarget; readonly how: BoardOpenHow }[]
  files: number
}

/**
 * A surface's table for the tests: a caption per column, a row with its drill (none where it
 * opens nothing) and its copy.
 */
function TestTable<Row>(props: BoardTableProps<Row>) {
  const { label, columns, rows, rowKey, onOpen, opens, openLabel, copyOf, empty, footer } = props
  return (
    <div data-testid="table">
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.cell(row)}</td>
              ))}
              <td>
                {opens?.(row) !== false && (
                  <button
                    type="button"
                    aria-label={openLabel(row)}
                    onClick={(event) => {
                      onOpen(row, { toSide: event.ctrlKey })
                    }}
                  />
                )}
                <button
                  type="button"
                  aria-label={`Copy ${copyOf(row).label}`}
                  data-copy={copyOf(row).text}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty}
      {footer}
    </div>
  )
}

/** Slots that record what the tiles ask, with a table, an id and a diagram of the tests. */
export function testSlots(
  options: {
    readonly opensToSide?: boolean
    readonly withFile?: boolean
    readonly opens?: (target: BoardTarget) => boolean
  } = {},
): { readonly slots: BoardSlots; readonly asked: Asked } {
  const asked: Asked = { opened: [], files: 0 }
  const slots: BoardSlots = {
    Table: TestTable,
    Id: ({ id, label }) => <code title={label}>{`id:${id}`}</code>,
    Diagram: ({ engine, definition, badges, label, onSelect }) => (
      <figure aria-label={label} data-engine={engine} data-definition={definition.id}>
        {badges.map((badge) => (
          <button
            key={badge.elementId}
            type="button"
            onClick={() => {
              onSelect(badge.elementId, "withIncident")
            }}
          >
            {badge.elementId}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onSelect("Gateway_Uncounted", undefined)
            onSelect(badges[0]?.elementId ?? "", undefined)
          }}
        >
          canvas
        </button>
      </figure>
    ),
    onOpen: (target, how) => {
      asked.opened.push({ target, how })
    },
    ...(options.withFile === false
      ? {}
      : {
          onOpenFile: () => {
            asked.files += 1
          },
        }),
    ...(options.opensToSide === undefined ? {} : { opensToSide: options.opensToSide }),
    ...(options.opens === undefined ? {} : { opens: options.opens }),
  }
  return { slots, asked }
}
