import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The error-path goldens (T0) of the three interfaces name the same cases in the same order and
 * make each case with the same engine answers, and the MCP server's and the CLI's output goldens
 * (W0) read the same engine. Apps share no code, so each surface keeps its own copy of the case
 * list and its answers (error-cases.ts), its test and its fixtures; each surface's own test holds
 * its README table to its list and its golden files, and this guard holds the three tables, the
 * three case files and the two world copies to one another, below their headers. Each case is a
 * conformance case of the transport too (@miragon/pulse-http/testing, TRANSPORT_CASES), under the
 * same name, which every wiring of the transport runs.
 */

const SURFACES = ["apps/mcp-server", "apps/cli", "packages/connectors/engine/engine-adapter"]

const CASE_FILES = [
  "apps/mcp-server/test/engine-goldens/error-cases.ts",
  "apps/cli/test/support/error-cases.ts",
  "packages/connectors/engine/engine-adapter/test/goldens/error-cases.ts",
]

/** The files of the transport's conformance cases, one per group. */
const TRANSPORT_CASE_FILES = ["wire-cases.ts", "credential-cases.ts", "request-cases.ts"].map(
  (file) => `packages/core/http/src/testing/${file}`,
)

const WORLDS = [
  "apps/mcp-server/test/engine-goldens/world.ts",
  "apps/cli/test/support/golden-world.ts",
]

/** The names of a transport case file: each case's `name: "…",` line. */
function transportNames(source) {
  return [...source.matchAll(/^ {4}name: "([a-z0-9-]+)",$/gm)].map((match) => match[1])
}

/** The case names of a README table, in order: rows of the form `| \`case\` | status |`. */
function caseNames(markdown) {
  return [...markdown.matchAll(/^\| `([a-z0-9-]+)` \| [a-z ]+? \|/gm)].map((match) => match[1])
}

/**
 * A shared file from its first top-level constant on: the header comment and the import differ
 * by surface.
 */
function sharedBody(source) {
  const start = source.search(/\n(?:export )?const /)
  return start === -1 ? source : source.slice(start)
}

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")

describe("the error-path cases", () => {
  it("reads a table's case names and nothing else", () => {
    const table = [
      "| Case | Status | Why |",
      "| ---- | ------ | --- |",
      "| `redirect` | pinned | a 302 |",
      "| `too-large-response` | deferred | no cap |",
      "| not a case | pinned | |",
    ].join("\n")
    assert.deepEqual(caseNames(table), ["redirect", "too-large-response"])
  })

  it("are the same on every surface, in the same order", () => {
    const [first, ...others] = SURFACES.map((dir) => ({
      dir,
      names: caseNames(read(`${dir}/test/__golden__/error-paths/README.md`)),
    }))
    assert.ok(first.names.length >= 18, `${first.dir} lists only ${first.names.length} cases`)
    for (const other of others) {
      assert.deepEqual(other.names, first.names, `${other.dir} differs from ${first.dir}`)
    }
  })
})

describe("the shared files", () => {
  it("cut at their first top-level constant, exported or not", () => {
    assert.equal(sharedBody("/** a */\nimport x\n\nconst A = 1\n"), "\nconst A = 1\n")
    assert.equal(sharedBody('import x\n\nexport const A = ["a"]\n'), '\nexport const A = ["a"]\n')
  })

  it("make each case with the same list and answers on every surface", () => {
    const [first, ...others] = CASE_FILES.map((rel) => ({ rel, body: sharedBody(read(rel)) }))
    assert.ok(first.body.includes("export const ERROR_PATH_CASES"), "the scanner reads no cases")
    for (const other of others) {
      assert.equal(
        other.body,
        first.body,
        `${other.rel} drifted from ${first.rel}: change all three`,
      )
    }
  })

  it("are the same world for the MCP server and the CLI", () => {
    const [mcp, cli] = WORLDS.map((rel) => sharedBody(read(rel)))
    assert.ok(mcp.includes('"/process-instance/pi-1"'), "the scanner reads no world")
    assert.equal(cli, mcp, `${WORLDS[1]} drifted from ${WORLDS[0]}: change both together`)
  })
})

describe("the transport's conformance cases", () => {
  it("read a case file's names and nothing else", () => {
    const source = '  {\n    name: "redirect",\n    about: "x",\n    request: { name: "no" },\n'
    assert.deepEqual(transportNames(source), ["redirect"])
  })

  it("carry the name of every error-path case, since each is a transport case too", () => {
    const golden = caseNames(read("apps/mcp-server/test/__golden__/error-paths/README.md"))
    const transport = TRANSPORT_CASE_FILES.flatMap((rel) => transportNames(read(rel)))
    assert.ok(transport.length > golden.length, "the scanner reads no transport cases")
    assert.deepEqual(
      golden.filter((name) => !transport.includes(name)),
      [],
      "add a conformance case of this name to packages/core/http/src/testing/",
    )
  })
})
