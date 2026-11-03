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
