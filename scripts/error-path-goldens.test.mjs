import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The error-path goldens (T0) of the interfaces name the same cases in the same order: the MCP
 * server's (of a Camunda 7 engine and of a Camunda 8 cluster), the CLI's and the two adapters' of
 * the editor hosts. The three surfaces that speak the Camunda 7 REST API make each case with the
 * same engine answers, and the MCP server's and the CLI's output goldens (W0) read the same
 * engine; the C8 adapter and the MCP server's Camunda 8 goldens make the cases with the answers
 * of a Camunda 8 cluster and pin the cases of Camunda 8 alone in a second table of their READMEs.
 * Apps share no code, so each surface keeps its own copy of the case list and its answers
 * (error-cases.ts, the server's error-cases-c8.ts), its test and its fixtures; each surface's own
 * test holds its README tables to its lists and its golden files, and this guard holds the five
 * first tables and the five case lists to one another, the two second tables and the two lists of
 * the cases of Camunda 8 alone, the three C7 case files, the two C8 case files, the two world
 * copies of the Camunda 7 engine and the two of the Camunda 8 cluster (the C8 adapter's and the MCP
 * server's) to one another below their headers, and the failure of each Camunda 8 case: every probe
 * of the server's Camunda 8 goldens that names the adapter's call it matches fails as that call
 * fails in the adapter's golden of the same case. Each shared case is a conformance case of the
 * transport too (@miragon/pulse-http/testing, TRANSPORT_CASES), under the same name, which every
 * wiring of the transport runs.
 */

/** The error-path golden directories, each with its README. */
const GOLDEN_DIRS = [
  "apps/mcp-server/test/__golden__/error-paths",
  "apps/cli/test/__golden__/error-paths",
  "packages/connectors/c7/c7-adapter/test/__golden__/error-paths",
  "packages/connectors/c8/c8-adapter/test/__golden__/error-paths",
  "apps/mcp-server/test/__golden__/error-paths-c8",
]

/** The Camunda 8 goldens of the C8 adapter and of the MCP server: the second tables, the failures. */
const C8_GOLDEN_DIRS = {
  adapter: "packages/connectors/c8/c8-adapter/test/__golden__/error-paths",
  server: "apps/mcp-server/test/__golden__/error-paths-c8",
}

/** The case files of the surfaces that speak the Camunda 7 REST API: the same answers. */
const CASE_FILES = [
  "apps/mcp-server/test/engine-goldens/error-cases.ts",
  "apps/cli/test/support/error-cases.ts",
  "packages/connectors/c7/c7-adapter/test/goldens/error-cases.ts",
]

/** The case files of the Camunda 8 surfaces: the same case list, the answers of a cluster. */
const C8_CASE_FILES = [
  "packages/connectors/c8/c8-adapter/test/goldens/error-cases.ts",
  "apps/mcp-server/test/engine-goldens/error-cases-c8.ts",
]

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

/**
 * A README's tables, each its lines from one that starts with `|` to the next that does not, in
 * order.
 */
function tables(markdown) {
  const found = []
  let rows = []
  for (const line of [...markdown.split("\n"), ""]) {
    if (line.startsWith("|")) {
      rows.push(line)
    } else if (rows.length > 0) {
      found.push(rows.join("\n"))
      rows = []
    }
  }
  return found
}

/**
 * The case names of a README's table (the first by default), in order: its rows of the form
 * `| \`case\` | status |`. The first table holds the shared cases; a second (the cases of Camunda 8
 * alone, in the Camunda 8 goldens) is the Camunda 8 surfaces' own.
 */
function caseNames(markdown, table = 0) {
  return [...(tables(markdown)[table] ?? "").matchAll(/^\| `([a-z0-9-]+)` \| [a-z ]+? \|/gm)].map(
    (match) => match[1],
  )
}

/** The names of a case file's list `name` (`ERROR_PATH_CASES`), in order; none without it. */
function listedCases(source, name = "ERROR_PATH_CASES") {
  const list = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(source)?.[1] ?? ""
  return [...list.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1])
}

/**
 * Where the server's Camunda 8 golden `server` fails otherwise than the adapter's golden `adapter`
 * of the same case: each probe that names the adapter's call it `matches` against that call's
 * probe at the same second (`atSecond`, 0 when absent), its `failure` (null for none) against the
 * adapter's outcome's failure. A probe whose call the adapter's golden lacks is a mismatch, and so
 * is a golden that names no call.
 */
function failureMismatches(server, adapter) {
  const named = server.probes.filter((probe) => probe.matches !== undefined)
  if (named.length === 0) return [`${server.case}: no probe names the adapter's call it matches`]
  return named.flatMap((probe) => {
    const second = probe.atSecond ?? 0
    const twin = adapter.probes.find(
      (other) => other.call === probe.matches && (other.atSecond ?? 0) === second,
    )
    const at = `${server.case}: ${probe.matches} at ${second} s`
    if (twin === undefined) return [`${at}: the adapter's golden has no such call`]
    const expected = twin.outcome.failure ?? null
    return probe.failure === expected
      ? []
      : [`${at}: ${probe.failure} where the adapter has ${expected}`]
  })
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

  it("reads the first table by default, a later one when asked", () => {
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
    assert.deepEqual(caseNames(readme, 1), ["version-below-the-floor"])
    assert.deepEqual(caseNames(readme, 2), [])
    assert.deepEqual(caseNames("no table at all"), [])
  })

  it("reads a case file's list by its name and nothing after it", () => {
    const source = [
      "export const ERROR_PATH_CASES = [",
      '  "redirect",',
      '  "unauthorized-none",',
      "] as const",
      "",
      'export const CAMUNDA_8_CASES = ["version-below-the-floor"] as const',
    ].join("\n")
    assert.deepEqual(listedCases(source), ["redirect", "unauthorized-none"])
    assert.deepEqual(listedCases(source, "CAMUNDA_8_CASES"), ["version-below-the-floor"])
    assert.deepEqual(listedCases('const OTHER = ["redirect"]'), [])
  })

  it("are the same on every surface, in the same order", () => {
    const [first, ...others] = GOLDEN_DIRS.map((dir) => ({
      dir,
      names: caseNames(read(`${dir}/README.md`)),
    }))
    assert.ok(first.names.length >= 18, `${first.dir} lists only ${first.names.length} cases`)
    for (const other of others) {
      assert.deepEqual(other.names, first.names, `${other.dir} differs from ${first.dir}`)
    }
  })

  it("are the same list in every case file, the Camunda 8 surfaces' included", () => {
    const [first, ...others] = [...CASE_FILES, ...C8_CASE_FILES].map((rel) => ({
      rel,
      names: listedCases(read(rel)),
    }))
    assert.ok(first.names.length >= 18, `${first.rel} lists only ${first.names.length} cases`)
    for (const other of others) {
      assert.deepEqual(other.names, first.names, `${other.rel} differs from ${first.rel}`)
    }
  })

  it("of Camunda 8 alone are the same list and second table on both Camunda 8 surfaces", () => {
    const [adapter, server] = C8_CASE_FILES.map((rel) => listedCases(read(rel), "CAMUNDA_8_CASES"))
    assert.ok(adapter.length >= 7, `${C8_CASE_FILES[0]} lists only ${adapter.length} cases`)
    assert.deepEqual(server, adapter, `${C8_CASE_FILES[1]} differs from ${C8_CASE_FILES[0]}`)
    for (const dir of Object.values(C8_GOLDEN_DIRS)) {
      assert.deepEqual(caseNames(read(`${dir}/README.md`), 1), adapter, `${dir}'s second table`)
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

  it("make each Camunda 8 case with the same lists and answers on both Camunda 8 surfaces", () => {
    const [adapter, mcp] = C8_CASE_FILES.map((rel) => sharedBody(read(rel)))
    assert.ok(adapter.includes("export const CAMUNDA_8_CASES"), "the scanner reads no cases")
    assert.equal(
      mcp,
      adapter,
      `${C8_CASE_FILES[1]} drifted from ${C8_CASE_FILES[0]}: change both together`,
    )
  })
})

describe("the failures of the Camunda 8 cases", () => {
  const adapterProbe = (call, failure, atSecond) => ({
    call,
    ...(atSecond === undefined ? {} : { atSecond }),
    outcome: failure === null ? { returned: "undefined" } : { failure },
  })
  const serverProbe = (matches, failure, atSecond) => ({
    tool: "engine_open_cockpit",
    ...(matches === undefined ? {} : { matches }),
    ...(atSecond === undefined ? {} : { atSecond }),
    failure,
  })
  const adapter = {
    case: "token-endpoint-refusal",
    probes: [
      adapterProbe("describeEngine", "unauthorized"),
      adapterProbe("describeEngine", "unauthorized", 59),
      adapterProbe("getInstanceDetail 4711", null),
    ],
  }

  it("match the adapter's call by its name and second, none against no failure", () => {
    const server = {
      case: "token-endpoint-refusal",
      probes: [
        serverProbe("describeEngine", "unauthorized"),
        serverProbe("describeEngine", "unauthorized", 59),
        serverProbe("getInstanceDetail 4711", null),
        serverProbe(undefined, "ENGINE_DIALECT_NOT_SERVED"),
      ],
    }
    assert.deepEqual(failureMismatches(server, adapter), [])
  })

  it("name a probe whose failure differs, whose call the adapter lacks, or a golden naming none", () => {
    const server = {
      case: "token-endpoint-refusal",
      probes: [
        serverProbe("describeEngine", "engineFailure"),
        serverProbe("describeEngine", "unauthorized", 61),
        serverProbe("getInstanceDetail 4711", "misconfigured"),
      ],
    }
    assert.deepEqual(failureMismatches(server, adapter), [
      "token-endpoint-refusal: describeEngine at 0 s: engineFailure where the adapter has unauthorized",
      "token-endpoint-refusal: describeEngine at 61 s: the adapter's golden has no such call",
      "token-endpoint-refusal: getInstanceDetail 4711 at 0 s: misconfigured where the adapter has null",
    ])
    const silent = { case: "redirect", probes: [serverProbe(undefined, null)] }
    assert.deepEqual(failureMismatches(silent, adapter), [
      "redirect: no probe names the adapter's call it matches",
    ])
  })

  it("are the same on both Camunda 8 surfaces for every case both pin", () => {
    const goldens = (dir) =>
      fs
        .readdirSync(path.join(REPO_ROOT, dir))
        .filter((file) => file.endsWith(".json"))
        .sort()
    const pinned = goldens(C8_GOLDEN_DIRS.server)
    const shared = pinned.filter((file) => goldens(C8_GOLDEN_DIRS.adapter).includes(file))
    assert.ok(shared.length >= 25, `only ${shared.length} cases are pinned on both surfaces`)
    const golden = (dir, file) => JSON.parse(read(`${dir}/${file}`))
    assert.deepEqual(
      shared.flatMap((file) =>
        failureMismatches(
          golden(C8_GOLDEN_DIRS.server, file),
          golden(C8_GOLDEN_DIRS.adapter, file),
        ),
      ),
      [],
    )
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
