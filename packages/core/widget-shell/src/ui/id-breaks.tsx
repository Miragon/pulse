import { Fragment } from "react"

const BREAK_AFTER = /[_\-.:/]/u
const LOWER = /\p{Ll}/u
const UPPER = /\p{Lu}/u

/** After a separator and at a lower-to-upper case change; joined, the segments give the id back. */
export function idBreakSegments(id: string): string[] {
  const segments: string[] = []
  let start = 0
  for (let i = 1; i < id.length; i++) {
    const before = id[i - 1]
    const at = id[i]
    if (BREAK_AFTER.test(before) || (LOWER.test(before) && UPPER.test(at))) {
      segments.push(id.slice(start, i))
      start = i
    }
  }
  segments.push(id.slice(start))
  return segments
}

/** `<wbr>` keeps the copied text the id itself. */
export function BreakableId({ id }: { id: string }) {
  return (
    <>
      {idBreakSegments(id).map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {segment}
        </Fragment>
      ))}
    </>
  )
}
