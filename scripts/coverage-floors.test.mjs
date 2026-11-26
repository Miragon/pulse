import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import * as floors from "./coverage-floors.mjs"
import {
  FLOOR_MARGIN,
  METRICS,
  coverageFloors,
  floorFindings,
  floorGroups,
} from "./coverage-floors.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = "/pkg"

/** A file's summary: `[covered, total]` per metric, every metric not named 10 of 10. */
function summary(counts = {}) {
  return Object.fromEntries(
    METRICS.map((metric) => {
      const [covered, total] = counts[metric] ?? [10, 10]
      return [metric, { covered, total, skipped: 0, pct: 0 }]
    }),
  )
}

/** A coverage map as istanbul's reads, from `{ relPath: summary }` under ROOT. */
function coverageMap(files) {
  const byPath = new Map(
    Object.entries(files).map(([rel, data]) => [path.posix.join(ROOT, rel), data]),
  )
  return {
    files: () => [...byPath.keys()],
    fileCoverageFor: (file) => ({ toSummary: () => ({ data: byPath.get(file) }) }),
  }
}

const all = (value) => Object.fromEntries(METRICS.map((metric) => [metric, value]))

describe("floorFindings: a floor follows its measurement", () => {
  it("passes floors up to the margin under the measurement, the margin itself included", () => {
    const map = coverageMap({ "src/a.ts": summary({ lines: [93, 100], branches: [975, 1000] }) })
    assert.deepEqual(floorFindings(map, { ...all(100), lines: 90, branches: 95 }, ROOT), [])
    assert.equal(FLOOR_MARGIN, 3)
  })

  it("fails a global floor more than the margin under, and says what to raise it to", () => {
    const map = coverageMap({ "src/a.ts": summary({ branches: [9342, 10000] }) })
    const findings = floorFindings(map, { ...all(100), branches: 78 }, ROOT)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /^the global floor for branches \(78%\) trails the measurement/)
    assert.match(findings[0], /by 15\.42 points \(the run measures 93\.42%\)/)
    assert.match(findings[0], /more than the 3 a floor may trail it/)
    assert.match(
      findings[0],
      /raise it to a value from 91 to 93 \(93 is the measurement rounded down\)/,
    )
  })

  it("reads each metric on its own, as istanbul rounds it (2 decimals, down)", () => {
    // 2/3 lines = 66.66 %, the rest 100 %: lines (6.66 points) and functions (10) trail,
    // statements (1) and branches (2) hold.
    const map = coverageMap({ "src/a.ts": summary({ lines: [2, 3] }) })
    const findings = floorFindings(
      map,
      { lines: 60, functions: 90, statements: 99, branches: 98 },
      ROOT,
    )
    assert.deepEqual(
      findings.map((finding) => finding.match(/floor for (\w+)/)[1]),
      ["lines", "functions"],
    )
    assert.match(findings[0], /\(the run measures 66\.66%\)/)
  })

  it("sums the files of a group as istanbul merges them, not their percentages", () => {
    const map = coverageMap({
      "src/a.ts": summary({ lines: [1, 1] }),
      "src/b.ts": summary({ lines: [49, 99] }),
    })
    // 50 of 100 lines: a floor of 47 holds, one of 46 trails by 4 (the files' mean, 74.74 %,
    // would fail both).
    assert.deepEqual(floorFindings(map, { ...all(100), lines: 47 }, ROOT), [])
    const findings = floorFindings(map, { ...all(100), lines: 46 }, ROOT)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /by 4 points \(the run measures 50%\)/)
  })

  it("holds a glob key's floors over the files it matches, relative to the config's root", () => {
    const map = coverageMap({
      "src/web/a.ts": summary(),
      "src/web/b.ts": summary(),
      "src/other.ts": summary({ lines: [5, 10] }),
    })
    const thresholds = {
      lines: 50,
      functions: 100,
      statements: 100,
      branches: 100,
      "src/web/**": { lines: 90 },
    }
    const groups = floorGroups(map, thresholds, ROOT)
    assert.deepEqual(
      groups.map(({ name, files }) => [name, files.map((file) => path.posix.relative(ROOT, file))]),
      [
        ["global", ["src/web/a.ts", "src/web/b.ts", "src/other.ts"]],
        ['"src/web/**"', ["src/web/a.ts", "src/web/b.ts"]],
      ],
    )
    const findings = floorFindings(map, thresholds, ROOT)
    assert.equal(findings.length, 2)
    // The global floors count every measured file, the glob's too, as vitest's do: 25/30 lines.
    assert.match(findings[0], /the global floor for lines \(50%\) .* measures 83\.33%/)
    assert.match(findings[1], /the "src\/web\/\*\*" floor for lines \(90%\) .* measures 100%/)
  })

  it("never fails a floor of 100, written out or as `100: true`", () => {
    const map = coverageMap({ "src/a.ts": summary(), "src/web/b.ts": summary() })
    assert.deepEqual(floorFindings(map, { 100: true, "src/web/**": { 100: true } }, ROOT), [])
    assert.deepEqual(floorFindings(map, all(100), ROOT), [])
    assert.equal(floorFindings(map, { 100: true, "src/web/**": { lines: 50 } }, ROOT).length, 1)
  })

  it("reads `perFile` by its least covered file, as vitest's autoUpdate does", () => {
    const map = coverageMap({
      "src/a.ts": summary({ lines: [95, 100] }),
      "src/b.ts": summary(),
    })
    assert.deepEqual(floorFindings(map, { ...all(100), lines: 93, perFile: true }, ROOT), [])
    const findings = floorFindings(map, { ...all(90), lines: 93, perFile: true }, ROOT)
    // a.ts at 95 lines and 100 elsewhere: lines hold, the other three trail by 10.
    assert.deepEqual(
      findings.map((finding) => finding.match(/floor for (\w+)/)[1]),
      ["functions", "statements", "branches"],
    )
    assert.match(findings[0], /its least covered file measures 100%/)
  })

  it("holds a `perFile` object's floors over each file, beside the group's own", () => {
    const map = coverageMap({ "src/a.ts": summary({ lines: [8, 10] }), "src/b.ts": summary() })
    const findings = floorFindings(map, { ...all(100), lines: 90, perFile: { lines: 70 } }, ROOT)
    assert.equal(findings.length, 1)
    assert.match(
      findings[0],
      /the global per-file floor for lines \(70%\) .* least covered file measures 80%/,
    )
  })

  it("counts a count floor (-N uncovered) in the points it leaves beyond the measurement", () => {
    const map = coverageMap({ "src/a.ts": summary({ lines: [98, 100] }) })
    const holds = floorFindings(map, { ...all(100), lines: -5 }, ROOT)
    assert.deepEqual(holds, [])
    const findings = floorFindings(map, { ...all(100), lines: -10 }, ROOT)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /floor for lines \(10 uncovered\) trails the measurement by 8 points/)
    assert.match(findings[0], /2 of 100 uncovered, 98%/)
    assert.match(findings[0], /lower the count to one from -2 to -5/)
  })

  it("takes another margin", () => {
    const map = coverageMap({ "src/a.ts": summary({ lines: [97, 100] }) })
    assert.deepEqual(floorFindings(map, { ...all(100), lines: 95 }, ROOT, 3), [])
    assert.equal(floorFindings(map, { ...all(100), lines: 95 }, ROOT, 1).length, 1)
    // A margin under a point leaves one whole number or none to raise to.
    const half = coverageMap({ "src/a.ts": summary({ lines: [101, 200] }) })
    const hint = (margin) => floorFindings(half, { ...all(100), lines: 40 }, ROOT, margin)[0]
    assert.match(hint(0.6), /raise it to 50 \(the measurement rounded down\)$/)
    assert.match(hint(0.2), /raise it to 50\.5 \(the measurement\)$/)
  })

  it("reads nothing without thresholds", () => {
    assert.deepEqual(floorFindings(coverageMap({}), undefined, ROOT), [])
  })
})

