import { describe, expect, it } from "vitest"
import { createEngineClient } from "./client.js"
import { formDataBodySerializer, urlSearchParamsBodySerializer } from "./generated/client/index.js"

/**
 * The wire of a `createEngineClient` client, called the way the generated SDK calls it (a URL
 * template, path and query values, the `basic` security every operation declares, the
 * multipart serializer of the deployment and form operations) against the recording `fetch` it
 * is given. The SDK itself is not imported: loading it would put its hundreds of wrappers into
 * this package's coverage measurement. What survives to a real engine, through the transport,
 * is asserted end to end by the engine connector's recording fake engine
 * (`src/tools/*.wire.test.ts`).
 */

const BASE = "http://localhost:8410/engine-rest"
const BASIC = [{ scheme: "basic", type: "http" }] as const

interface Sent {
  request: Request
}

let answering: { sent: Sent[]; answer: () => Response } = { sent: [], answer: () => json({}) }

/** The `fetch` every client here is given: it records the request and answers as told. */
const engineFetch = ((request: Request) => {
  answering.sent.push({ request })
  return Promise.resolve(answering.answer())
}) as typeof fetch

function recordFetch(answer: () => Response): Sent[] {
  answering = { sent: [], answer }
  return answering.sent
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("the request a client sends", () => {
  it("fills path values encoded, so an id cannot change the path", async () => {
    const sent = recordFetch(() => json({}))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.get({
      url: "/process-instance/{id}/variables/{varName}",
      path: { id: "a b/../c", varName: "x?y" },
      security: [...BASIC],
    })
    expect(sent[0]?.request.url).toBe(`${BASE}/process-instance/a%20b%2F..%2Fc/variables/x%3Fy`)
  })

  // A deepObject key goes out unencoded (`variables[amount]`), as hey-api writes it.
  it("writes the query: primitives as given, arrays exploded, objects deep, absent values dropped", async () => {
    const sent = recordFetch(() => json([]))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.get({
      url: "/process-instance",
      query: {
        processDefinitionKey: "order",
        active: true,
        firstResult: 0,
        maxResults: 20,
        processInstanceIds: ["pi-1", "pi 2"],
        variables: { amount: "gt_100" },
        businessKeyLike: undefined,
        tenantIdIn: null,
      },
    })
    const url = new URL(sent[0]?.request.url ?? "")
    expect(url.pathname).toBe("/engine-rest/process-instance")
    expect(url.search).toBe(
      "?processDefinitionKey=order&active=true&firstResult=0&maxResults=20" +
        "&processInstanceIds=pi-1&processInstanceIds=pi%202&variables[amount]=gt_100",
    )
  })

  it("adds no Authorization although every operation declares basic security", async () => {
    const sent = recordFetch(() => json({}))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.get({ url: "/engine", security: [...BASIC] })
    expect(sent[0]?.request.headers.has("Authorization")).toBe(false)
  })

  it("sends a JSON body as JSON, a Long beyond 2^53 as its exact digits", async () => {
    const sent = recordFetch(() => json({}))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.post({
      url: "/process-definition/key/{key}/start",
      path: { key: "order" },
      body: { businessKey: "B-1", variables: { n: { value: 9007199254740993n, type: "Long" } } },
    })
    const request = sent[0]?.request
    expect(request?.method).toBe("POST")
    expect(request?.headers.get("Content-Type")).toBe("application/json")
    expect(await request?.text()).toBe(
      '{"businessKey":"B-1","variables":{"n":{"value":"9007199254740993","type":"Long"}}}',
    )
  })

  it("sends a multipart body with its own boundary, files and fields as the deployment takes them", async () => {
    const sent = recordFetch(() => json({ id: "d-1" }))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.post({
      url: "/deployment/create",
      ...formDataBodySerializer,
      headers: { "Content-Type": null },
      body: {
        "deployment-name": "orders",
        "enable-duplicate-filtering": true,
        "deployment-activation-time": new Date(Date.UTC(2026, 9, 1, 8, 30)),
        data: [new Blob(["<definitions/>"], { type: "text/xml" }), "second"],
        "tenant-id": undefined,
        source: null,
      },
    })
    const request = sent[0]?.request
    expect(request?.headers.get("Content-Type")).toMatch(/^multipart\/form-data; boundary=/)
    const form = await request?.formData()
    expect(form?.get("deployment-name")).toBe("orders")
    expect(form?.get("enable-duplicate-filtering")).toBe("true")
    expect(form?.get("deployment-activation-time")).toBe("2026-10-01T08:30:00.000Z")
    const [file, second] = form?.getAll("data") ?? []
    expect(await (file as Blob).text()).toBe("<definitions/>")
    expect(second).toBe("second")
    expect(form?.has("tenant-id")).toBe(false)
    expect(form?.has("source")).toBe(false)
  })

  it("serializes a form-encoded body pair by pair", async () => {
    const sent = recordFetch(() => json({}))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.post({
      url: "/form",
      ...urlSearchParamsBodySerializer,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: { a: "1", b: [2, "3"], c: { d: true }, e: undefined, f: null },
    })
    expect(await sent[0]?.request.text()).toBe("a=1&b=2&b=3&c=%7B%22d%22%3Atrue%7D")
  })

  it("sends no body and no Content-Type without one", async () => {
    const sent = recordFetch(() => new Response(null, { status: 204 }))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    await client.delete({ url: "/incident/{id}", path: { id: "i-1" } })
    const request = sent[0]?.request
    expect(request?.method).toBe("DELETE")
    expect(request?.body).toBeNull()
    expect(request?.headers.has("Content-Type")).toBe(false)
  })
})

describe("the answer a client reads", () => {
  const client = () => createEngineClient({ baseUrl: BASE, fetch: engineFetch })

  it("parses JSON, and an empty 200 body as an empty object", async () => {
    recordFetch(() => json([{ id: "pi-1" }]))
    expect(await client().get({ url: "/process-instance" })).toEqual([{ id: "pi-1" }])
    recordFetch(() => new Response("", { status: 200 }))
    expect(await client().get({ url: "/process-instance", parseAs: "json" })).toEqual({})
  })

  // A write's 204 carries no Content-Type, so the default reading takes its (absent) stream.
  it("reads a 204 as nothing: null by default, {} as JSON, an empty text, an empty form", async () => {
    recordFetch(() => new Response(null, { status: 204 }))
    expect(await client().post({ url: "/job/{id}/execute", path: { id: "j" } })).toBeNull()
    expect(await client().post({ url: "/x", parseAs: "json" })).toEqual({})
    expect(
      await client().get({ url: "/job/{id}/stacktrace", path: { id: "j" }, parseAs: "text" }),
    ).toBe("")
    expect(await client().get({ url: "/x", parseAs: "formData" })).toBeInstanceOf(FormData)
    expect(await client().get({ url: "/x", parseAs: "stream" })).toBeNull()
  })

  it("reads by the Content-Type: text, JSON, binary, form, the stream without one, else JSON", async () => {
    const answer = (body: BodyInit | null, type?: string) =>
      new Response(body, type ? { headers: { "Content-Type": type } } : {})
    recordFetch(() => answer("java.lang.IllegalStateException: boom", "text/plain;charset=UTF-8"))
    expect(
      await client().get({ url: "/job/{id}/stacktrace", path: { id: "j" }, parseAs: "auto" }),
    ).toBe("java.lang.IllegalStateException: boom")
    recordFetch(() => answer('{"a":1}', "application/hal+json"))
    expect(await client().get({ url: "/x", parseAs: "auto" })).toEqual({ a: 1 })
    recordFetch(() => answer("bytes", "application/octet-stream"))
    expect(await client().get({ url: "/x", parseAs: "auto" })).toBeInstanceOf(Blob)
    recordFetch(() => {
      const form = new FormData()
      form.append("a", "1")
      return new Response(form)
    })
    const form = (await client().get({ url: "/x", parseAs: "auto" })) as unknown as FormData
    expect(form.get("a")).toBe("1")
    recordFetch(() => answer(new TextEncoder().encode("raw")))
    expect(await client().get({ url: "/x", parseAs: "auto" })).toBeInstanceOf(ReadableStream)
    recordFetch(() => answer('{"a":1}', "font/woff2"))
    expect(await client().get({ url: "/x", parseAs: "auto" })).toEqual({ a: 1 })
  })

  it("hands back the whole result on request: data, request and response", async () => {
    recordFetch(() => json({ version: "7.22.0" }))
    const result = (await client().get({ url: "/version", responseStyle: "fields" })) as {
      data: unknown
      request: Request
      response: Response
    }
    expect(result.data).toEqual({ version: "7.22.0" })
    expect(result.request.url).toBe(`${BASE}/version`)
    expect(result.response.status).toBe(200)
  })

  // The words are the caller's, through the client's error interceptor (the engine connector's).
  it("rejects an engine error with its JSON body, and a text body as text", async () => {
    recordFetch(() => json({ type: "InvalidRequestException", message: "nope" }, 400))
    await expect(client().get({ url: "/x" })).rejects.toEqual({
      type: "InvalidRequestException",
      message: "nope",
    })
    recordFetch(() => new Response("Bad Gateway", { status: 502 }))
    await expect(client().get({ url: "/x" })).rejects.toBe("Bad Gateway")
    recordFetch(() => new Response("", { status: 500 }))
    let seen: Response | undefined
    const reading = client()
    reading.interceptors.error.use((error, response) => {
      seen = response
      return error
    })
    await expect(reading.get({ url: "/x" })).rejects.toEqual({})
    expect(seen?.status).toBe(500)
  })
})

describe("the client's own configuration", () => {
  it("builds a URL from the template, path and query without sending", () => {
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    expect(
      client.buildUrl({ url: "/task/{id}/form", path: { id: "t 1" }, query: { a: ["1", "2"] } }),
    ).toBe(`${BASE}/task/t%201/form?a=1&a=2`)
  })

  it("lets a request interceptor be found, replaced and removed", async () => {
    const sent = recordFetch(() => json({}))
    const client = createEngineClient({ baseUrl: BASE, fetch: engineFetch })
    const tag = (value: string) => (request: Request) => {
      request.headers.set("X-Tag", value)
      return request
    }
    const first = tag("one")
    const id = client.interceptors.request.use(first)
    expect(client.interceptors.request.exists(first)).toBe(true)
    client.interceptors.request.update(id, tag("two"))
    await client.get({ url: "/engine" })
    expect(sent[0]?.request.headers.get("X-Tag")).toBe("two")
    client.interceptors.request.eject(id)
    await client.get({ url: "/engine" })
    expect(sent[1]?.request.headers.has("X-Tag")).toBe(false)
  })
})
