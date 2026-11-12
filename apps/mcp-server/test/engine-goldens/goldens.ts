import fs from "node:fs"
import path from "node:path"
import { expect } from "vitest"
import { GOLDEN_DIR } from "../golden.js"
import { ERROR_PATH_CASES, type ErrorPathCase } from "./error-cases.js"
import type { SentRequest } from "./fake-engines.js"

/**
 * Where the output goldens (W0) and the error-path goldens (T0) live; the error-path cases are
 * error-cases.ts's. The goldens pin TODAY's behaviour byte for byte, so each later swap of the
 * transport (the plan's steps 7 to 16) shows exactly what it changes; they update only through
 * the app's `golden:update` (golden.ts, refused in CI), like the tools/list goldens. The golden
 * file sorts every object's keys (golden.ts), so a result's structuredContent is pinned by its
 * values, not its key order; the content text is pinned byte for byte.
 */

export const OUTPUT_DIR = path.join(GOLDEN_DIR, "outputs")
export const ERROR_PATH_DIR = path.join(GOLDEN_DIR, "error-paths")

/** The clock the output goldens read: `engine_status` derives its overdue cut-off from it. */
export const NOW = Date.parse("2026-10-09T14:00:00.000Z")

/**
 * A tool result as the golden holds it: each text content as `textLines`, its text split at the
 * line breaks (joined with "\n" they are the bytes the model reads), so a review sees a line diff
 * instead of one long escaped string. Everything else stays as the wire carried it.
 */
export function modelResult(result: unknown): unknown {
  const { content, ...rest } = result as { content: Array<{ type: string; text: string }> }
  return {
    ...rest,
    content: content.map(({ text, ...item }) => ({ ...item, textLines: text.split("\n") })),
  }
}

/**
 * The requests an engine saw as `METHOD target [Authorization]`, sorted: every call here that
 * sends more than one request starts reads in parallel, and those arrive in any order.
 */
export function sentLines(requests: readonly SentRequest[]): string[] {
  return requests
    .map((r) => `${r.method} ${r.target}${r.authorization ? ` [${r.authorization}]` : ""}`)
    .sort()
}

/** The README's table: one row per case, `| \`case\` | status | … |`, in the list's order. */
function readmeRows(dir: string): Array<{ name: string; status: string }> {
  const text = fs.readFileSync(path.join(dir, "README.md"), "utf8")
  return [...text.matchAll(/^\| `([a-z0-9-]+)` \| ([a-z ]+?) \|/gm)].map((match) => ({
    name: match[1],
    status: match[2],
  }))
}

/**
 * The README names every case once, in order; a pinned case has its golden and nothing else
 * does, so a table row cannot claim a pin the directory lacks, nor a golden outlive its case.
 */
export function expectReadmeMatches(dir: string, pinned: readonly ErrorPathCase[]): void {
  const rows = readmeRows(dir)
  expect(rows.map((row) => row.name)).toEqual([...ERROR_PATH_CASES])
  const claimed = rows.filter((row) => row.status === "pinned").map((row) => row.name)
  expect(claimed.sort()).toEqual([...pinned].sort())
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
  expect(files.sort(), "a golden without its case: delete the file").toEqual([...pinned].sort())
}