describe("floorFindings: a floor measures something", () => {
  it("fails a global scope without a file", () => {
    const findings = floorFindings(coverageMap({}), all(90), ROOT)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /^the measured scope holds no file, so its floors hold over 0 of 0/)
    assert.match(findings[0], /point coverage.include at the package's sources/)
  })

  it("fails a global scope whose files hold no statement (types, barrels of re-exports)", () => {
    const empty = summary(all([0, 0]))
    const findings = floorFindings(coverageMap({ "src/types.ts": empty }), all(90), ROOT)
    assert.equal(findings.length, 1)
    assert.match(findings[0], /^the measured scope holds 1 file without a statement/)
  })

  it("fails a glob key that matches no measured file, or none with a statement", () => {
    const map = coverageMap({ "src/a.ts": summary(), "src/types.ts": summary(all([0, 0])) })
    const findings = floorFindings(
      map,
      { ...all(100), "src/gone/**": { lines: 90 }, "src/types.ts": { 100: true } },
      ROOT,
    )
    assert.deepEqual(findings, [
      `the glob "src/gone/**" (relative to the config's root) matches no measured file, so its floors hold over 0 of 0 (read as 100 %) and pass whatever the tests do: point the glob at measured files`,
      `the glob "src/types.ts" (relative to the config's root) matches only 1 file without a statement, so its floors hold over 0 of 0 (read as 100 %) and pass whatever the tests do: point the glob at measured files`,
    ])
  })

  it("passes a scope without a branch under any branch floor: nothing there to follow", () => {
    const map = coverageMap({ "src/a.ts": summary({ branches: [0, 0] }) })
    assert.deepEqual(floorFindings(map, all(100), ROOT), [])
    assert.deepEqual(floorFindings(map, { ...all(100), branches: 80 }, ROOT), [])
    const perFile = coverageMap({
      "src/a.ts": summary({ branches: [0, 0] }),
      "src/b.ts": summary(),
    })
    assert.deepEqual(floorFindings(perFile, { ...all(100), perFile: true }, ROOT), [])
  })

  it("reports an empty scope once, not as floors that trail a 100 % read of nothing", () => {
    assert.equal(
      floorFindings(coverageMap({}), { ...all(50), perFile: { lines: 50 } }, ROOT).length,
      1,
    )
  })

  it("leaves a glob key without a floor alone", () => {
    assert.deepEqual(
      floorFindings(coverageMap({ "src/a.ts": summary() }), { ...all(100), "src/x/**": {} }, ROOT),
      [],
    )
  })
})

