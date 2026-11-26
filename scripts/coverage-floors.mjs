// @ts-check
/**
 * Coverage floors follow their measurement and measure something (#688, F103 and F104): a vitest
 * reporter that every package's coverage run carries through vitest.shared.ts, next to vitest's
 * own threshold check. vitest fails a floor the measurement falls below, but nothing failed a
 * floor the measurement had left far behind (engine-connector's stood unchanged from 2026-10-12,
 * up to 13 points under, the runtime view's webview's up to 21), so a change could drop that much
 * coverage unseen; and a floor over a scope that measured nothing passed whatever the tests did
 * (apps/vscode measured 0 of 0 statements from #585 to #595, which istanbul reads as 100 %).
 *
 * Over the coverage map vitest checks its thresholds against, grouped as vitest groups it (every
 * measured file under the global floors, also the files a glob key matches; under a glob key's
 * floors the files it matches relative to the config's root; with `perFile` the least covered
 * file, as vitest's own `autoUpdate` reads it), a run fails
 * - where a floor trails its measurement by more than FLOOR_MARGIN points (a count floor, `-N`
 *   uncovered, by the points of the group it leaves uncovered beyond what the run leaves), and
 * - where a group that carries a floor measures no statement: a global scope without a file or
 *   with files that hold none, a glob key that matches no such file.
 *
 * The margin is 3 points. The packages write a floor in one of two ways, the measured value
 * rounded down (less than 1 point behind) or 2 points under it, rounded down (less than 3 behind),
 * and both hold; it is the most a change can lose unseen, against up to 21 before. Full runs on
 * the same code read the same numbers in every package but the CLI, whose property tests move its
 * totals by hundredths of a point, so the margin is room for changes, not for noise: a floor
 * rounded down, less a point, sits 1 to 2 points under the measurement and keeps at least a point
 * either way, for a change that leaves a line uncovered as for one that covers more without
 * raising the floor.
 *
 * It reads a whole `vitest run` whose tests passed, nothing else: a run narrowed to some files,
 * tests (`-t`), projects or a shard, `--changed` and watch mode measure less than the floors hold
 * (scripts/local-test-one.mjs switches coverage off for that), and after a failed test vitest
 * checks no floor either. It changes nothing vitest measures or checks. No package drops it:
 * lint:package-scripts holds every package's test script to exactly `vitest run`, which takes no
 * `--reporter`, and its vitest.config.ts to `mergeConfig(sharedConfig, …)`, which keeps the
 * shared reporters (scripts/vitest-wiring.mjs). scripts/coverage-floors.d.mts types it for
 * vitest.shared.ts, and scripts/coverage-floors.test.mjs holds it to planted floors and scopes,
 * the last cases through `vitest run` over the real vitest.shared.ts.
 */
/**
 * Its declarations, which vitest.shared.ts reads: knip resolves that import of this module to it,
 * never to the declaration file, and sees them used through this namespace;
 * scripts/coverage-floors.test.mjs holds the declarations to the module's exports.
 * @import * as Declarations from "./coverage-floors.d.mts"
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import picomatch from "picomatch"

/** How many points a floor may trail its measurement. */
export const FLOOR_MARGIN = 3

/** The four metrics, in the order vitest reports them. */
export const METRICS = ["lines", "functions", "statements", "branches"]

/** Keys of `coverage.thresholds` that are no glob. */
const RESERVED = new Set(["perFile", "autoUpdate", "100", ...METRICS])

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** istanbul's percentage: 2 decimals, rounded down, 100 for nothing to cover. */
const percent = (covered, total) =>
  total > 0 ? Math.floor((100_000 * covered) / total / 10) / 100 : 100

/** A threshold entry's floors as vitest resolves them (`100: true` sets all four). */
function floorsOf(entry) {
  if (!entry || typeof entry !== "object") return {}
  if (entry[100] === true) return Object.fromEntries(METRICS.map((metric) => [metric, 100]))
  return Object.fromEntries(
    METRICS.filter((metric) => typeof entry[metric] === "number").map((metric) => [
      metric,
      entry[metric],
    ]),
  )
}

