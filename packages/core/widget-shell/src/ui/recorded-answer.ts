/**
 * What a recording keeps of a tool's answer (`recordToolCalls`' `reads`): the paths the page
 * reads and nothing else, its free text replaced unless the recorder keeps it, its BPMN diagrams
 * without what the engine runs (`recorded-bpmn.ts`). So the recording a page's repository commits
 * holds what the page shows of an engine, and a field the page reads that an answer lacks is said
 * when it is recorded. Framework-free, for a recorder in Node; a page that reads live never holds
 * it.
 */
import { recordedBpmn } from "./recorded-bpmn.js"

type Scalar = string | number | boolean | bigint | symbol | null | undefined

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`

/** The paths into `T` below `P`: each key, `[]` an array's elements, `*` every key of a map. */
type PathsAt<T, P extends string> = T extends Scalar
  ? never
  : T extends readonly (infer E)[]
    ? `${P}[]` | PathsAt<E, `${P}[]`>
    : string extends keyof T
      ? Join<P, "*"> | PathsAt<T[keyof T], Join<P, "*">>
      : { [K in keyof T & string]-?: Join<P, K> | PathsAt<T[K], Join<P, K>> }[keyof T & string]

/** The paths of `T`'s values below `P`, null and undefined aside: what a page shows of it. */
type LeavesAt<T, P extends string> = T extends null | undefined
  ? never
  : T extends Scalar
    ? P
    : T extends readonly (infer E)[]
      ? LeavesAt<E, `${P}[]`>
      : string extends keyof T
        ? LeavesAt<T[keyof T], Join<P, "*">>
        : { [K in keyof T & string]-?: LeavesAt<T[K], Join<P, K>> }[keyof T & string]

/**
 * A path into an answer of type `T`, as a recording keeps it: its keys joined by dots, `[]` an
 * array's elements and `*` every key of a map (`now.running`, `buckets[].start`,
 * `buckets[].endedAt.*`). A path keeps everything below it.
 */
export type AnswerPath<T> = PathsAt<T, "">

/** The values of `T` that none of `P` keeps. */
type Uncovered<T, P extends string> = Exclude<
  LeavesAt<T, "">,
  P | `${P}.${string}` | `${P}[]${string}`
>

/**
 * What a recording keeps of one tool's answers (its `structuredContent`, else the JSON of its
 * text): only `paths`, each a path into the answer (`AnswerPath`). Of what they keep, `text` names
 * free text (an engine's message), replaced unless the recorder keeps text, and `bpmn` a BPMN
 * diagram's XML, kept without what the engine runs (`recordedBpmn`); a path of either that names
 * an object or an array changes every string below it.
 */
export interface RecordedRead {
  readonly paths: readonly string[]
  readonly text?: readonly string[]
  readonly bpmn?: readonly string[]
}

/** A `RecordedRead` of answers of type `T`: every path one of `T`'s. */
export interface RecordedReadOf<T> extends RecordedRead {
  readonly paths: readonly AnswerPath<T>[]
  readonly text?: readonly AnswerPath<T>[]
  readonly bpmn?: readonly AnswerPath<T>[]
}

/** Nothing more where `P` keeps every value of `T`; else the values it leaves out, by name. */
type Covering<T, P extends string> = [Uncovered<T, P>] extends [never]
  ? unknown
  : { readonly uncovered: Uncovered<T, P> }

/**
 * A page's read of answers of type `T` (the fields it reads), held to that type: each path is one
 * of `T`'s, and together they keep every field of it, so the recording holds what the page reads,
 * no more, and a field added to `T` that no path keeps is a type error that names it
 * (`uncovered`). `recordedRead<ProcessStats>()({ paths: ["asOf", "now.running"] })`.
 */
export function recordedRead<T>() {
  return <const R extends RecordedReadOf<T>>(read: R & Covering<T, R["paths"][number]>): R => read
}

/** A path as its steps: `buckets[].endedAt.*` is `buckets`, `[]`, `endedAt`, `*`. */
function stepsOf(path: string): string[] {
  return path
    .split(".")
    .filter((part) => part !== "")
    .flatMap((part) => {
      let end = part.length
      while (end >= 2 && part.startsWith("[]", end - 2)) end -= 2
      const name = part.slice(0, end)
      const arrays = (part.length - end) / 2
      return [...(name === "" ? [] : [name]), ...Array<string>(arrays).fill("[]")]
    })
}

/** The steps below `step` of those that start with it. */
function below(paths: readonly (readonly string[])[], step: string): string[][] {
  return paths.filter((steps) => steps[0] === step).map((steps) => steps.slice(1))
}

const join = (at: string, step: string) =>
  at === "" || step === "[]" ? at + step : `${at}.${step}`

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** What `paths` keep of `value` at `at`; a key they name that an object lacks goes to `lacking`. */
function kept(
  value: unknown,
  paths: readonly (readonly string[])[],
  at: string,
  lacking: Set<string>,
): unknown {
  if (paths.some((steps) => steps.length === 0) || !isObject(value)) return value
  if (Array.isArray(value)) {
    const inner = below(paths, "[]")
    return value.map((each) => kept(each, inner, join(at, "[]"), lacking))
  }
  const named = new Set(paths.map((steps) => steps[0]).filter((step) => step !== "*"))
  for (const key of named)
    if (key !== "[]" && !Object.hasOwn(value, key)) lacking.add(join(at, key))
  const entries = Object.entries(value).flatMap(([key, child]) => {
    const inner = [...below(paths, key), ...below(paths, "*")]
    return inner.length === 0 ? [] : [[key, kept(child, inner, join(at, key), lacking)] as const]
  })
  return Object.fromEntries(entries)
}

/** `value` with `change` applied to what `steps` names in it. */
function changedAt(
  value: unknown,
  steps: readonly string[],
  change: (value: unknown) => unknown,
): unknown {
  const [step, ...rest] = steps
  if (step === undefined) return change(value)
  if (!isObject(value) || Array.isArray(value) !== (step === "[]")) return value
  if (Array.isArray(value)) return value.map((each) => changedAt(each, rest, change))
  const entries = Object.entries(value).map(([key, child]): [string, unknown] => [
    key,
    step === "*" || step === key ? changedAt(child, rest, change) : child,
  ])
  return Object.fromEntries(entries)
}

/** `value` with `change` applied to every string in it, at any depth. */
function everyString(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === "string") return change(value)
  if (Array.isArray(value)) return value.map((each: unknown) => everyString(each, change))
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, everyString(child, change)]),
  )
}

const placeholderOf = (n: number) => `Text left out of the recording (${String(n)})`
const PLACEHOLDER = /^Text left out of the recording \(\d+\)$/

/**
 * How a recording replaces free text: one placeholder per distinct text, numbered as met. A
 * placeholder stays as it is, so a recording recorded again from itself (`pnpm record -- --from`)
 * keeps its placeholders, in whatever order its answers come.
 */
export function textReplacer(): (text: string) => string {
  const placeholders = new Map<string, string>()
  const taken = new Set<string>()
  let next = 1
  return (text) => {
    if (text === "" || PLACEHOLDER.test(text)) {
      taken.add(text)
      return text
    }
    const known = placeholders.get(text)
    if (known !== undefined) return known
    while (taken.has(placeholderOf(next))) next += 1
    const placeholder = placeholderOf(next)
    taken.add(placeholder)
    placeholders.set(text, placeholder)
    return placeholder
  }
}

/** How a recording keeps an answer: its free text replaced (`text`), or kept as it came (null). */
interface KeptAnswerOptions {
  readonly text: ((text: string) => string) | null
}

/**
 * What a recording keeps of an answer's data under `read`, and the paths it names that the data
 * lacks (an object without the key, never a null on the way): the server renamed or dropped a
 * field the page reads.
 */
export function keptAnswer(
  data: unknown,
  read: RecordedRead,
  { text }: KeptAnswerOptions,
): { readonly data: unknown; readonly lacking: readonly string[] } {
  const lacking = new Set<string>()
  let answer = kept(data, read.paths.map(stepsOf), "", lacking)
  // A path that names an object or an array changes every string below it, so no text slips by.
  const strings = (change: (value: string) => string) => (value: unknown) =>
    everyString(value, change)
  for (const path of read.bpmn ?? []) {
    answer = changedAt(
      answer,
      stepsOf(path),
      strings((xml) => recordedBpmn(xml, text)),
    )
  }
  if (text !== null) {
    for (const path of read.text ?? []) answer = changedAt(answer, stepsOf(path), strings(text))
  }
  return { data: answer, lacking: [...lacking] }
}
