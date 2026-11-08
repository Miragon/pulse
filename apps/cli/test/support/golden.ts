/**
 * Golden files of the CLI: what a command writes, pinned byte for byte as JSON next to the tests
 * (apps/cli/test/__golden__/), so a change to an output or an error is a reviewable diff. Not
 * vitest snapshots: `vitest -u` would rewrite them in passing. The one update path is
 * UPDATE_COMMAND (`GOLDEN_UPDATE=1`), refused in CI like the MCP server's tools/list goldens.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect } from "vitest"
import { ERROR_PATH_CASES, type ErrorPathCase } from "./error-cases.js"

export const GOLDEN_DIR = join(import.meta.dirname, "..", "__golden__")

export const UPDATE_COMMAND = "pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update"

/** Object keys sorted at every depth, arrays in their order: the file is byte-stable. */
function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort)
  if (typeof value !== "object" || value === null) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableSort(record[key])]),
  )
}

/** `GOLDEN_UPDATE=1` outside CI; in CI it throws: a golden changes only through a reviewed diff. */
function updating(name: string): boolean {
  if (process.env.GOLDEN_UPDATE !== "1") return false
  if (process.env.CI) {
    throw new Error(`GOLDEN_UPDATE is forbidden in CI: ${name} changes only via a committed diff.`)
  }
  return true
}

/**
 * Compares `actual` (keys sorted) with the golden `dir/name.json` below `root`, or rewrites it on
 * an update. `root` is the goldens' directory; the helper's own test passes a scratch one.
 */
export function assertGolden(dir: string, name: string, actual: unknown, root = GOLDEN_DIR): void {
  const file = join(root, dir, `${name}.json`)
  const text = `${JSON.stringify(stableSort(actual), null, 2)}\n`
  if (updating(name)) {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(file, text, "utf8")
    return
  }
  if (!existsSync(file)) {
    throw new Error(`No golden ${dir}/${name}.json: run ${UPDATE_COMMAND} and commit it.`)
  }
  expect(
    JSON.parse(text),
    `The CLI's ${dir} golden ${name} differs. If the change is intended, run ${UPDATE_COMMAND} ` +
      "and commit the diff; never edit a golden by hand.",
  ).toEqual(JSON.parse(readFileSync(file, "utf8")))
}

/** A stream's text split at its line breaks: joined with "\n" they are the bytes written. */
export const linesOf = (text: string): string[] => text.split("\n")

/**
 * The README of `dir` names every case once, in order (`| \`case\` | status |`); a pinned case
 * has its golden and nothing else does.
 */
export function expectReadmeMatches(dir: string, pinned: readonly ErrorPathCase[]): void {
  const text = readFileSync(join(GOLDEN_DIR, dir, "README.md"), "utf8")
  const rows = [...text.matchAll(/^\| `([a-z0-9-]+)` \| ([a-z ]+?) \|/gm)].map((match) => ({
    name: match[1] ?? "",
    status: match[2] ?? "",
  }))
  expect(rows.map((row) => row.name)).toEqual([...ERROR_PATH_CASES])
  const claimed = rows.filter((row) => row.status === "pinned").map((row) => row.name)
  expect(claimed.sort()).toEqual([...pinned].sort())
  const files = readdirSync(join(GOLDEN_DIR, dir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
  expect(files.sort(), "a golden without its case: delete the file").toEqual([...pinned].sort())
}
