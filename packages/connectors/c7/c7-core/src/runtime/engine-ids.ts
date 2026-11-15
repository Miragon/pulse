/**
 * The one engine id rule of the Camunda 7 REST family: an id the engine assigns (an instance's,
 * an incident's, a batch's, a definition's `order:3:1f2…`) is a letter, a digit or an underscore,
 * then word characters, dots, colons and hyphens. Anything else would change the path or the
 * query it is sent in, so it is refused before a request leaves. Pure.
 */

import { RuntimeError } from "@miragon/pulse-engine-core"

const ENGINE_ID = /^[A-Za-z0-9_][\w.:-]*$/

/** True for a value the engine could have assigned as an id. */
export function isEngineId(value: string): boolean {
  return ENGINE_ID.test(value)
}

/**
 * `value` when it is an engine id; otherwise a `RuntimeError("misconfigured")` that names it,
 * since a read of the engine contract got an id no engine assigns.
 */
export function engineIdOf(value: string): string {
  if (!isEngineId(value)) {
    throw new RuntimeError("misconfigured", `"${value}" as an identifier is not accepted`)
  }
  return value
}
