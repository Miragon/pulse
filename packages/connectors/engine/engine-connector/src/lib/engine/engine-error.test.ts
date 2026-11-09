import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Client } from "@miragon/pulse-c7-client"
import { FAILURE_REASONS, HttpFailure } from "@miragon/pulse-http"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import type { EngineAuth } from "../../engine-provider.js"
import { createEngineConnection } from "./engine-connection.js"
import { EngineRequestError, failureError, toEngineToolError } from "./engine-error.js"
import {
  closedPortUrl,
  json,
  type RawEngine,
  type RawRoute,
  reset,
  startRawEngine,
} from "./test-support/raw-engine.js"

/**
 * What the model reads when an engine call fails (#325): the module's client over its transport
 * against a REAL loopback engine, each assertion the exact `message` widget-shell's
 * `withToolErrors` hands to the model. The calls are what the generated SDK functions of the
 * same name send; the read composites go through the same client (engine-port.ts).
 */

const LONG_TEXT = `upstream connect error or disconnect/reset before headers. ${"x".repeat(2000)}`

function text(status: number, body?: string, phrase = ""): RawRoute {
  return (res) => {
    res.writeHead(status, phrase, body === undefined ? {} : { "Content-Type": "text/plain" })
    res.end(body)
  }
}

const ROUTES: Record<string, RawRoute> = {
  "GET /process-instance/bad-type": (res) =>
    json(res, 400, {
      type: "InvalidRequestException",
      message: 'Cannot convert value "abc" of type String to type Integer',
      code: 0,
    }),
  "GET /process-instance/missing": (res) =>
    json(res, 404, {
      type: "InvalidRequestException",
      message: "Process instance with id missing does not exist",
    }),
  "DELETE /process-instance/missing": (res) =>
    json(res, 404, {
      type: "InvalidRequestException",
      message: "Process instance with id missing does not exist",
    }),
  "GET /process-instance/locked": (res) =>
    json(res, 500, {
      type: "OptimisticLockingException",
      message: "ENGINE-03005 Execution of 'UPDATE ExecutionEntity[42]' failed.",
      code: 1,
    }),
  "GET /process-instance/empty": text(500),
  "GET /process-instance/no-endpoint": (res) =>
    json(res, 404, { type: "NotFoundException", message: "HTTP 404 Not Found" }),
  "GET /process-instance/no-engine": (res) => {
    res.writeHead(404, "", { "Content-Type": "text/html" })
    res.end("<html>Not Found</html>")
  },
  "GET /process-instance/text": text(502, LONG_TEXT),
  "GET /process-instance/proxy-json": (res) => json(res, 403, { error: "Forbidden", status: 403 }),
  "GET /process-instance/odd-type": (res) =>
    json(res, 400, { type: `Gateway\nError ${"y".repeat(300)}`, message: "boom" }),
  // Like a proxy that quotes the rejected credential back.
  "GET /process-instance/unauthorized": (res, req) =>
    text(401, req.headers.authorization ? `denied: ${req.headers.authorization}` : "")(
      res,
      req,
      "",
    ),
  "GET /process-instance/reset": reset,
  "POST /process-definition/key/reset/start": reset,
  // The reading POSTs: queries with a body, and the migration plan.
  "POST /process-instance": reset,
  "POST /process-instance/count": reset,
  "POST /migration/generate": reset,
  "POST /job": reset,
  "POST /job/retries": reset,
}

let engine: RawEngine
let downUrl = ""

beforeAll(async () => {
  engine = await startRawEngine(ROUTES)
  downUrl = await closedPortUrl()
})

afterAll(() => engine.close())

function client(auth: EngineAuth = { type: "none" }, baseUrl = engine.baseUrl): Client {
  return createEngineConnection({ id: "prod-a", baseUrl }, auth)
}

