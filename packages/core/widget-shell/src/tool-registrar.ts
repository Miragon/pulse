import type { ServerContext, ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"
import type { ModuleServer } from "./module-server.js"
import { withToolErrors } from "./tool-errors.js"
import { strictToolInput } from "./widget-tool-bindings.js"

type ZodRawShape = Record<string, z.ZodType>

/** The validated args a handler receives, inferred from its input shape. */
type ToolArgs<TShape extends ZodRawShape = ZodRawShape> = z.infer<z.ZodObject<TShape>>

export interface ToolConfig<TClient, TShape extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  /** The domain file the tool lives in (CLAUDE.md invariant 1). */
  category?: string
  inputSchema?: TShape
  /** An object schema: MCP's `structuredContent` is an object. */
  outputSchema?: z.ZodObject
  annotations?: ToolAnnotations
  /**
   * `ctx` is the SDK's per-call context (`ctx.mcpReq.signal` aborts with the request); optional
   * so a test calls the handler as `(client, args)`. The caller comes from the ambient request
   * info (`callerCacheKey`), never from `ctx`.
   */
  handler: (client: TClient, args: ToolArgs<TShape>, ctx?: ServerContext) => Promise<unknown>
}

/** What `createToolRegistrar` returns: a module's tool files take it as `register`. */
export type ToolRegistrar<TClient> = <TShape extends ZodRawShape = ZodRawShape>(
  config: ToolConfig<TClient, TShape>,
) => void

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  _meta: { mimeType: "text/plain" },
})

const objectResult = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
  _meta: { mimeType: "application/json" },
})

/** A scalar under a declared outputSchema would be an opaque protocol error: name it instead. */
function toResult(result: unknown, config: { name: string; outputSchema?: unknown }) {
  if (Array.isArray(result)) return objectResult({ data: result })
  if (result !== null && typeof result === "object") {
    return objectResult(result as Record<string, unknown>)
  }
  if (config.outputSchema) {
    const kind = result === null ? "null" : typeof result
    throw new Error(
      `Tool "${config.name}" declares an outputSchema but its handler returned a ${kind} value; ` +
        `structured output must be an object or array.`,
    )
  }
  if (result !== undefined && result !== null) return textResult(JSON.stringify(result, null, 2))
  return textResult("Success (no content returned)")
}

/**
 * Every operations tool registers here (CLAUDE.md invariant 1), through the SDK's `registerTool`:
 * strict input (an unknown key is a tool error naming the valid keys), a throw as
 * `[code] message`, the result mirrored into `structuredContent`. The handler gets
 * `(client, args, ctx)`.
 */
export function createToolRegistrar<TClient>(
  server: ModuleServer,
  client: TClient,
): ToolRegistrar<TClient> {
  return <TShape extends ZodRawShape>(config: ToolConfig<TClient, TShape>) => {
    server.registerTool(
      config.name,
      {
        description: config.description,
        inputSchema: strictToolInput(config.inputSchema ?? {}),
        ...(config.outputSchema !== undefined && { outputSchema: config.outputSchema }),
        ...(config.annotations !== undefined && { annotations: config.annotations }),
      },
      // The SDK validates the args against the schema above before the callback runs; the
      // callback sees the erased `ToolArgs`, the handler its own shape.
      withToolErrors(async (args: ToolArgs, ctx: ServerContext) =>
        toResult(await config.handler(client, args as ToolArgs<TShape>, ctx), config),
      ),
    )
  }
}
