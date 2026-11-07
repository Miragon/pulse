import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import {
  installRequestLog,
  requestLogLevel,
  requestLogLevelWarning,
  type RequestLogLevel,
} from "./request-log.js"

let log: MockInstance<(line: string) => void>

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const lines = () => log.mock.calls.map(([line]) => String(line))

let seen = 0

beforeEach(() => {
  seen = 0
})

/** The line the last request added (a streamed answer's comes once it ended), its time made stable. */
const lastLine = async () => {
  await vi.waitFor(() => expect(lines().length).toBeGreaterThan(seen))
  seen = lines().length
  return lines()
    .at(-1)!
    .replace(/ \d+ms/, " Nms")
}

const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

const notification = (method: string) => ({ jsonrpc: "2.0", method })

const sse = (...messages: object[]) =>
  new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  })

/** A Hono app with the log in front of `/mcp`, answering what `answer` returns. */
function appWith(
  answer: (request: Request) => Response | Promise<Response>,
  level?: RequestLogLevel,
) {
  const app = new Hono()
  installRequestLog(app, "/mcp", level)
  app.all("/mcp", (c) => answer(c.req.raw))
  app.get("/health", (c) => c.text("ok"))
  app.get("/boom", () => {
    throw new Error("handler blew up")
  })
  return app
}

const post = (app: Hono, body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )

const ok = (result: unknown = {}) => Response.json({ jsonrpc: "2.0", id: 1, result })

describe("the request log: one line per request", () => {
  it("names an HTTP request by its method and path", async () => {
    await appWith(() => ok()).fetch(new Request("http://localhost/health"))
    expect(await lastLine()).toBe("GET /health 200 Nms")
  })

  it("names an MCP request by its method, subject and client", async () => {
    const app = appWith(() => ok())
    await post(app, rpc("initialize", { clientInfo: { name: "claude-code", version: "2.1" } }))
    expect(await lastLine()).toBe("initialize claude-code/2.1 /mcp 200 client=claude-code/2.1 Nms")
  })

  it.each<[string, Record<string, unknown>, string]>([
    ["tools/call", { name: "engine_status", arguments: { a: 1 } }, "tools/call engine_status"],
    ["prompts/get", { name: "triage" }, "prompts/get triage"],
    ["resources/read", { uri: "ui://views/x.html" }, "resources/read ui://views/x.html"],
    ["logging/setLevel", { level: "debug" }, "logging/setLevel debug"],
    [
      "completion/complete",
      { ref: { type: "ref/prompt", name: "triage" } },
      "completion/complete triage",
    ],
    [
      "completion/complete",
      { ref: { type: "ref/resource", uri: "ui://x" } },
      "completion/complete ui://x",
    ],
    ["tools/list", {}, "tools/list"],
  ])("names %s's subject", async (method, params, named) => {
    await post(
      appWith(() => ok()),
      rpc(method, params),
    )
    expect(await lastLine()).toBe(`${named} /mcp 200 client=unknown Nms`)
  })

  it("reads the client from a modern request's envelope", async () => {
    const meta = { "io.modelcontextprotocol/clientInfo": { name: "probe", version: "" } }
    await post(
      appWith(() => ok()),
      rpc("tools/list", { _meta: meta }),
    )
    expect(await lastLine()).toBe("tools/list /mcp 200 client=probe Nms")
  })

  it("names a batch by its requests, and a body without a request by its HTTP method", async () => {
    const app = appWith(() => ok())
    await post(app, [
      rpc("ping"),
      rpc("tools/list", {}, 2),
      notification("notifications/initialized"),
    ])
    expect(await lastLine()).toBe("batch(ping,tools/list) /mcp 200 client=unknown Nms")
    await post(app, notification("notifications/initialized"))
    expect(await lastLine()).toBe("POST /mcp 200 Nms")
    await post(app, "{nope")
    expect(await lastLine()).toBe("POST /mcp 200 Nms")
  })

  // A caller must not forge a line or reorder the screen through a name it chooses.
  it("replaces control and format characters in what the caller names", async () => {
    const app = appWith(() => ok())
    await post(app, rpc("tools/call", { name: "a\nGET /forged 200 0ms" }))
    await post(app, rpc("initialize", { clientInfo: { name: "x‮evil", version: "1" } }))
    const [first, second] = lines()
    expect(first).toMatch(/^tools\/call a\?GET \/forged 200 0ms \/mcp 200 client=unknown \d+ms$/)
    expect(second).toContain("client=x?evil/1")
  })
})

