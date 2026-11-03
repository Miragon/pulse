/** Wait states, an instance view and the usage error, for the advance plan tests. */

import type { WaitState } from "@miragon/pulse-engine-core"
import { PulseCliError } from "../../src/errors.js"
import type { InstanceView } from "../../src/workflow/types.js"

export {
  ASYNC,
  CONDITIONAL,
  EXTERNAL,
  MESSAGE,
  RECEIVE,
  SIGNAL,
  TIMER,
  USER_TASK,
  VARS,
} from "@miragon/pulse-engine-core/testing"

export function view(
  waitingAt: readonly WaitState[],
  overrides: Partial<InstanceView> = {},
): InstanceView {
  return {
    id: "p1",
    definition: { key: "k", id: "k:1:x" },
    state: "ACTIVE",
    waitingAt,
    incidents: [],
    children: [],
    next: [],
    ...overrides,
  }
}

export function usage(fn: () => unknown): PulseCliError {
  try {
    fn()
  } catch (error) {
    if (error instanceof PulseCliError) return error
  }
  throw new Error("expected a usage error")
}
