/** Wait states of every kind and a variable input, for the advance plan tests. */

import type { WaitState } from "../types.js"

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

export const VARS = { variables: { approved: { value: true, type: "Boolean" } } }
