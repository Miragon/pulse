import { describe, expect, test, vi } from "vitest"
import { EngineHttp, EngineRequestError } from "../../src/engine-rest/index.js"
import type { EngineCredentials } from "../../src/engine-rest/http/engine-wire.js"
import { engineFailure, REST_URL } from "../support/fake-engine-rest.js"

const MEGABYTE = new Uint8Array(1024 * 1024)
const ROOT_HINT =
  "Check that the engine URL points at the REST API root itself, such as http://localhost:8080/engine-rest."

function httpAnswering(answer: typeof fetch, writes = false): EngineHttp {
  return new EngineHttp({
    url: `${REST_URL}/`,
    credentials: { kind: "none" },
    writes,
    send: answer,
  })
}

function hrefOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

function httpAt(url: string, reached: string[] = []): EngineHttp {
  return new EngineHttp({
    url,
    credentials: { kind: "none" },
    writes: false,
    send: (input) => {
      reached.push(hrefOf(input))
      return Promise.resolve(Response.json({ version: "7.24.0" }))
    },
  })
}

function httpWith(credentials: EngineCredentials, url = REST_URL): EngineHttp {
  return new EngineHttp({
    url,
    credentials,
    writes: false,
    send: () => Promise.reject(new Error("never sent")),
  })
}

function endlessAnswer(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(MEGABYTE)
      },
    }),
  )
}

function failingWith(code: string): typeof fetch {
  return () =>
    Promise.reject(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error(code), { code }),
      }),
    )
}

