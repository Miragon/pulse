import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { COMMANDS, parseArgs, USAGE } from "./local-args.mjs"

describe("parseArgs", () => {
  it("reads a command and its options", () => {
    assert.deepEqual(parseArgs(["stack:up", "--multi-engine"]), {
      command: "stack:up",
      options: { multiEngine: true, auth: false, jdkContainer: false },
      rest: [],
    })
  })

  it("skips the -- pnpm passes on", () => {
    assert.equal(parseArgs(["check", "--", "--force"]).options.force, true)
  })

  it("lets --deploy imply --admin", () => {
    assert.deepEqual(parseArgs(["play", "--deploy"]).options, {
      multiEngine: false,
      auth: false,
      admin: true,
      deploy: true,
      jdkContainer: false,
    })
  })

  it("passes every play:cli argument on, a leading -- dropped", () => {
    assert.deepEqual(parseArgs(["play:cli", "--", "ping", "--force"]).rest, ["ping", "--force"])
    assert.deepEqual(parseArgs(["play:cli", "status"]).rest, ["status"])
    assert.deepEqual(parseArgs(["play:cli"]).rest, [])
  })

  it("reads test:one's files and --watch in any order", () => {
    assert.deepEqual(parseArgs(["test:one", "a.test.ts", "--watch", "b.test.ts"]), {
      command: "test:one",
      options: { watch: true },
      rest: ["a.test.ts", "b.test.ts"],
    })
    assert.equal(parseArgs(["test:one", "--", "a.test.ts"]).options.watch, false)
    assert.deepEqual(parseArgs(["test:one", "--", "a.test.ts"]).rest, ["a.test.ts"])
  })

  it("refuses test:one without a file, and a flag it does not take", () => {
    assert.match(parseArgs(["test:one"]).message, /test:one needs at least one file/)
    assert.match(parseArgs(["test:one", "--watch"]).message, /test:one needs at least one file/)
    assert.match(
      parseArgs(["test:one", "a.test.ts", "--coverage"]).message,
      /does not take --coverage.*--watch/,
    )
  })

  it("takes no operand on a command without any", () => {
    assert.match(parseArgs(["check", "a.test.ts"]).message, /check does not take a\.test\.ts/)
  })

  it("names an unknown command, a missing one and an option the command does not take", () => {
    assert.match(parseArgs(["stack:restart"]).message, /Unknown command: stack:restart/)
    assert.match(parseArgs([]).message, /No command given/)
    assert.match(parseArgs(["stack:status", "--wipe"]).message, /does not take --wipe.*none/)
    assert.match(parseArgs(["stack:down", "--auth"]).message, /its options: --wipe/)
  })

  it("lists every command in the usage", () => {
    for (const name of Object.keys(COMMANDS)) assert.match(USAGE, new RegExp(`  ${name} `))
  })

  it("has one root script per command, each running this command", () => {
    const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))
    for (const name of Object.keys(COMMANDS)) {
      assert.equal(scripts[name], `node scripts/local.mjs ${name}`)
    }
  })
})
