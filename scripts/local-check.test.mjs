import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  CHECK_LOG_DIR,
  checkSteps,
  checkSummary,
  formatDuration,
  lintSteps,
  logName,
  outcomeOf,
  stepLine,
} from "./local-check.mjs"

const names = (steps) => steps.map(({ name }) => name)
const rootScripts = () =>
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).scripts
const LINT_CHAIN = "pnpm lint:first && turbo run lint --continue=always && pnpm run lint:last"

describe("checkSteps", () => {
  it("runs the standard bar in order, with a step per gate of the lint chain", () => {
    assert.deepEqual(names(checkSteps({ lintScript: LINT_CHAIN })), [
      "install",
      "browsers",
      "turbo",
      "test:scripts",
      "fetch",
      "lint:first",
      "lint:turbo",
      "lint:last",
      "format:check",
    ])
  })

  it("keeps turbo going past a red package", () => {
    assert.deepEqual(checkSteps()[2].args, [
      "exec",
      "turbo",
      "run",
      "build",
      "typecheck",
      "test",
      "lint",
      "--continue=dependencies-successful",
    ])
  })

  it("derives the lint steps from the root lint chain at run time", () => {
    const planned = checkSteps().map(({ args }) => args?.join(" "))
    const segments = rootScripts()
      .lint.split("&&")
      .map((segment) => segment.trim())
    assert.ok(segments.length > 1)
    for (const segment of segments) {
      const command = segment.startsWith("pnpm ") ? segment.slice(5) : `exec ${segment}`
      assert.ok(planned.includes(command), `${segment} has no step of its own`)
    }
    assert.ok(!names(checkSteps()).includes("lint"), "a single lint step hides the later gates")
  })

  it("splits a chain segment into a command without a shell", () => {
    assert.deepEqual(lintSteps("  pnpm  lint:a   &&\nturbo run lint --x=y "), [
      { name: "lint:a", command: "pnpm", args: ["lint:a"] },
      { name: "lint:turbo", command: "pnpm", args: ["exec", "turbo", "run", "lint", "--x=y"] },
    ])
  })

  it("refuses a segment only a shell would run as written", () => {
    for (const segment of [
      "knip --workspace '!docs'",
      "pnpm lint:a || true",
      "depcruise src/* --config x",
      "pnpm lint:a ; true",
      "FOO=$BAR pnpm lint:a",
    ]) {
      assert.throws(() => lintSteps(`pnpm lint:ok && ${segment}`), /without a shell/, segment)
    }
  })

  it("passes --force to turbo only", () => {
    const forced = checkSteps({ force: true })
    assert.deepEqual(forced[2].args.slice(-1), ["--force"])
    assert.equal(forced.filter(({ args = [] }) => args.includes("--force")).length, 1)
    assert.ok(forced[2].args.includes("--continue=dependencies-successful"))
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
    const all = checkSteps({ all: true })
    assert.deepEqual(names(all).slice(names(all).indexOf("format:check") + 1), [
      "host browsers",
      "test:host",
      "template",
      "engine-plugins",
      "docs:build",
      "test:engines",
    ])
    assert.deepEqual(all.find(({ name }) => name === "engine-plugins").gradle, {
      project: "engine-plugins",
      tasks: ["build"],
    })
  })

  it("calls only root scripts that exist", () => {
    const scripts = rootScripts()
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
      `ok     turbo                     2m 05s  ${log}`,
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