/** The rejection of `call`, asserted to be an EngineRequestError. */
async function failure(call: Promise<unknown>): Promise<EngineRequestError> {
  const error = await call.then(
    () => new Error("expected the engine call to fail"),
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(EngineRequestError)
  return error as EngineRequestError
}

const get = (id: string, c = client()) =>
  failure(c.get({ url: "/process-instance/{id}", path: { id } }))

describe("engine answers reach the model as actionable text", () => {
  it("400 ExceptionDto: status, exception type, engine message and engine id", async () => {
    const e = await get("bad-type")
    expect(e.message).toBe(
      '[400 InvalidRequestException] Cannot convert value "abc" of type String to type Integer (engine prod-a)',
    )
    expect(e).toMatchObject({ kind: "http", httpStatus: 400, engineId: "prod-a", engineCode: 0 })
  })

  it("404 ExceptionDto, the same for a read and a delete", async () => {
    const read = await get("missing")
    expect(read.message).toBe(
      "[404 InvalidRequestException] Process instance with id missing does not exist (engine prod-a)",
    )
    const del = await failure(
      client().delete({ url: "/process-instance/{id}", path: { id: "missing" } }),
    )
    expect(del.message).toBe(read.message)
  })

  it("a 404 of a wrong REST root asks to check that the engine URL is the REST root", async () => {
    const hint =
      ". No such endpoint: check that the engine URL points at the REST API root itself " +
      "(e.g. http://localhost:8080/engine-rest)."
    expect((await get("no-endpoint")).message).toBe(
      `[404 NotFoundException] HTTP 404 Not Found (engine prod-a)${hint}`,
    )
    const page = await get("no-engine")
    expect(page.message).toBe(`[404] <html>Not Found</html> (engine prod-a)${hint}`)
    expect(page).toMatchObject({ httpStatus: 404, type: undefined })
  })

  it("keeps the engine's error code as data, never as `status` or `code`", async () => {
    const e = await get("locked")
    expect(e.message).toBe(
      "[500 OptimisticLockingException] ENGINE-03005 Execution of 'UPDATE ExecutionEntity[42]' failed. (engine prod-a)",
    )
    expect(e.engineCode).toBe(1)
    expect(e).not.toHaveProperty("status")
    expect(e).not.toHaveProperty("code")
  })

  it("an empty body without a reason phrase (Tomcat) names the status only", async () => {
    const e = await get("empty")
    expect(e.message).toBe("[500] empty response body (engine prod-a)")
  })

  it("a text body is whitespace-collapsed and cut", async () => {
    const e = await get("text")
    expect(e.message).toMatch(
      /^\[502\] upstream connect error or disconnect\/reset before headers\. x+… \(engine prod-a\)$/,
    )
    expect(e.engineMessage.length).toBeLessThanOrEqual(501)
  })

  it("a proxy's JSON yields its message; a `type` that is no class name is dropped", async () => {
    expect((await get("proxy-json")).message).toBe("[403] Forbidden (engine prod-a)")
    const odd = await get("odd-type")
    expect(odd.message).toBe("[400] boom (engine prod-a)")
    expect(odd.type).toBeUndefined()
  })
})

describe("network failures", () => {
  it("ECONNREFUSED: the engine is unreachable", async () => {
    const e = await get("x", client({ type: "none" }, downUrl))
    expect(e.message).toBe("engine prod-a unreachable (ECONNREFUSED)")
    expect(e).toMatchObject({ kind: "unreachable", httpStatus: undefined })
  })

  it("a dropped WRITE may have applied; a dropped read says nothing of the kind", async () => {
    const write = await failure(
      client().post({ url: "/process-definition/key/{key}/start", path: { key: "reset" } }),
    )
    expect(write.message).toMatch(
      /^connection to engine prod-a failed \(\w+\) — the POST may still have been applied; check the current state before retrying$/,
    )
    expect(write.kind).toBe("connection")
    expect((await get("reset")).message).toMatch(/^connection to engine prod-a failed \(\w+\)$/)
  })

  it("the reading POSTs carry no write caveat, by the route table; a writing POST does", async () => {
    for (const url of [
      "/process-instance",
      "/process-instance/count",
      "/migration/generate",
      "/job",
    ]) {
      const e = await failure(client().post({ url, body: {} }))
      expect(e.message, url).toMatch(/^connection to engine prod-a failed \(\w+\)$/)
    }
    const retries = await failure(client().post({ url: "/job/retries", body: {} }))
    expect(retries.message).toMatch(/— the POST may still have been applied/)
  })
})

describe("401 hints per auth type, the credential masked", () => {
  const unauthorized = (auth: EngineAuth) => get("unauthorized", client(auth))

  it("passthrough without a caller token", async () => {
    const e = await unauthorized({ type: "passthrough" })
    expect(e.message).toBe(
      "[401] empty response body (engine prod-a). The MCP request carried no bearer token to pass through.",
    )
  })

  it("passthrough with the caller's token", async () => {
    const e = await runWithMcpRequestInfo({ authorization: "Bearer tok-123" }, () =>
      unauthorized({ type: "passthrough" }),
    )
    expect(e.message).toBe(
      "[401] denied: Bearer *** (engine prod-a). The engine rejected the forwarded bearer token.",
    )
    expect(engine.seen.at(-1)?.authorization).toBe("Bearer tok-123")
  })

  it("Basic credentials, sent as UTF-8", async () => {
    const e = await unauthorized({ type: "basic", username: "demo", password: "pässw€rd" })
    expect(e.message).toBe(
      "[401] denied: Basic *** (engine prod-a). The engine rejected the configured credentials.",
    )
    const value = Buffer.from("demo:pässw€rd", "utf8").toString("base64")
    expect(engine.seen.at(-1)?.authorization).toBe(`Basic ${value}`)
  })

  it("a static bearer token, its trailing line break trimmed", async () => {
    const e = await unauthorized({ type: "bearer", token: "tok-456\n" })
    expect(e.message).toBe(
      "[401] denied: Bearer *** (engine prod-a). The engine rejected the configured credentials.",
    )
    expect(engine.seen.at(-1)?.authorization).toBe("Bearer tok-456")
  })

  it("no auth configured", async () => {
    const e = await unauthorized({ type: "none" })
    expect(e.message).toMatch(/The engine requires authentication, but none is configured\.$/)
  })
})

describe("the words of every transport reason", () => {
  const ctx = { engineId: "e", unauthorizedHint: () => "Sign in." }
  const failed = (reason: (typeof FAILURE_REASONS)[number], more: object = {}) =>
    failureError(
      new HttpFailure(reason, { method: "PUT", target: "", mayHaveApplied: false, ...more }),
      ctx,
    )

  it("names the engine in each, and never a status or code property", () => {
    for (const reason of FAILURE_REASONS) {
      const error = failed(reason, { status: 500, limit: 1 })
      expect(error.message, reason).toMatch(/engine e\b/)
      expect(error, reason).not.toHaveProperty("status")
    }
  })

  it("words what only a transport call or a refusal brings", () => {
    expect(failed("too-large", { limit: 67108864, mayHaveApplied: true }).message).toBe(
      "the answer exceeds 67108864 bytes, the size cap, and was not read (engine e) — the PUT " +
        "may still have been applied; check the current state before retrying",
    )
    expect(failed("credential", { code: "token-syntax" }).message).toBe(
      "the bearer token cannot be sent (token-syntax); nothing was sent (engine e)",
    )
    expect(failed("refused-write").message).toBe(
      "this server only reads from the engine; nothing was sent (engine e)",
    )
    expect(failed("tls", { code: "CERT_HAS_EXPIRED" }).message).toBe(
      "connection to engine e failed (CERT_HAS_EXPIRED): the TLS handshake failed, so nothing was sent",
    )
    expect(failed("unauthorized", { status: 401 }).message).toBe(
      "[401] empty response body (engine e). Sign in.",
    )
    expect(failed("redirect", { status: 307 }).message).toMatch(/^\[307\] redirect \(engine e\)\./)
  })

  it("passes its own errors and the ones it does not know through unchanged", () => {
    const own = failed("cancelled")
    expect(toEngineToolError(own, undefined, ctx)).toBe(own)
    const other = new SyntaxError("x")
    expect(toEngineToolError(other, undefined, ctx)).toBe(other)
    expect(toEngineToolError(other, new Response("{}"), ctx)).toBe(other)
  })
})
