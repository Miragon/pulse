import { describe, expect, test } from "vitest"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import { CappedText } from "../../../src/adapters/c8/rest/capped-text.js"
import type { RuntimeError } from "../../../src/contract/index.js"
import { jsonAnswer, REST_URL } from "./support/fake-camunda-rest.js"
import { NONE } from "./support/runtime-fixture.js"

const MEBIBYTE = 1024 * 1024
const TOKEN_TEXT = "eyJhbGciOi.secret-part"

interface Body {
  readonly stream: ReadableStream<Uint8Array>
  cancelled(): boolean
}

function bodyOf(chunks: readonly Uint8Array[], cancel: () => void = () => undefined): Body {
  const left = [...chunks]
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = left.shift()
      if (chunk === undefined) {
        controller.close()
      } else {
        controller.enqueue(chunk)
      }
    },
    cancel() {
      cancelled = true
      cancel()
    },
  })
  return { stream, cancelled: () => cancelled }
}

function bytes(size: number): Uint8Array {
  return new Uint8Array(size).fill(0x61)
}

function cannotCancel(): never {
  throw new Error("the transport cannot cancel")
}

function runtimeAnswering(answer: () => Promise<Response>) {
  return new C8Adapter(answer).runtime({ endpoint: REST_URL, credentials: NONE })
}

function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => "answered",
    (error: unknown) => error,
  )
}

function chunksOf(sizes: readonly number[]): ReadableStream<Uint8Array> {
  const left = [...sizes]
  return new ReadableStream({
    pull(controller) {
      const size = left.shift()
      if (size === undefined) {
        controller.close()
      } else {
        controller.enqueue(new Uint8Array(size))
      }
    },
  })
}

describe("the HTTP layer of the C8 adapter", () => {
  test("reads a deadline that passed as unreachable and names it", async () => {
    const runtime = runtimeAnswering(() =>
      Promise.reject(Object.assign(new Error("late"), { name: "TimeoutError" })),
    )

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "unreachable",
      message: expect.stringContaining("did not answer within 60000 ms") as unknown,
    })
  })

  test("names the reason of a connection that failed", async () => {
    const runtime = runtimeAnswering(() =>
      Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })),
    )

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "unreachable",
      message: expect.stringContaining("ECONNREFUSED") as unknown,
    })
  })

  test.each([
    ["an error", new Error(`no route for Bearer ${TOKEN_TEXT}`), "Error"],
    [
      "a failed fetch whose cause has no code",
      new TypeError("fetch failed", { cause: new Error(`Bearer ${TOKEN_TEXT}`) }),
      "TypeError",
    ],
    [
      "a header value that fetch refuses and quotes",
      new TypeError(`Headers.append: "Bearer ${TOKEN_TEXT}\nX" is an invalid header value.`),
      "TypeError",
    ],
  ])(
    "names a request stopped by %s by the kind of failure alone, never by its text",
    async (_name, error, kind) => {
      const runtime = runtimeAnswering(() => Promise.reject(error))

      const failure = (await failureOf(runtime.describeEngine())) as RuntimeError

      expect(failure).toMatchObject({
        failure: "unreachable",
        message: `Cannot reach ${REST_URL}/topology (${kind})`,
      })
      expect(`${failure.message} ${String(failure.hint)}`).not.toContain(TOKEN_TEXT)
    },
  )

  test("names no reason for a failure that is no error, and never quotes it", async () => {
    const answer = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(`Bearer ${TOKEN_TEXT}`)
        },
      }),
    )

    await expect(
      runtimeAnswering(() => Promise.resolve(answer)).describeEngine(),
    ).rejects.toMatchObject({
      failure: "unreachable",
      message: `Cannot reach ${REST_URL}/topology (unknown failure)`,
    })
  })

  test("refuses an answer that announces more than it reads", async () => {
    const answer = new Response("{}", {
      headers: { "Content-Length": String(65 * MEBIBYTE) },
    })

    await expect(
      runtimeAnswering(() => Promise.resolve(answer)).describeEngine(),
    ).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: expect.stringContaining("more than 67108864 bytes") as unknown,
    })
  })

  test("stops reading an answer that grows past the cap", async () => {
    const answer = new Response(chunksOf([33 * MEBIBYTE, 33 * MEBIBYTE]))

    await expect(
      runtimeAnswering(() => Promise.resolve(answer)).describeEngine(),
    ).rejects.toMatchObject({ failure: "unexpectedResponse" })
  })

  test("reads an empty answer as unexpected", async () => {
    await expect(
      runtimeAnswering(() => Promise.resolve(new Response(null))).describeEngine(),
    ).rejects.toMatchObject({ failure: "unexpectedResponse" })
  })

  test("reads a failure without a problem body by its status", async () => {
    const runtime = runtimeAnswering(() => Promise.resolve(new Response("oops", { status: 500 })))

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "engineFailure",
      message: expect.stringContaining("HTTP 500") as unknown,
    })
  })

  test.each([
    ["a field of another type", { gatewayVersion: 8 }],
    ["a missing field", {}],
    ["a list instead of an object", []],
    ["nothing", null],
  ])("reads %s as unexpected", async (_name, body) => {
    await expect(
      runtimeAnswering(() => Promise.resolve(jsonAnswer(body))).describeEngine(),
    ).rejects.toMatchObject({ failure: "unexpectedResponse" })
  })
})

describe("a capped answer text", () => {
  const capped = new CappedText(8)

  test("reads an answer within the cap whole, also a character split across chunks", async () => {
    const encoded = new TextEncoder().encode("12 €")
    const body = bodyOf([encoded.slice(0, 4), encoded.slice(4)])

    expect(await capped.read(new Response(body.stream))).toBe("12 €")
  })

  test("reads an answer of exactly the cap", async () => {
    expect(await capped.read(new Response(bodyOf([bytes(5), bytes(3)]).stream))).toBe("aaaaaaaa")
  })

  test("reads an answer without a body as empty", async () => {
    expect(await capped.read(new Response(null))).toBe("")
  })

  test("refuses an answer that announces more than the cap and cancels its body unread", async () => {
    const body = bodyOf([bytes(1)])
    const answer = new Response(body.stream, { headers: { "Content-Length": "9" } })

    expect(await capped.read(answer)).toBeUndefined()
    expect(body.cancelled()).toBe(true)
  })

  test("refuses an announced size above the cap without a body to cancel", async () => {
    const answer = new Response(null, { headers: { "Content-Length": "9" } })

    expect(await capped.read(answer)).toBeUndefined()
  })

  test("stops reading an answer that grows past the cap and cancels the rest", async () => {
    const body = bodyOf([bytes(4), bytes(4), bytes(1), bytes(4)])

    expect(await capped.read(new Response(body.stream))).toBeUndefined()
    expect(body.cancelled()).toBe(true)
  })

  test.each([
    [
      "announces",
      (body: Body) => new Response(body.stream, { headers: { "Content-Length": "9" } }),
    ],
    ["grows past", (body: Body) => new Response(body.stream)],
  ])("gives up an answer that %s the cap even when cancelling fails", async (_name, answerOf) => {
    const body = bodyOf([bytes(9)], cannotCancel)

    expect(await capped.read(answerOf(body))).toBeUndefined()
    expect(body.cancelled()).toBe(true)
  })
})
