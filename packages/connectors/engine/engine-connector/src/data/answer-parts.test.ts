import type { Client } from "@miragon/pulse-c7-client"
import {
  getHistoricProcessInstancesCount,
  getProcessDefinitionBpmn20Xml,
} from "@miragon/pulse-c7-client/sdk"
import { afterEach, describe, expect, it } from "vitest"
import { engineClientKey } from "../lib/engine/per-engine.js"
import { ENGINE_FAILURE } from "../tools/test-support/engine-world.js"
import { clientFor, type FakeEngine, startFakeEngine } from "../tools/test-support/fake-engine.js"
import { withPartsWatched } from "./answer-parts.js"
import { countOf, optional } from "./engine-reads.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineClient() {
  const engine = await startFakeEngine({
    "GET /process-definition/up/xml": { body: { id: "up", bpmn20Xml: "<definitions/>" } },
    "GET /process-definition/down/xml": ENGINE_FAILURE,
    "GET /process-definition/gone/xml": {
      status: 404,
      body: { type: "InvalidRequestException", message: "No matching definition with id gone" },
    },
    // A 200 whose body is no count: the build refuses it, though the request answered.
    "GET /history/process-instance/count": { body: {} },
  })
  engines.push(engine)
  return clientFor(engine)
}

/** A definition's diagram as an enrichment read of the build over `client`. */
const xml = (id: string) => (client: Client) =>
  optional(getProcessDefinitionBpmn20Xml({ client, path: { id } }), client)

describe("withPartsWatched", () => {
  it("is complete when every part of the build was read", async () => {
    const client = await engineClient()
    expect(await withPartsWatched(client, xml("up"))).toEqual({
      value: { id: "up", bpmn20Xml: "<definitions/>" },
      complete: true,
    })
  })

  it("learns of a part left out, though the build answered without it", async () => {
    const client = await engineClient()
    expect(await withPartsWatched(client, xml("down"))).toEqual({ value: null, complete: false })
  })

  it("learns of an answer whose body the build refused, though its request answered", async () => {
    const client = await engineClient()
    const count = (watched: Client) =>
      optional(getHistoricProcessInstancesCount({ client: watched }).then(countOf), watched)
    expect(await withPartsWatched(client, count)).toEqual({ value: null, complete: false })
  })

  it("learns of a part missed by a read another call started, which the build joined", async () => {
    const client = await engineClient()
    let fail!: (error: Error) => void
    // Sent outside the build: its failure reaches the build only where the build catches it.
    const shared = new Promise<string>((_, reject) => {
      fail = reject
    })
    const joined = withPartsWatched(client, (watched) => optional(shared, watched))
    fail(new Error("timeout"))
    expect(await joined).toEqual({ value: null, complete: false })
  })

  it("takes an engine answer that names a missing resource for an answer", async () => {
    const client = await engineClient()
    expect((await withPartsWatched(client, xml("gone"))).complete).toBe(true)
  })

  it("keeps two builds apart, and notes nothing over a client no floor watches", async () => {
    const client = await engineClient()
    const [whole, partial] = await Promise.all([
      withPartsWatched(client, xml("up")),
      withPartsWatched(client, xml("down")),
    ])
    expect([whole.complete, partial.complete]).toEqual([true, false])
    expect(await xml("down")(client)).toBeNull()
  })

  it("reads through the client's interceptors, so what is kept per engine stays the client's", async () => {
    const client = await engineClient()
    const answer = await withPartsWatched(client, async (watched) => engineClientKey(watched))
    expect(answer.value).toBe(engineClientKey(client))
  })
})
