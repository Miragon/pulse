import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  VIEW_RESOURCE_URI_PREFIX,
  appOnly,
  showToolBinding,
  strictToolInput,
  viewNameOf,
  viewResourceUri,
} from "./widget-tool-bindings.js"

describe("viewResourceUri and viewNameOf", () => {
  it("builds the view resource URI the boot serves, and reads the view back", () => {
    expect(viewResourceUri("show_tasks_board")).toBe("ui://views/show_tasks_board.html")
    expect(viewResourceUri("x").startsWith(VIEW_RESOURCE_URI_PREFIX)).toBe(true)
    expect(viewNameOf(viewResourceUri("show_tasks_board"))).toBe("show_tasks_board")
  })

  it("names no view for another URI", () => {
    for (const uri of [
      "ui://weather/view.html",
      "ui://views/x.htm",
      "ui://views/.html",
      "ui://views/a/b.html",
      undefined,
      7,
    ]) {
      expect(viewNameOf(uri), String(uri)).toBeUndefined()
    }
  })
})

describe("showToolBinding", () => {
  const binding = showToolBinding("show_widget", "Widget")
  const uri = "ui://views/show_widget.html"

  it("binds the view named after the tool, in both MCP Apps spellings", () => {
    expect(binding._meta.ui).toEqual({ resourceUri: uri })
    expect(binding._meta["ui/resourceUri"]).toBe(uri)
  })

  it("stamps the five Apps SDK keys in the wire order, after the MCP Apps half", () => {
    expect(Object.keys(binding._meta)).toEqual([
      "ui",
      "ui/resourceUri",
      "openai/outputTemplate",
      "openai/toolInvocation/invoking",
      "openai/toolInvocation/invoked",
      "openai/widgetAccessible",
      "openai/resultCanProduceWidget",
    ])
    expect(binding._meta).toMatchObject({
      "openai/outputTemplate": uri,
      "openai/toolInvocation/invoking": "Loading Widget…",
      "openai/toolInvocation/invoked": "Widget ready",
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
    })
  })

  it("is only official config: an outputSchema and _meta", () => {
    expect(Object.keys(binding)).toEqual(["outputSchema", "_meta"])
  })

  it("carries a passthrough outputSchema", () => {
    // Free-form structuredContent must survive SDK-side validation unstripped.
    expect(binding.outputSchema.parse({ anything: 1, nested: { x: true } })).toEqual({
      anything: 1,
      nested: { x: true },
    })
  })
})

describe("appOnly", () => {
  it("marks the tool app-only + widget-accessible, without any rendering keys", () => {
    expect(appOnly).toEqual({
      _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
    })
    // A feed result must never be rendered by the host (invariant 5).
    expect(appOnly._meta.ui).not.toHaveProperty("resourceUri")
    expect(appOnly._meta).not.toHaveProperty("openai/outputTemplate")
  })
})

describe("strictToolInput", () => {
  const shape = { processDefinitionKey: z.string().optional(), engine: z.string().optional() }

  const failure = (schema: z.ZodType, args: unknown) => {
    const result = schema.safeParse(args)
    if (result.success) throw new Error("expected a validation failure")
    return result.error.issues.map((issue) => issue.message)
  }

  it("rejects an unknown key, naming it and every valid key", () => {
    expect(failure(strictToolInput(shape), { processDefinitionKeyIn: "a" })).toEqual([
      'Unknown key "processDefinitionKeyIn". Valid keys: "processDefinitionKey", "engine".',
    ])
  })

  it("keeps valid input and other validation messages untouched", () => {
    expect(strictToolInput(shape).parse({ engine: "a" })).toEqual({ engine: "a" })
    expect(failure(strictToolInput(shape), { engine: 1 })[0]).not.toMatch(/Unknown key/)
    expect(failure(strictToolInput(shape), "not an object")[0]).not.toMatch(/Unknown key/)
  })

  it("advertises additionalProperties: false", () => {
    expect(z.toJSONSchema(strictToolInput(shape), { io: "input" })).toMatchObject({
      additionalProperties: false,
    })
  })
})
