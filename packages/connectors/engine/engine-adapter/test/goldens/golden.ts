import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect } from "vitest"
import { ERROR_PATH_CASES, type ErrorPathCase } from "./error-cases.js"

export const ERROR_PATH_DIR = join(import.meta.dirname, "..", "__golden__", "error-paths")

export const UPDATE_COMMAND =
  "pnpm --fail-if-no-match --filter @miragon/pulse-engine-adapter golden:update"

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

export function expectReadmeMatches(pinned: readonly ErrorPathCase[]): void {
  const text = readFileSync(join(ERROR_PATH_DIR, "README.md"), "utf8")
  const rows = [...text.matchAll(/^\| `([a-z0-9-]+)` \| ([a-z ]+?) \|/gm)].map((match) => ({
    name: match[1] ?? "",
    status: match[2] ?? "",
  }))
  expect(rows.map((row) => row.name)).toEqual([...ERROR_PATH_CASES])
  const claimed = rows.filter((row) => row.status === "pinned").map((row) => row.name)
  expect(claimed.sort()).toEqual([...pinned].sort())
  const files = readdirSync(ERROR_PATH_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
  expect(files.sort(), "a golden without its case: delete the file").toEqual([...pinned].sort())
}
