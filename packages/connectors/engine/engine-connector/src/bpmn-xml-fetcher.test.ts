import { afterEach, describe, expect, it } from "vitest"
import { recordingModuleServer, testServerContext } from "@miragon/pulse-widget-shell/testing"
import { engineModule, createBpmnXmlFetcher } from "./module.js"
import {
  type FakeEngine,
  type FakeRoutes,
  startFakeEngine,
} from "./tools/test-support/fake-engine.js"

/**
 * The BPMN-XML lookup handed to analytics (its heatmap and the names in its
 * views): the key's latest version over every tenant, read by id (the
 * definition view's own lookup). The tenant-less
 * `/process-definition/key/{key}/xml` left a tenant-deployed key without a
 * diagram (#322 follow-up).
 */
describe("createBpmnXmlFetcher", () => {
  it("finds a tenant-deployed key's diagram through the latest definition's id", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": (request) => ({
        body:
          request.query.key === "leasing"
            ? [{ id: "leasing:3:t1", key: "leasing", version: 3, tenantId: "acme" }]
            : [],
      }),
      "GET /process-definition/leasing:3:t1/xml": {
        body: { id: "leasing:3:t1", bpmn20Xml: "<definitions/>" },
      },
      "GET /process-definition/key/leasing/xml": { status: 404, body: { message: "none" } },
    })
    try {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINE_BASE_URL: engine.baseUrl }),
      )!
      expect(await fetchBpmnXml("leasing")).toBe("<definitions/>")
      expect(engine.requests.map((r) => r.path)).toEqual([
        "/process-definition",
        "/process-definition/leasing:3:t1/xml",
      ])
      // An unknown key is an answer: no such definition on this engine.
      expect(await fetchBpmnXml("unknown")).toBeNull()
    } finally {
      await engine.close()
    }
  })

  // A failure is no answer: a consumer that keeps answers (analytics' name
  // lookup, five minutes) must be able to tell it from "not deployed".
  it("rejects a failed read instead of reporting the key as not deployed", async () => {
    const engine = await startFakeEngine({
      "GET /process-definition": { status: 503, body: { message: "shutting down" } },
    })
    try {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINE_BASE_URL: engine.baseUrl }),
      )!
      await expect(fetchBpmnXml("leasing")).rejects.toThrow()
    } finally {
      await engine.close()
    }
  })

  // A process may run on a later engine only: the consumer names the engine. Without one, the
  // tools' precedence (invariant 2): ENGINE_DEFAULT, else the only engine, else no pick at all.
  describe("picks the engine by the tools' precedence", () => {
    const engines: FakeEngine[] = []
    afterEach(async () => {
      await Promise.all(engines.splice(0).map((engine) => engine.close()))
    })

    async function twoEngines() {
      const a = await startFakeEngine(definitions("a"))
      const b = await startFakeEngine(definitions("b"))
      engines.push(a, b)
      return JSON.stringify([
        { id: "prod-a", baseUrl: a.baseUrl },
        { id: "prod-b", baseUrl: b.baseUrl },
      ])
    }

    it("reads on the engine it is asked for, and refuses an unknown one", async () => {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINES_JSON: await twoEngines() }),
      )!
      expect(await fetchBpmnXml("leasing", "prod-b")).toBe('<definitions id="b"/>')
      expect(await fetchBpmnXml("leasing", "prod-a")).toBe('<definitions id="a"/>')
      await expect(fetchBpmnXml("leasing", "prod-z")).rejects.toThrow(
        'Unknown engine id "prod-z". Available: prod-a, prod-b.',
      )
    })

    it("without an engine id: ENGINE_DEFAULT, not the first configured engine", async () => {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINES_JSON: await twoEngines(), ENGINE_DEFAULT: "prod-b" }),
      )!
      expect(await fetchBpmnXml("leasing")).toBe('<definitions id="b"/>')
    })

    it("without an engine id and without a default: the only engine", async () => {
      const only = await startFakeEngine(definitions("a"))
      engines.push(only)
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINE_BASE_URL: only.baseUrl }),
      )!
      expect(await fetchBpmnXml("leasing")).toBe('<definitions id="a"/>')
    })

    it("without an engine id, a default or a single engine: ENGINE_NOT_SELECTED", async () => {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({ ENGINES_JSON: await twoEngines() }),
      )!
      await expect(fetchBpmnXml("leasing")).rejects.toMatchObject({ code: "ENGINE_NOT_SELECTED" })
    })
  })
})

function definitions(id: string): FakeRoutes {
  return {
    "GET /process-definition": (request) => ({
      body:
        request.query.key === "leasing"
          ? [{ id: `leasing:1:${id}`, key: "leasing", version: 1 }]
          : [],
    }),
    [`GET /process-definition/leasing:1:${id}/xml`]: {
      body: { id: `leasing:1:${id}`, bpmn20Xml: `<definitions id="${id}"/>` },
    },
  }
}

/**
 * The lookup runs on the module's own clients: the plugin the boot creates from the same config
 * object, so a diagram analytics read is the one the tools then answer from definition-xml.ts's
 * cache, also through a tool call's per-request client view (`ctx.mcpReq.signal`).
 */
describe("createBpmnXmlFetcher shares the engine module's clients and XML cache", () => {
  it("one XML read for the lookup and the tool on the same boot config", async () => {
    const engine = await startFakeEngine(definitions("a"))
    try {
      const config = engineModule.configFromEnv({ ENGINE_BASE_URL: engine.baseUrl })
      const fetchBpmnXml = createBpmnXmlFetcher(config)!
      const recording = recordingModuleServer()
      engineModule.createPlugin(config).register(recording.server)
      const xmlTool = recording.tool("engine_get_process_definition_xml")

      expect(await fetchBpmnXml("leasing")).toBe('<definitions id="a"/>')
      const answer = await xmlTool.call({ processDefinitionId: "leasing:1:a" }, testServerContext())
      expect(JSON.stringify(answer)).toContain("definitions id=")
      expect(engine.requests.filter((r) => r.path.endsWith("/xml"))).toHaveLength(1)
    } finally {
      await engine.close()
    }
  })
})
