import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect } from "vitest"
import { CAMUNDA_8_CASES, ERROR_PATH_CASES } from "./error-cases.js"

const ERROR_PATH_DIR = join(import.meta.dirname, "..", "__golden__", "error-paths")

export const UPDATE_COMMAND =
  "pnpm --fail-if-no-match --filter @miragon/pulse-c8-adapter golden:update"

interface Row {
  readonly name: string
  readonly status: string
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSort)
  }
  if (typeof value !== "object" || value === null) {
    return value
  }
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableSort(record[key])]),
  )
}

function updating(name: string): boolean {
  if (process.env.GOLDEN_UPDATE !== "1") {
    return false
  }
  if (process.env.CI) {
    throw new Error(`GOLDEN_UPDATE is forbidden in CI: ${name} changes only via a committed diff.`)
  }
  return true
}

export function assertGolden(name: string, actual: unknown, dir = ERROR_PATH_DIR): void {
  const file = join(dir, `${name}.json`)
  const text = `${JSON.stringify(stableSort(actual), null, 2)}\n`
  if (updating(name)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, text, "utf8")
    return
  }
  if (!existsSync(file)) {
    throw new Error(`No golden error-paths/${name}.json: run ${UPDATE_COMMAND} and commit it.`)
  }
  expect(
    JSON.parse(text),
    `The error-path golden ${name} differs. If the change is intended, run ${UPDATE_COMMAND} and commit the diff; never edit a golden by hand.`,
  ).toEqual(JSON.parse(readFileSync(file, "utf8")))
}

export function tablesOf(markdown: string): Row[][] {
  const tables: Row[][] = []
  let rows: Row[] | undefined
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      rows = undefined
      continue
    }
    if (rows === undefined) {
      rows = []
      tables.push(rows)
    }
    const match = /^\| `([a-z0-9-]+)` \| ([a-z ]+?) \|/.exec(line)
    if (match !== null) {
      rows.push({ name: match[1] ?? "", status: match[2] ?? "" })
    }
  }
  return tables
}

export function expectReadmeMatches(pinned: readonly string[], dir = ERROR_PATH_DIR): void {
  const tables = tablesOf(readFileSync(join(dir, "README.md"), "utf8"))
  expect(tables.map((rows) => rows.map((row) => row.name))).toEqual([
    [...ERROR_PATH_CASES],
    [...CAMUNDA_8_CASES],
  ])
  const claimed = tables
    .flat()
    .filter((row) => row.status === "pinned")
    .map((row) => row.name)
  expect(claimed.sort()).toEqual([...pinned].sort())
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
  expect(files.sort(), "a golden without its case: delete the file").toEqual([...pinned].sort())
}
