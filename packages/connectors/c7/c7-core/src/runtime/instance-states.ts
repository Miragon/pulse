/**
 * An instance's state as the engine contract names it (`InstanceState` of
 * @miragon/pulse-engine-core) from the state the history writes: a state no engine of the family
 * writes is an answer the reader cannot use. Pure.
 */

import { type InstanceState, RuntimeError } from "@miragon/pulse-engine-core"

const INSTANCE_STATES: ReadonlyMap<string, InstanceState> = new Map<string, InstanceState>([
  ["ACTIVE", "running"],
  ["SUSPENDED", "suspended"],
  ["COMPLETED", "completed"],
  ["EXTERNALLY_TERMINATED", "terminated"],
  ["INTERNALLY_TERMINATED", "terminated"],
])

/** The contract's state of `engineState`; an unknown one fails as `unexpectedResponse`. */
export function instanceStateOf(engineState: string): InstanceState {
  const state = INSTANCE_STATES.get(engineState)
  if (state === undefined) {
    throw new RuntimeError("unexpectedResponse", `Unknown process instance state ${engineState}`)
  }
  return state
}
