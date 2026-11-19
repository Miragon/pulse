/**
 * A read by id of a resource that may be gone: missing (an engine 404 that names it) or ended
 * meanwhile (a 500 `NullValueException`), the reading `inspect` gives an instance that ended
 * between two rounds, so every wire reads a resource that is gone alike. Any other failure, a
 * wrong REST root included, rejects.
 */

import { endedMeanwhile } from "../inspect.js"
import type { EnginePort, OperationInput } from "../port.js"

/**
 * The answer of `operationId` read by `read`, or undefined when the resource is gone. `read` sees
 * every answer the engine gives, an empty one too, so an unusable answer still fails there.
 */
export async function findUnlessGone<T>(
  port: EnginePort,
  operationId: string,
  input: OperationInput,
  read: (answer: unknown) => T,
): Promise<T | undefined> {
  let answer: unknown
  try {
    answer = await port.json(operationId, input)
  } catch (error: unknown) {
    if (endedMeanwhile(port, error)) return undefined
    throw error
  }
  return read(answer)
}
