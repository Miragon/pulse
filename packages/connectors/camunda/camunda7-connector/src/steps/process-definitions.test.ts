import { afterEach, describe, expect, it } from "vitest"
import { registryFor, startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import { loadProcessDefinitionsStep } from "./process-definitions.js"

/** #329: the engine would match a `%`-less LIKE exactly. */

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function queryFor(keys: Record<string, unknown>) {
  const engine = await startFakeEngine(
    { "GET /process-definition/count": { body: { count: 0 } } },
    { body: [] },
  )
  engines.push(engine)
  await loadProcessDefinitionsStep.execute(
    { steps: {}, keys, errors: [] },
    { registry: registryFor(engine), engines: [] },
  )
  // The page and its exact total — the show tool's builder (#335 N63).
  expect(engine.requests.map((r) => r.path).sort()).toEqual([
    "/process-definition",
    "/process-definition/count",
  ])
  return engine.requests.find((r) => r.path === "/process-definition")!.query
}

describe("camunda7:load-process-definitions", () => {
  it("sends camunda7:nameLike as a substring match", async () => {
    expect(await queryFor({ "camunda7:nameLike": "Inv" })).toMatchObject({ nameLike: "%Inv%" })
  })

  it("keeps a nameLike that already carries a wildcard, and the key filter as is", async () => {
    expect(
      await queryFor({ "camunda7:nameLike": "Inv%", "camunda7:processDefinitionKey": "invoice" }),
    ).toMatchObject({ nameLike: "Inv%", key: "invoice" })
  })

  it("sends no nameLike without the key", async () => {
    expect(await queryFor({})).not.toHaveProperty("nameLike")
  })
})
