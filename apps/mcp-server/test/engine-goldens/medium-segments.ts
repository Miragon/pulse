/**
 * The rows of a read of the medium engine (medium-world.ts) as segments, never listed whole: a
 * segment is a run of rows, each made when a page takes it, with keys monotone in its position.
 * A count is the sum of the segments' lengths, a time bound a cut of each segment found by
 * bisection, a page the rows its offset and size cut from them: in the segments' order where the
 * read asks for none, else in the order it asks for, which the keys place without making a row
 * before the page (`sortedPageOf`).
 */

/** A run of rows, made on demand. */
export interface Segment<Row = unknown> {
  readonly count: number
  /** Its row `j`, from 0. */
  row(j: number): Row
  /**
   * Its keys by name, each a whole number that strictly falls, strictly rises or stays as `j`
   * rises, so the rows of a segment come in the order of any sort over them, forward or back: the
   * times (`start`, `end`, `incident` …) fall, so a time bound cuts one run of them (`within`), the
   * ids' places (`id`) rise, a state's values (`retries`, a step's `occurrence`) stay.
   */
  readonly keys: Readonly<Record<string, (j: number) => number>>
}

export const total = (segments: readonly { readonly count: number }[]) =>
  segments.reduce((sum, segment) => sum + segment.count, 0)

/** The first `j` of `[from, to)` where `holds` holds, where it holds from some `j` on; else `to`. */
function firstWhere(from: number, to: number, holds: (j: number) => boolean): number {
  let low = from
  let high = to
  while (low < high) {
    const middle = (low + high) >> 1
    if (holds(middle)) high = middle
    else low = middle + 1
  }
  return low
}

/** A bound on one time of a segment: the rows at or after `after` and at or before `before`. */
export interface TimeBound {
  readonly time: string
  readonly after?: number
  readonly before?: number
}

/** The part of a segment within `bounds`; a time it lacks takes none of it. */
export function within<Row>(segment: Segment<Row>, bounds: readonly TimeBound[]): Segment<Row> {
  let from = 0
  let to = segment.count
  for (const { time, after, before } of bounds) {
    const at = segment.keys[time]
    if (!at) return { ...segment, count: 0 }
    const first = before === undefined ? 0 : firstWhere(0, segment.count, (j) => at(j) <= before)
    const end =
      after === undefined ? segment.count : firstWhere(0, segment.count, (j) => at(j) < after)
    from = Math.max(from, first)
    to = Math.min(to, end)
  }
  return {
    count: Math.max(0, to - from),
    row: (j) => segment.row(from + j),
    keys: Object.fromEntries(
      Object.entries(segment.keys).map(([name, at]) => [name, (j: number) => at(from + j)]),
    ),
  }
}

/** The rows `first` to `first + max` of the segments, in their order. */
export function pageOf<Row>(segments: readonly Segment<Row>[], first: number, max: number): Row[] {
  const rows: Row[] = []
  let skip = first
  for (const segment of segments) {
    if (rows.length >= max) break
    if (skip >= segment.count) {
      skip -= segment.count
      continue
    }
    const end = Math.min(segment.count, skip + max - rows.length)
    for (let j = skip; j < end; j++) rows.push(segment.row(j))
    skip = 0
  }
  return rows
}

/** One key of the order a read asks for: the segments' key it sorts by, and its direction. */
export interface SortKey {
  readonly key: string
  readonly descending: boolean
}

/**
 * A segment read in the ascending order of a sort: its position `p` runs from the row that comes
 * first. Its levels are the sort's keys (a descending one negated), then the segment's place among
 * the read's segments and the position, which break the ties of the keys as an engine breaks them,
 * by an order of its own; each level's value does not fall as `p` rises where the levels before
 * it are equal, so the levels of a row place it in one total order.
 */
interface Ordered<Row> {
  readonly count: number
  level(at: number, p: number): number
  row(p: number): Row
}

