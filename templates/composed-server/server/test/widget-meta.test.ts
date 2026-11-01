import { describe, expect, it } from "vitest"
import {
  VIEW_RESOURCE_URI_PREFIX,
  showToolBinding,
  viewResourceUri,
} from "@miragon/pulse-widget-shell/server"

/**
 * Fast guard on the INSTALLED widget-shell's widget contract (mcp-use 2
 * native views): the MCP Apps half (`_meta.ui.*`) is emitted by mcp-use from
 * the tool's `view`/`visibility` fields, while `showToolBinding` stamps only the
 * Apps SDK half (`openai/*`). Without those keys Apps-SDK hosts don't recognise
 * widget tools and every widget hangs on its loading skeleton. If this fails,
 * the widget-shell pin or lockfile resolved to a package without the contract;
 * the wire-level counterpart lives in widget-contract.e2e.test.ts.
 */
describe("showToolBinding widget contract (installed widget-shell)", () => {
  it("derives the stable mcp-use view resource uri from the view name", () => {
    expect(VIEW_RESOURCE_URI_PREFIX).toBe("ui://views/")
    expect(viewResourceUri("notes_show_notes")).toBe("ui://views/notes_show_notes.html")
  })

  it("emits the Apps SDK half for widget-rendering tools", () => {
    const meta = showToolBinding("notes_show_notes", "Team Notes")._meta

    expect(meta["openai/outputTemplate"]).toBe(viewResourceUri("notes_show_notes"))
    // One "…" character (the catalog rule), never three dots.
    expect(meta["openai/toolInvocation/invoking"]).toBe("Loading Team Notes…")
    expect(meta["openai/toolInvocation/invoked"]).toBe("Team Notes ready")
    expect(meta["openai/widgetAccessible"]).toBe(true)
    expect(meta["openai/resultCanProduceWidget"]).toBe(true)
  })

  it("never stamps the mcp-use-owned ui namespace", () => {
    // mcp-use owns `_meta.ui` / `ui/*` (derived from view/visibility) and
    // overwrites them on tools/list: showToolBinding must not fight it.
    for (const key of Object.keys(showToolBinding("x", "X")._meta)) {
      expect(key === "ui" || key.startsWith("ui/"), `unexpected ui key ${key}`).toBe(false)
    }
  })
})
