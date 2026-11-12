/**
 * The deadline and the size cap, over fake bodies: the deadline holds to the last byte, and an
 * answer above the cap is cancelled as it crosses it, never buffered whole.
 */
import fc from "fast-check"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createHttp,
  HttpFailure,
  type HttpRequest,
  MAX_ANSWER_BYTES,
  noCredential,
} from "../src/index.js"
import { readBody } from "../src/body.js"
import { platformOf, type Step, untilAborted } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const MIB = 1024 * 1024
const GET: HttpRequest = { method: "GET", url: `${ROOT}/x`, intent: "read" }
const PUT: HttpRequest = { method: "PUT", url: `${ROOT}/x`, intent: "write", body: "{}" }

const httpOf = (steps: readonly Step[], timeoutMs = 1_000, maxAnswerBytes?: number) =>
  createHttp(
    {
      url: ROOT,
      credential: noCredential,
      timeoutMs,
      ...(maxAnswerBytes === undefined ? {} : { maxAnswerBytes }),
    },
    platformOf(steps).platform,
  )

/** A body that sends `chunks` chunks of 10 bytes, one every `everyMs`, on the (fake) timers. */
function trickling(chunks: number, everyMs: number): Response {
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, everyMs))
      controller.enqueue(new Uint8Array(10))
      sent += 1
      if (sent === chunks) controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

/** A body of `total` bytes pulled in chunks of `chunk`, counting the pulls and the cancel. */
function counted(total: number, chunk: number, headers: Record<string, string> = {}) {
  const shared = new Uint8Array(chunk)
  const seen = { pulls: 0, cancelled: false }
  let left = total
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1
      const size = Math.min(chunk, left)
      if (size > 0) controller.enqueue(size === chunk ? shared : shared.subarray(0, size))
      left -= size
      if (left === 0) controller.close()
    },
    cancel() {
      seen.cancelled = true
    },
  })
  return { response: new Response(body, { status: 200, headers }), seen }
}

async function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "answered",
    (error: unknown) => (error instanceof HttpFailure ? error.reason : String(error)),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe("the deadline", () => {
  it("holds to the last byte: a body that ends in time answers, one that does not fails at it", async () => {
    vi.useFakeTimers()
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 300 }),
        async (chunks, everyMs, timeoutMs) => {
          fc.pre(chunks * everyMs !== timeoutMs)
          const http = httpOf([() => trickling(chunks, everyMs)], timeoutMs)
          const started = Date.now()
          let ended = -1
          const result = outcome(http.send(GET)).finally(() => {
            ended = Date.now() - started
          })
          await vi.runAllTimersAsync()
          const expected = chunks * everyMs < timeoutMs ? "answered" : "deadline"
          expect(await result).toBe(expected)
          expect(ended).toBe(expected === "answered" ? chunks * everyMs : timeoutMs)
        },
      ),
      { numRuns: 60 },
    )
  })

  it("fails a write it cut with the caveat, a read without", async () => {
    const write = await httpOf([untilAborted], 20)
      .send(PUT)
      .catch((error: unknown) => error)
    expect(write).toMatchObject({ reason: "deadline", limit: 20, mayHaveApplied: true })
    expect(String(write)).toContain(
      "no complete answer within 20 ms; the write may have been applied",
    )
    const read = await httpOf([untilAborted], 20)
      .send(GET)
      .catch((error: unknown) => error)
    expect(read).toMatchObject({ reason: "deadline", mayHaveApplied: false })
  })

  it("holds when the fetch never hands its signal on to the body", async () => {
    const stalled = new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }))
    expect(await outcome(httpOf([stalled], 20).send(GET))).toBe("deadline")
  })
})

describe("the caller's abort", () => {
  it("cancels a read, as a cancellation, not the deadline", async () => {
    const caller = new AbortController()
    const pending = httpOf([untilAborted], 5_000).send({ ...GET, signal: caller.signal })
    caller.abort()
    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      reason: "cancelled",
      mayHaveApplied: false,
    })
  })

  it("cancels a read before it left", async () => {
    const http = httpOf([untilAborted], 5_000)
    expect(await outcome(http.send({ ...GET, signal: AbortSignal.abort() }))).toBe("cancelled")
  })

  it("never reaches a write: aborting a write that left cannot undo it", async () => {
    const fake = platformOf([new Response(null, { status: 204 })])
    const http = createHttp(
      { url: ROOT, credential: noCredential, timeoutMs: 1_000 },
      fake.platform,
    )
    const answer = await http.send({ ...PUT, signal: AbortSignal.abort() })
    expect(answer.status).toBe(204)
    expect(fake.calls[0]?.signal?.aborted).toBe(false)
  })
})

describe("the size cap", () => {
  it("is 64 MiB by default", () => {
    expect(MAX_ANSWER_BYTES).toBe(64 * 1024 * 1024)
  })

  it("fails 64 MiB + 1, streamed without a length", async () => {
    const { response, seen } = counted(MAX_ANSWER_BYTES + 1, MIB)
    const failure = await httpOf([() => response])
      .send(GET)
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ reason: "too-large", status: 200, limit: MAX_ANSWER_BYTES })
    expect(seen.pulls).toBeLessThanOrEqual(65 + 2)
  })

  it("cancels a longer body the moment it crossed the cap, never reading it whole", async () => {
    const { response, seen } = counted(2 * MAX_ANSWER_BYTES, MIB)
    expect(await outcome(httpOf([() => response]).send(GET))).toBe("too-large")
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThanOrEqual(65 + 2)
  })

  it("takes exactly 64 MiB", async () => {
    const { response } = counted(MAX_ANSWER_BYTES, MIB)
    expect((await httpOf([() => response]).send(GET)).body.byteLength).toBe(MAX_ANSWER_BYTES)
  })

  it("fails an announced length over the cap before reading a byte", async () => {
    const { response, seen } = counted(10, 10, { "Content-Length": String(MAX_ANSWER_BYTES + 1) })
    expect(await outcome(httpOf([() => response]).send(GET))).toBe("too-large")
    expect(seen.pulls).toBeLessThanOrEqual(1)
  })

  it("holds any cap: a body above it fails, one at or below answers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 0, max: 8192 }),
        fc.integer({ min: 1, max: 512 }),
        async (cap, size, chunk) => {
          const { response, seen } = counted(size, chunk)
          const result = await outcome(httpOf([() => response], 1_000, cap).send(GET))
          expect(result).toBe(size > cap ? "too-large" : "answered")
          if (size > cap) expect(seen.pulls).toBeLessThanOrEqual(Math.floor(cap / chunk) + 3)
        },
      ),
    )
  })

  it("marks a write whose answer was too large as maybe applied", async () => {
    const { response } = counted(11, 11)
    const failure = await httpOf([() => response], 1_000, 10)
      .send(PUT)
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ reason: "too-large", mayHaveApplied: true })
    expect(String(failure)).toContain("the answer exceeds 10 bytes")
  })
})

describe("readBody", () => {
  it("fails at once when the deadline passed before the body", async () => {
    const response = new Response("{}")
    await expect(readBody(response, 10, AbortSignal.abort())).rejects.toThrow("aborted")
  })
})
