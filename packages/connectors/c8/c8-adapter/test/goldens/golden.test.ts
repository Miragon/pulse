import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CAMUNDA_8_CASES, ERROR_PATH_CASES } from "./error-cases.js"
import { assertGolden, expectReadmeMatches, tablesOf, UPDATE_COMMAND } from "./golden.js"

type PlantedRow = readonly [name: string, status: string]

const HEAD = [
  "| Case | Status | What the golden shows, or why there is none | Changes in step |",
  "| ---- | ------ | ------------------------------------------- | --------------- |",
]

const PASSTHROUGH = "unauthorized-passthrough"

const REACHABLE = [...ERROR_PATH_CASES, ...CAMUNDA_8_CASES].filter((name) => name !== PASSTHROUGH)

let scratch = ""

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pulse-c8-adapter-golden-"))
  vi.stubEnv("GOLDEN_UPDATE", "")
  vi.stubEnv("CI", "")
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function sharedRows(): PlantedRow[] {
  return ERROR_PATH_CASES.map((name) => [name, name === PASSTHROUGH ? "not reachable" : "pinned"])
}

function ownRows(): PlantedRow[] {
  return CAMUNDA_8_CASES.map((name) => [name, "pinned"])
}

function tableOf(rows: readonly PlantedRow[]): string[] {
  return [
    ...HEAD,
    ...rows.map(([name, status]) => `| \`${name}\` | ${status} | shown | none planned |`),
  ]
}

function plant(
  first: readonly PlantedRow[],
  second: readonly PlantedRow[],
  goldens: readonly string[],
): void {
  const readme = [
    "# Planted",
    "",
    ...tableOf(first),
    "",
    "The cases of Camunda 8 alone.",
    "",
    ...tableOf(second),
    "",
  ]
  writeFileSync(join(scratch, "README.md"), readme.join("\n"), "utf8")
  for (const name of goldens) {
    writeFileSync(join(scratch, `${name}.json`), "{}\n", "utf8")
  }
}

describe("the golden helper on a scratch directory, never the real goldens", () => {
  test("a missing golden is refused with the one update path and never created", () => {
    expect(() => {
      assertGolden("probe", { a: 1 }, scratch)
    }).toThrow(UPDATE_COMMAND)
    expect(readdirSync(scratch)).toEqual([])
    expect(UPDATE_COMMAND).toBe(
      "pnpm --fail-if-no-match --filter @miragon/pulse-c8-adapter golden:update",
    )
  })

  test("an update in CI is refused and writes nothing", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    vi.stubEnv("CI", "true")
    expect(() => {
      assertGolden("probe", { a: 1 }, scratch)
    }).toThrow(/forbidden in CI/)
    expect(readdirSync(scratch)).toEqual([])
  })

  test("a local update writes sorted keys at every depth, and a plain run then compares against it", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    assertGolden("probe", { b: [{ d: 1, c: "x" }], a: null }, scratch)
    expect(readFileSync(join(scratch, "probe.json"), "utf8")).toBe(
      '{\n  "a": null,\n  "b": [\n    {\n      "c": "x",\n      "d": 1\n    }\n  ]\n}\n',
    )
    vi.stubEnv("GOLDEN_UPDATE", "")
    expect(() => {
      assertGolden("probe", { a: null, b: [{ c: "x", d: 1 }] }, scratch)
    }).not.toThrow()
    expect(() => {
      assertGolden("probe", { a: null, b: [{ c: "x", d: 2 }] }, scratch)
    }).toThrow(/never edit a golden by hand/)
  })
})

describe("the README check on a planted README with two tables", () => {
  test("each table reads apart, a row with its case and status only", () => {
    const markdown = [
      "# Planted",
      ...HEAD,
      "| `redirect` | pinned | a 302 | none planned |",
      `| \`${PASSTHROUGH}\` | not reachable | no caller | |`,
      "The cases of Camunda 8 alone.",
      ...HEAD,
      "| `url-of-operate` | deferred | later | |",
      "| no case | pinned | | |",
    ].join("\n")
    expect(tablesOf(markdown)).toEqual([
      [
        { name: "redirect", status: "pinned" },
        { name: PASSTHROUGH, status: "not reachable" },
      ],
      [{ name: "url-of-operate", status: "deferred" }],
    ])
  })

  test("both case lists in their tables, each pinned row with its golden, passes", () => {
    plant(sharedRows(), ownRows(), REACHABLE)
    expect(() => {
      expectReadmeMatches(REACHABLE, scratch)
    }).not.toThrow()
  })

  test("a row of the second table renamed with its golden and its pinned case still fails", () => {
    const rename = (name: string) => (name === "url-of-operate" ? "url-of-zeebe" : name)
    const renamed = ownRows().map(([name, status]): PlantedRow => [rename(name), status])
    plant(sharedRows(), renamed, REACHABLE.map(rename))
    expect(() => {
      expectReadmeMatches(REACHABLE.map(rename), scratch)
    }).toThrow()
  })

  test("a case pinned in the test whose row is not pinned fails", () => {
    const deferred = ownRows().map(([name, status]): PlantedRow => [
      name,
      name === "no-secondary-storage" ? "deferred" : status,
    ])
    plant(sharedRows(), deferred, REACHABLE)
    expect(() => {
      expectReadmeMatches(REACHABLE, scratch)
    }).toThrow()
  })

  test("a pinned case without its golden fails, and so does a golden without its case", () => {
    plant(
      sharedRows(),
      ownRows(),
      REACHABLE.filter((name) => name !== "redirect"),
    )
    expect(() => {
      expectReadmeMatches(REACHABLE, scratch)
    }).toThrow(/delete the file/)
    writeFileSync(join(scratch, "redirect.json"), "{}\n", "utf8")
    writeFileSync(join(scratch, "stray.json"), "{}\n", "utf8")
    expect(() => {
      expectReadmeMatches(REACHABLE, scratch)
    }).toThrow(/delete the file/)
  })
})
