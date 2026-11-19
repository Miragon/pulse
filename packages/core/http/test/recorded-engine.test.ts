/**
 * The recorded engine of ./testing/loopback: each request gets the answer recorded for what it
 * asks, over real sockets, whatever the order of its query and of its body's keys, as JSON or as
 * the recorded text with its content type, and a request nothing was recorded for gets a 500 that
 * names it.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  type RecordedAnswer,
  type RecordedEngine,
  startRecordedEngine,
} from "../src/testing/loopback/index.js"

const ANSWERS: readonly RecordedAnswer[] = [
  {
    method: "GET",
    path: "/engine-rest/process-definition/order:1:a/xml",
    answer: { id: "order:1:a", bpmn20Xml: "<definitions/>" },
  },
  {
    method: "GET",
    path: "/engine-rest/incident",
    query: { sortBy: "incidentTimestamp", maxResults: "51" },
    answer: [{ id: "i1" }],
  },
  {
    method: "POST",
    path: "/engine-rest/history/process-instance/count",
    body: { processDefinitionKey: "order", sorting: [{ sortBy: "startTime" }], unfinished: true },
    answer: { count: 3 },
  },
  {
    method: "GET",
    path: "/v2/process-definitions/2251799813685249/xml",
    text: '<?xml version="1.0" encoding="UTF-8"?>\n<definitions id="order"/>\n',
    contentType: "text/xml;charset=UTF-8",
  },
]

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function recorded(): Promise<RecordedEngine> {
  const engine = await startRecordedEngine(ANSWERS)
  engines.push(engine)
  return engine
}

async function post(url: string, body: string): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
}

describe("startRecordedEngine", () => {
  it("answers a request by its decoded path and its query in any order, as JSON with 200", async () => {
    const engine = await recorded()
    const xml = await fetch(`${engine.origin}/engine-rest/process-definition/order%3A1%3Aa/xml`)
    const incidents = await fetch(
      `${engine.origin}/engine-rest/incident?maxResults=51&sortBy=incidentTimestamp`,
    )

    expect(xml.status).toBe(200)
    expect(xml.headers.get("content-type")).toBe("application/json")
    expect(await xml.json()).toEqual({ id: "order:1:a", bpmn20Xml: "<definitions/>" })
    expect(await incidents.json()).toEqual([{ id: "i1" }])
    expect(engine.seen.map(({ method, target }) => `${method} ${target}`)).toEqual([
      "GET /engine-rest/process-definition/order%3A1%3Aa/xml",
      "GET /engine-rest/incident?maxResults=51&sortBy=incidentTimestamp",
    ])
    expect(engine.unanswered).toEqual([])
  })

  it("answers a request by its JSON body, the keys of its objects in any order", async () => {
    const engine = await recorded()
    const answer = await post(
      `${engine.origin}/engine-rest/history/process-instance/count`,
      '{"unfinished":true,"sorting":[{"sortBy":"startTime"}],"processDefinitionKey":"order"}',
    )

    expect(await answer.json()).toEqual({ count: 3 })
    expect(engine.unanswered).toEqual([])
  })

  it("answers a request recorded with a text by that text as it is, its content type and 200", async () => {
    const engine = await recorded()
    const xml = await fetch(`${engine.origin}/v2/process-definitions/2251799813685249/xml`)

    expect(xml.status).toBe(200)
    expect(xml.headers.get("content-type")).toBe("text/xml;charset=UTF-8")
    expect(await xml.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<definitions id="order"/>\n',
    )
    expect(engine.unanswered).toEqual([])
  })

  it("answers a request it holds no answer for with a 500 that names it, and lists it", async () => {
    const engine = await recorded()
    const unknown = await fetch(`${engine.origin}/engine-rest/incident?maxResults=51`)
    const otherBody = await post(
      `${engine.origin}/engine-rest/history/process-instance/count`,
      '{"processDefinitionKey":"order"}',
    )

    expect(unknown.status).toBe(500)
    expect(await unknown.text()).toBe(
      "No recorded answer for GET /engine-rest/incident?maxResults=51",
    )
    expect(await otherBody.text()).toBe(
      'No recorded answer for POST /engine-rest/history/process-instance/count {"processDefinitionKey":"order"}',
    )
    expect(engine.unanswered.map(({ target }) => target)).toEqual([
      "/engine-rest/incident?maxResults=51",
      "/engine-rest/history/process-instance/count",
    ])
  })

  it("matches no answer for a parameter sent twice, another method or no body where one was recorded", async () => {
    const engine = await recorded()
    const incidents = `${engine.origin}/engine-rest/incident?maxResults=51&sortBy=incidentTimestamp`
    const twice = await fetch(`${incidents}&sortBy=incidentTimestamp`)
    const otherMethod = await fetch(incidents, { method: "POST" })
    const withoutBody = await fetch(`${engine.origin}/engine-rest/history/process-instance/count`, {
      method: "POST",
    })

    expect([twice.status, otherMethod.status, withoutBody.status]).toEqual([500, 500, 500])
    expect(engine.unanswered.map(({ method }) => method)).toEqual(["GET", "POST", "POST"])
  })

  it("matches no answer for a body that is no JSON or a path with a malformed escape", async () => {
    const engine = await recorded()
    const notJson = await post(`${engine.origin}/engine-rest/history/process-instance/count`, "{")
    const malformed = await fetch(
      `${engine.origin}/engine-rest/process-definition/order%E0%A4%A/xml`,
    )

    expect(await notJson.text()).toBe(
      "No recorded answer for POST /engine-rest/history/process-instance/count {",
    )
    expect(await malformed.text()).toBe(
      "No recorded answer for GET /engine-rest/process-definition/order%E0%A4%A/xml",
    )
  })
})
