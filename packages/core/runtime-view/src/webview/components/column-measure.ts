export type ColumnWidths = Readonly<Record<string, number>>

const LABEL_ROOM = 24
const LAST_COLUMN_MIN = 80
const MEASURING = "data-table__measuring"

export class ColumnMeasure {
  static readonly MIN = 48
  static readonly MAX = 2000

  static isWidth(value: unknown): value is number {
    return typeof value === "number" && value >= ColumnMeasure.MIN && value <= ColumnMeasure.MAX
  }

  static width(cell: Element): number {
    return Math.round(cell.getBoundingClientRect().width)
  }

  static widths(cell: Element, keys: readonly string[]): ColumnWidths {
    const cells = [...(cell.parentElement?.children ?? [])]
    return Object.fromEntries(
      keys.slice(0, -1).map((key) => {
        const keyed = cells.find((candidate) => candidate.getAttribute("data-key") === key)
        return [key, ColumnMeasure.width(keyed ?? cell)]
      }),
    )
  }

  static tableWidth(widths: ColumnWidths, fixed = 0): number {
    return Object.values(widths).reduce((sum, width) => sum + width, LAST_COLUMN_MIN + fixed)
  }

  static clamp(cell: Element, width: number): number {
    const label = (cell.firstElementChild?.scrollWidth ?? 0) + LABEL_ROOM
    return Math.round(Math.min(ColumnMeasure.MAX, Math.max(ColumnMeasure.MIN, label, width)))
  }

  static fit(cell: Element): number {
    const table = cell.closest("table")
    const visible = table?.parentElement?.clientWidth ?? 0
    table?.classList.add(MEASURING)
    const natural = ColumnMeasure.width(cell)
    table?.classList.remove(MEASURING)
    return Math.min(natural, visible / 2)
  }

  static offerTitle(event: Event): void {
    const cell = (event.target as Element).closest("td")
    if (cell !== null) {
      cell.title = cell.scrollWidth > cell.clientWidth ? cell.textContent : ""
    }
  }
}
