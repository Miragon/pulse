import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT, scanSources } from "./source-scan.mjs"

/**
 * The server reads no PULSE_* variable. PulseAudio owns PULSE_* (PULSE_SERVER, PULSE_COOKIE,
 * ...) and PULSE_CLI_* belongs to the CLI. The typo warner watches the prefix of every known
 * variable, so ONE server name under PULSE_ would make every server in a shared environment (a
 * devcontainer, a Compose file, a shell that also runs the CLI) warn about both. Name a server
 * setting in its own family instead (CAMUNDA_*, PROMETHEUS_*, ANALYTICS_*, MCP_*). This guard
 * reads the server's sources (every package and every MCP server app) and both `.env.example`
 * files; the MCP server app's `test/setup.test.ts` holds the variables the boot declares to it.
 */

/** A PULSE_ name on its own (IMPULSE_RATE, MY_PULSE_X and the word Pulse are no hit). */
const PULSE_NAME = /\bPULSE_[A-Z0-9]/

/** Every line of `text` that names a PULSE_ variable, as `file:line: text`. */
const pulseLines = (file, text) =>
  text
    .split("\n")
    .flatMap((line, index) =>
      PULSE_NAME.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
    )

describe("the server reads no PULSE_* variable", () => {
  for (const [line, count] of [
    ["const url = process.env.PULSE_URL", 1],
    ['read("PULSE_SERVER")', 1],
    ['const name = "PULSE_CLI_TOKEN"', 1],
    ["// set PULSE_2 in the shell", 1],
    ["const rate = env.IMPULSE_RATE", 0],
    ["const MY_PULSE_X = 1", 0],
    ['const id = "pulse_server"', 0],
    ['const label = "Pulse"', 0],
    ['const prefix = "PULSE_"', 0],
  ]) {
    it(`${line} gives ${count} hit(s)`, () => {
      assert.equal(pulseLines("packages/x/src/a.ts", `const a = 1\n${line}\n`).length, count)
    })
  }

  it("names the file and the line of a hit", () => {
    assert.deepEqual(pulseLines("packages/x/src/a.ts", "const a = 1\n  env.PULSE_URL \n"), [
      "packages/x/src/a.ts:2: env.PULSE_URL",
    ])
  })

  // Which sources that is (every package and MCP server app, no interface app) is
  // source-scan.test.mjs's.
  it("no server source names one (every MCP server app and every package)", () => {
    assert.deepEqual(scanSources(pulseLines), [])
  })

  for (const file of [".env.example", "templates/composed-server/.env.example"]) {
    it(`${file} names none`, () => {
      assert.deepEqual(pulseLines(file, fs.readFileSync(path.join(REPO_ROOT, file), "utf8")), [])
    })
  }
})
