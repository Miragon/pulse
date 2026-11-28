import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CLAUDE_RUNTIME_CODES } from "../src/ui/claude-artifact/claude-tool-caller.js"

/**
 * The README's table of the artifact runtime's codes ("A Claude artifact") is the one a page's
 * documentation links to (the Claude artifact template's README, the docs site): row by row it is
 * `CLAUDE_RUNTIME_CODES`, the caller's map, and its last row the code every other one becomes.
 */

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8")

/** The rows of the table in the README's section `heading`: each its cells' backticked names. */
function tableRows(heading: string): string[][][] {
  const start = README.indexOf(`\n## ${heading}\n`)
  const end = README.indexOf("\n## ", start + 1)
  const section = README.slice(start, end === -1 ? undefined : end)
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| The runtime's code"))
    .filter((line) => !/^\|[\s|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => [...cell.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? "")),
    )
}

describe("the README's table of the runtime's codes", () => {
  const rows = tableRows("A Claude artifact")

  it("maps every code CLAUDE_RUNTIME_CODES maps, as it maps it, and nothing else", () => {
    const named = rows.slice(0, -1).flatMap(([runtime = [], page = []]) => {
      expect(page, runtime.join(", ")).toHaveLength(1)
      return runtime.map((code) => [code, page[0]])
    })
    expect(Object.fromEntries(named)).toEqual(Object.fromEntries(CLAUDE_RUNTIME_CODES))
    expect(named).toHaveLength(CLAUDE_RUNTIME_CODES.size)
  })

  it("ends with what any other code becomes, a tool's error", () => {
    const [runtime, page] = rows.at(-1) ?? []
    expect(runtime).toEqual([])
    expect(page).toEqual(["tool_error"])
  })
})
