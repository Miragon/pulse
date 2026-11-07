import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { viewResourceUri } from "@miragon/pulse-widget-shell/server"
import {
  bootComposition,
  closeComposition,
  isAppOnly,
  isComposed,
  isViewBound,
  type BootedComposition,
} from "./boot.js"

/**
 * The example module (`modules/mcp-notes`), the one test that names it. The guard tests next to
 * this file derive what they check from `MODULES` and the tools the composition lists; this one
 * pins that they select the example's plain tool, view tool and data feed, so they never pass by
 * checking nothing. Delete it together with `modules/mcp-notes`: the create-module skill's
 * "Remove the example module" lists every step.
 */
const EXAMPLE = "notes"

describe("the example module (modules/mcp-notes)", () => {
  it("is composed (delete this file once you remove it)", () => {
    expect(
      isComposed(EXAMPLE),
      "modules/mcp-notes is no longer in MODULES: delete server/test/example-notes.test.ts " +
        'too (create-module skill, "Remove the example module")',
    ).toBe(true)
  })

  describe.runIf(isComposed(EXAMPLE))("on the wire", () => {
    let booted: BootedComposition
    const tool = (name: string) => booted.tools.find((t) => t.name === name)

    beforeAll(async () => {
      booted = await bootComposition()
    })

    afterAll(async () => {
      await closeComposition(booted)
      vi.unstubAllEnvs()
    })

    it("lists its plain tool, its view tool and its data feed", () => {
      expect(booted.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(["notes_list_notes", "notes_show_notes", "notes_list_data"]),
      )
    })

    it("is selected by the guards: a view-bound show tool and an app-only feed", () => {
      expect(isViewBound(tool("notes_show_notes")!), "notes_show_notes is view-bound").toBe(true)
      expect(isAppOnly(tool("notes_show_notes")!), "notes_show_notes is model-visible").toBe(false)
      expect(isAppOnly(tool("notes_list_data")!), "notes_list_data is app-only").toBe(true)
    })

    it("describes its view with the show tool's title", async () => {
      const { contents } = await booted.client.readResource({
        uri: viewResourceUri("notes_show_notes"),
      })
      const meta = (contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}
      expect(meta["openai/widgetDescription"]).toBe("Team Notes")
    })
  })
})
