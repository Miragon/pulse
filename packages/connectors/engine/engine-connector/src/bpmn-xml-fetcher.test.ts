import { describe, expect, it } from "vitest"
import { engineModule, createBpmnXmlFetcher } from "./module.js"
import { startFakeEngine } from "./tools/test-support/fake-engine.js"

/**
 * The BPMN-XML lookup handed to analytics (its heatmap and the names in its
 * views): the key's latest version over every tenant, read by id — the
 * definition view's own lookup. The tenant-less
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

  // A process may run on a later engine only: the consumer names the engine.
  it("reads on the engine it is asked for, the first configured one by default", async () => {
    const definitions = (id: string) => ({
      "GET /process-definition": (request: { query: Record<string, string> }) => ({
        body:
          request.query.key === "leasing"
            ? [{ id: `leasing:1:${id}`, key: "leasing", version: 1 }]
            : [],
      }),
      [`GET /process-definition/leasing:1:${id}/xml`]: {
        body: { id: `leasing:1:${id}`, bpmn20Xml: `<definitions id="${id}"/>` },
      },
    })
    const first = await startFakeEngine(definitions("a"))
    const second = await startFakeEngine(definitions("b"))
    try {
      const fetchBpmnXml = createBpmnXmlFetcher(
        engineModule.configFromEnv({
          ENGINES_JSON: JSON.stringify([
            { id: "prod-a", baseUrl: first.baseUrl },
            { id: "prod-b", baseUrl: second.baseUrl },
          ]),
        }),
      )!
      expect(await fetchBpmnXml("leasing", "prod-b")).toBe('<definitions id="b"/>')
      expect(await fetchBpmnXml("leasing")).toBe('<definitions id="a"/>')
      expect(await fetchBpmnXml("leasing", "prod-a")).toBe('<definitions id="a"/>')
      expect(second.requests).toHaveLength(2)
      await expect(fetchBpmnXml("leasing", "prod-z")).rejects.toThrow(
        'No engine "prod-z" is configured.',
      )
    } finally {
      await first.close()
      await second.close()
    }
  })
})
