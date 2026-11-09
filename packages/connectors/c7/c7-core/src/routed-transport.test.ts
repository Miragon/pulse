import { describe, expect, it } from "vitest"
import type { EngineFailure, OperationInput } from "./port.js"
import { createEnginePort } from "./port.js"
import type { Route, Routes } from "./route.js"
import { routedTransport, type RoutedWire } from "./routed-transport.js"

const JOB: Route = {
  operationId: "getJob",
  method: "GET",
  path: "/job/{id}",
  effect: "read",
  engineScoped: true,
  accepts: ["application/json"],
}
const PAIR: Route = { ...JOB, operationId: "getPair", path: "/a/{x}/b/{y}" }
const ROUTES: Routes = { getJob: JOB, getPair: PAIR }

interface Answer {
  readonly json?: unknown
  readonly text?: string
}

class Failed extends Error {
  constructor(readonly failure: EngineFailure) {
    super(`HTTP ${failure.status}`)
  }
}

/** A wire that answers every route with its path and records what it was asked to send. */
function wire() {
  const sent: { route: Route; input: OperationInput }[] = []
  const fake: RoutedWire<Answer> & { sent: typeof sent } = {
    sent,
    send(route, input) {
      sent.push({ route, input })
      return Promise.resolve({ json: { path: route.path }, text: route.operationId })
    },
    json: (answer) => answer.json,
    text: (answer) => answer.text,
    failure: (error) => (error instanceof Failed ? error.failure : undefined),
  }
  return fake
}

describe("routedTransport", () => {
  it("sends an operation as its route and reads the wire's answers", async () => {
    const fake = wire()
    const transport = routedTransport(ROUTES, fake)
    const input = { pathArgs: ["j1"], query: { a: "1" } }
    const answer = await transport.send("getJob", input)
    expect(fake.sent).toEqual([{ route: JOB, input }])
    expect(transport.json(answer)).toEqual({ path: "/job/{id}" })
    expect(transport.text(answer)).toBe("getJob")
  })

  it("passes the failure reading of the wire through", () => {
    const transport = routedTransport(ROUTES, wire())
    const failure = { status: 404, engineType: "InvalidRequestException" }
    expect(transport.failure(new Failed(failure))).toEqual(failure)
    expect(transport.failure(new Error("x"))).toBeUndefined()
  })

  it("refuses an operation the table lacks, an inherited name included, sending nothing", async () => {
    const fake = wire()
    const transport = routedTransport(ROUTES, fake)
    await expect(transport.send("getTask", { pathArgs: [], query: {} })).rejects.toThrow(
      new Error("c7-core asked for getTask, which the route table does not hold"),
    )
    await expect(transport.send("constructor", { pathArgs: [], query: {} })).rejects.toThrow(
      new Error("c7-core asked for constructor, which the route table does not hold"),
    )
    expect(fake.sent).toEqual([])
  })

  it("refuses more or fewer path values than the template has placeholders", async () => {
    const fake = wire()
    const transport = routedTransport(ROUTES, fake)
    await expect(transport.send("getJob", { pathArgs: [], query: {} })).rejects.toThrow(
      new Error("getJob takes 1 path values, c7-core sent 0"),
    )
    await expect(transport.send("getPair", { pathArgs: ["x"], query: {} })).rejects.toThrow(
      new Error("getPair takes 2 path values, c7-core sent 1"),
    )
    await expect(
      transport.send("getPair", { pathArgs: ["x", "y", "z"], query: {} }),
    ).rejects.toThrow(new Error("getPair takes 2 path values, c7-core sent 3"))
    expect(fake.sent).toEqual([])
    await transport.send("getPair", { pathArgs: ["x", "y"], query: {} })
    expect(fake.sent.map(({ route }) => route.operationId)).toEqual(["getPair"])
  })

  it("is a transport c7-core's port runs on", async () => {
    const port = createEnginePort(routedTransport(ROUTES, wire()))
    expect(await port.json("getJob", { pathArgs: ["j1"], query: {} })).toEqual({
      path: "/job/{id}",
    })
    expect(await port.text("getJob", ["j1"])).toBe("getJob")
  })
})
