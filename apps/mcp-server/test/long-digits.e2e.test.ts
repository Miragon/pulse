import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComposedServer } from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"

/**
 * A Long beyond 2^53 on its way to the engine, through the real composition (`createApp`), the
 * MCP SDK's request parsing and the engine module's writes (final review S3). The SDK parses a
 * call's JSON before any tool sees it, so such a number written as a JSON number arrives rounded,
 * also inside a Json value given as parsed JSON; the module instructions ask for it as a string
 * with type Long, the form the reads return, and for a Json value that holds one as JSON text, and
 * both reach the engine with every digit. Every other input that takes a variable's value is the
 * engine module's `write-tools.wire.test.ts`.
 */

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

const BEYOND_2_53 = "9007199254740993"

interface EngineRequest {
  method: string
  path: string
  /** The body as it came over the socket: a number keeps the digits it was sent with. */
  body: string
}

/** An engine that records every request's raw body and answers a start with an instance. */
async function startEngine() {
  const requests: EngineRequest[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      requests.push({ method: req.method ?? "", path: req.url ?? "", body })
      if (req.method !== "POST") return res.writeHead(204).end()
      res.writeHead(200, { "content-type": "application/json" }).end('{"id":"pi-1"}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

let engine: Awaited<ReturnType<typeof startEngine>>
let composed: ComposedServer

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  engine = await startEngine()
  stubNeutralEnv({
    MCP_ACTIVE_MODULES: "engine:operations",
    ENGINE_BASE_URL: `${engine.url}/engine-rest`,
  })
  composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await engine.close()
})

/** A tools/call whose arguments go out as this JSON text, digit for digit. */
async function callWithArgumentsJson(name: string, argumentsJson: string): Promise<string> {
  const res = await composed.app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${name}","arguments":${argumentsJson}}}`,
    }),
  )
  expect(res.status).toBe(200)
  return res.text()
}

const setVariable = (value: string, type = "Long") =>
  `{"processInstanceId":"pi-1","variableName":"orderNumber","value":${value},"type":"${type}"}`

/** A Json value that holds the number, as JSON text. */
const ORDER_JSON_TEXT = `{"orderId":${BEYOND_2_53}}`

describe("a Long beyond 2^53 written through the MCP server", () => {
  it("as a string with type Long, a variable write sends every digit", async () => {
    const answer = await callWithArgumentsJson(
      "engine_set_process_instance_variable",
      setVariable(`"${BEYOND_2_53}"`),
    )

    expect(answer).not.toContain('"isError":true')
    expect(engine.requests).toEqual([
      {
        method: "PUT",
        path: "/engine-rest/process-instance/pi-1/variables/orderNumber",
        body: `{"value":"${BEYOND_2_53}","type":"Long"}`,
      },
    ])
  })

  it("as a string with type Long in a variables map, the start sends every digit", async () => {
    const answer = await callWithArgumentsJson(
      "engine_start_process_instance",
      `{"processDefinitionKey":"invoice","variables":{"orderNumber":{"value":"${BEYOND_2_53}","type":"Long"}}}`,
    )

    expect(answer).not.toContain('"isError":true')
    expect(engine.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /engine-rest/process-definition/key/invoice/start",
    ])
    expect(engine.requests[0]?.body).toContain(
      `"orderNumber":{"value":"${BEYOND_2_53}","type":"Long"}`,
    )
  })

  it("inside a Json value given as JSON text, a variable write sends every digit", async () => {
    const answer = await callWithArgumentsJson(
      "engine_set_process_instance_variable",
      setVariable(JSON.stringify(ORDER_JSON_TEXT), "Json"),
    )

    expect(answer).not.toContain('"isError":true')
    expect(engine.requests.map(({ body }) => body)).toEqual([
      `{"value":${JSON.stringify(ORDER_JSON_TEXT)},"type":"Json"}`,
    ])
  })

  // Pinned: the reason for the instructions' rule. Should the SDK ever parse a call losslessly,
  // these flip, and the rule can say so.
  it("as a JSON number, it arrives rounded before any tool sees it", async () => {
    await callWithArgumentsJson("engine_set_process_instance_variable", setVariable(BEYOND_2_53))

    expect(engine.requests.map(({ body }) => body)).toEqual([
      '{"value":9007199254740992,"type":"Long"}',
    ])
  })

  it("inside a Json value given as parsed JSON, it arrives rounded too", async () => {
    await callWithArgumentsJson(
      "engine_set_process_instance_variable",
      setVariable(ORDER_JSON_TEXT, "Json"),
    )

    expect(engine.requests.map(({ body }) => body)).toEqual([
      `{"value":${JSON.stringify('{"orderId":9007199254740992}')},"type":"Json"}`,
    ])
  })
})
