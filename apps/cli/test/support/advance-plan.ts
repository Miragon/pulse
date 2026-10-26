/** Wait states, an instance view and the usage error, for the advance plan tests. */

import { PulseCliError } from "../../src/errors.js"
import type { InstanceView, WaitState } from "../../src/workflow/types.js"

export const USER_TASK = {
  activityId: "approve",
  kind: "userTask",
  taskId: "t1",
} satisfies WaitState
export const EXTERNAL = {
  activityId: "charge",
  kind: "externalTask",
  externalTaskId: "e1",
  topic: "pay",
} satisfies WaitState
export const TIMER = {
  activityId: "cool-down",
  kind: "timer",
  jobId: "j1",
  dueDate: "d",
  retries: 3,
} satisfies WaitState
export const ASYNC = {
  activityId: "book",
  kind: "asyncContinuation",
  jobId: "j2",
  retries: 3,
} satisfies WaitState
export const MESSAGE = {
  activityId: "paid",
  kind: "message",
  eventSubscriptionId: "s1",
  eventName: "Paid",
  executionId: "x1",
} satisfies WaitState
export const SIGNAL = {
  activityId: "go",
  kind: "signal",
  eventSubscriptionId: "s2",
  eventName: "Go",
  executionId: "x2",
} satisfies WaitState
export const RECEIVE = {
  activityId: "wait",
  activityType: "receiveTask",
  kind: "other",
  executionId: "x3",
} satisfies WaitState
export const CONDITIONAL = {
  activityId: "cond",
  kind: "conditional",
  eventSubscriptionId: "s3",
  executionId: "x4",
} satisfies WaitState

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

export const VARS = { variables: { approved: { value: true, type: "Boolean" } } }
