import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer, testServerContext } from "@miragon/pulse-widget-shell/testing"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import type { EngineEntry } from "../engine-provider.js"
import { createEngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineModule } from "../module.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_PROCESS_INSTANCES_DATA } from "../tool-names.js"
import { registerWidgetDataFeeds } from "../widget-tools/data-feeds.js"
import { registerProcessInstanceTools } from "./process-instances.js"
import { engineParamShape } from "../lib/engine/with-engine.js"

/** #325, end to end with nothing mocked: before the fix these read "[object Object]". */

const engine = http.createServer((req, res) => {
  // A query's filter travels in the URL (GET) or in the body (POST queries).
  let body = ""
  req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")))
  req.on("end", () => answer(req.url ?? "", body, res))
})

function answer(url: string, body: string, res: http.ServerResponse) {
  const json = (status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(payload))
  }
  if (url.includes("hang") || body.includes("hang")) return // never answers
  if (url.startsWith("/engine-rest/process-instance/missing")) {
    return json(404, {
      type: "InvalidRequestException",
      message: "Process instance with id missing does not exist",
      code: 0,
    })
  }
  if (url.startsWith("/engine-rest/process-instance/bad-type")) {
    return json(400, {
      type: "InvalidRequestException",
      message: "Cannot convert value 'abc' to type Integer",
      code: 0,
    })
  }
  if (url.startsWith("/engine-rest/process-instance/empty")) {
    // Tomcat's status line, without a reason phrase: the transport fills in the standard one.
    res.writeHead(500, "")
    return res.end()
  }
  if (url.startsWith("/engine-rest/process-instance/standard")) {
    // A proxy's status line with Node's standard reason phrase, "Service Unavailable".
    res.writeHead(503)
    return res.end()
  }
  if (url.startsWith("/engine-rest/process-instance/phrase")) {
    res.writeHead(502, "Upstream Engine Down")
    return res.end()
  }
  if (url.startsWith("/engine-rest/process-instance/text")) {
    res.writeHead(503, { "Content-Type": "text/plain" })
    return res.end("Service Unavailable: engine is starting")
  }
  json(200, { id: "ok" })
}

let baseUrl = ""
let closedPortUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/engine-rest`
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const closedPort = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  closedPortUrl = `http://127.0.0.1:${closedPort}/engine-rest`
})

afterAll(async () => {
  engine.closeAllConnections()
  await new Promise<void>((resolve) => engine.close(() => resolve()))
})

/** Generous by default: only the hung-engine case asks for a short deadline, so a loaded run never turns a 404 into a timeout. */
function registryFor(engines: EngineEntry[], timeoutMs = 10_000) {
  return createEngineRegistry(engines, (e) =>
    providerForEntry(e).createClient(e, { type: "none" }, { timeoutMs }),
  )
}

function fakeServer() {
  const recording = recordingModuleServer()
  return { server: recording.server, tool: (name: string) => recording.tool(name).call }
}

async function getInstanceError(
  processInstanceId: string,
  engines: EngineEntry[],
  engine?: string,
  timeoutMs?: number,
) {
  const { server, tool } = fakeServer()
  registerProcessInstanceTools(createToolRegistrar(server, registryFor(engines, timeoutMs)))
  const result = await tool("engine_get_process_instance_variables")({
    processInstanceId,
    engine,
  })
  expect(result.isError).toBe(true)
  return result.content[0].text
}

describe("engine errors as the model reads them (registrar tool)", () => {
  const prodA = () => [{ id: "prod-a", baseUrl }]

  it("404 ExceptionDto", async () => {
    expect(await getInstanceError("missing", prodA())).toBe(
      "[404 InvalidRequestException] Process instance with id missing does not exist (engine prod-a)",
    )
  })

  it("400 ExceptionDto", async () => {
    expect(await getInstanceError("bad-type", prodA())).toBe(
      "[400 InvalidRequestException] Cannot convert value 'abc' to type Integer (engine prod-a)",
    )
  })

  it("500 with an empty body", async () => {
    expect(await getInstanceError("empty", prodA())).toBe(
      "[500] empty response body (engine prod-a)",
    )
  })

  it("an empty body behind a standard reason phrase: the phrase is not repeated", async () => {
    expect(await getInstanceError("standard", prodA())).toBe(
      "[503] empty response body (engine prod-a)",
    )
  })

  it("an empty body behind a reason phrase of the server's own", async () => {
    expect(await getInstanceError("phrase", prodA())).toBe(
      "[502] Upstream Engine Down — empty response body (engine prod-a)",
    )
  })

  it("a text/plain body", async () => {
    expect(await getInstanceError("text", prodA())).toBe(
      "[503] Service Unavailable: engine is starting (engine prod-a)",
    )
  })

  it("ECONNREFUSED names the engine that is down", async () => {
    const fleet = [
      { id: "prod-a", baseUrl },
      { id: "prod-b", baseUrl: closedPortUrl },
    ]
    expect(await getInstanceError("x", fleet, "prod-b")).toBe(
      "engine prod-b unreachable (ECONNREFUSED)",
    )
  })

  it("a hung engine ends at the per-request deadline", async () => {
    expect(await getInstanceError("hang", prodA(), undefined, 200)).toBe(
      "engine prod-a did not respond within 200 ms (timeout)",
    )
  })

  it("ENGINE_REQUEST_TIMEOUT_MS reaches the clients the module boots", async () => {
    const { server, tool } = fakeServer()
    const config = engineModule.configFromEnv({
      ENGINE_BASE_URL: baseUrl,
      ENGINE_ID: "prod-a",
      ENGINE_REQUEST_TIMEOUT_MS: "150",
    })
    engineModule.createPlugin({ ...config, toolset: "read-only" }).register(server)
    const result = await tool("engine_get_process_instance_variables")({
      processInstanceId: "hang",
    })
    expect(result.content[0].text).toBe("engine prod-a did not respond within 150 ms (timeout)")
  })
})

describe("registrar tools honor the MCP request's ctx.mcpReq.signal", () => {
  // The registrar passes ctx as the third argument, which `withEngine` forwards.
  it("a cancelled request aborts the engine read before the deadline", async () => {
    const { server, tool } = fakeServer()
    registerProcessInstanceTools(
      createToolRegistrar(server, registryFor([{ id: "prod-a", baseUrl }], 10_000)),
    )
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const started = Date.now()
    const result = await tool("engine_get_process_instance_variables")(
      { processInstanceId: "hang" },
      testServerContext(controller.signal),
    )
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("request to engine prod-a was cancelled by the caller")
  })
})

describe("widget-path feeds honor the MCP request's ctx.mcpReq.signal", () => {
  it("a cancelled request aborts the engine read before the deadline", async () => {
    const { server, tool } = fakeServer()
    registerWidgetDataFeeds({
      server,
      registry: registryFor([{ id: "prod-a", baseUrl }], 10_000),
      healthThresholds: DEFAULT_VERDICT_THRESHOLDS,
      toolset: "read-only",
      engineParam: engineParamShape,
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const started = Date.now()
    const result = await tool(ENGINE_PROCESS_INSTANCES_DATA)(
      { processDefinitionKey: "hang" },
      testServerContext(controller.signal),
    )
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("request to engine prod-a was cancelled by the caller")
  })
})
