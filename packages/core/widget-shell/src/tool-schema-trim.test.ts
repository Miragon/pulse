import { describe, expect, it } from "vitest"
import { z } from "zod"
import { trimInputSchema, trimToolDescriptor, trimToolSchema } from "./tool-schema-trim.js"

const input = z.toJSONSchema(
  z.object({
    firstResult: z.number().int().min(0).optional(),
    maxResults: z.number().int().positive().max(100).optional(),
    nested: z.object({ count: z.number().int() }).optional(),
    items: z.array(z.object({ retries: z.number().int() })).optional(),
  }),
)

describe("trimToolSchema", () => {
  it("drops the $schema dialect and every safe-integer bound, keeping real bounds", () => {
    expect(input.$schema).toBeDefined()
    expect(JSON.stringify(input)).toContain(String(Number.MAX_SAFE_INTEGER))
    const trimmed = trimToolSchema(input) as Record<string, unknown>
    expect(trimmed).not.toHaveProperty("$schema")
    expect(JSON.stringify(trimmed)).not.toContain(String(Number.MAX_SAFE_INTEGER))
    expect(trimmed.properties).toMatchObject({
      firstResult: { type: "integer", minimum: 0 },
      maxResults: { type: "integer", exclusiveMinimum: 0, maximum: 100 },
      nested: { properties: { count: { type: "integer" } } },
      items: { items: { properties: { retries: { type: "integer" } } } },
    })
  })

  it("never drops a property merely NAMED maximum/minimum", () => {
    const schema = {
      type: "object",
      properties: { maximum: { type: "integer" }, minimum: { type: "number" } },
    }
    expect(trimToolSchema(schema)).toEqual(schema)
  })

  it("passes non-objects through", () => {
    expect(trimToolSchema(undefined)).toBeUndefined()
    expect(trimToolSchema("x")).toBe("x")
  })
})

describe("trimToolDescriptor / trimInputSchema", () => {
  it("trims the input schema only: the output schema is what clients validate against", () => {
    const tool = { name: "t", inputSchema: input, outputSchema: input }
    const trimmed = trimToolDescriptor(tool) as typeof tool
    expect(trimmed.inputSchema).not.toHaveProperty("$schema")
    expect(trimmed.outputSchema).toBe(input)
    expect(trimToolDescriptor({ name: "no-schema" })).toEqual({ name: "no-schema" })
  })

  it("shells a Standard Schema so it advertises the trimmed JSON Schema and validates as before", () => {
    const schema = z.strictObject({ firstResult: z.number().int().min(0).optional() })
    const shell = trimInputSchema(schema)
    const advertised = shell["~standard"].jsonSchema.input({ target: "draft-2020-12" })
    expect(advertised).not.toHaveProperty("$schema")
    expect(JSON.stringify(advertised)).not.toContain(String(Number.MAX_SAFE_INTEGER))
    expect(shell["~standard"].validate({ nope: 1 })).toHaveProperty("issues")
  })
})
