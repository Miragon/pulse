/*
 * The parts of an address the router reads and writes, apart from what an address names: a path's
 * segments and their texts, the `:params` of a page's pattern in a path, a path with its query.
 */

/**
 * Whether `value` can be a segment of a path: a text that is neither empty nor a dot segment, in
 * any spelling (the listener refuses those, `isNormalTarget`, and a browser resolves them).
 */
export const isSegment = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && value !== "." && value !== ".."

/** A segment of the path as its text: the browser escapes it, a broken escape stays as sent. */
function segmentText(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The text of each `:param` of `page` in `pathname`, or undefined where the path is not on it. */
export function paramsOn(page: string, pathname: string): Record<string, string> | undefined {
  const want = page.split("/")
  const got = pathname.split("/")
  if (want.length !== got.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, part] of want.entries()) {
    const segment = got[index]
    if (!part.startsWith(":")) {
      if (part !== segment) return undefined
    } else if (segment === "") {
      return undefined
    } else {
      params[part.slice(1)] = segmentText(segment)
    }
  }
  return params
}

/** `path` with `query`, without a `?` where the query is empty. */
export function withQuery(path: string, query: URLSearchParams): string {
  const written = query.toString()
  return written === "" ? path : `${path}?${written}`
}
