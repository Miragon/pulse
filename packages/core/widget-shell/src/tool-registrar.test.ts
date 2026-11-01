import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { MCPServer } from "mcp-use"
import { createToolRegistrar } from "./tool-registrar.js"

interface Result {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: unknown
  _meta?: { mimeType?: string }
}

interface Registered {
  definition: {
    name: string
    description: string
    inputSchema: z.ZodType
    outputSchema?: z.ZodType
    annotations?: Record<string, boolean>
  }
  call: (args: Record<string, unknown>, ctx?: unknown) => Promise<Result>
}

/** A fake `server.tool` that records what the registrar hands mcp-use. */
function harness<TClient>(client: TClient) {
  const tools: Registered[] = []
  const server = {
    tool: (definition: Registered["definition"], call: Registered["call"]) => {
      tools.push({ definition, call })
    },
  } as unknown as MCPServer
  const only = (): Registered => {
    const [tool] = tools
    if (!tool) throw new Error("the registrar registered nothing")
    return tool
  }
  return { register: createToolRegistrar(server, client), only }
}

const text = (result: Result) => result.content[0]?.text

describe("createToolRegistrar results", () => {
  it("mirrors an object into structuredContent and pretty JSON text", async () => {
    const { register, only } = harness({})
    register({
      name: "get",
      description: "",
      handler: () => Promise.resolve({ id: "1", name: "Foo" }),
    })
    const result = await only().call({})
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ id: "1", name: "Foo" }, null, 2) }],
      structuredContent: { id: "1", name: "Foo" },
      _meta: { mimeType: "application/json" },
    })
  })

  it("wraps an array as { data }", async () => {
    const { register, only } = harness({})
    register({ name: "list", description: "", handler: () => Promise.resolve([{ id: "1" }]) })
    const result = await only().call({})
    expect(result.structuredContent).toEqual({ data: [{ id: "1" }] })
    expect(JSON.parse(text(result) ?? "")).toEqual({ data: [{ id: "1" }] })
  })

  it("returns a scalar as JSON text without structuredContent", async () => {
    const { register, only } = harness({})
    register({ name: "version", description: "", handler: () => Promise.resolve("1.2.3") })
    expect(await only().call({})).toEqual({
      content: [{ type: "text", text: '"1.2.3"' }],
      _meta: { mimeType: "text/plain" },
    })
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("answers %s with the success text", async (_label, value) => {
    const { register, only } = harness({})
    register({ name: "noop", description: "", handler: () => Promise.resolve(value) })
    const result = await only().call({})
    expect(result.structuredContent).toBeUndefined()
    expect(text(result)).toBe("Success (no content returned)")
  })

  it("reports a coded throw as `[code] message`", async () => {
    const { register, only } = harness({})
    register({
      name: "broken",
      description: "",
      handler: () => Promise.reject(Object.assign(new Error("boom"), { code: "ENGINE_DOWN" })),
    })
    expect(await only().call({})).toEqual({
      isError: true,
      content: [{ type: "text", text: "[ENGINE_DOWN] boom" }],
    })
  })

  it.each([
    ["string", "1.2.3"],
    ["null", null],
    ["undefined", undefined],
  ])("names a %s result under an outputSchema as a tool error", async (kind, value) => {
    const { register, only } = harness({})
    register({
      name: "declared",
      description: "",
      outputSchema: z.object({ id: z.string() }),
      handler: () => Promise.resolve(value),
    })
    const result = await only().call({})
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(text(result)).toBe(
      `Tool "declared" declares an outputSchema but its handler returned a ${kind} value; ` +
        "structured output must be an object or array.",
    )
  })
})

describe("createToolRegistrar registration", () => {
  it("forwards name, description, outputSchema and annotations unchanged", () => {
    const { register, only } = harness({})
    const outputSchema = z.object({ data: z.array(z.string()) })
    const annotations = { readOnlyHint: true, destructiveHint: false }
    register({
      name: "probe",
      description: "Probes.",
      category: "probes",
      outputSchema,
      annotations,
      handler: () => Promise.resolve({ data: [] }),
    })
    const { definition } = only()
    expect(definition.name).toBe("probe")
    expect(definition.description).toBe("Probes.")
    expect(definition.outputSchema).toBe(outputSchema)
    expect(definition.annotations).toBe(annotations)
    // `category` is registrar bookkeeping, never part of the wire definition.
    expect(definition).not.toHaveProperty("category")
  })

  it("hands the handler the client, the args and the ctx", async () => {
    const client = { id: "client" }
    const seen: unknown[] = []
    const { register, only } = harness(client)
    register({
      name: "probe",
      description: "",
      inputSchema: { a: z.number() },
      handler: (...args) => {
        seen.push(...args)
        return Promise.resolve(null)
      },
    })
    const ctx = { signal: new AbortController().signal }
    await only().call({ a: 1 }, ctx)
    expect(seen).toEqual([client, { a: 1 }, ctx])
  })

  it("advertises strict input and names the valid keys for an unknown one", () => {
    const { register, only } = harness({})
    register({
      name: "probe",
      description: "",
      inputSchema: { query: z.string(), limit: z.number().optional() },
      handler: () => Promise.resolve(null),
    })
    const schema = only().definition.inputSchema
    expect(z.toJSONSchema(schema, { io: "input" })).toMatchObject({ additionalProperties: false })
    const result = schema.safeParse({ query: "a", extra: 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Unknown key "extra". Valid keys: "query", "limit".',
    ])
  })

  it("is strict without an input schema too", () => {
    const { register, only } = harness({})
    register({ name: "probe", description: "", handler: () => Promise.resolve(null) })
    const schema = only().definition.inputSchema
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ x: 1 }).error?.issues.map((issue) => issue.message)).toEqual([
      'Unknown key "x". This tool takes no arguments.',
    ])
  })
})
