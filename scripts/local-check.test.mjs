import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  CHECK_LOG_DIR,
  checkSteps,
  checkSummary,
  formatDuration,
  logName,
  outcomeOf,
  stepLine,
} from "./local-check.mjs"

const names = (steps) => steps.map(({ name }) => name)

describe("checkSteps", () => {
  it("runs the standard bar in order", () => {
    assert.deepEqual(names(checkSteps()), [
      "install",
      "browsers",
      "turbo",
      "test:scripts",
      "fetch",
      "lint",
      "format:check",
    ])
    assert.deepEqual(checkSteps()[2].args, [
      "exec",
      "turbo",
      "run",
      "build",
      "typecheck",
      "test",
      "lint",
    ])
  })

  it("passes --force to turbo only", () => {
    const forced = checkSteps({ force: true })
    assert.deepEqual(forced[2].args.slice(-1), ["--force"])
    assert.equal(forced.filter(({ args = [] }) => args.includes("--force")).length, 1)
  })

  it("runs only the fetch best effort", () => {
    assert.deepEqual(
      checkSteps({ all: true })
        .filter(({ bestEffort }) => bestEffort)
        .map(({ name }) => name),
      ["fetch"],
    )
  })

  it("adds the CI-only checks with all", () => {
    assert.deepEqual(names(checkSteps({ all: true })).slice(7), [
      "host browsers",
      "test:host",
      "template",
      "engine-plugins",
      "docs:build",
      "test:engines",
    ])
    assert.deepEqual(checkSteps({ all: true })[10].gradle, {
      project: "engine-plugins",
      tasks: ["build"],
    })
  })

  it("calls only root scripts that exist", () => {
    const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))
    for (const { command, args } of checkSteps({ all: true })) {
      if (command === "pnpm" && args.length === 1) assert.ok(scripts[args[0]], args[0])
    }
  })

  it("filters every pnpm call with --fail-if-no-match", () => {
    for (const { args = [] } of checkSteps({ all: true })) {
      if (args.includes("--filter")) assert.equal(args[0], "--fail-if-no-match")
    }
  })
})

describe("the summary", () => {
  it("numbers the logs", () => {
    assert.equal(logName(0, "install"), "01-install.log")
    assert.equal(logName(9, "host browsers"), "10-host-browsers.log")
    assert.equal(logName(3, "test:scripts"), "04-test-scripts.log")
  })

  it("formats a duration", () => {
    assert.equal(formatDuration(400), "0s")
    assert.equal(formatDuration(59_400), "59s")
    assert.equal(formatDuration(125_000), "2m 05s")
  })

  it("fails a step on a non-zero exit, warns on a best-effort one", () => {
    assert.equal(outcomeOf({}, 0), "ok")
    assert.equal(outcomeOf({}, 2), "FAILED")
    assert.equal(outcomeOf({ bestEffort: true }, 128), "warn")
  })

  it("writes one line per step", () => {
    const log = `${CHECK_LOG_DIR}/03-turbo.log`
    assert.equal(
      stepLine({ outcome: "ok", name: "turbo", ms: 125_000, log }),
      `ok     turbo            2m 05s  ${log}`,
    )
  })

  it("passes when every step passed", () => {
    const results = [
      { name: "install", outcome: "ok", log: "a.log" },
      { name: "lint", outcome: "ok", log: "b.log" },
    ]
    assert.deepEqual(checkSummary(results), { text: "All 2 steps passed.", failed: false })
  })

  it("passes, without claiming every step did, when a best-effort step only warned", () => {
    const results = [
      { name: "install", outcome: "ok", log: "a.log" },
      { name: "fetch", outcome: "warn", log: "b.log" },
    ]
    assert.deepEqual(checkSummary(results), {
      text:
        "1 of 2 steps passed, 1 did not (best effort).\n" +
        "  fetch did not succeed (best effort): see b.log",
      failed: false,
    })
  })

  it("fails and names the failed steps and their logs", () => {
    const results = [
      { name: "lint", outcome: "FAILED", log: "l.log" },
      { name: "format:check", outcome: "ok", log: "f.log" },
      { name: "turbo", outcome: "FAILED", log: "t.log" },
    ]
    assert.deepEqual(checkSummary(results), {
      text: "2 of 3 steps failed: lint, turbo.\n  lint: see l.log\n  turbo: see t.log",
      failed: true,
    })
  })

  it("fails an interrupted run", () => {
    const { text, failed } = checkSummary([{ name: "install", outcome: "ok", log: "a" }], {
      interrupted: true,
    })
    assert.equal(text, "Interrupted after 1 step(s).")
    assert.equal(failed, true)
  })
})
