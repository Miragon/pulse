import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { MCPServer } from "mcp-use"
import { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { appOnly, showToolBinding, strictToolInput } from "./widget-tool-bindings.js"

describe("showToolBinding", () => {
  it("binds the view to the tool name and stamps the Apps-SDK _meta half", () => {
    const binding = showToolBinding("camunda7_show_thing", "Thing")
    expect(binding.view).toEqual({
      name: "camunda7_show_thing",
      description: "Thing",
      prefersBorder: true,
    })
    expect(binding._meta).toMatchObject({
      "openai/outputTemplate": "ui://views/camunda7_show_thing.html",
      "openai/widgetAccessible": true,
    })
  })

  it("carries a passthrough outputSchema (mcp-use requires one for view-bound tools)", () => {
    const binding = showToolBinding("t", "T")
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

  function registrarSchema(input: Record<string, z.ZodType>): z.ZodType {
    let schema: z.ZodType | undefined
    const server = {
      tool: (definition: { inputSchema: z.ZodType }) => {
        schema = definition.inputSchema
      },
    } as unknown as MCPServer
    createToolRegistrar(server, null, { strictInput: true })({
      name: "probe",
      description: "probe",
      inputSchema: input,
      handler: () => Promise.resolve(null),
    })
    if (!schema) throw new Error("the registrar registered nothing")
    return schema
  }

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

  it("reports exactly the registrar's message (the widget path matches the registrar path)", () => {
    for (const args of [{ bogus: 1 }, { a: 1, b: 2, engine: "x" }]) {
      expect(failure(strictToolInput(shape), args)).toEqual(failure(registrarSchema(shape), args))
    }
    expect(failure(strictToolInput({}), { x: 1 })).toEqual(failure(registrarSchema({}), { x: 1 }))
  })

  it("keeps valid input and other validation messages untouched", () => {
    expect(strictToolInput(shape).parse({ engine: "a" })).toEqual({ engine: "a" })
    expect(failure(strictToolInput(shape), { engine: 1 })[0]).not.toMatch(/Unknown key/)
  })

  it("advertises additionalProperties: false", () => {
    expect(z.toJSONSchema(strictToolInput(shape), { io: "input" })).toMatchObject({
      additionalProperties: false,
    })
  })
})