/** The sign of the order of two rows by their values, level by level. */
function compareLevels(a: readonly number[], b: readonly number[]): number {
  for (const [at, value] of a.entries()) {
    const difference = value - b[at]
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function orderedOf<Row>(
  segment: Segment<Row>,
  by: readonly SortKey[],
  place: number,
): Ordered<Row> {
  const keys = by.map(({ key, descending }) => {
    const value = segment.keys[key]
    return descending ? (j: number) => -value(j) : value
  })
  const last = segment.count - 1
  // A segment's keys are monotone: it is read forward where its first row does not come later.
  const forward =
    compareLevels(
      keys.map((key) => key(0)),
      keys.map((key) => key(last)),
    ) <= 0
  const jOf = forward ? (p: number) => p : (p: number) => last - p
  const levels = [...keys.map((key) => (p: number) => key(jOf(p))), () => place, (p: number) => p]
  return {
    count: segment.count,
    level: (at, p) => levels[at](p),
    row: (p) => segment.row(jOf(p)),
  }
}

/** A run of positions of one segment, `[from, to)`. */
interface Run {
  readonly from: number
  readonly to: number
}

/** The first position of `run` whose value at the level `at` is `value` or more. */
function lowerBound(segment: Ordered<unknown>, at: number, run: Run, value: number): number {
  if (run.from === run.to || segment.level(at, run.from) >= value) return run.from
  if (segment.level(at, run.to - 1) < value) return run.to
  return firstWhere(run.from, run.to, (p) => segment.level(at, p) >= value)
}

/**
 * The levels of the row of rank `rank` in the order of `segments`, one level at a time: of the
 * rows whose levels so far are the rank's, the value of the next level is the largest with no
 * more of them below it than the rank's rest, found by bisection over the values, each count
 * summed from the segments' runs by bisection over their positions.
 */
function levelsAt(segments: readonly Ordered<unknown>[], depth: number, rank: number): number[] {
  let runs: Run[] = segments.map(({ count }) => ({ from: 0, to: count }))
  let rest = rank
  const levels: number[] = []
  for (let at = 0; at < depth; at++) {
    const below = (value: number) =>
      segments.reduce(
        (sum, segment, s) => sum + lowerBound(segment, at, runs[s], value) - runs[s].from,
        0,
      )
    const open = segments.flatMap((segment, s) => (runs[s].from < runs[s].to ? [s] : []))
    let low = Math.min(...open.map((s) => segments[s].level(at, runs[s].from)))
    let high = Math.max(...open.map((s) => segments[s].level(at, runs[s].to - 1)))
    while (low < high) {
      const middle = low + Math.ceil((high - low) / 2)
      if (below(middle) <= rest) low = middle
      else high = middle - 1
    }
    rest -= below(low)
    runs = runs.map((run, s) => ({
      from: lowerBound(segments[s], at, run, low),
      to: lowerBound(segments[s], at, run, low + 1),
    }))
    levels.push(low)
  }
  return levels
}

/** The values of a segment's position `p`, level by level. */
const levelsOf = (segment: Ordered<unknown>, p: number, depth: number) =>
  Array.from({ length: depth }, (_, at) => segment.level(at, p))

/**
 * The rows `first` to `first + max` of the segments in the order `by`, whose keys every segment
 * holds. The levels of the page's first and last row are found by rank (`levelsAt`); the rows
 * between them lie in one run of each segment, found by bisection, so only the page's rows are
 * made and ordered.
 */
export function sortedPageOf<Row>(
  segments: readonly Segment<Row>[],
  by: readonly SortKey[],
  first: number,
  max: number,
): Row[] {
  const ordered = segments
    .filter(({ count }) => count > 0)
    .map((segment, place) => orderedOf(segment, by, place))
  const end = Math.min(total(ordered), first + max)
  if (first >= end) return []
  const depth = by.length + 2
  const from = levelsAt(ordered, depth, first)
  const to = levelsAt(ordered, depth, end - 1)
  const rows = ordered.flatMap((segment) => {
    const after = (levels: readonly number[], p: number) =>
      compareLevels(levelsOf(segment, p, depth), levels)
    const low = firstWhere(0, segment.count, (p) => after(from, p) >= 0)
    const high = firstWhere(low, segment.count, (p) => after(to, p) > 0)
    return Array.from({ length: high - low }, (_, k) => ({
      levels: levelsOf(segment, low + k, depth),
      row: () => segment.row(low + k),
    }))
  })
  rows.sort((a, b) => compareLevels(a.levels, b.levels))
  return rows.map(({ row }) => row())
}