/**
 * The checks of one threshold entry, as vitest's checkThresholds runs them: its floors over the
 * group, or over each file with `perFile: true`, and a `perFile` object's floors over each file.
 */
function checksOf(label, entry) {
  const perFile = entry && typeof entry === "object" ? entry.perFile : undefined
  const checks = [{ label, floors: floorsOf(entry), perFile: perFile === true }]
  if (perFile && typeof perFile === "object")
    checks.push({ label: `${label} per-file`, floors: floorsOf(perFile), perFile: true })
  return checks.filter((check) => Object.keys(check.floors).length > 0)
}

/** A file's path as vitest matches a glob key: relative to the config's root, with slashes. */
const relativeTo = (root, file) => path.relative(root, file).split(path.sep).join("/")

/**
 * The groups vitest checks floors over: `global` (every measured file) and one per glob key (the
 * files it matches), each with the summaries of its files and its checks.
 */
export function floorGroups(coverageMap, thresholds, root) {
  const files = coverageMap.files()
  const summaryOf = new Map(
    files.map((file) => [file, coverageMap.fileCoverageFor(file).toSummary().data]),
  )
  const groupOf = (name, matched, checks) => ({
    name,
    files: matched,
    summaries: matched.map((file) => summaryOf.get(file)),
    checks,
  })
  const groups = [groupOf("global", files, checksOf("global", thresholds))]
  for (const key of Object.keys(thresholds)) {
    if (RESERVED.has(key)) continue
    const matches = picomatch(key)
    const matched = files.filter((file) => matches(relativeTo(root, file)))
    groups.push(groupOf(`"${key}"`, matched, checksOf(`"${key}"`, thresholds[key])))
  }
  return groups
}

/** How many points `floor` trails one summary's measurement of `metric`, with the reading. */
function lagOf(summary, metric, floor) {
  const { total, covered } = summary[metric]
  const uncovered = total - covered
  const measured = percent(covered, total)
  const lag = floor >= 0 ? measured - floor : (100 * (-floor - uncovered)) / total
  return { lag, measured, total, uncovered }
}

/** The group's sums per metric, as istanbul merges the summaries of its files. */
function merged(summaries) {
  return Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      summaries.reduce(
        (sum, summary) => ({
          total: sum.total + summary[metric].total,
          covered: sum.covered + summary[metric].covered,
        }),
        { total: 0, covered: 0 },
      ),
    ]),
  )
}

const points = (value) => `${Number(value.toFixed(2))}`

/** What to raise a floor that lags to: anything from the margin under it to the measurement. */
function raiseHint(reading, floor, margin) {
  if (floor >= 0) {
    const highest = Math.floor(reading.measured)
    const lowest = Math.ceil(reading.measured - margin)
    if (lowest < highest)
      return `raise it to a value from ${lowest} to ${highest} (${highest} is the measurement rounded down)`
    if (lowest === highest) return `raise it to ${highest} (the measurement rounded down)`
    return `raise it to ${reading.measured} (the measurement)`
  }
  const loosest = reading.uncovered + Math.floor((margin * reading.total) / 100)
  return `lower the count to one from -${reading.uncovered} to -${loosest}`
}

/**
 * Each floor of a check that trails its measurement by more than the margin. A metric the group
 * (per file: every file) counts none of has no measurement to follow: an empty scope is
 * emptyFinding's, and a scope without a branch reads 100 %, as vitest reads it, under any floor.
 */
