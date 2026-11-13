import type http from "node:http"
import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Client, withCallerSignal } from "@miragon/pulse-c7-client"
import { getProcessInstanceVariables } from "@miragon/pulse-c7-client/sdk"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import type { EngineAuth } from "../../engine-provider.js"
import { createEngineConnection, intentOfRequest, pathUnder } from "./engine-connection.js"
import { EngineRequestError } from "./engine-error.js"
import {
  hang,
  json,
  type RawEngine,
  type RawRoute,
  startRawEngine,
} from "./test-support/raw-engine.js"

/**
 * The module's engine client over its transport against a REAL loopback engine, for what the
 * transport's conformance cases (transport-cases.test.ts, the same wiring against the case
 * engine) do not express: the words the model reads of a deadline, a redirect and a refused path
 * value, the caller's cancellation through `withCallerSignal` (after a garbage collection too),
 * one transport serving two callers at once, and the options a call may not bring. The outcomes
 * of a stalled body, the size cap and lossless integers are the cases'; the words of every other
 * failure are pinned in engine-error.test.ts.
 */

// A real garbage collection, for the case where only a GC exposes a broken abort chain: undici
// follows a Request's signal through a WeakRef, and the transport builds a Request of its own
// from the SDK's (#325).
setFlagsFromString("--expose-gc")
const gc = runInNewContext("gc") as () => void

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Lets the in-flight call reach the engine, then collects garbage a few times. */
async function collectGarbageInFlight() {
  await sleep(30)
  for (let i = 0; i < 3; i++) {
    gc()
    await sleep(5)
  }
}

/** Answers after `ms`, echoing the body: a write the caller's cancellation must not stop. */
const slow =
  (ms: number): RawRoute =>
  (res, _, body) => {
    setTimeout(() => json(res, 200, { id: "pi-1", echo: JSON.parse(body) as unknown }), ms)
  }

/** Requests held until two have arrived, so both callers are in flight at once. */
const held: { res: http.ServerResponse; authorization: string | undefined }[] = []

/** Answers 401, quoting the credential back like a proxy, once a second request is in flight. */
const quoteBackInPairs: RawRoute = (res, req) => {
  held.push({ res, authorization: req.headers.authorization })
  if (held.length < 2) return
  for (const { res: each, authorization } of held.splice(0)) {
    each.writeHead(401, "", { "Content-Type": "text/plain" })
    each.end(`denied: ${authorization ?? "-"}`)
  }
}

const ROUTES: Record<string, RawRoute> = {
  "GET /process-instance/hang": hang,
  "POST /process-definition/key/hang/start": hang,
  "GET /process-instance/pair": quoteBackInPairs,
  "POST /process-definition/key/slow/start": slow(80),
  "GET /process-instance/redirect": (res) => {
    res.writeHead(302, "", { Location: "https://sso.example/login?state=s3cr3t" })
    res.end()
  },
  "POST /process-definition/key/redirect/start": (res) => {
    res.writeHead(303, "", { Location: "/login" })
    res.end()
  },
}

let engine: RawEngine

beforeAll(async () => {
  engine = await startRawEngine(ROUTES)
})

afterAll(() => engine.close())

function client(timeoutMs?: number, auth: EngineAuth = { type: "none" }): Client {
  return createEngineConnection({ id: "prod-a", baseUrl: engine.baseUrl }, auth, { timeoutMs })
}

async function failure(call: Promise<unknown>): Promise<EngineRequestError> {
  const error = await call.then(
    () => new Error("expected the engine call to fail"),
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EngineRequestError)
  return error as EngineRequestError
}

const read = (c: Client, id: string) => c.get({ url: "/process-instance/{id}", path: { id } })
const start = (c: Client, key: string, body: object = {}) =>
  c.post({ url: "/process-definition/key/{key}/start", path: { key }, body })

describe("the deadline", () => {
  it("ends a read of a hung engine, and a write with the caveat", async () => {
    const e = await failure(read(client(50), "hang"))
    expect(e.message).toBe("engine prod-a did not respond within 50 ms (timeout)")
    expect(e.kind).toBe("timeout")
    expect((await failure(start(client(50), "hang"))).message).toBe(
      "engine prod-a did not respond within 50 ms (timeout) — the POST may still have been applied; check the current state before retrying",
    )
  })
})

describe("the caller's cancellation", () => {
  it("aborts a read, and an already aborted one sends nothing", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const e = await failure(read(withCallerSignal(client(), controller.signal), "hang"))
    expect(e.message).toBe("request to engine prod-a was cancelled by the caller")
    expect(e.kind).toBe("cancelled")
    const before = engine.seen.length
    await failure(read(withCallerSignal(client(), AbortSignal.abort()), "ok"))
    expect(engine.seen).toHaveLength(before)
  })

  it("still aborts a read after a garbage collection while it is in flight", async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = failure(read(withCallerSignal(client(3000), controller.signal), "hang"))
    await collectGarbageInFlight()
    controller.abort()
    const e = await pending
    expect(e.message).toBe("request to engine prod-a was cancelled by the caller")
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it("never aborts a write once started", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const started = (await start(withCallerSignal(client(), controller.signal), "slow", {
      businessKey: "order-8",
    })) as unknown as { id: string; echo: unknown }
    expect(controller.signal.aborted).toBe(true)
    expect(started).toEqual({ id: "pi-1", echo: { businessKey: "order-8" } })
  })
})