describe("the engine's HTTP connection", () => {
  test("reads an answer that is no JSON as unexpected", async () => {
    const http = httpAnswering(() => Promise.resolve(new Response("<html>login</html>")))
    await expect(http.read("/version")).rejects.toThrow("the engine answered no JSON")
  })

  test("stops reading an answer that grows past 64 MiB", async () => {
    const http = httpAnswering(() => Promise.resolve(endlessAnswer()))
    await expect(http.read("/incident")).rejects.toThrow("more than 67108864 bytes")
  })

  test("names the deadline when the engine does not answer in time", async () => {
    vi.useFakeTimers()
    try {
      const http = httpAnswering(() => new Promise<Response>(() => undefined))
      const read = expect(http.read("/version")).rejects.toMatchObject({
        failure: "unanswered",
        message: `${REST_URL}/version did not answer within 60000 ms`,
      })
      await vi.advanceTimersByTimeAsync(60_000)
      await read
    } finally {
      vi.useRealTimers()
    }
  })

  test("names what failed when the engine cannot be reached", async () => {
    await expect(httpAnswering(failingWith("ECONNREFUSED")).read("/version")).rejects.toThrow(
      `Cannot reach ${REST_URL}/version (ECONNREFUSED)`,
    )
    await expect(
      httpAnswering(() => Promise.reject(new TypeError("fetch failed"))).read("/version"),
    ).rejects.toMatchObject({
      failure: "unanswered",
      message: `The connection to ${REST_URL}/version failed`,
      hint: "Check the network path to the engine, such as a proxy, a VPN or a firewall.",
    })
  })

  test("fails loud on a request the platform cannot build, never reading it as missing", async () => {
    const http = httpAnswering(failingWith("UND_ERR_INVALID_ARG"))
    await expect(http.find("/process-instance/p1")).rejects.toMatchObject({
      failure: "unusable",
      message: `GET ${REST_URL}/process-instance/p1 cannot be sent (UND_ERR_INVALID_ARG)`,
    })
  })

  test("reads a path value no resource carries as missing, sending nothing", async () => {
    const reached: string[] = []
    expect(await httpAt(REST_URL, reached).find("/process-instance/..")).toBeUndefined()
    expect(reached).toEqual([])
  })

  test.each([
    [
      "a host name that does not resolve",
      "ENOTFOUND",
      `Cannot reach ${REST_URL}/version: the host name does not resolve (ENOTFOUND)`,
      "Check the host name in the engine URL.",
    ],
    [
      "a TLS handshake that fails",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      `Cannot reach ${REST_URL}/version: the TLS handshake failed (DEPTH_ZERO_SELF_SIGNED_CERT)`,
      "Check that this computer trusts the engine's certificate and that the engine serves https at this URL.",
    ],
  ])("names %s as its own reason, with what to check", async (_name, code, message, hint) => {
    await expect(httpAnswering(failingWith(code)).read("/version")).rejects.toMatchObject({
      failure: "unanswered",
      message,
      hint,
    })
  })

  test("drops the trailing slashes of the engine URL", async () => {
    const reached: string[] = []
    await httpAt(`${REST_URL}///`, reached).read("/version")
    expect(reached).toEqual([`${REST_URL}/version`])
  })

  test("reads an engine URL with a long run of inner slashes in linear time", async () => {
    const start = performance.now()
    await httpAt(`${REST_URL}${"/".repeat(200_000)}x`).read("/version")
    expect(performance.now() - start).toBeLessThan(1000)
  })

  test("refuses to write on a connection that only reads, and reads that as no missing resource", async () => {
    const http = httpAnswering(() => Promise.reject(new Error("never sent")))
    const refused = await http.write("DELETE", "/batch/b1").catch((error: unknown) => error)
    expect(refused).toMatchObject({
      failure: "readOnly",
      message: `Read-only. This connection only reads, so Pulse did not send DELETE ${REST_URL}/batch/b1.`,
    })
    expect(EngineRequestError.isMissingResource(refused)).toBe(false)
  })

  test("names the status with its phrase, and the REST root when the path is unknown", async () => {
    const root = httpAnswering(() =>
      Promise.resolve(engineFailure(404, "NotFoundException", "Could not find resource")),
    )
    await expect(root.read("/version")).rejects.toMatchObject({
      failure: "answered",
      status: 404,
      message: "HTTP 404 Not Found: Could not find resource",
      hint: ROOT_HINT,
    })
    const missing = httpAnswering(() =>
      Promise.resolve(engineFailure(404, "InvalidRequestException", "gone")),
    )
    await expect(missing.read("/incident/i1")).rejects.toMatchObject({
      message: "HTTP 404 Not Found: gone",
      hint: undefined,
    })
  })

  test("masks the credentials an engine text echoes", async () => {
    const echo = `password s3cret,\n\tsent Basic ${btoa("demo:s3cret")}`
    const http = new EngineHttp({
      url: REST_URL,
      credentials: { kind: "basic", username: "demo", password: "s3cret" },
      writes: false,
      send: () => Promise.resolve(engineFailure(500, "ProcessEngineException", echo)),
    })
    await expect(http.read("/version")).rejects.toMatchObject({
      failure: "answered",
      message: "HTTP 500 Internal Server Error: password ***,\n\tsent Basic ***",
    })
  })

  test("names where a redirect points, without following it", async () => {
    const http = httpAnswering(() =>
      Promise.resolve(new Response("", { status: 302, headers: { Location: "/login?next=x" } })),
    )
    await expect(http.read("/version")).rejects.toMatchObject({
      failure: "answered",
      status: 302,
      message: "HTTP 302 Found: redirects to http://engine.test/login",
      hint: expect.stringContaining("Pulse never follows a redirect") as unknown,
    })
  })

  test.each([
    [
      "a URL with credentials",
      httpWith({ kind: "none" }, "http://demo:s3cret@engine.test/engine-rest"),
      "The engine URL cannot be used: the connection URL carries credentials: hand them over as its credential",
    ],
    [
      "a user name with a colon",
      httpWith({ kind: "basic", username: "de:mo", password: "s3cret" }),
      "The user name holds a colon, which basic authentication cannot send",
    ],
    [
      "a password with a line break",
      httpWith({ kind: "basic", username: "demo", password: "s3\ncret" }),
      "The user name or password holds a control character",
    ],
  ])(
    "refuses every call on a connection with %s, sending nothing",
    async (_name, http, message) => {
      await expect(http.read("/version")).rejects.toMatchObject({ failure: "unusable", message })
      await expect(http.text("/job/j1/stacktrace")).rejects.toMatchObject({ failure: "unusable" })
    },
  )
})