function lagFindings(group, check, margin) {
  const findings = []
  for (const [metric, floor] of Object.entries(check.floors)) {
    const measured = (check.perFile ? group.summaries : [merged(group.summaries)]).filter(
      (summary) => summary[metric].total > 0,
    )
    if (measured.length === 0) continue
    const reading = measured
      .map((summary) => lagOf(summary, metric, floor))
      .reduce((least, next) => (next.lag < least.lag ? next : least))
    if (reading.lag <= margin + 1e-9) continue
    const what = check.perFile ? "its least covered file measures" : "the run measures"
    const floorText = floor >= 0 ? `${floor}%` : `${-floor} uncovered`
    const reads =
      floor >= 0
        ? `${reading.measured}%`
        : `${reading.uncovered} of ${reading.total} uncovered, ${reading.measured}%`
    findings.push(
      `the ${check.label} floor for ${metric} (${floorText}) trails the measurement by ` +
        `${points(reading.lag)} points (${what} ${reads}), more than the ${margin} a floor may ` +
        `trail it, so that much coverage could go unseen: ${raiseHint(reading, floor, margin)}`,
    )
  }
  return findings
}

/** A group that carries a floor but counts no statement: its floors hold over 0 of 0. */
function emptyFinding(group) {
  if (group.checks.length === 0) return []
  const statements = group.summaries.reduce((sum, summary) => sum + summary.statements.total, 0)
  if (statements > 0) return []
  const count = group.files.length
  const files = `${count} file${count === 1 ? "" : "s"} without a statement`
  const [what, fix] =
    group.name === "global"
      ? [
          `the measured scope holds ${count === 0 ? "no file" : files}`,
          "point coverage.include at the package's sources, or load them from a test",
        ]
      : [
          `the glob ${group.name} (relative to the config's root) matches ${count === 0 ? "no measured file" : `only ${files}`}`,
          "point the glob at measured files",
        ]
  return [
    `${what}, so its floors hold over 0 of 0 (read as 100 %) and pass whatever the tests do: ${fix}`,
  ]
}

/** Every floor of `thresholds` that lags its measurement or holds over an empty scope. */
export function floorFindings(coverageMap, thresholds, root, margin = FLOOR_MARGIN) {
  if (!thresholds || typeof thresholds !== "object") return []
  return floorGroups(coverageMap, thresholds, root).flatMap((group) => [
    ...emptyFinding(group),
    ...group.checks.flatMap((check) => lagFindings(group, check, margin)),
  ])
}

/** Whether this run is the package's whole suite, the run its floors are written for. */
async function isWholeRun(vitest, specifications) {
  const { config } = vitest
  if (config.watch || config.shard || config.testNamePattern || config.changed) return false
  if (config.related?.length || config.project?.length) return false
  const every = await vitest.globTestSpecifications()
  return specifications.length >= every.length
}

/** Fails the run with each finding, named by the config whose floors it is about. */
function failRun(vitest, findings) {
  process.exitCode = 1
  const config = vitest.vite?.config?.configFile ?? vitest.config.root
  const where = path.relative(REPO_ROOT, config) || config
  for (const finding of findings)
    vitest.logger.error(`ERROR: Coverage floors of ${where}: ${finding}.`)
  vitest.logger.error(
    "Floors follow the measurement (scripts/coverage-floors.mjs): a raise needs no " +
      "Ratchet-Exception trailer, and a floor over an empty scope holds nothing.",
  )
}

/** The reporter vitest.shared.ts hands every package's run. */
export function coverageFloors({ margin = FLOOR_MARGIN } = {}) {
  let vitest
  let whole = false
  let coverage
  return {
    onInit(ctx) {
      vitest = ctx
    },
    async onTestRunStart(specifications) {
      coverage = undefined
      whole = vitest !== undefined && (await isWholeRun(vitest, specifications))
    },
    onCoverage(map) {
      coverage = map
    },
    onTestRunEnd(_modules, _errors, reason) {
      if (!vitest || !whole || reason !== "passed" || coverage === undefined) return
      const { config } = vitest
      const findings = floorFindings(coverage, config.coverage?.thresholds, config.root, margin)
      if (findings.length > 0) failRun(vitest, findings)
    },
  }
}
