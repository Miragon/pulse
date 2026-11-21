/**
 * The call activities of a deployed BPMN XML, read by their start tags: the one place Camunda 7
 * puts a copy of a called instance's incident (the caller's execution at its call activity), so
 * the element statistics tell root incidents from copies at these elements alone. A tag of any
 * prefix counts, also one in a comment or an extension, which costs a read and never a number.
 * Where an id is not readable for sure, no set is given, and the caller reads as if every element
 * could hold a copy.
 */

/**
 * A call activity's start tag, of any prefix; a `>` in a value quoted either way part of it, and
 * so the other quote inside a value (`name='5" pipe'`), which XML allows.
 */
export const CALL_ACTIVITY_TAG = /<(?:[^\s<>/:="']+:)?callActivity\b(?:[^>"']|"[^"]*"|'[^']*')*>/g

/** An attribute of a start tag, its value quoted either way. */
const ATTRIBUTE = /([^\s<>/="']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** The value of the tag's `id` attribute, never a prefixed one; undefined without one. */
function idOf(tag: string): string | undefined {
  for (const [, name, double, single] of tag.matchAll(ATTRIBUTE)) {
    if (name === "id") return double ?? single
  }
  return undefined
}

/**
 * The ids of every call activity of `xml`; undefined without a diagram and where a call activity's
 * id is missing or holds a reference (`&`), whose value the engine reads otherwise.
 */
export function callActivityIdsOf(xml: string | undefined): ReadonlySet<string> | undefined {
  if (xml === undefined) return undefined
  const ids = new Set<string>()
  for (const [tag] of xml.matchAll(CALL_ACTIVITY_TAG)) {
    const id = idOf(tag)
    if (id === undefined || id.includes("&")) return undefined
    ids.add(id)
  }
  return ids
}
