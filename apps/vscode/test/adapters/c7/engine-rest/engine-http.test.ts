import { describe, expect, test } from "vitest"
import { EngineHttp } from "../../../../src/adapters/c7/engine-rest/index.js"
import { REST_URL } from "../support/fake-engine-rest.js"

const MEGABYTE = new Uint8Array(1024 * 1024)

function httpAnswering(answer: () => Promise<Response>, writes = false): EngineHttp {
  return new EngineHttp({
    url: `${REST_URL}/`,
    credentials: { kind: "none" },
    writes,
    send: answer,
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
    const timeout = new DOMException("aborted", "TimeoutError")
    const http = httpAnswering(() => Promise.reject(timeout))
    await expect(http.read("/version")).rejects.toMatchObject({
      failure: "unanswered",
      message: `${REST_URL}/version did not answer within 60000 ms`,
    })
  })

  test("names what failed when the engine cannot be reached", async () => {
    const http = httpAnswering(() => Promise.reject(new TypeError("fetch failed")))
    await expect(http.read("/version")).rejects.toThrow(
      `Cannot reach ${REST_URL}/version (TypeError: fetch failed)`,
    )
  })

  test("refuses to write on a connection that only reads", async () => {
    const http = httpAnswering(() => Promise.reject(new Error("never sent")))
    await expect(http.write("DELETE", "/batch/b1")).rejects.toMatchObject({ failure: "refused" })
  })
})
