import { describe, expect, it, vi } from "vitest"
import { classifyError } from "./describe-error.js"
import { readWebSession, WebApiError, webToolCaller } from "./web-caller.js"

const SESSION = { name: "Alice Adams", csrf: "csrf-secret", expiresAt: 1_800_000_000_000 }

/** A fetch that answers every request with `status` and `body`, and records what it was sent. */
function server(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
}

describe("readWebSession", () => {
  it("reads the session of the page's own cookie", async () => {
    const fetch = server(200, SESSION)
    expect(await readWebSession({ fetch })).toEqual(SESSION)
    const [input, init] = fetch.mock.calls[0]
    expect(input).toBe("/app/api/session")
    expect(init).toEqual({ credentials: "same-origin", headers: { accept: "application/json" } })
  })

  it("answers no session where the server has none", async () => {
    expect(await readWebSession({ fetch: server(401, { code: "signed_out", message: "x" }) })).toBe(
      undefined,
    )
  })

  it("fails with the server's words on any other refusal", async () => {
    const refused = readWebSession({ fetch: server(400, { message: "Bad request: no bearer." }) })
    await expect(refused).rejects.toThrow(
      new WebApiError(400, { message: "Bad request: no bearer." }),
    )
  })
})

describe("webToolCaller", () => {
  it("posts the call as JSON with the CSRF token and resolves with the tool's result", async () => {
    const result = { content: [{ type: "text", text: "{}" }], isError: true }
    const fetch = server(200, { result })
    const callTool = webToolCaller(SESSION, { fetch })
    expect(await callTool("engine_jobs_data", { engine: "prod" })).toEqual(result)
    const [input, init] = fetch.mock.calls[0]
    expect(input).toBe("/app/api/call")
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" })
    expect(init?.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "x-pulse-csrf": "csrf-secret",
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      name: "engine_jobs_data",
      arguments: { engine: "prod" },
    })
  })

  it("rejects a refusal with its status and code, which describeError reads", async () => {
    const refusal = { code: "WEB_READ_ONLY", message: "Refused: the web app only reads." }
    const onSignedOut = vi.fn()
    const callTool = webToolCaller(SESSION, { fetch: server(403, refusal), onSignedOut })
    const error = (await callTool("engine_set_job_retries", {}).catch(
      (thrown: unknown) => thrown,
    )) as WebApiError
    expect(error).toBeInstanceOf(WebApiError)
    expect([error.status, error.code, error.message]).toEqual([
      403,
      "WEB_READ_ONLY",
      refusal.message,
    ])
    expect(classifyError(error).kind).toBe("forbidden")
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it("tells the page once a call finds the session gone", async () => {
    const onSignedOut = vi.fn()
    const signedOut = { code: "signed_out", message: "No session: sign in again." }
    const callTool = webToolCaller(SESSION, { fetch: server(401, signedOut), onSignedOut })
    await expect(callTool("engine_jobs_data", {})).rejects.toMatchObject({
      status: 401,
      code: "signed_out",
    })
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it("refuses a call that names another connection, and sends nothing", async () => {
    const fetch = server(200, { result: { content: [] } })
    const callTool = webToolCaller(SESSION, { fetch })
    await expect(
      callTool("engine_jobs_data", { engine: "prod" }, { connector: "Shop" }),
    ).rejects.toThrow("The web app calls its own server only, not Shop.")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("asks as always on a refresh: the API keeps no answers of its own", async () => {
    const fetch = server(200, { result: { content: [] } })
    const callTool = webToolCaller(SESSION, { fetch })
    await callTool("engine_jobs_data", { engine: "prod" })
    await callTool("engine_jobs_data", { engine: "prod" }, { refresh: true })
    const [plain, refreshed] = fetch.mock.calls.map(([input, init]) => [input, init])
    expect(refreshed).toEqual(plain)
  })

  it("names the status where the answer says nothing", async () => {
    const callTool = webToolCaller(SESSION, { fetch: server(502, "<html>") })
    await expect(callTool("engine_jobs_data", {})).rejects.toMatchObject({
      status: 502,
      code: undefined,
      message: "The web app's API answered HTTP 502.",
    })
  })

  it("sends with the page's own fetch by default", async () => {
    const fetch = server(200, { result: { content: [] } })
    vi.stubGlobal("fetch", fetch)
    try {
      expect(await webToolCaller(SESSION)("engine_list_engines", {})).toEqual({ content: [] })
      await readWebSession()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
