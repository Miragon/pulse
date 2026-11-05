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

/** Failures another failure explains: the parent of a failed subtest, a test its parent cancelled. */
const FOLLOW_ON = new Set(["subtestsFailed", "cancelledByParent"])

const escapeData = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")

const escapeProperty = (text) => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C")

const cut = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

/** The assertion behind node:test's wrapper, and how a crashed test file ended. */
function messageOf(error) {
  const message = (error?.cause?.message ?? error?.message ?? "test failed").trim()
  const exit = error?.exitCode ?? error?.signal
  return exit ? `${message} (exit ${exit})` : message
}

/** A `test:fail` event's failure; `ancestors` are the names of the suites around it. */
export function failureOf({ name, file, line, details }, ancestors = [], cwd = process.cwd()) {
  return {
    title: [...ancestors, name].join(" > "),
    file: file && path.relative(cwd, file),
    line,
    message: messageOf(details?.error),
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

export default async function* ghaReporter(source) {
  /** Per test file, the names of the tests running by nesting: suites start in definition order. */
  const running = new Map()
  const failures = []
  const followOn = []
  for await (const { type, data } of source) {
    if (type === "test:start") {
      const names = running.get(data.file) ?? []
      names.length = data.nesting
      names[data.nesting] = data.name
      running.set(data.file, names)
    }
    if (type !== "test:fail" || data.todo !== undefined) continue
    const failure = failureOf(data, running.get(data.file)?.slice(0, data.nesting))
    if (FOLLOW_ON.has(data.details?.error?.failureType)) {
      followOn.push(failure)
      continue
    }
    failures.push(failure)
    yield annotation(failure)
  }
  // Follow-ons with no failure behind them (a subtest its parent never awaited) still turned the
  // run red, so they speak rather than leave a red step without a word.
  if (failures.length === 0) yield* followOn.map(annotation)
  const reported = failures.length > 0 ? failures : followOn
  if (reported.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(reported))
  }
}
