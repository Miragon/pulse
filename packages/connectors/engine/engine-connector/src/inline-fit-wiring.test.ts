import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The inline fit (#396) only reaches a paged list that hands it its rows and
 * lets its footer say what the click does. A list that forgets either stays
 * uncapped inline (the card scrolls again), or its footer says "Load more"
 * where the click opens fullscreen. Both are silent in a unit render (no
 * host, no fit), so every paged list is checked here by its source:
 *  - its rows reach the fit: `<PagedRows paged={…}>` (a table inside hands
 *    its body to it), or the list passes `paged.fit.attachRows` itself;
 *  - every `<PagedListFooter>` passes `labels={paged.footerLabels}`.
 */

const WIDGETS = join(import.meta.dirname, "widgets")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

const PAGED = /\busePaged(ViewData|ListView)\b/
const files = sources(WIDGETS).filter((path) => PAGED.test(readFileSync(path, "utf8")))

describe("every paged list reaches the inline fit", () => {
  it("finds the paged lists (the scan is not empty)", () => {
    expect(files.map((path) => relative(WIDGETS, path)).sort()).toEqual([
      "cluster-detail.tsx",
      "history-timeline.tsx",
      "job-panel.tsx",
      "process-incidents/incident-table.tsx",
      "process-instances/list.tsx",
    ])
  })

  it.each(files.map((path) => [relative(WIDGETS, path), path]))(
    "%s hands its rows to the fit",
    (_name, path) => {
      const source = readFileSync(path, "utf8")
      expect(source).toMatch(/<PagedRows\s+paged=\{|\.fit\.attachRows/)
    },
  )

  it.each(files.map((path) => [relative(WIDGETS, path), path]))(
    "%s lets its footer say what the click does",
    (_name, path) => {
      const source = readFileSync(path, "utf8")
      // An arrow function in a prop (`noun={(total) => …}`) is no end of the tag.
      const footers = source.match(/<PagedListFooter\b(?:=>|[^>])*>/g) ?? []
      expect(footers.length).toBeGreaterThan(0)
      for (const footer of footers) expect(footer).toMatch(/labels=\{\w+\.footerLabels\}/)
    },
  )
})
