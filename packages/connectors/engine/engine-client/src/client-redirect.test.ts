import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createEngineClient } from "./client.js"
import { EngineRequestError, toEngineRequestError } from "./engine-error.js"

/**
 * A real HTTP server that answers every engine path with a redirect, and records what reaches
 * it: Node's fetch and hey-api as they run in production, no stub. A followed 302/303 would
 * turn the POST into a GET of the login page, which answers 200 and reads as success.
 */

interface Seen {
  readonly method: string
  readonly path: string
}

const seen: Seen[] = []
let server: Server
let origin = ""

function answer(request: IncomingMessage, response: ServerResponse): void {
  seen.push({ method: request.method ?? "", path: request.url ?? "" })
  if (request.url?.startsWith("/login")) {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end("{}")
    return
  }
  const status = request.url?.includes("see-other") ? 303 : 302
  response.writeHead(status, { Location: `${origin}/login?return=%2Fengine-rest&state=s3cr3t` })
  response.end()
}

beforeAll(async () => {
  server = createServer(answer)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

async function failure(call: Promise<unknown>): Promise<EngineRequestError> {
  const error: unknown = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof EngineRequestError)) {
    throw new Error(`expected an engine error: ${String(error)}`)
  }
  return error
}

describe("a redirecting engine URL", () => {
  it.each([
    ["POST", "/process-instance/pi-1/modification", 302],
    ["POST", "/message/see-other", 303],
    ["GET", "/process-instance", 302],
  ] as const)("fails a %s %s on its %s without following it", async (method, url, status) => {
    seen.length = 0
    const client = createEngineClient({ baseUrl: `${origin}/engine-rest`, engineId: "prod" })
    const call =
      method === "POST" ? client.post({ url, body: { instructions: [] } }) : client.get({ url })
    const error = await failure(call)
    expect(seen).toEqual([{ method, path: `/engine-rest${url}` }])
    expect(error).toMatchObject({ kind: "http", httpStatus: status, engineId: "prod" })
    expect(error.engineMessage).toBe(`redirect to ${origin}/login`)
    expect(error.message).toBe(
      `[${status}] redirect to ${origin}/login (engine prod). The engine URL redirects, and ` +
        "redirects are never followed: point the engine URL at the REST API root itself " +
        "(e.g. https:// when the server redirects from http://). A redirect to a login page " +
        "means the engine credentials are missing or expired.",
    )
    expect(error.message).not.toContain("s3cr3t")
  })
})

describe("the error of a 3xx", () => {
  const request = new Request("http://engine.example/engine-rest/process-instance")
  const ctx = { request, timeoutMs: 1000, timedOut: false }

  it("says redirect without a target when the answer names none", () => {
    const error = toEngineRequestError("", {
      ...ctx,
      response: new Response(null, { status: 307 }),
    })
    expect(error).toMatchObject({ httpStatus: 307, engineMessage: "redirect" })
    expect((error as Error).message).toMatch(/^\[307\] redirect\. The engine URL redirects/)
  })

  it("masks a credential the target carries", () => {
    const response = new Response(null, {
      status: 302,
      headers: { Location: "https://sso.example/login/hunter2-secret" },
    })
    const error = toEngineRequestError("", { ...ctx, response, secrets: ["hunter2-secret"] })
    expect(error).toMatchObject({ engineMessage: "redirect to https://sso.example/login/***" })
  })
})
