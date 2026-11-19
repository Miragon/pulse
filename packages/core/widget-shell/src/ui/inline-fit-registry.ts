import type { FitSlot } from "./inline-fit-solve.js"

/** Injected in tests: happy-dom has no layout. */
export interface FitMeasure {
  content: (box: HTMLElement) => number
  rows: (rowsElement: HTMLElement) => number[]
}

const ROWS_ATTRIBUTE = "data-inline-fit-rows"
/** A row continuing the one before (an incident's error line): the fit counts ITEMS, as the cap does. */
const CONTINUES_ATTRIBUTE = "data-inline-fit-continues"

export const FIT_CONTINUES_ROW = { [CONTINUES_ATTRIBUTE]: "" } as const
const FALLBACK_ATTRIBUTE = "data-inline-fit-fallback"
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
  /** The list hides rows now, so its footer shows and a further cut adds none. */
  capped: boolean
  /** What a cut of this list added below its rows, measured once one rendered. */
  footer: number
}

/** A list's cap: the rows the fit leaves it and the rows the user revealed beyond them. */
export interface SlotCaps {
  fitted: number
  revealed: number
}

/**
 * A cut that hid rows of lists that showed every row: what it added besides is their footer,
 * which no layout knows before it renders, so the next fit measures it (`judgeTrial`).
 */
interface Trial {
  /** The fit state the cut was decided on: judged once a newer one has rendered. */
  stamp: unknown
  content: number
  /** The px of rows each newly cut list hid, and its cap before the cut. */
  cuts: ReadonlyMap<string, { hidden: number; before: SlotCaps | undefined }>
}

/** Mutable bookkeeping outside React state: ref callbacks and effects change it mid-measure. */
export class SlotRegistry {
  private readonly records = new Map<string, SlotRecord>()
  private trial: Trial | null = null

  /** Refs attach before effects, so rows can arrive before their list registers. */
  private recordOf(id: string): SlotRecord {
    let record = this.records.get(id)
    if (!record) {
      record = {
        rows: null,
        fallback: null,
        placed: false,
        frozen: false,
        capped: false,
        footer: 0,
      }
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

  setCapped(id: string, capped: boolean): void {
    this.recordOf(id).capped = capped
  }

  /** Whether the list shows every row, so a cut of it adds its footer. */
  isWhole(id: string): boolean {
    return !this.recordOf(id).capped
  }

  /** A new epoch: a footer may wrap differently at another width, so it is measured again. */
  restart(): void {
    this.trial = null
    for (const record of this.records.values()) {
      record.frozen = false
      record.placed = false
      record.footer = 0
    }
  }

  /** Records a cut of lists that showed every row; a trial not yet judged stays. */
  startTrial(stamp: unknown, content: number, cuts: Trial["cuts"]): void {
    if (this.trial || cuts.size === 0) return
    this.trial = { stamp, content, cuts }
  }

  /**
   * Once a newer fit state than the trial's has rendered: what the view grew by besides the rows
   * the cut hid is the footer it added, which each list keeps for later cuts. Returns the caps
   * before the cut of the lists whose cut hid no more than that, so the view grew: they show every
   * row again.
   */
  judgeTrial(stamp: unknown, content: number): Map<string, SlotCaps | undefined> {
    const undo = new Map<string, SlotCaps | undefined>()
    const trial = this.trial
    if (!trial || trial.stamp === stamp) return undo
    this.trial = null
    const hidden = [...trial.cuts.values()].reduce((sum, cut) => sum + cut.hidden, 0)
    const footer = Math.max(0, content - (trial.content - hidden)) / trial.cuts.size
    for (const [id, cut] of trial.cuts) {
      const record = this.records.get(id)
      if (!record || record.frozen) continue
      record.footer = footer
      if (cut.hidden <= footer) undo.set(id, cut.before)
    }
    return undo
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
      slots.push({
        id,
        order: ordered.indexOf(rows),
        bottoms,
        frozen: record.frozen,
        footer: record.capped ? 0 : record.footer,
      })
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