describe("coverageFloors: the reporter reads a whole passing run only", () => {
  const lagging = { ...all(100), lines: 50 }
  const map = coverageMap({ "src/a.ts": summary() })

  /** Drives the reporter through one run; returns what it logged and the exit code it set. */
  async function run({
    config = {},
    specs = 2,
    globbed = 2,
    reason = "passed",
    coverage = map,
  } = {}) {
    const logged = []
    const vitest = {
      config: { root: ROOT, watch: false, coverage: { thresholds: lagging }, ...config },
      vite: { config: { configFile: path.join(repoRoot, "packages/x/vitest.config.ts") } },
      logger: { error: (message) => logged.push(message) },
      globTestSpecifications: async () => Array.from({ length: globbed }),
    }
    const reporter = coverageFloors()
    const before = process.exitCode
    try {
      reporter.onInit(vitest)
      await reporter.onTestRunStart(Array.from({ length: specs }))
      if (coverage) reporter.onCoverage(coverage)
      reporter.onTestRunEnd([], [], reason)
      return { logged, exitCode: process.exitCode }
    } finally {
      process.exitCode = before
    }
  }

  it("fails a whole passing run whose floor lags, naming the package's config", async () => {
    const { logged, exitCode } = await run()
    assert.equal(exitCode, 1)
    assert.equal(logged.length, 2)
    assert.match(
      logged[0],
      /^ERROR: Coverage floors of packages\/x\/vitest\.config\.ts: the global floor for lines \(50%\)/,
    )
    assert.match(logged[1], /scripts\/coverage-floors\.mjs/)
  })

  it("stays quiet where the floors follow", async () => {
    const { logged, exitCode } = await run({ config: { coverage: { thresholds: all(100) } } })
    assert.deepEqual(logged, [])
    assert.equal(exitCode, undefined)
  })

  for (const [what, options] of [
    ["a run of some files", { specs: 1 }],
    ["a run of some tests (-t)", { config: { testNamePattern: /adds/ } }],
    ["a shard", { config: { shard: { index: 1, count: 2 } } }],
    ["a run of some projects", { config: { project: ["unit"] } }],
    ["a run of the changed files", { config: { changed: true } }],
    ["a run of related files", { config: { related: ["src/a.ts"] } }],
    ["watch mode", { config: { watch: true } }],
    ["a run with a failed test", { reason: "failed" }],
    ["an interrupted run", { reason: "interrupted" }],
    ["a run without coverage", { coverage: null }],
  ])
    it(`reads nothing of ${what}`, async () => {
      const { logged, exitCode } = await run(options)
      assert.deepEqual(logged, [])
      assert.equal(exitCode, undefined)
    })

  it("declares what the module exports", () => {
    const declarations = readFileSync(path.join(repoRoot, "scripts/coverage-floors.d.mts"), "utf8")
    const declared = [...declarations.matchAll(/^export declare (?:function|const) (\w+)/gm)].map(
      ([, name]) => name,
    )
    assert.deepEqual(declared.sort(), Object.keys(floors).sort())
  })
})

