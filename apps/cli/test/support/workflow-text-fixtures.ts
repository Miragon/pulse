/** The instance view the text tests of the workflow commands render (src/workflow/text*). */

import type { InstanceView } from "../../src/workflow/types.js"

export const VIEW: InstanceView = {
  id: "p1",
  businessKey: "B-1",
  definition: { key: "order", version: 3, name: "Order", id: "order:3:x" },
  state: "ACTIVE",
  startTime: "s",
  parentId: "parent",
  rootId: "root",
  waitingAt: [
    { activityId: "approve", kind: "userTask", taskId: "t1", name: "Approve" },
    {
      activityId: "review",
      kind: "userTask",
      taskId: "t2",
      assignee: "demo",
      processInstanceId: "c1",
    },
    {
      activityId: "charge",
      kind: "externalTask",
      externalTaskId: "e1",
      topic: "pay",
      workerId: "w",
      retries: 0,
      errorMessage: "declined",
    },
    { activityId: "mail", kind: "externalTask", externalTaskId: "e2", topic: "mail" },
    {
      activityId: "remind",
      attachedTo: "review",
      kind: "timer",
      jobId: "j1",
      dueDate: "tomorrow",
      retries: 3,
    },
    {
      activityId: "book",
      kind: "asyncContinuation",
      jobId: "j2",
      retries: 0,
      exceptionMessage: "boom",
    },
    { activityId: "ship", kind: "asyncContinuation", jobId: "j3", retries: 3 },
    {
      activityId: "paid",
      kind: "message",
      eventSubscriptionId: "s1",
      eventName: "Paid",
      executionId: "x1",
    },
    { activityId: "cond", kind: "conditional", eventSubscriptionId: "s2", executionId: "x2" },
    { activityId: "wait", activityType: "receiveTask", kind: "other", executionId: "x3" },
    { activityId: "odd", kind: "other", executionId: "x4" },
  ],
  incidents: [
    { id: "i1", type: "failedJob", activityId: "book", rootCause: "cause", since: "s" },
    {
      id: "i2",
      type: "custom",
      activityId: "x",
      message: "msg",
      processInstanceId: "c1",
      since: "s",
    },
    { id: "i3", type: "custom", activityId: "y", since: "s" },
  ],
  propagatedIncidents: 2,
  children: [
    { id: "c1", parentId: "p1", key: "child", state: "ACTIVE" },
    { id: "c2", parentId: "p1", key: "child", version: 2, state: "SUSPENDED" },
  ],
  variables: { amount: 250, order: { type: "Json", value: "{}" } },
  timeline: [
    { activityId: "start", activityType: "startEvent", startTime: "s", durationMs: 5 },
    {
      activityId: "book",
      activityType: "serviceTask",
      startTime: "s",
      canceled: true,
      incidents: [
        { type: "failedJob", state: "resolved", message: "boom" },
        { type: "x", state: "open" },
      ],
    },
  ],
  truncated: true,
  next: ["operate retry p1"],
  waited: { until: "idle", elapsedMs: 1200, polls: 5 },
}