describe("the request log: the error text", () => {
  it("ends a JSON-RPC error in its message", async () => {
    const app = appWith(() =>
      Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not Acceptable: no SSE" } },
        { status: 406 },
      ),
    )
    await post(app, rpc("tools/list"))
    expect(await lastLine()).toBe(
      "tools/list /mcp 406 client=unknown Nms ERROR Not Acceptable: no SSE",
    )
  })

  it("ends a tool's isError result in its text, read off the stream once it ended", async () => {
    const app = appWith(() =>
      sse({
        jsonrpc: "2.0",
        id: 1,
        result: { isError: true, content: [{ type: "text", text: "engine down" }] },
      }),
    )
    const res = await post(app, rpc("tools/call", { name: "engine_status" }))
    expect(await res.text()).toContain("engine down")
    expect(await lastLine()).toBe(
      "tools/call engine_status /mcp 200 client=unknown Nms ERROR engine down",
    )
  })

  it("says tool error for an isError result without text, and finds an error among batch answers", async () => {
    const app = appWith((request) =>
      request.headers.get("x-batch")
        ? Response.json([
            { jsonrpc: "2.0", id: 1, result: {} },
            { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } },
          ])
        : sse({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "image" }] } }),
    )
    await post(app, rpc("tools/call", { name: "x" }))
    expect(await lastLine()).toMatch(/ERROR tool error$/)
    await post(app, [rpc("ping"), rpc("resources/subscribe", {}, 2)], { "x-batch": "1" })
    expect(await lastLine()).toMatch(
      /^batch\(ping,resources\/subscribe\) .* ERROR Method not found$/,
    )
  })

  it("ends an OAuth refusal in its code and description", async () => {
    const app = appWith(() =>
      Response.json(
        { error: "invalid_token", error_description: "Missing Authorization header" },
        { status: 401 },
      ),
    )
    await post(app, rpc("initialize", { clientInfo: { name: "x", version: "0" } }))
    expect(await lastLine()).toBe(
      "initialize x/0 /mcp 401 client=x/0 Nms ERROR invalid_token: Missing Authorization header",
    )
    const bare = appWith(() => Response.json({ error: "invalid_request" }, { status: 400 }))
    await post(bare, rpc("ping"))
    expect(await lastLine()).toMatch(/ERROR invalid_request$/)
  })

  it("names the status of a failed MCP request whose body says nothing", async () => {
    await post(
      appWith(() => new Response("boom", { status: 500 })),
      rpc("ping"),
    )
    expect(await lastLine()).toBe("ping /mcp 500 client=unknown Nms ERROR (HTTP 500)")
    await post(
      appWith(() => new Response(null, { status: 405 })),
      rpc("ping"),
    )
    expect(await lastLine()).toBe("ping /mcp 405 client=unknown Nms ERROR (HTTP 405)")
  })

  // The edge guard refuses before the body is read, and `PUT /mcp` has no request to name.
  it("names the error of a refusal that carries no MCP request, and nothing for a plain 404", async () => {
    const app = appWith(() =>
      Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        { status: 405 },
      ),
    )
    await app.fetch(new Request("http://localhost/mcp", { method: "PUT" }))
    expect(await lastLine()).toBe("PUT /mcp 405 Nms ERROR Method not allowed.")
    await app.fetch(new Request("http://localhost/nope"))
    expect(await lastLine()).toBe("GET /nope 404 Nms")
  })

  // Every client probes the standalone stream (GET) and may end its session (DELETE); a
  // stateless server answers both with 405, which is no failure.
  it("logs the 405 of a GET or DELETE on /mcp without an error", async () => {
    const app = appWith(() =>
      Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
        { status: 405, headers: { allow: "POST" } },
      ),
    )
    await app.fetch(new Request("http://localhost/mcp"))
    expect(await lastLine()).toBe("GET /mcp 405 Nms")
    await app.fetch(new Request("http://localhost/mcp", { method: "DELETE" }))
    expect(await lastLine()).toBe("DELETE /mcp 405 Nms")
  })

  it("names a handler's thrown error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    await appWith(() => ok()).fetch(new Request("http://localhost/boom"))
    expect(await lastLine()).toBe("GET /boom 500 Nms ERROR handler blew up")
  })

  it("cuts a long error text and keeps it on one line", async () => {
    const message = `line one\nline two ${"x".repeat(600)}`
    const app = appWith(() =>
      Response.json({ jsonrpc: "2.0", id: 1, error: { code: 1, message } }, { status: 400 }),
    )
    await post(app, rpc("ping"))
    const line = await lastLine()
    expect(line).toContain("ERROR line one?line two xxx")
    expect(line.endsWith("…")).toBe(true)
    expect(line.length).toBeLessThan(600)
  })

  // An open stream never ends: its line comes at once, without reading it.
  it("logs subscriptions/listen at once, without reading the stream", async () => {
    let close!: () => void
    const app = appWith(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              close = () => controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const res = await post(app, rpc("subscriptions/listen"))
    expect(await lastLine()).toBe("subscriptions/listen /mcp 200 client=unknown Nms")
    close()
    await res.body?.cancel()
  })
})

