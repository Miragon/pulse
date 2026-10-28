import type { WidgetProps } from "@miragon/mcp-toolkit-core"
import { KpiGrid, resolveTone, useLocale, type KpiCell } from "@miragon/mcp-toolkit-ui"
import { humanizeKey } from "./humanize-key.js"
import { kitLabels, type KitLabels } from "./kit-labels.js"
import { ListTable } from "./list-table.js"
import { TableEmptyState, Td } from "./table.js"

// The `shell:*` widgets (`../shell-catalogue.ts`): a layout cell points one at plain data via `props.dataKey`.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
}

type YesNo = Pick<KitLabels, "yes" | "no">

function cellValue(v: unknown, words: YesNo): string | number {
  if (typeof v === "number") return v
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? words.yes : words.no
  return "—"
}

/** Cells or a plain `{ label: value }` object; anything else is empty. */
function coerceKpiCells(raw: unknown, words: YesNo): KpiCell[] {
  if (Array.isArray(raw)) {
    return raw
      .filter(isRecord)
      .filter((r) => typeof r.label === "string" && r.label.length > 0)
      .map((r) => ({
        label: r.label as string,
        value: cellValue(r.value, words),
        // `resolveTone` maps retired names (`critical`) and falls back to neutral.
        tone: typeof r.tone === "string" ? resolveTone(r.tone) : undefined,
        fraction: typeof r.fraction === "string" ? r.fraction : undefined,
      }))
  }
  if (isRecord(raw)) {
    return Object.entries(raw)
      .filter(([, v]) => isPrimitive(v))
      .map(([label, v]) => ({ label, value: cellValue(v, words) }))
  }
  return []
}

/** `shell:kpi-grid`. */
export function GenericKpiGridWidget({ keys, widgetProps }: WidgetProps) {
  const labels = kitLabels(useLocale())
  const dataKey = typeof widgetProps?.dataKey === "string" ? widgetProps.dataKey : undefined
  const cells = coerceKpiCells(dataKey ? keys[dataKey] : undefined, labels)
  if (cells.length === 0) {
    return typeof widgetProps?.emptyText === "string" ? (
      <TableEmptyState>{widgetProps.emptyText}</TableEmptyState>
    ) : (
      <TableEmptyState description={labels.noDataHint}>{labels.noFiguresYet}</TableEmptyState>
    )
  }
  return (
    <KpiGrid
      cells={cells}
      boxed={widgetProps?.boxed === true}
      variant={widgetProps?.variant === "soft" ? "soft" : "strip"}
    />
  )
}

interface ColumnSpec {
  key: string
  label: string
  align: "left" | "right"
}

/** The `columns` prop, else the first row's primitive fields; unlabelled keys are humanized. */
function coerceColumns(raw: unknown, rows: Record<string, unknown>[]): ColumnSpec[] {
  if (Array.isArray(raw)) {
    const cols = raw
      .filter(isRecord)
      .filter((c) => typeof c.key === "string" && c.key.length > 0)
      .map((c) => ({
        key: c.key as string,
        label: typeof c.label === "string" ? c.label : humanizeKey(c.key as string),
        align: c.align === "right" ? ("right" as const) : ("left" as const),
      }))
    if (cols.length > 0) return cols
  }
  const first = rows[0]
  if (!first) return []
  return Object.keys(first)
    .filter((k) => isPrimitive(first[k]) || first[k] === null)
    .slice(0, 8)
    .map((key) => ({
      key,
      label: humanizeKey(key),
      align: typeof first[key] === "number" ? ("right" as const) : ("left" as const),
    }))
}

/** `shell:data-table`: `keys[dataKey]` is an array of records or `{ rows }`. */
export function GenericDataTableWidget({ keys, widgetProps }: WidgetProps) {
  const labels = kitLabels(useLocale())
  const dataKey = typeof widgetProps?.dataKey === "string" ? widgetProps.dataKey : undefined
  const raw = dataKey ? keys[dataKey] : undefined
  const rows = (
    Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.rows) ? raw.rows : []
  ).filter(isRecord)
  const columns = coerceColumns(widgetProps?.columns, rows)

  if (rows.length === 0 || columns.length === 0) {
    return typeof widgetProps?.emptyText === "string" ? (
      <TableEmptyState>{widgetProps.emptyText}</TableEmptyState>
    ) : (
      <TableEmptyState description={labels.noDataHint}>{labels.noRowsYet}</TableEmptyState>
    )
  }

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <ListTable
        ariaLabel={labels.dataTable}
        columns={columns.map((col) => ({ label: col.label, align: col.align }))}
      >
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <Td key={col.key} align={col.align}>
                {cellValue(row[col.key], labels)}
              </Td>
            ))}
          </tr>
        ))}
      </ListTable>
    </div>
  )
}