describe("what the transport refuses", () => {
  it("follows no redirect: the target without its query, a write never turned into a GET", async () => {
    const e = await failure(read(client(), "redirect"))
    expect(e.message).toMatch(
      /^\[302\] redirect to https:\/\/sso\.example\/login \(engine prod-a\)\./,
    )
    expect(e.message).not.toContain("s3cr3t")
    const before = engine.seen.length
    expect((await failure(start(client(), "redirect"))).httpStatus).toBe(303)
    expect(engine.seen.slice(before).map((seen) => seen.method)).toEqual(["POST"])
  })

  it('refuses a path value "", "." or ".." before anything is sent; encodes any other', async () => {
    const before = engine.seen.length
    for (const [id, shown] of [
      [".", 'the path value "."'],
      ["..", 'the path value ".."'],
      ["", "an empty path value"],
    ] as const) {
      const e = await failure(read(client(), id))
      expect(e.message).toMatch(new RegExp(`^${shown} was refused before sending`))
      expect(e.message).toMatch(/nothing was sent \(engine prod-a\)$/)
    }
    expect(engine.seen).toHaveLength(before)
    await read(client(), "a b/../c")
    expect(engine.seen.at(-1)?.path).toBe("/process-instance/a%20b%2F..%2Fc")
  })

  it("refuses a call that brings its own fetch: it would leave the credential out", async () => {
    const c = client(undefined, { type: "bearer", token: "tok-1" })
    const own = (() => Promise.resolve(Response.json({}))) as typeof fetch
    await expect(
      getProcessInstanceVariables({ client: c, path: { id: "pi-1" }, fetch: own }),
    ).rejects.toThrow(/may not bring its own fetch/)
    await getProcessInstanceVariables({ client: c, path: { id: "pi-1" } })
    expect(engine.seen.at(-1)?.authorization).toBe("Bearer tok-1")
  })

  it("refuses a call's own requestValidator, which would let `..` reach another resource", async () => {
    const before = engine.seen.length
    await expect(
      getProcessInstanceVariables({
        client: client(),
        path: { id: ".." },
        requestValidator: undefined,
      }),
    ).rejects.toThrow(/may not bring its own requestValidator/)
    expect(engine.seen).toHaveLength(before)
  })
})

describe("one transport for every caller", () => {
  it("sends each caller's own token when two calls are in flight at once, each masked", async () => {
    const c = client(undefined, { type: "passthrough" })
    const as = (token: string) =>
      runWithMcpRequestInfo({ authorization: `Bearer ${token}` }, () => failure(read(c, "pair")))
    const before = engine.seen.length
    const [alice, bob] = await Promise.all([as("tok-alice"), as("tok-bob")])
    const sent = engine.seen.slice(before).map((seen) => seen.authorization)
    expect([...sent].sort()).toEqual(["Bearer tok-alice", "Bearer tok-bob"])
    for (const e of [alice, bob]) {
      expect(e.message).toBe(
        "[401] denied: Bearer *** (engine prod-a). The engine rejected the forwarded bearer token.",
      )
      expect(e.engineMessage).not.toMatch(/tok-/)
    }
  })
})

describe("the intent of an SDK request", () => {
  const root = "http://e.example/engine-rest"
  const intent = (method: string, path: string) =>
    intentOfRequest(root, new Request(`${root}${path}?a=1`, { method }))

  it("reads by the route table: GETs and the reading POSTs; writes otherwise", () => {
    expect(intent("GET", "/process-instance/pi-1")).toBe("read")
    expect(intent("POST", "/process-instance")).toBe("read")
    expect(intent("POST", "/process-instance/count")).toBe("read")
    expect(intent("POST", "/migration/generate")).toBe("read")
    expect(intent("POST", "/job")).toBe("read")
    expect(intent("POST", "/process-definition/key/order/start")).toBe("write")
    expect(intent("DELETE", "/process-instance/pi-1")).toBe("write")
    // Unknown to the table: a GET reads, anything else writes (fail closed).
    expect(intent("GET", "/no-such-route")).toBe("read")
    expect(intent("POST", "/no-such-route")).toBe("write")
    expect(intentOfRequest(root, new Request("http://other.example/job", { method: "POST" }))).toBe(
      "write",
    )
  })

  it("takes the path below the root, the root at an origin's path included", () => {
    expect(pathUnder(root, `${root}/job?x=1`)).toBe("/job")
    expect(pathUnder(root, `${root}`)).toBe("")
    expect(pathUnder(root, "http://e.example/engine-restx/job")).toBeUndefined()
    expect(pathUnder("http://e.example", "http://e.example/job")).toBe("/job")
  })
})
