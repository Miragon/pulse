import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  annotation,
  failureOf,
  lastError,
  reportFailures,
  summaryTable,
} from "./gha-test-reporter.mjs"

const REPORTER = fileURLToPath(new URL("./gha-test-reporter.mjs", import.meta.url))
const GUARD = path.resolve("scripts/guard.test.mjs")

const failEvent = (name, nesting, failureType, extra = {}) => ({
  type: "test:fail",
  data: {
    name,
    nesting,
    file: GUARD,
    line: 7,
    details: { error: { failureType, message: `${name} wrapper`, cause: { message: "boom" } } },
    ...extra,
  },
})
const startEvent = (name, nesting) => ({
  type: "test:start",
  data: { name, nesting, file: GUARD },
})
const passEvent = (name, nesting) => ({ type: "test:pass", data: { name, nesting, file: GUARD } })

/** The reporter's lines; it reads no environment, so this run's own job summary stays clean. */
async function report(events, options) {
  const lines = []
  for await (const line of reportFailures(Readable.from(events), options)) lines.push(line)
  return lines
}

describe("the workflow command", () => {
  it("names the file, the line, the test and the message", () => {
    assert.equal(
      annotation({ title: "a > b", file: "scripts/x.test.mjs", line: 3, message: "boom" }),
      "::error file=scripts/x.test.mjs,line=3::a > b: boom\n",
    )
  })

  it("stays one line whatever the message holds", () => {
    assert.equal(
      annotation({ title: "100%", file: "a:b,c.mjs", line: 1, message: "one\r\ntwo" }),
      "::error file=a%3Ab%2Cc.mjs,line=1::100%25: one%0D%0Atwo\n",
    )
  })

  it("leaves out what it does not know", () => {
    assert.equal(annotation({ title: "t", message: "m" }), "::error::t: m\n")
  })

  it("cuts a long message", () => {
    const line = annotation({ title: "t", message: "x".repeat(5000) })
    assert.ok(line.length < 2100, String(line.length))
    assert.ok(line.endsWith("…\n"))
  })
})

describe("the failure", () => {
  it("reads the assertion behind node:test's wrapper, the file relative to the repo", () => {
    const { data } = failEvent("t", 1, "testCodeFailure")
    assert.deepEqual(failureOf(data, ["suite"]), {
      title: "suite > t",
      file: "scripts/guard.test.mjs",
      line: 7,
      message: "boom",
    })
  })

  it("says how a crashed test file ended and the error it printed last", () => {
    const crashed = (error, output) =>
      failureOf({ name: "x.test.mjs", file: "/repo/x.test.mjs", line: 1, details: { error } }, [], {
        output,
      }).message
    assert.equal(
      crashed({ message: "test failed", cause: "test failed", exitCode: 7 }),
      "test failed (exit 7)",
    )
    assert.equal(
      crashed({ message: "test failed", signal: "SIGKILL", exitCode: null }),
      "test failed (exit SIGKILL)",
    )
    assert.equal(
      crashed(
        { message: "test failed", exitCode: 1 },
        "const x = ;\n\nSyntaxError: Unexpected token ';'\n    at y\n",
      ),
      "test failed (exit 1): SyntaxError: Unexpected token ';'",
    )
  })

  it("reads the error a file printed last, past one a test logged and the stack", () => {
    assert.equal(
      lastError(
        [
          "Error: logged on purpose",
          "file:///repo/x.test.mjs:1",
          "    throw new ERR_MODULE_NOT_FOUND(",
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './y.mjs'",
          "    at resolve (node:internal)",
          "Node.js v22.22.2",
        ].join("\n"),
      ),
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './y.mjs'",
    )
    assert.equal(lastError("Errors: 3 ErrorBoundary\nall fine"), undefined)
    assert.equal(lastError(undefined), undefined)
  })
})

