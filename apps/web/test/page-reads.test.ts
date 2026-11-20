import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { APP } from "./web-build.js"

/**
 * Every tool the page names is one its server's forward admits a page's call to (`/app/api/call`,
 * widget-shell's `src/web/forward.ts`): a read a view calls, which is a view tool, an app-only
 * `*_data` feed or a model tool marked `forViews`, each with `readOnlyHint` and
 * `openai/widgetAccessible`, as the admin golden of the tools/list wire payload lists them (the
 * widest toolset, apps/mcp-server/test/__golden__/tools-admin.json). A screen of the page reads a
 * screen feed, never a write and never a model tool the views do not read, so a name the forward
 * refuses fails here before a page meets the refusal.
 */

const GOLDEN = join(APP, "..", "mcp-server", "test", "__golden__", "tools-admin.json")

interface WireTool {
  readonly name: string
  readonly annotations?: { readonly readOnlyHint?: boolean }
  readonly _meta?: Record<string, unknown>
}

/** How a page may call a tool: as a view, an app-only feed, a model tool for views; else not. */
function kindOf({ _meta: meta = {} }: WireTool): string | undefined {
  const ui = (meta.ui ?? {}) as { resourceUri?: unknown; visibility?: unknown }
  if (meta["openai/widgetAccessible"] !== true) return undefined
  if (typeof ui.resourceUri === "string") return "view"
  const visibility = JSON.stringify(ui.visibility)
  if (visibility === '["app"]') return "feed"
  return visibility === '["model","app"]' ? "for views" : undefined
}

/** The page's sources, every file under src/. */
function sources(dir = join(APP, "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

/** A tool of the engine module, as a source names it: a string of its whole name. */
const TOOL_NAME = /["'`](engine_[a-z0-9_]+)["'`]/g

/** Every tool name the page's sources hold, with where. */
function namedTools(): Array<{ readonly at: string; readonly name: string }> {
  return sources().flatMap((file) => {
    const text = readFileSync(file, "utf8")
    return [...text.matchAll(TOOL_NAME)].map((match) => ({
      at: `${relative(APP, file)}:${text.slice(0, match.index).split("\n").length}`,
      name: match[1],
    }))
  })
}

const golden = new Map(
  (JSON.parse(readFileSync(GOLDEN, "utf8")) as WireTool[]).map((tool) => [tool.name, tool]),
)

describe("every tool the page names is a read its server's forward admits", () => {
  it("finds the view tool, the engine list and the engine screen's feed (the scan is not vacuous)", () => {
    const names = new Set(namedTools().map(({ name }) => name))
    expect([...names].sort()).toEqual(
      expect.arrayContaining([
        "engine_list_engines",
        "engine_open_cockpit",
        "engine_screen_processes_data",
      ]),
    )
  })

  it("names only a view tool, an app-only feed or a forViews tool of the admin golden, each a read", () => {
    const wrong = namedTools()
      .map(({ at, name }) => ({ at, name, tool: golden.get(name) }))
      .filter(
        ({ tool }) =>
          tool === undefined || tool.annotations?.readOnlyHint !== true || !kindOf(tool),
      )
      .map(({ at, name }) => `${at} ${name}`)
    expect(wrong, "the page reads a screen feed (SCREEN_FEEDS), never a write").toEqual([])
  })

  it("sees a name the forward refuses: a write, a model tool, a name no server lists", () => {
    const refused = ["engine_set_job_retries", "engine_list_incidents", "engine_no_such_tool"]
    expect(
      refused.filter((name) => {
        const tool = golden.get(name)
        return tool !== undefined && tool.annotations?.readOnlyHint === true && !!kindOf(tool)
      }),
    ).toEqual([])
  })
})
