/**
 * A node:test reporter for GitHub Actions: `.github/workflows/ci.yml` runs it next to the spec
 * reporter through NODE_OPTIONS, so the pinned `pnpm test:scripts` stays as it is. It prints one
 * `::error` workflow command per failed test, which GitHub turns into an annotation on the file
 * and `gh run view --log-failed` shows, and appends a table of the failures to
 * $GITHUB_STEP_SUMMARY when that is set (GitHub shows 10 annotations per step, the table holds
 * all). A green run prints nothing. Node built-ins only.
 */
import { appendFileSync } from "node:fs"
import path from "node:path"

const ANNOTATION_LIMIT = 2000
const CELL_LIMIT = 300
/** How much of what a test file printed (stderr, diagnostics) is kept to name why it crashed. */
const STDERR_LIMIT = 16_384

/** The first line of an error as Node prints it: `SyntaxError: …`, `Error [ERR_…]: …`. */
const ERROR_LINE = /^\w*(?:Error|Exception)\b.*$/gm

const escapeData = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

const escapeProperty = (text) => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C")

const cut = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

/** The last error a test file printed: the one that ended it, past any a test logged on purpose. */
export function lastError(output) {
  return [...String(output ?? "").matchAll(ERROR_LINE)].at(-1)?.[0].trim()
}

/** The assertion behind node:test's wrapper, and how a crashed test file ended and why. */
function messageOf(error, output) {
  const message = (error?.cause?.message ?? error?.message ?? "test failed").trim()
  const exit = error?.exitCode ?? error?.signal
  if (!exit) return message
  const cause = lastError(output)
  return `${message} (exit ${exit})${cause ? `: ${cause}` : ""}`
}

/**
 * A `test:fail` event's failure; `ancestors` are the names of the suites around it, `output` what
 * its test file printed since its last result (read only when the file itself failed).
 */
export function failureOf(
  { name, file, line, details },
  ancestors = [],
  { cwd = process.cwd(), output } = {},
) {
  return {
    title: [...ancestors, name].join(" > "),
    file: file && path.relative(cwd, file),
    line,
    message: messageOf(details?.error, output),
  }
}

/** The workflow command of a failure, on one line as the runner reads it. */
export function annotation({ title, file, line, message }) {
  const where = [file && `file=${escapeProperty(file)}`, line && `line=${line}`]
    .filter(Boolean)
    .join(",")
  const text = cut(`${title}: ${message}`, ANNOTATION_LIMIT)
  return `::error${where && ` ${where}`}::${escapeData(text)}\n`
}

const cell = (text) =>
  cut(String(text).replace(/\s+/g, " ").trim(), CELL_LIMIT)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll("|", "\\|")

/** The failures as a Markdown table for the step summary. */
export function summaryTable(failures) {
  return [
    `### Failed tests: ${failures.length}`,
    "",
    "| Test | Where | Message |",
    "| --- | --- | --- |",
    ...failures.map(
      ({ title, file, line, message }) =>
        `| ${cell(title)} | ${cell(file && line ? `${file}:${line}` : (file ?? ""))} | ${cell(message)} |`,
    ),
    "",
    "",
  ].join("\n")
}

/**
 * A running test: node:test reports a file's tests in definition order, each one's subtests
 * before it, so a frame sees its whole subtree before its own result. `reported`: a failure in
 * its subtree was reported; `cancelled`: its subtests that were cancelled when it ended.
 */
const frame = (name) => ({ name, reported: false, cancelled: [] })

/**
 * The failures of a test run, one annotation each, and with `summaryFile` their table appended to
 * it. A failure another one explains stays out: the parent of a reported failure
 * (`subtestsFailed`) and a subtest cancelled because its parent failed on its own (a hook, a
 * timeout). A subtest its parent ended without awaiting is the cause of the parent's failure, so
 * it is reported in the parent's place. A red test never goes without a word.
 */
export async function* reportFailures(source, { summaryFile, cwd = process.cwd() } = {}) {
  const files = new Map()
  const failures = []
  for await (const { type, data } of source) {
    if (data?.file === undefined) continue
    // test:stderr names the file as the command line did, the test events by its absolute path.
    const key = path.resolve(cwd, data.file)
    if (!files.has(key)) files.set(key, { frames: [], output: "" })
    const state = files.get(key)
    const { frames } = state
    if (type === "test:stderr" || type === "test:diagnostic") {
      const text = type === "test:stderr" ? data.message : `${data.message}\n`
      state.output = `${state.output}${text}`.slice(-STDERR_LIMIT)
      continue
    }
    if (type === "test:start") {
      frames.length = data.nesting
      frames[data.nesting] = frame(data.name)
      continue
    }
    if (type !== "test:pass" && type !== "test:fail") continue
    const own = frames[data.nesting] ?? frame(data.name)
    const parent = data.nesting > 0 ? frames[data.nesting - 1] : undefined
    const { output } = state
    state.output = ""
    const failureType = data.details?.error?.failureType
    const failed = type === "test:fail" && data.todo === undefined
    // A cancelled subtest is explained only by its parent's own failure.
    const found = failed && failureType !== "subtestsFailed" ? [] : own.cancelled
    own.cancelled = []
    if (failed) {
      const ancestors = frames.slice(0, data.nesting).map((above) => above?.name ?? "")
      const failure = failureOf(data, ancestors, { cwd, output })
      if (failureType === "cancelledByParent" && parent) parent.cancelled.push(failure)
      else if (failureType !== "subtestsFailed" || (found.length === 0 && !own.reported)) {
        found.push(failure)
      }
    }
    if (found.length === 0) continue
    for (const above of frames.slice(0, data.nesting)) if (above) above.reported = true
    for (const failure of found) {
      failures.push(failure)
      yield annotation(failure)
    }
  }
  if (failures.length > 0 && summaryFile) appendFileSync(summaryFile, summaryTable(failures))
}

export default async function* ghaReporter(source) {
  yield* reportFailures(source, { summaryFile: process.env.GITHUB_STEP_SUMMARY })
}
