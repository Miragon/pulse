import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The error-path goldens (T0) of the interfaces name the same cases in the same order: the MCP
 * server's, the CLI's and the two adapters' of the editor hosts. The three surfaces that speak the
 * Camunda 7 REST API make each case with the same engine answers, and the MCP server's and the
 * CLI's output goldens (W0) read the same engine; the C8 adapter makes the cases with its own
 * answers, since a Camunda 8 cluster answers otherwise, and pins the cases of Camunda 8 alone in a
 * second table of its README. Apps share no code, so each surface keeps its own copy of the case
 * list and its answers (error-cases.ts), its test and its fixtures; each surface's own test holds
 * its README tables to its lists and its golden files, and this guard holds the four first tables
 * and the four case lists to one another, and the three C7 case files, the two world copies of the
 * Camunda 7 engine and the two of the Camunda 8 cluster (the C8 adapter's and the MCP server's) to
 * one another below their headers. Each shared case is a conformance case of the transport too
 * (@miragon/pulse-http/testing, TRANSPORT_CASES), under the same name, which every wiring of the
 * transport runs.
 */

const SURFACES = [
  "apps/mcp-server",
  "apps/cli",
  "packages/connectors/c7/c7-adapter",
  "packages/connectors/c8/c8-adapter",
]

/** The case files of the surfaces that speak the Camunda 7 REST API: the same answers. */
const CASE_FILES = [
  "apps/mcp-server/test/engine-goldens/error-cases.ts",
  "apps/cli/test/support/error-cases.ts",
  "packages/connectors/c7/c7-adapter/test/goldens/error-cases.ts",
]

/** The C8 adapter's case file: the same case list, its own answers. */
const C8_CASE_FILE = "packages/connectors/c8/c8-adapter/test/goldens/error-cases.ts"

/** The files of the transport's conformance cases, one per group. */
const TRANSPORT_CASE_FILES = ["wire-cases.ts", "credential-cases.ts", "request-cases.ts"].map(
  (file) => `packages/core/http/src/testing/${file}`,
)

const WORLDS = [
  "apps/mcp-server/test/engine-goldens/world.ts",
  "apps/cli/test/support/golden-world.ts",
]

/** The Camunda 8 cluster the C8 adapter's goldens read, and the MCP server's copy of it. */
const C8_WORLDS = [
  "packages/connectors/c8/c8-adapter/test/goldens/cluster-world.ts",
  "apps/mcp-server/test/engine-goldens/c8-cluster-world.ts",
]

/** The names of a transport case file: each case's `name: "…",` line. */
function transportNames(source) {
  return [...source.matchAll(/^ {4}name: "([a-z0-9-]+)",$/gm)].map((match) => match[1])
}

/** A README's first table: its lines from the first that starts with `|` to the next that does not. */
function firstTable(markdown) {
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => line.startsWith("|"))
  if (start === -1) return ""
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("|"))
  return lines.slice(start, end === -1 ? undefined : end).join("\n")
}

/**
 * The shared case names of a README, in order: the rows of its first table of the form
 * `| \`case\` | status |`. A table after it (the C8 adapter's cases of Camunda 8 alone) is the
 * surface's own.
 */
function caseNames(markdown) {
  return [...firstTable(markdown).matchAll(/^\| `([a-z0-9-]+)` \| [a-z ]+? \|/gm)].map(
    (match) => match[1],
  )
}

/** The names of a case file's `ERROR_PATH_CASES` list, in order; none when it holds no list. */
function listedCases(source) {
  const list = /export const ERROR_PATH_CASES = \[([^\]]*)\] as const/.exec(source)?.[1] ?? ""
  return [...list.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1])
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

  it("reads the first table only, never a surface's own table after it", () => {
    const readme = [
      "# Goldens",
      "",
      "| Case | Status | Why |",
      "| ---- | ------ | --- |",
      "| `redirect` | pinned | a 302 |",
      "",
      "The cases of one engine alone:",
      "",
      "| Case | Status | Why |",
      "| ---- | ------ | --- |",
      "| `version-below-the-floor` | pinned | 8.8 |",
    ].join("\n")
    assert.deepEqual(caseNames(readme), ["redirect"])
    assert.deepEqual(caseNames("no table at all"), [])
  })

  it("reads a case file's list and nothing after it", () => {
    const source = [
      "export const ERROR_PATH_CASES = [",
      '  "redirect",',
      '  "unauthorized-none",',
      "] as const",
      "",
      'export const CAMUNDA_8_CASES = ["version-below-the-floor"] as const',
    ].join("\n")
    assert.deepEqual(listedCases(source), ["redirect", "unauthorized-none"])
    assert.deepEqual(listedCases('const OTHER = ["redirect"]'), [])
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

  it("are the same list in every case file, the C8 adapter's included", () => {
    const [first, ...others] = [...CASE_FILES, C8_CASE_FILE].map((rel) => ({
      rel,
      names: listedCases(read(rel)),
    }))
    assert.ok(first.names.length >= 18, `${first.rel} lists only ${first.names.length} cases`)
    for (const other of others) {
      assert.deepEqual(other.names, first.names, `${other.rel} differs from ${first.rel}`)
    }
  })
})

describe("the shared files", () => {
  it("cut at their first top-level constant, exported or not", () => {
    assert.equal(sharedBody("/** a */\nimport x\n\nconst A = 1\n"), "\nconst A = 1\n")
    assert.equal(sharedBody('import x\n\nexport const A = ["a"]\n'), '\nexport const A = ["a"]\n')
  })

  it("make each case with the same list and answers on every surface of the Camunda 7 REST API", () => {
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

  it("are the same Camunda 8 cluster for the C8 adapter and the MCP server", () => {
    const [adapter, mcp] = C8_WORLDS.map((rel) => sharedBody(read(rel)))
    assert.ok(adapter.includes('"/v2/topology"'), "the scanner reads no world")
    assert.equal(mcp, adapter, `${C8_WORLDS[1]} drifted from ${C8_WORLDS[0]}: change both together`)
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
