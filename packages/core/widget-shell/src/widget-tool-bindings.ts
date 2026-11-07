import { z } from "zod"
import { toWidgetCspMeta, type AppResourceCsp } from "./view-csp.js"

/** The scheme of the views the boot serves; the widget-contract e2e pins it. */
export const VIEW_RESOURCE_URI_PREFIX = "ui://views/"
const VIEW_RESOURCE_URI_SUFFIX = ".html"

export function viewResourceUri(viewName: string): string {
  return `${VIEW_RESOURCE_URI_PREFIX}${viewName}${VIEW_RESOURCE_URI_SUFFIX}`
}

/** The view a `ui://views/<name>.html` URI names; `undefined` for any other URI. */
export function viewNameOf(uri: unknown): string | undefined {
  if (typeof uri !== "string") return undefined
  if (!uri.startsWith(VIEW_RESOURCE_URI_PREFIX) || !uri.endsWith(VIEW_RESOURCE_URI_SUFFIX)) {
    return undefined
  }
  const name = uri.slice(VIEW_RESOURCE_URI_PREFIX.length, -VIEW_RESOURCE_URI_SUFFIX.length)
  return name.length > 0 && !name.includes("/") ? name : undefined
}

/** A view the module brings itself, a resource it registers, in place of one from the bundle. */
export interface OwnViewBinding {
  /** The resource's URI (`registerAppResource`), never under `ui://views/`. */
  resourceUri: string
  /** What the resource states in its `_meta.ui.csp`, for Apps SDK hosts' `openai/widgetCSP`. */
  csp?: AppResourceCsp
}

/**
 * The config parts that bind a tool to its view, spread into `registerTool`'s config: both halves
 * of `_meta`, MCP Apps' `ui.resourceUri` (with the flat `ui/resourceUri` older hosts read, as
 * `registerAppTool` adds it) and the OpenAI Apps SDK keys. Without `own` that is the view named
 * after the tool: the boot serves it from the bundle and titles it with the tool's `title`. With
 * `own` it is the resource the module registers itself. `passthrough` keeps free-form
 * `structuredContent` intact under the output schema.
 */
export function showToolBinding(name: string, title: string, own?: OwnViewBinding) {
  const resourceUri = own?.resourceUri ?? viewResourceUri(name)
  return {
    outputSchema: z.object({}).passthrough(),
    _meta: {
      ui: { resourceUri },
      "ui/resourceUri": resourceUri,
      "openai/outputTemplate": resourceUri,
      "openai/toolInvocation/invoking": `Loading ${title}…`,
      "openai/toolInvocation/invoked": `${title} ready`,
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
      ...(own?.csp && { "openai/widgetCSP": toWidgetCspMeta(own.csp) }),
    },
  }
}

/**
 * A non-strict `z.object` STRIPS an unknown key, so a misnamed filter silently widens the result
 * (#329). The registrar and every raw registration take this one schema; the boot refuses a tool
 * whose input lets an unknown key through.
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
 * The config part of a `*_data` feed, spread into `registerTool`'s config: SEP-1865 hosts hide a
 * `ui.visibility: ["app"]` tool from the LLM; Apps-SDK hosts deny in-widget callTool without
 * `openai/widgetAccessible`, which renders nothing. No view: a host would render the result
 * instead of returning it to the in-widget `callTool()`.
 */
export const appOnly = {
  _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
} as const satisfies { _meta: Record<string, unknown> }
