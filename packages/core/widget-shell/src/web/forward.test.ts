import { describe, expect, it } from "vitest"
import {
  callContext,
  CSRF,
  DUE,
  jsonOf,
  mcpTarget,
  pageCall,
  result,
  RESULT,
  ROWS,
  scriptedProvider,
  sessionCookie,
  sessionTokens,
  setup,
  SIGNED_OUT,
  T0,
  type McpReply,
} from "./call.test-support.js"
import { callRoute, WEB_CALL_MAX_BYTES } from "./forward.js"

describe("POST /app/api/call: what a page may send", () => {
  it("forwards a page's call of a feed and answers its result, with nothing else", async () => {
    const { call, requests } = await setup({ mcp: [result(RESULT)] })
    const response = await call()
    expect(await jsonOf(response)).toEqual({ status: 200, body: { result: RESULT } })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toHaveLength(1)
  })

  it("answers 401 signed_out without a session, and forwards nothing", async () => {
    const { ctx } = callContext(scriptedProvider().platform)
    const { target, requests } = mcpTarget()
    const response = await callRoute(ctx, target)(pageCall("", ROWS))
    expect(await jsonOf(response)).toEqual({ status: 401, body: SIGNED_OUT })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(requests).toEqual([])
  })

  it("refuses a request that did not come from the app's page, and says why in the log", async () => {
    const { call, requests, logged } = await setup()
    const response = await call(ROWS, { "x-pulse-csrf": `${CSRF}-forged` })
    expect(await jsonOf(response)).toEqual({
      status: 403,
      body: { message: "Refused: the request did not come from the app's page." },
    })
    expect(logged).toEqual(["Web call refused: wrong-token."])
    expect(requests).toEqual([])
  })

  it.each([
    ["text/plain", { "content-type": "text/plain" }],
    ["a form", { "content-type": "application/x-www-form-urlencoded" }],
    ["no type", { "content-type": "" }],
  ])("refuses a body sent as %s with 415", async (_label, headers) => {
    const { call, requests } = await setup()
    const response = await call(ROWS, headers)
    expect(await jsonOf(response)).toEqual({
      status: 415,
      body: { message: "Unsupported media type: a call is sent as JSON." },
    })
    expect(requests).toEqual([])
  })

  it("refuses a body that names no type with 415", async () => {
    const { ctx } = callContext(scriptedProvider().platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    const { target, requests } = mcpTarget()
    const headers = new Headers(pageCall(cookie, ROWS).headers)
    headers.delete("content-type")
    const body = new TextEncoder().encode(JSON.stringify(ROWS))
    const request = new Request("http://localhost/app/api/call", { method: "POST", headers, body })
    expect((await callRoute(ctx, target)(request)).status).toBe(415)
    expect(requests).toEqual([])
  })

  it.each(["Application/JSON; charset=utf-8", "application/json ; charset=utf-8"])(
    "takes JSON with a charset (%s)",
    async (type) => {
      const { call } = await setup()
      expect((await call(ROWS, { "content-type": type })).status).toBe(200)
    },
  )

  it("refuses a body over 64 KiB with 413 and reads no further", async () => {
    const { call, requests } = await setup()
    const filler = "x".repeat(WEB_CALL_MAX_BYTES)
    const response = await call({ ...ROWS, arguments: { filler } })
    expect(await jsonOf(response)).toEqual({
      status: 413,
      body: { message: "Payload too large: a call holds at most 64 KiB." },
    })
    expect(requests).toEqual([])
    const fits = "x".repeat(
      WEB_CALL_MAX_BYTES - JSON.stringify({ ...ROWS, arguments: { f: "" } }).length,
    )
    expect((await call({ ...ROWS, arguments: { f: fits } })).status).toBe(200)
  })

  it.each([
    ["an empty body", ""],
    ["no JSON", "{name"],
    ["an array", "[]"],
    ["null", "null"],
    ["no name", { arguments: {} }],
    ["a name that is no string", { name: 7 }],
    ["arguments that are no object", { name: "probe_rows_data", arguments: [] }],
    ["a key besides the two", { ...ROWS, engine: "prod" }],
  ])("refuses %s with 400", async (_label, body) => {
    const { call, requests } = await setup()
    expect(await jsonOf(await call(body))).toEqual({
      status: 400,
      body: {
        message:
          "Bad request: a call is a JSON object of the tool's name and its arguments, and nothing else.",
      },
    })
    expect(requests).toEqual([])
  })

  it("refuses a request without a body with 400", async () => {
    const { ctx } = callContext(scriptedProvider().platform)
    const cookie = await sessionCookie(ctx, sessionTokens(T0))
    const { target, requests } = mcpTarget()
    const request = pageCall(cookie, ROWS)
    const bodiless = new Request(request.url, { method: "POST", headers: request.headers })
    expect((await callRoute(ctx, target)(bodiless)).status).toBe(400)
    expect(requests).toEqual([])
  })

  it("forwards a call without arguments with none", async () => {
    const { call, bodies } = await setup()
    expect((await call({ name: "probe_rows_data" })).status).toBe(200)
    expect(bodies).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "probe_rows_data", arguments: {} },
      },
    ])
  })
})

