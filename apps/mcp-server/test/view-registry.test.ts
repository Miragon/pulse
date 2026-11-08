import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { viewRegistry } from "../src/ui/view-registry.js"
import { GOLDEN_DIR } from "./golden.js"

interface GoldenTool {
  name: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  _meta?: { ui?: { resourceUri?: string } }
}

/** Every view-bound tool any toolset advertises, per toolset: the goldens are the wire. */
function viewBoundGoldens(): GoldenTool[] {
  return ["read-only", "operations", "admin"].flatMap((toolset) => {
    const file = path.join(GOLDEN_DIR, `tools-${toolset}.json`)
    const tools = JSON.parse(fs.readFileSync(file, "utf8")) as GoldenTool[]
    return tools.filter((tool) => tool._meta?.ui?.resourceUri)
  })
}

function viewBoundTools(): string[] {
  return [...new Set(viewBoundGoldens().map((tool) => tool.name))].sort()
}

/**
 * The bundle picks a view by its name (= the view tool's name, primed under
 * `ui://views/<name>.html`). Both halves fail SILENTLY: a view-bound tool
 * without a view renders the "can't show this view" state, and a view no tool
 * opens is dead code in every view's bundle.
 */
describe("the view registry vs the view-bound tools", () => {
  it("holds a view for every view-bound tool, and nothing else", () => {
    const tools = viewBoundTools()
    // The floor is the engine module's one view, engine_open_cockpit.
    expect(tools.length, "the goldens name the view-bound tools").toBeGreaterThanOrEqual(1)
    expect(Object.keys(viewRegistry).sort()).toEqual(tools)
  })

  // On a host that strips `structuredContent` (claude.ai) the view re-runs its own view tool ONCE
  // by itself, with no annotation check (`resolveViewCall`): only a read may be re-run unasked.
  it("binds a view to read-only tools only, since a stripped result re-runs the tool", () => {
    const writes = viewBoundGoldens()
      .filter(
        (tool) =>
          tool.annotations?.readOnlyHint !== true || tool.annotations.destructiveHint === true,
      )
      .map((tool) => tool.name)
    expect(writes, "a view-bound tool must be readOnlyHint: true and never destructive").toEqual([])
  })
})
