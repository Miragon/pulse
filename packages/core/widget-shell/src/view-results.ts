/**
 * A type alias, NOT an interface: TypeScript synthesizes the index signature mcp-use's tool
 * callback expects for anonymous types only.
 */
export type ViewResult = {
  content: { type: "text"; text: string }[]
  structuredContent: Record<string, unknown>
}

/**
 * A show tool's result: `structuredContent` IS the data its view renders (the view is picked by
 * its name, the tool's name); the text is what the model reads: a short summary or, where the
 * model needs the figures, the result as compact JSON.
 */
export function buildViewResult(data: object, summary: string): ViewResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: data as Record<string, unknown>,
  }
}

type FeedResult = { content: { type: "text"; text: string }[] }

/**
 * No widget `_meta`: a widget-tool result would be rendered by the host instead
 * of reaching the in-widget `callTool()`. Text only: hosts may strip
 * `structuredContent`, and sending both doubled every feed.
 */
export const buildDataFeedResult = (data: Record<string, unknown>): FeedResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
})
