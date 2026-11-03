import { describe, expect, it } from "vitest"
import { decodeToolResult } from "./protocol/tool-result.js"
import { buildDataFeedResult } from "./view-results.js"

/** No widget `_meta`: a result with `ui.resourceUri` would be rendered by the host, not returned to `callTool()`. */
describe("buildDataFeedResult", () => {
  const data = { rows: [{ id: "pi-1" }], total: 1 }
  const result = buildDataFeedResult(data)

  it("puts the payload on the text channel as compact JSON", () => {
    expect(result.content).toEqual([{ type: "text", text: '{"rows":[{"id":"pi-1"}],"total":1}' }])
  })

  it("is read back by the view runtime's decoder, which falls back to the JSON text", () => {
    expect(decodeToolResult(result)).toEqual(data)
  })

  it("sends the payload once — no structuredContent copy, no widget _meta, no view binding", () => {
    expect(Object.keys(result)).toEqual(["content"])
  })

  it("stays a plain JSON envelope for an empty payload", () => {
    expect(buildDataFeedResult({}).content).toEqual([{ type: "text", text: "{}" }])
  })
})
