/**
 * The pure half of the inline fit (#396), on measured sizes only. Rows go
 * from the longest list to `softMin`, then later lists first to `hardMin`.
 * If even that does not fit, cutting below `softMin` buys nothing, so the
 * result stays at step 1 with `fits: false` (the view scrolls instead).
 */

export interface FitSlot {
  id: string
  order: number
  /** Any common origin. */
  bottoms: readonly number[]
  frozen: boolean
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
  return slot.bottoms[shown - 1] - slot.bottoms[keep - 1]
}

const totalSaved = (lists: readonly Working[]) =>
  lists.reduce((sum, list) => sum + savedBy(list), 0)

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
  const lists: Working[] = input.slots
    .filter((slot) => !slot.frozen && slot.bottoms.length > 0)
    .map((slot) => ({ slot, shown: slot.bottoms.length, keep: slot.bottoms.length }))

  trimToSoftMin(lists, over, limits.softMin)
  const soft = lists.map((list) => list.keep)
  let fits = totalSaved(lists) >= over
  if (!fits) {
    trimToHardMin(lists, over, Math.max(1, limits.hardMin))
    fits = totalSaved(lists) >= over
    // Below softMin only where it makes the view fit.
    if (!fits) lists.forEach((list, i) => (list.keep = soft[i]))
  }

  const cuts: Record<string, number> = {}
  for (const list of lists) if (list.keep < list.shown) cuts[list.slot.id] = list.keep
  return { cuts, fits }
}
