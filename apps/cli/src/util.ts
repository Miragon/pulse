/** Small helpers shared across layers. */

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> }

/**
 * Drops properties whose value is undefined. Needed with exactOptionalPropertyTypes, where an
 * optional property must be absent rather than undefined.
 */
export function compact<T extends object>(value: T): Partial<Defined<T>> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<Defined<T>>
}

/** True for plain JSON-like objects (not null, not arrays). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Merges header maps; later maps win. Header names are case-insensitive, so a later `authorization`
 * replaces an earlier `Authorization` instead of being sent twice. The later spelling is kept.
 */
export function mergeHeaders(
  ...sources: readonly Readonly<Record<string, string>>[]
): Record<string, string> {
  const merged = new Map<string, readonly [string, string]>()
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      const key = name.toLowerCase()
      merged.delete(key)
      merged.set(key, [name, value])
    }
  }
  return Object.fromEntries(merged.values())
}

const SECRET_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
])
const SECRET_NAME_PARTS = ["token", "secret", "password", "api-key", "apikey"]

/**
 * True for a header that carries a secret: credentials, cookies and names containing token,
 * secret, password or api-key. Output masks their values; a project file must not store them.
 */
export function isSecretHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return SECRET_HEADERS.has(lower) || SECRET_NAME_PARTS.some((part) => lower.includes(part))
}

/** Lower-case hex of the SHA-256 of `data` (text as UTF-8), with WebCrypto. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The parts of `JSON` that TypeScript's ES2023 lib does not describe (Node.js >= 21 has them). */
interface SourceJson {
  parse(
    text: string,
    reviver: (key: string, value: unknown, context: { readonly source?: string }) => unknown,
  ): unknown
  rawJSON(text: string): unknown
}

const SOURCE_JSON = JSON as unknown as SourceJson
const INTEGER_LITERAL = /^-?\d+$/

/**
 * JSON.parse without losing integers beyond 2^53 (engine `Long` values such as
 * 9223372036854775807): they become BigInts, which `stringifyJson` writes back digit for digit.
 * Other numbers are parsed as usual. Throws like JSON.parse.
 */
export function parseJson(text: string): unknown {
  return SOURCE_JSON.parse(text, (_key, value, context) =>
    typeof value === "number" &&
    !Number.isSafeInteger(value) &&
    context.source !== undefined &&
    INTEGER_LITERAL.test(context.source)
      ? BigInt(context.source)
      : value,
  )
}

/** JSON.stringify that writes BigInts (from `parseJson`) as plain JSON numbers. */
export function stringifyJson(value: unknown, indent?: number): string | undefined {
  return JSON.stringify(
    value,
    (_key, entry: unknown) =>
      typeof entry === "bigint" ? SOURCE_JSON.rawJSON(entry.toString()) : entry,
    indent,
  )
}

/** One row of the Levenshtein matrix, computed from the row above. */
function nextRow(above: readonly number[], char: string, other: string, rowIndex: number) {
  const row = [rowIndex]
  let diagonal = rowIndex - 1
  let left = rowIndex
  above.slice(1).forEach((up, index) => {
    left = Math.min(up + 1, left + 1, diagonal + (char === other.charAt(index) ? 0 : 1))
    diagonal = up
    row.push(left)
  })
  return row
}

/** Levenshtein distance: insert, delete and substitute each cost 1. */
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let index = 0; index < a.length; index++) {
    row = nextRow(row, a.charAt(index), b, index + 1)
  }
  // the last cell of the last row
  return row.reduce((_, cell) => cell)
}

/** Largest edit distance of a close spelling. */
const MAX_DISTANCE = 2
/** Smallest share of unchanged characters of a close spelling (commander uses the same). */
const MIN_SIMILARITY = 0.4
const MAX_SUGGESTIONS = 5

/** True when at most 2 edits apart and more than 40 % of the longer name is unchanged. */
function isClose(distance: number, word: string, name: string): boolean {
  const length = Math.max(word.length, name.length)
  return distance <= MAX_DISTANCE && (length - distance) / length > MIN_SIMILARITY
}

/**
 * Close spellings of `word` among `names`, compared case-insensitively (a name that differs only in
 * case has distance 0), closest first, at most 5; names keep their spelling. The one rule for every
 * "did you mean" of operate: commands, groups, options and body properties.
 */
export function closeNames(word: string, names: readonly string[]): string[] {
  const wanted = word.toLowerCase()
  return [...new Set(names)]
    .map((name) => ({ name, distance: editDistance(wanted, name.toLowerCase()) }))
    .filter((candidate) => isClose(candidate.distance, wanted, candidate.name))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.name)
}

/**
 * Maps every item with `fn`, at most `limit` calls at a time, and resolves to the results in the
 * order of the items (requests of one round of a workflow command run like this). Rejects with the
 * first failure; no item starts after it (calls already running finish on their own).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index] as T, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