describe("the request log: MCP_LOG_LEVEL", () => {
  const toolAnswer = () =>
    sse({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "x" }], structuredContent: { status: "ok" } },
    })

  it("shows no payload at info", async () => {
    await post(
      appWith(toolAnswer, "info"),
      rpc("tools/call", { name: "t", arguments: { key: "secret" } }),
    )
    expect(await lastLine()).toBe("tools/call t /mcp 200 client=unknown Nms")
  })

  // A view read answers with the whole bundle, quotes escaped: at info nothing in it can be named.
  it("parses no answer at info that carries no error, and still names one that does", async () => {
    const view = 'x={type:"error",isError:true};'.repeat(40_000)
    const read = () =>
      sse({ jsonrpc: "2.0", id: 1, result: { contents: [{ uri: "ui://v", text: view }] } })
    const parse = vi.spyOn(JSON, "parse")
    const bigParses = () => parse.mock.calls.filter(([text]) => String(text).length > 1e6).length
    await post(appWith(read, "info"), rpc("resources/read", { uri: "ui://v" }))
    expect(await lastLine()).toBe("resources/read ui://v /mcp 200 client=unknown Nms")
    expect(bigParses()).toBe(0)
    await post(appWith(read, "debug"), rpc("resources/read", { uri: "ui://v" }))
    await lastLine()
    expect(bigParses()).toBe(1)
    const failed = () =>
      sse({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Resource not found" } })
    await post(appWith(failed, "info"), rpc("resources/read", { uri: "ui://v" }))
    expect(await lastLine()).toBe(
      "resources/read ui://v /mcp 200 client=unknown Nms ERROR Resource not found",
    )
  })

  it("shows a tool's arguments and result at debug, cut at 80 characters", async () => {
    const app = appWith(toolAnswer, "debug")
    await post(app, rpc("tools/call", { name: "t", arguments: { key: "v" } }))
    expect(await lastLine()).toBe(
      'tools/call t /mcp 200 client=unknown Nms {"key":"v"} -> {"status":"ok"}',
    )
    await post(app, rpc("prompts/get", { name: "p", arguments: { long: "y".repeat(200) } }))
    expect(await lastLine()).toMatch(/^prompts\/get p \/mcp 200 client=unknown Nms \{"long":"y+…$/)
  })

  it.each<[string, object, string]>([
    ["a lone text", { content: [{ type: "text", text: "hi" }] }, '"hi"'],
    [
      "its blocks",
      {
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      },
      '[{"type":"text","text":"a"},{"type":"text","text":"b"}]',
    ],
    ["a bare value", { content: "odd" }, "undefined"],
  ])("shows %s as a tool's result at debug", async (_case, result, shown) => {
    const app = appWith(() => sse({ jsonrpc: "2.0", id: 1, result }), "debug")
    await post(app, rpc("tools/call", { name: "t" }))
    expect(await lastLine()).toBe(`tools/call t /mcp 200 client=unknown Nms -> ${shown}`)
  })

  it("dumps request and response at trace, credential headers redacted", async () => {
    const app = appWith(() => ok({ tools: [] }), "trace")
    await post(app, rpc("tools/list"), { authorization: "Bearer secret-token", "x-api-key": "k" })
    const [line, ...dump] = (await lastLine()).split("\n")
    expect(line).toBe("tools/list /mcp 200 client=unknown Nms")
    const trace = dump.join("\n")
    expect(trace).toContain('"authorization": "[REDACTED]"')
    expect(trace).toContain('"x-api-key": "[REDACTED]"')
    expect(trace).not.toContain("secret-token")
    expect(trace).toContain('[trace] request body {\n  "jsonrpc": "2.0"')
    expect(trace).toContain('[trace] response body {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')
    await app.fetch(new Request("http://localhost/health"))
    const health = await lastLine()
    expect(health).toMatch(/^GET \/health 200 Nms\n/)
    expect(health).toContain("[trace] request body (none)")
    expect(health).toContain("[trace] response body (not read)")
  })

  it("reads the level from MCP_LOG_LEVEL in any case, else info", () => {
    expect(requestLogLevel({})).toBe("info")
    expect(requestLogLevel({ MCP_LOG_LEVEL: " DEBUG " })).toBe("debug")
    expect(requestLogLevel({ MCP_LOG_LEVEL: "trace" })).toBe("trace")
    expect(requestLogLevel({ MCP_LOG_LEVEL: "verbose" })).toBe("info")
  })

  it("warns at debug and trace, and about a level it does not know", () => {
    expect(requestLogLevelWarning({})).toBeUndefined()
    expect(requestLogLevelWarning({ MCP_LOG_LEVEL: " " })).toBeUndefined()
    expect(requestLogLevelWarning({ MCP_LOG_LEVEL: "info" })).toBeUndefined()
    expect(requestLogLevelWarning({ MCP_LOG_LEVEL: " DEBUG " })).toBe(
      "MCP_LOG_LEVEL=debug: the request log shows tool arguments and results (process variables, business keys) on every call. For debugging only.",
    )
    expect(requestLogLevelWarning({ MCP_LOG_LEVEL: "trace" })).toMatch(
      /^MCP_LOG_LEVEL=trace: the request log shows every request and response in full/,
    )
    expect(requestLogLevelWarning({ MCP_LOG_LEVEL: "verbose" })).toBe(
      "MCP_LOG_LEVEL=verbose is not a level (info, debug, trace): the request log stays at info.",
    )
  })
})
