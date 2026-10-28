import type { FitSlot } from "./inline-fit-solve.js"

/** Injected in tests: happy-dom has no layout. */
export interface FitMeasure {
  content: (box: HTMLElement) => number
  rows: (rowsElement: HTMLElement) => number[]
}

export const ROWS_ATTRIBUTE = "data-inline-fit-rows"
/** A row continuing the one before (an incident's error line): the fit counts ITEMS, as the cap does. */
export const CONTINUES_ATTRIBUTE = "data-inline-fit-continues"

export const FIT_CONTINUES_ROW = { [CONTINUES_ATTRIBUTE]: "" } as const
export const FALLBACK_ATTRIBUTE = "data-inline-fit-fallback"
export const LIST_SELECTOR = `[${ROWS_ATTRIBUTE}], [${FALLBACK_ATTRIBUTE}]`

export const DOM_MEASURE: FitMeasure = {
  content(box) {
    // A `display: contents` box has no box of its own: measure its children's union.
    if (getComputedStyle(box).display === "contents") {
      const range = document.createRange()
      range.selectNodeContents(box)
      return range.getBoundingClientRect().height
    }
    return box.scrollHeight
  },
  rows(rowsElement) {
    const bottoms: number[] = []
    for (const child of Array.from(rowsElement.children)) {
      // Skip overlays such as `PagedRows`' stale bar.
      if (getComputedStyle(child).position === "absolute") continue
      const rect = child.getBoundingClientRect()
      if (rect.height === 0) continue
      if (child.hasAttribute(CONTINUES_ATTRIBUTE) && bottoms.length > 0) {
        bottoms[bottoms.length - 1] = rect.bottom
      } else bottoms.push(rect.bottom)
    }
    return bottoms
  },
}

interface SlotRecord {
  rows: HTMLElement | null
  fallback: HTMLElement | null
  placed: boolean
  frozen: boolean
}

/** Mutable bookkeeping outside React state: ref callbacks and effects change it mid-measure. */
export class SlotRegistry {
  private readonly records = new Map<string, SlotRecord>()

  /** Refs attach before effects, so rows can arrive before their list registers. */
  private recordOf(id: string): SlotRecord {
    let record = this.records.get(id)
    if (!record) {
      record = { rows: null, fallback: null, placed: false, frozen: false }
      this.records.set(id, record)
    }
    return record
  }

  register(id: string): () => void {
    this.recordOf(id)
    return () => {
      this.records.delete(id)
    }
  }

  setRows(id: string, element: HTMLElement | null, kind: "rows" | "fallback"): void {
    element?.setAttribute(kind === "rows" ? ROWS_ATTRIBUTE : FALLBACK_ATTRIBUTE, "")
    this.recordOf(id)[kind] = element
  }

  setFrozen(id: string, frozen: boolean): void {
    this.recordOf(id).frozen = frozen
  }

  restart(): void {
    for (const record of this.records.values()) {
      record.frozen = false
      record.placed = false
    }
  }

  unplace(id: string): void {
    this.recordOf(id).placed = false
  }

  /** `fresh`: a list was placed for the first time (a drill or tab just showed it). */
  measure(box: HTMLElement, measure: FitMeasure): { slots: FitSlot[]; fresh: boolean } {
    const ordered = Array.from(box.querySelectorAll<HTMLElement>(LIST_SELECTOR))
    const slots: FitSlot[] = []
    let fresh = false
    for (const [id, record] of this.records) {
      const rows = record.rows ?? record.fallback
      if (!rows) continue
      const bottoms = measure.rows(rows)
      if (bottoms.length === 0) continue
      fresh ||= !record.placed
      record.placed = true
      slots.push({ id, order: ordered.indexOf(rows), bottoms, frozen: record.frozen })
    }
    return { slots, fresh }
  }

  hasUnplacedVisible(measure: FitMeasure): boolean {
    for (const record of this.records.values()) {
      const rows = record.rows ?? record.fallback
      if (!record.placed && rows && measure.rows(rows).length > 0) return true
    }
    return false
  }
}
