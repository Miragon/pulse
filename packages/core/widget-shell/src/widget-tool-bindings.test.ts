import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  VIEW_RESOURCE_URI_PREFIX,
  appOnly,
  showToolBinding,
  strictToolInput,
  viewResourceUri,
} from "./widget-tool-bindings.js"

describe("viewResourceUri", () => {
  it("builds mcp-use's view resource URI", () => {
    expect(viewResourceUri("show_tasks_board")).toBe("ui://views/show_tasks_board.html")
    expect(viewResourceUri("x").startsWith(VIEW_RESOURCE_URI_PREFIX)).toBe(true)
  })
})

describe("showToolBinding", () => {
  const binding = showToolBinding("show_widget", "Widget")

  it("binds the view to the tool name", () => {
    expect(binding.view).toEqual({
      name: "show_widget",
      description: "Widget",
      prefersBorder: true,
    })
  })

  it("stamps the five Apps SDK keys in the wire order", () => {
    expect(Object.keys(binding._meta)).toEqual([
      "openai/outputTemplate",
      "openai/toolInvocation/invoking",
      "openai/toolInvocation/invoked",
      "openai/widgetAccessible",
      "openai/resultCanProduceWidget",
    ])
    expect(binding._meta).toEqual({
      "openai/outputTemplate": "ui://views/show_widget.html",
      "openai/toolInvocation/invoking": "Loading Widget…",
      "openai/toolInvocation/invoked": "Widget ready",
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
    })
  })

  it("never stamps a ui key: mcp-use owns that namespace", () => {
    expect(Object.keys(binding._meta).some((key) => key === "ui" || key.startsWith("ui/"))).toBe(
      false,
    )
  })

  it("carries a passthrough outputSchema (mcp-use requires one for view-bound tools)", () => {
    // Free-form structuredContent must survive SDK-side validation unstripped.
    expect(binding.outputSchema.parse({ anything: 1, nested: { x: true } })).toEqual({
      anything: 1,
      nested: { x: true },
    })
  })
})

describe("appOnly", () => {
  it("marks the tool app-only + widget-accessible, without any rendering keys", () => {
    expect(appOnly.visibility).toBe("app")
    expect(appOnly._meta).toEqual({ "openai/widgetAccessible": true })
    // A feed result must never be rendered by the host (invariant 5).
    expect(appOnly).not.toHaveProperty("view")
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
