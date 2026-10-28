import {
  buildComposedView as buildComposedViewCore,
  buildSingleWidgetView as buildSingleWidgetViewCore,
  type ComposedViewInput,
  type SingleWidgetViewInput,
} from "@miragon/mcp-toolkit-core"

/** Kept out of the `/server` barrel so the shell's own tools import it directly. */

/**
 * TypeScript synthesizes the index signature mcp-use's callback expects for
 * anonymous types but NOT for the named `ViewToolResult`; re-annotated to stay assignable.
 */
type ViewResult = {
  content: { type: "text"; text: string }[]
  structuredContent: Record<string, unknown>
}

export const buildSingleWidgetView = (input: SingleWidgetViewInput): ViewResult =>
  buildSingleWidgetViewCore(input)

export const buildComposedView = (input: ComposedViewInput): ViewResult =>
  buildComposedViewCore(input)

type FeedResult = { content: { type: "text"; text: string }[] }

/**
 * No widget `_meta`: a widget-tool result would be rendered by the host instead
 * of reaching the in-widget `callTool()`. Text only: hosts may strip
 * `structuredContent`, and sending both doubled every feed.
 */
export const buildDataFeedResult = (data: Record<string, unknown>): FeedResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
})
