import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server"

/** Drops the `$schema` URI and zod's ±MAX_SAFE_INTEGER `.int()` bounds from advertised input schemas: they cost characters on every tool of every turn. Validation runs against the zod schemas, so this is behaviour-neutral; output schemas stay (clients validate against them). */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSafeIntegerBound(key: string, value: unknown): boolean {
  return (
    (key === "maximum" && value === Number.MAX_SAFE_INTEGER) ||
    (key === "minimum" && value === Number.MIN_SAFE_INTEGER)
  )
}

function withoutSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutSafeIntegerBounds)
  if (!isRecord(node)) return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key, value]) => !isSafeIntegerBound(key, value))
      .map(([key, value]) => [key, withoutSafeIntegerBounds(value)]),
  )
}

/** One advertised schema, trimmed: no root `$schema`, no safe-integer bounds. */
export function trimToolSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return schema
  const rest = { ...schema }
  delete rest.$schema
  return withoutSafeIntegerBounds(rest)
}

export function trimToolDescriptor(tool: unknown): unknown {
  if (!isRecord(tool) || !("inputSchema" in tool)) return tool
  return { ...tool, inputSchema: trimToolSchema(tool.inputSchema) }
}

/** The SDK has no list middleware: a Standard Schema shell whose JSON Schema comes out trimmed. */
export function trimInputSchema<TSchema extends StandardSchemaWithJSON>(schema: TSchema): TSchema {
  const standard = schema["~standard"]
  const { jsonSchema } = standard
  return {
    ...schema,
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options: never) => trimToolSchema(jsonSchema.input(options)),
        output: (options: never) => trimToolSchema(jsonSchema.output(options)),
      },
    },
  }
}
