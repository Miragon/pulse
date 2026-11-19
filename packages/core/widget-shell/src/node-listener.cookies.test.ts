import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createBodyLimitedListener, type FetchTarget } from "./node-listener.js"

/**
 * The cookies of one answer over a real socket: the bridge writes a `Response`'s headers as one
 * object, where several `Set-Cookie` fields would collapse into the last (the web sign-in's
 * callback sets its session and clears its login cookie in one answer).
 */

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

const COOKIES = [
  "__Host-pulse-session=a; Path=/; HttpOnly; Secure; SameSite=Lax",
  "__Host-pulse-session-1=b; Path=/; HttpOnly; Secure; SameSite=Lax",
  "__Host-pulse-login=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
]

/** A target that answers with `cookies` as its Set-Cookie fields, beside a location and a body. */
function cookieTarget(cookies: readonly string[], body: string | null = null): FetchTarget {
  return {
    fetch: () => {
      const headers = new Headers({ location: "/app", "x-kept": "yes" })
      for (const cookie of cookies) headers.append("set-cookie", cookie)
      return Promise.resolve(new Response(body, { status: body === null ? 303 : 200, headers }))
    },
  }
}

async function answerOf(target: FetchTarget, method = "GET") {
  const server = http.createServer(createBodyLimitedListener(target, { maxBodyBytes: 1024 }))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, method, path: "/app/auth/callback", agent: false },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          )
        },
      )
      req.on("error", reject)
      req.end(method === "POST" ? "{}" : undefined)
    },
  )
}

describe("an answer's cookies", () => {
  it("reach the client each as its own field, beside the answer's other headers", async () => {
    const answer = await answerOf(cookieTarget(COOKIES))
    expect(answer.status).toBe(303)
    expect(answer.headers["set-cookie"]).toEqual(COOKIES)
    expect(answer.headers.location).toBe("/app")
    expect(answer.headers["x-kept"]).toBe("yes")
  })

  it("keep the answer's body and status, a request with a body too", async () => {
    const answer = await answerOf(cookieTarget(COOKIES, '{"location":"/app/signed-out"}'), "POST")
    expect(answer.status).toBe(200)
    expect(answer.body).toBe('{"location":"/app/signed-out"}')
    expect(answer.headers["set-cookie"]).toEqual(COOKIES)
  })

  it("leave one cookie and none as the bridge writes them", async () => {
    expect((await answerOf(cookieTarget(COOKIES.slice(0, 1)))).headers["set-cookie"]).toEqual(
      COOKIES.slice(0, 1),
    )
    expect((await answerOf(cookieTarget([]))).headers["set-cookie"]).toBeUndefined()
  })
})
