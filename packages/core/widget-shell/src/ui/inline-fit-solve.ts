/**
 * The pure half of the inline fit (#396), on measured sizes only. Rows go
 * from the longest list to `softMin`, then later lists first to `hardMin`.
 * If even that does not fit, cutting below `softMin` buys nothing, so the
 * result stays at step 1 with `fits: false` (the view scrolls instead).
 * A cut pays for the footer it adds ("1 of 2 shown"): a cut that hides no more
 * than that footer adds is never taken, so a cut view is always shorter than
 * the uncut one, and a list too short to pay for it is left whole.
 */

export interface FitSlot {
  id: string
  order: number
  /** Any common origin. */
  bottoms: readonly number[]
  frozen: boolean
  /** What a cut adds below the rows (its footer): 0 while the list hides rows already. */
  footer: number
}

export interface FitLimits {
  softMin: number
  hardMin: number
}

export const FIT_LIMITS: FitLimits = { softMin: 3, hardMin: 1 }

export interface FitResult {
  cuts: Record<string, number>
  fits: boolean
}

interface Working {
  slot: FitSlot
  shown: number
  keep: number
}

function savedBy({ slot, shown, keep }: Working): number {
  if (keep >= shown) return 0
  return slot.bottoms[shown - 1] - slot.bottoms[keep - 1] - slot.footer
}

const totalSaved = (lists: readonly Working[]) =>
  lists.reduce((sum, list) => sum + savedBy(list), 0)

/** Whether cutting the list as far as `hardMin` hides more than the footer the cut adds. */
function canPayFooter(slot: FitSlot, hardMin: number): boolean {
  const shown = slot.bottoms.length
  return shown > hardMin && slot.bottoms[shown - 1] - slot.bottoms[hardMin - 1] > slot.footer
}

function trimToSoftMin(lists: Working[], over: number, softMin: number): void {
  while (totalSaved(lists) < over) {
    let pick: Working | undefined
    for (const list of lists) {
      if (list.keep <= Math.min(softMin, list.shown)) continue
      if (
        !pick ||
        list.keep > pick.keep ||
        (list.keep === pick.keep && list.slot.order > pick.slot.order)
      ) {
        pick = list
      }
    }
    if (!pick) return
    pick.keep -= 1
  }
}

function trimToHardMin(lists: Working[], over: number, hardMin: number): void {
  const byOrder = [...lists].sort((a, b) => a.slot.order - b.slot.order)
  const sequence = [...byOrder.slice(1).reverse(), ...byOrder.slice(0, 1)]
  for (const list of sequence) {
    while (totalSaved(lists) < over && list.keep > hardMin) list.keep -= 1
    if (totalSaved(lists) >= over) return
  }
}

export function solveInlineFit(
  input: { budget: number; content: number; slots: readonly FitSlot[] },
  limits: FitLimits = FIT_LIMITS,
): FitResult {
  const over = Math.ceil(input.content) - input.budget
  if (over <= 0) return { cuts: {}, fits: true }
  const hardMin = Math.max(1, limits.hardMin)
  const lists: Working[] = input.slots
    .filter((slot) => !slot.frozen && canPayFooter(slot, hardMin))
    .map((slot) => ({ slot, shown: slot.bottoms.length, keep: slot.bottoms.length }))

  trimToSoftMin(lists, over, limits.softMin)
  const soft = lists.map((list) => list.keep)
  if (totalSaved(lists) < over) {
    trimToHardMin(lists, over, hardMin)
    // Below softMin only where it makes the view fit.
    if (totalSaved(lists) < over) lists.forEach((list, i) => (list.keep = soft[i]))
  }
  // A cut that hides no more than its footer adds would make the view taller: the list stays whole.
  for (const list of lists) if (savedBy(list) <= 0) list.keep = list.shown

  const cuts: Record<string, number> = {}
  for (const list of lists) if (list.keep < list.shown) cuts[list.slot.id] = list.keep
  return { cuts, fits: totalSaved(lists) >= over }
}
