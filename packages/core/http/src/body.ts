/**
 * Waiting for an answer and reading its body under the deadline and the cap. The deadline holds
 * from sending to the last byte, even where a `fetch` does not honour its signal at all, and an
 * answer above the cap is cancelled the moment it crosses it: an announced Content-Length before
 * the first byte, a streamed body after the chunk that crossed it, never buffered whole.
 */

/** The largest answer body by default: 64 MiB. */
export const MAX_ANSWER_BYTES = 64 * 1024 * 1024

type Reader = ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>

const ignore = (): undefined => undefined

/** A promise that rejects once `signal` aborts, and the way to stop listening. */
function abortOf(signal: AbortSignal): {
  readonly aborted: Promise<never>
  readonly dispose: () => void
} {
  let listener = ignore as () => void
  const aborted = new Promise<never>((_, reject) => {
    listener = () => {
      reject(new Error("aborted"))
    }
    if (signal.aborted) listener()
    else signal.addEventListener("abort", listener, { once: true })
  })
  return {
    aborted,
    dispose: () => {
      signal.removeEventListener("abort", listener)
    },
  }
}

/**
 * The answer of `pending`, or a rejection once `signal` aborts first, also when the `fetch`
 * behind it ignores the signal; the body of an answer that comes too late is cancelled.
 */
export async function beforeAbort(
  pending: Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  const { aborted, dispose } = abortOf(signal)
  try {
    return await Promise.race([pending, aborted])
  } catch (error) {
    pending.then((late) => late.body?.cancel().catch(ignore), ignore)
    throw error
  } finally {
    dispose()
  }
}

function joined(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}

async function collect(
  reader: Reader,
  cap: number,
  aborted: Promise<never>,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    // The deadline first: once it passed, a chunk already waiting does not win the race.
    const read = await Promise.race([aborted, reader.read()])
    if (read.done) return joined(chunks, total)
    total += read.value.byteLength
    if (total > cap) {
      reader.cancel().catch(ignore)
      return undefined
    }
    chunks.push(read.value)
  }
}

/**
 * The whole body, or `undefined` when it exceeds `cap` bytes. Rejects when `signal` aborts
 * before the last byte.
 */
export async function readBody(
  response: Response,
  cap: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  // No Content-Length reads as 0, which is never above a cap.
  if (Number(response.headers.get("Content-Length")) > cap) {
    response.body?.cancel().catch(ignore)
    return undefined
  }
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const { aborted, dispose } = abortOf(signal)
  try {
    return await collect(reader, cap, aborted)
  } catch (error) {
    reader.cancel().catch(ignore)
    throw error
  } finally {
    dispose()
  }
}
