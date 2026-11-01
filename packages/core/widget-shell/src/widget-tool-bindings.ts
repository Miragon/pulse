import { z } from "zod"

/** mcp-use's scheme for view resources; it exports none, and the widget-contract e2e pins it. */
export const VIEW_RESOURCE_URI_PREFIX = "ui://views/"

export function viewResourceUri(viewName: string): string {
  return `${VIEW_RESOURCE_URI_PREFIX}${viewName}.html`
}

/**
 * mcp-use derives the MCP Apps half of `_meta` from `view` and overwrites `ui` on tools/list; this
 * stamps only the OpenAI Apps SDK half (`openai/*`), in the wire order hosts read. mcp-use requires
 * an `outputSchema`; `passthrough` keeps free-form `structuredContent` intact. `prefersBorder`: the
 * cards draw no frame of their own (#344).
 */
export function showToolBinding(name: string, title: string) {
  return {
    view: { name, description: title, prefersBorder: true },
    outputSchema: z.object({}).passthrough(),
    _meta: {
      "openai/outputTemplate": viewResourceUri(name),
      "openai/toolInvocation/invoking": `Loading ${title}…`,
      "openai/toolInvocation/invoked": `${title} ready`,
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
    },
  }
}

/**
 * A non-strict `z.object` lets mcp-use STRIP an unknown key, so a misnamed
 * filter silently widens the result (#329). The registrar and every raw
 * registration take this one schema.
 */
export function strictToolInput<TShape extends z.ZodRawShape>(shape: TShape) {
  const valid = Object.keys(shape)
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? unknownKeysMessage(issue.keys, valid) : undefined,
  })
}

function unknownKeysMessage(unknown: readonly string[], valid: readonly string[]): string {
  const quote = (keys: readonly string[]) => keys.map((key) => JSON.stringify(key)).join(", ")
  const head = `Unknown key${unknown.length === 1 ? "" : "s"} ${quote(unknown)}.`
  return valid.length === 0
    ? `${head} This tool takes no arguments.`
    : `${head} Valid keys: ${quote(valid)}.`
}

/**
 * SEP-1865 hosts hide `visibility: "app"` tools from the LLM. Apps-SDK hosts
 * deny in-widget callTool without `openai/widgetAccessible`; it renders nothing.
 */
export const appOnly = {
  visibility: "app" as const,
  _meta: { "openai/widgetAccessible": true },
}