describe("the summary table", () => {
  it("lists every failure and keeps a cell on its one row", () => {
    const table = summaryTable([
      { title: "a | b", file: "x.mjs", line: 2, message: "one\ntwo <b> & c" },
      { title: "crash", message: "m" },
    ])
    assert.deepEqual(table.split("\n"), [
      "### Failed tests: 2",
      "",
      "| Test | Where | Message |",
      "| --- | --- | --- |",
      "| a \\| b | x.mjs:2 | one two &lt;b> &amp; c |",
      "| crash |  | m |",
      "",
      "",
    ])
  })
})

describe("the reporter", () => {
  it("prints one line per real failure, with the suites around it", async () => {
    assert.deepEqual(
      await report([
        startEvent("outer", 0),
        startEvent("inner", 1),
        startEvent("passes", 2),
        passEvent("passes", 2),
        startEvent("fails", 2),
        failEvent("fails", 2, "testCodeFailure", { line: 9 }),
        failEvent("inner", 1, "subtestsFailed"),
        failEvent("outer", 0, "subtestsFailed"),
      ]),
      ["::error file=scripts/guard.test.mjs,line=9::outer > inner > fails: boom\n"],
    )
  })

  it("keeps the suites of two test files apart", async () => {
    const [line] = await report([
      startEvent("outer", 0),
      { type: "test:start", data: { name: "other", nesting: 0, file: "/other.test.mjs" } },
      startEvent("fails", 1),
      failEvent("fails", 1, "testCodeFailure"),
    ])
    assert.match(line, /::outer > fails: boom\n$/)
  })

  it("ignores a failing todo", async () => {
    assert.deepEqual(await report([failEvent("later", 0, "testCodeFailure", { todo: true })]), [])
  })

  it("leaves a cancelled test to its parent's own failure", async () => {
    const lines = await report([
      startEvent("suite", 0),
      startEvent("a", 1),
      failEvent("a", 1, "cancelledByParent"),
      startEvent("b", 1),
      failEvent("b", 1, "cancelledByParent"),
      failEvent("suite", 0, "hookFailed"),
    ])
    assert.deepEqual(lines, ["::error file=scripts/guard.test.mjs,line=7::suite: boom\n"])
  })

  it("reports a subtest its parent never awaited in the parent's place, next to other failures", async () => {
    const lines = await report([
      startEvent("suite", 0),
      startEvent("real", 1),
      failEvent("real", 1, "testCodeFailure"),
      failEvent("suite", 0, "subtestsFailed"),
      startEvent("unawaited parent", 0),
      startEvent("late child", 1),
      failEvent("late child", 1, "cancelledByParent"),
      failEvent("unawaited parent", 0, "subtestsFailed"),
    ])
    assert.deepEqual(
      lines.map((line) => line.split("::")[2]),
      ["suite > real: boom\n", "unawaited parent > late child: boom\n"],
    )
  })

  it("never leaves a red test without a word", async () => {
    const orphan = await report([failEvent("a", 1, "cancelledByParent")])
    assert.equal(orphan.length, 1)
    assert.match(orphan[0], /a: boom/)
    const parent = await report([startEvent("p", 0), failEvent("p", 0, "subtestsFailed")])
    assert.equal(parent.length, 1)
    assert.match(parent[0], /p: boom/)
  })

  it("names the error a crashed test file printed", async () => {
    const crash = (name) => ({
      type: "test:fail",
      data: {
        name,
        nesting: 0,
        file: GUARD,
        line: 1,
        details: { error: { failureType: "testCodeFailure", message: "test failed", exitCode: 1 } },
      },
    })
    const stderr = (message) => ({ type: "test:stderr", data: { file: GUARD, message } })
    const lines = await report([
      stderr("Error: logged by a test that passed\n"),
      startEvent("passes", 0),
      passEvent("passes", 0),
      {
        type: "test:diagnostic",
        data: { file: GUARD, nesting: 0, message: "Error: uncaught later" },
      },
      startEvent("guard.test.mjs", 0),
      crash("guard.test.mjs"),
    ])
    assert.deepEqual(lines, [
      "::error file=scripts/guard.test.mjs,line=1::guard.test.mjs: test failed (exit 1): Error: uncaught later\n",
    ])
  })

  it("writes the summary only to the file it is handed, never to this run's", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gha-summary-"))
    const ours = path.join(dir, "ours.md")
    const handed = path.join(dir, "handed.md")
    const before = process.env.GITHUB_STEP_SUMMARY
    process.env.GITHUB_STEP_SUMMARY = ours
    try {
      await report([failEvent("fails", 0, "testCodeFailure")])
      assert.equal(existsSync(ours), false)
      await report([failEvent("fails", 0, "testCodeFailure")], { summaryFile: handed })
      assert.match(readFileSync(handed, "utf8"), /^### Failed tests: 1\n/)
      await report([passEvent("passes", 0)], { summaryFile: ours })
      assert.equal(existsSync(ours), false, "a green run writes no summary")
    } finally {
      if (before === undefined) delete process.env.GITHUB_STEP_SUMMARY
      else process.env.GITHUB_STEP_SUMMARY = before
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("a real node --test run", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gha-reporter-"))
  after(() => rmSync(dir, { recursive: true, force: true }))

  writeFileSync(
    path.join(dir, "red.test.mjs"),
    [
      'import { describe, it } from "node:test"',
      'describe("guard", () => {',
      '  it("passes", () => {})',
      '  it("fails", () => {',
      '    throw new Error("boom")',
      "  })",
      "})",
    ].join("\n"),
  )
  writeFileSync(path.join(dir, "crash.test.mjs"), 'throw new Error("at load")\n')
  writeFileSync(
    path.join(dir, "hook.test.mjs"),
    [
      'import { before, describe, it } from "node:test"',
      'describe("hooked", () => {',
      "  before(() => {",
      '    throw new Error("hook boom")',
      "  })",
      '  it("never runs", () => {})',
      "})",
    ].join("\n"),
  )
  writeFileSync(
    path.join(dir, "green.test.mjs"),
    'import { it } from "node:test"\nit("passes", () => {})\n',
  )

  /** Run in `dir`, outside this run's own test context and its CI reporters. */
  function run(args, env = {}) {
    const { NODE_TEST_CONTEXT, NODE_OPTIONS, GITHUB_STEP_SUMMARY, ...clean } = process.env
    return spawnSync(process.execPath, args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...clean, ...env },
    })
  }
  const REPORTER_ONLY = [`--test-reporter=${REPORTER}`, "--test-reporter-destination=stdout"]

  it("annotates every failure and keeps the run red", () => {
    const summary = path.join(dir, "summary.md")
    const files = ["red.test.mjs", "crash.test.mjs", "hook.test.mjs"]
    const { status, stdout } = run(["--test", ...REPORTER_ONLY, ...files], {
      GITHUB_STEP_SUMMARY: summary,
    })
    assert.equal(status, 1)
    const lines = stdout.trim().split("\n").sort()
    assert.deepEqual(lines, [
      "::error file=crash.test.mjs,line=1::crash.test.mjs: test failed (exit 1): Error: at load",
      "::error file=hook.test.mjs,line=2::hooked: hook boom",
      "::error file=red.test.mjs,line=4::guard > fails: boom",
    ])
    const table = readFileSync(summary, "utf8")
    assert.match(table, /### Failed tests: 3/)
    assert.match(table, /\| guard > fails \| red\.test\.mjs:4 \| boom \|/)
  })

  it("says nothing on a green run", () => {
    const summary = path.join(dir, "green.md")
    const { status, stdout } = run(["--test", ...REPORTER_ONLY, "green.test.mjs"], {
      GITHUB_STEP_SUMMARY: summary,
    })
    assert.equal(status, 0)
    assert.equal(stdout, "")
    assert.equal(existsSync(summary), false)
  })

  it("runs next to spec through NODE_OPTIONS, which is how ci.yml sets it", () => {
    const { status, stdout } = run(["--test", "red.test.mjs"], {
      NODE_OPTIONS: `--test-reporter=spec --test-reporter-destination=stdout ${REPORTER_ONLY.join(" ")}`,
    })
    assert.equal(status, 1)
    assert.match(stdout, /^::error file=red\.test\.mjs,line=4::guard > fails: boom$/m)
    assert.match(stdout, /✖ fails/)
    assert.doesNotMatch(stdout, /^TAP version/m)
  })
})
