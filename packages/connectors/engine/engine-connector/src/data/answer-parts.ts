/**
 * Whether an answer holds every part it reads. An enrichment read that fails (`optional`) leaves
 * its part out ("—"), and a floor keeps no such answer (invariant 7: never an answer that misses a
 * part), so the next call reads the part again. A floor builds its answer over a view of the
 * engine client (`withPartsWatched`), and each enrichment read of the build that degrades says so
 * through that view where the build catches its failure (`optional(read, client)`, `partMissed`):
 * a failed request of its own, a read another call started that it joined (the XML cache's), and
 * an answer whose body it refused (`countOf`, `rowsOf`) alike, so what decides is the answer's
 * parts, never which requests went out. The view shares the client's interceptors, so what the
 * module keeps per engine (`engineClientKey`) stays the client's. An engine answer that names a
 * missing resource is an answer, not a missed part (`isMissingResource`).
 */

import type { Client } from "@miragon/pulse-c7-client"
import { isMissingResource } from "../lib/core-adapter/engine-port.js"

/** An answer and whether it holds every part its build read. */
export interface WatchedAnswer<T> {
  readonly value: T
  readonly complete: boolean
}

/** The parts of the answer a build makes: whether one was left out. */
interface Parts {
  complete: boolean
}

/** Each watched build's parts, by the view of the client its reads go out through. */
const partsOf = new WeakMap<Client, Parts>()

/**
 * Notes that the answer built over `client` leaves out the part `error` kept it from reading.
 * Over a client no floor watches, and for an answer that names a missing resource, it notes
 * nothing.
 */
export function partMissed(client: Client, error: unknown): void {
  const parts = partsOf.get(client)
  if (parts !== undefined && !isMissingResource(error)) parts.complete = false
}

/** `build`'s answer over a view of `client`, and whether every part of it was read. */
export async function withPartsWatched<T>(
  client: Client,
  build: (client: Client) => Promise<T>,
): Promise<WatchedAnswer<T>> {
  const parts: Parts = { complete: true }
  const watched: Client = { ...client }
  partsOf.set(watched, parts)
  const value = await build(watched)
  return { value, complete: parts.complete }
}