describe("`vitest run` over the real vitest.shared.ts", () => {
  const runs = {}
  let fixtures

  /** A package that merges sharedConfig, with one source file its one test covers whole. */
  function fixture(coverage) {
    const dir = mkdtempSync(path.join(fixtures, "pkg-"))
    mkdirSync(path.join(dir, "src"))
    mkdirSync(path.join(dir, "test"))
    writeFileSync(path.join(dir, "src/sum.js"), "export function sum(a, b) {\n  return a + b\n}\n")
    writeFileSync(
      path.join(dir, "test/sum.test.js"),
      'import { sum } from "../src/sum.js"\n\ntest("adds", () => {\n  expect(sum(1, 2)).toBe(3)\n})\n',
    )
    writeFileSync(
      path.join(dir, "vitest.config.mjs"),
      [
        `import { mergeConfig } from ${JSON.stringify(import.meta.resolve("vitest/config"))}`,
        `import { sharedConfig } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "vitest.shared.ts")).href)}`,
        "",
        "export default mergeConfig(sharedConfig, {",
        `  test: { globals: true, include: ["test/**/*.test.js"], coverage: ${JSON.stringify(coverage)} },`,
        "})",
        "",
      ].join("\n"),
    )
    return dir
  }

  async function vitestRun(dir) {
    const env = { ...process.env, CI: "", GITHUB_ACTIONS: "" }
    delete env.NODE_TEST_CONTEXT
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [path.join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", "--root", dir],
        { cwd: dir, env, encoding: "utf8" },
      )
      return { code: 0, output: stdout + stderr }
    } catch (error) {
      return { code: error.code, output: `${error.stdout}${error.stderr}` }
    }
  }

  before(async () => {
    fixtures = mkdtempSync(path.join(tmpdir(), "coverage-floors-"))
    const cases = {
      follows: { include: ["src/**/*.js"], thresholds: { ...all(98), "src/**": { 100: true } } },
      lags: { include: ["src/**/*.js"], thresholds: { ...all(100), lines: 90 } },
      empty: { include: ["lib/**/*.js"], thresholds: all(90) },
      emptyGlob: {
        include: ["src/**/*.js"],
        thresholds: { ...all(100), "src/gone/**": { lines: 90 } },
      },
    }
    const entries = Object.entries(cases)
    const results = await Promise.all(entries.map(([, coverage]) => vitestRun(fixture(coverage))))
    entries.forEach(([name], index) => (runs[name] = results[index]))
  })

  after(() => rmSync(fixtures, { recursive: true, force: true }))

  it("passes floors that follow their measurement", () => {
    assert.equal(runs.follows.code, 0, runs.follows.output)
    assert.doesNotMatch(runs.follows.output, /Coverage floors of/)
  })

  it("fails a floor that lags: vitest's own check passes it", () => {
    assert.equal(runs.lags.code, 1, runs.lags.output)
    assert.match(
      runs.lags.output,
      /the global floor for lines \(90%\) trails the measurement by 10 points/,
    )
    assert.doesNotMatch(runs.lags.output, /does not meet/)
  })

  it("fails an empty measured scope: vitest's own check passes it", () => {
    assert.equal(runs.empty.code, 1, runs.empty.output)
    assert.match(runs.empty.output, /the measured scope holds no file/)
    assert.doesNotMatch(runs.empty.output, /does not meet/)
  })

  it("fails a glob key that matches no measured file", () => {
    assert.equal(runs.emptyGlob.code, 1, runs.emptyGlob.output)
    assert.match(
      runs.emptyGlob.output,
      /the glob "src\/gone\/\*\*" \(.*\) matches no measured file/,
    )
  })
})