describe("POST /app/api/call: only a read a view calls", () => {
  it("refuses a write with WEB_READ_ONLY before anything runs, though a view may call it", async () => {
    const { call, requests, idp } = await setup({ at: DUE })
    expect(await jsonOf(await call({ name: "probe_write", arguments: {} }))).toEqual({
      status: 403,
      body: {
        code: "WEB_READ_ONLY",
        message: "Refused: the web app only reads, and this tool writes.",
      },
    })
    // Not even the due token was renewed.
    expect([requests, idp.forms]).toEqual([[], []])
  })

  it("counts a tool without annotations as one that writes", async () => {
    const { call, requests } = await setup()
    const response = await call({ name: "probe_bare", arguments: {} })
    expect(await jsonOf(response)).toMatchObject({ status: 403, body: { code: "WEB_READ_ONLY" } })
    expect(requests).toEqual([])
  })

  it.each([
    ["a model read no view calls", "probe_model_read"],
    ["a tool this boot does not serve", "probe_unknown"],
  ])("refuses %s with WEB_NOT_FOR_PAGES", async (_label, name) => {
    const { call, requests } = await setup()
    expect(await jsonOf(await call({ name, arguments: {} }))).toEqual({
      status: 403,
      body: {
        code: "WEB_NOT_FOR_PAGES",
        message: "Refused: a page calls only the tools a view calls.",
      },
    })
    expect(requests).toEqual([])
  })
})

describe("POST /app/api/call: the forward", () => {
  it("sends one tools/call to <MCP_URL>/mcp with exactly an MCP client's headers", async () => {
    const { call, requests, bodies } = await setup()
    // The page's own headers (its cookie, its origin, the CSRF token) stay behind.
    expect((await call()).status).toBe(200)
    expect(requests).toHaveLength(1)
    const [forwarded] = requests
    expect([forwarded.method, forwarded.url]).toEqual(["POST", "http://localhost/mcp"])
    expect([...forwarded.headers]).toEqual([
      ["accept", "application/json, text/event-stream"],
      ["authorization", "Bearer access-1"],
      ["content-type", "application/json"],
      ["host", "localhost"],
      ["mcp-protocol-version", "2025-11-25"],
    ])
    expect(bodies).toEqual([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: ROWS }])
  })
})

describe("POST /app/api/call: what /mcp answers", () => {
  it("reads the result off an event stream, past a notification and a line that is no JSON", async () => {
    const message = (value: object) => `event: message\ndata: ${JSON.stringify(value)}\n\n`
    const stream: McpReply = {
      contentType: "text/event-stream; charset=utf-8",
      body:
        message({ jsonrpc: "2.0", method: "notifications/message", params: {} }) +
        "data: [keep-alive]\n\n" +
        message({ jsonrpc: "2.0", id: 1, result: RESULT }),
    }
    const { call } = await setup({ mcp: [stream] })
    expect(await jsonOf(await call())).toEqual({ status: 200, body: { result: RESULT } })
  })

  it("answers a tool's isError result as a result", async () => {
    const failed = { content: [{ type: "text", text: "engine down" }], isError: true }
    const { call } = await setup({ mcp: [result(failed)] })
    expect(await jsonOf(await call())).toEqual({ status: 200, body: { result: failed } })
  })

  it("answers a JSON-RPC error with 502 and its message", async () => {
    const error = { code: -32602, message: "MCP error -32602: Tool probe_rows_data not found" }
    const reply: McpReply = {
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, error }),
    }
    const { call } = await setup({ mcp: [reply] })
    expect(await jsonOf(await call())).toEqual({ status: 502, body: { message: error.message } })
  })

  it.each<[string, McpReply]>([
    ["no JSON-RPC message", { status: 500, body: "Internal Server Error" }],
    [
      "an error without words",
      { status: 403, contentType: "application/json", body: '{"error":{}}' },
    ],
    [
      "the gate's refusal of a scope",
      { status: 403, contentType: "application/json", body: '{"error":"insufficient_scope"}' },
    ],
  ])("answers %s with 502 and the status", async (_label, reply) => {
    const { call } = await setup({ mcp: [reply] })
    expect(await jsonOf(await call())).toEqual({
      status: 502,
      body: { message: `The MCP endpoint answered HTTP ${reply.status}.` },
    })
  })
})
