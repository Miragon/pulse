import { describe, expect, it } from "vitest"
import { VIEW } from "../../test/support/workflow-text-fixtures.js"
import { formatElapsed, headerBlock, instanceText, nextBlock, section, waitedText } from "./text.js"
import { advanceText, retryText } from "./text-views.js"
import type { InstanceView } from "./types.js"

describe("text helpers", () => {
  it("aligns header values and leaves out rows without a value", () => {
    expect(
      headerBlock([
        ["Process instance", "p1"],
        ["State", "ACTIVE"],
        ["Ended", undefined],
        ["Root", ""],
        ["Count", 0],
      ]),
    ).toEqual(["Process instance  p1", "State             ACTIVE", "Count             0"])
    expect(section({ title: "X:", columns: ["A"], rows: [] }, 80)).toEqual([])
    expect(nextBlock([])).toEqual([])
  })

  it("formats elapsed times and waits", () => {
    expect([350, 1200, 59_999, 125_000].map(formatElapsed)).toEqual([
      "350ms",
      "1.2s",
      "60.0s",
      "2m 5s",
    ])
    expect(waitedText({ until: "idle", elapsedMs: 0, polls: 1 })).toBe("idle after 0ms (1 poll)")
    expect(waitedText(undefined)).toBeUndefined()
  })
})

describe("instanceText", () => {
  it("renders the header, every section and the next commands", () => {
    expect(instanceText(VIEW, 200)).toBe(
      [
        "Process instance      p1",
        "State                 ACTIVE",
        "Definition            order v3 (Order)",
        "Business key          B-1",
        "Started               s",
        "Parent                parent",
        "Root                  root",
        "Propagated incidents  2",
        "Truncated             the instance tree was cut at depth 10 or 100 instances",
        "Waited                idle after 1.2s (5 polls)",
        "",
        "Waiting at:",
        "ACTIVITY            KIND               ID  DETAIL                                    INSTANCE",
        "approve             userTask           t1  Approve",
        "review              userTask           t2  assignee demo                             c1",
        "charge              externalTask       e1  topic pay, worker w, retries 0: declined",
        "mail                externalTask       e2  topic mail",
        "remind (on review)  timer              j1  due tomorrow",
        "book                asyncContinuation  j2  retries 0: boom",
        "ship                asyncContinuation  j3  retries 3",
        "paid                message            s1  Paid",
        "cond                conditional        s2",
        "wait                other              x3  receiveTask",
        "odd                 other              x4",
        "",
        "Incidents:",
        "TYPE       ACTIVITY  ROOT CAUSE  INSTANCE",
        "failedJob  book      cause",
        "custom     x         msg         c1",
        "custom     y",
        "",
        "Called instances:",
        "ID  KEY    VERSION  STATE      PARENT",
        "c1  child           ACTIVE     p1",
        "c2  child  2        SUSPENDED  p1",
        "",
        "Variables:",
        "NAME    VALUE  TYPE",
        "amount  250",
        "order   {}     Json",
        "",
        "Timeline:",
        "#  ACTIVITY  TYPE         START  DURATION  NOTE",
        "1  start     startEvent   s      5ms",
        "2  book      serviceTask  s                canceled; failedJob (resolved): boom; x (open)",
        "",
        "Next:",
        "  operate retry p1",
        "",
      ].join("\n"),
    )
  })

  it("renders an instance that ended without history", () => {
    expect(
      instanceText(
        { id: "p1", state: "ENDED", waited: { until: "idle", elapsedMs: 0, polls: 1 } },
        80,
      ),
    ).toBe(
      "Process instance  p1\nState             ENDED (no history)\nWaited            idle after 0ms (1 poll)\n",
    )
  })
})

describe("instance text of the comfort details", () => {
  const base: InstanceView = {
    id: "p1",
    definition: { key: "k", id: "k:1:x" },
    state: "ACTIVE",
    waitingAt: [],
    incidents: [],
    children: [],
    next: [],
  }

  it("prints the stacktrace of each incident below the incidents with --stacktrace", () => {
    const text = instanceText(
      {
        ...base,
        incidents: [
          {
            id: "i1",
            type: "failedJob",
            activityId: "book",
            rootCause: "PropertyNotFoundException: x",
            since: "s",
            stacktrace: ["org.x.ProcessEngineException: outer", "\tat org.x.Y.run(Y.java:1)"],
          },
          { id: "i2", type: "custom", activityId: "other", since: "s", stacktrace: [] },
        ],
        variables: { a: 1 },
      },
      80,
    )
    expect(text).toContain(
      "\nStacktrace (failedJob at book, incident i1):\n  org.x.ProcessEngineException: outer\n   at org.x.Y.run(Y.java:1)\n\nVariables:",
    )
    expect(text).not.toContain("incident i2")
  })

  it("names the activity of a user task without its own name and marks suspended jobs", () => {
    const text = instanceText(
      {
        ...base,
        waitingAt: [
          { activityId: "approve", activityName: "Approve", kind: "userTask", taskId: "t1" },
          {
            activityId: "book",
            kind: "asyncContinuation",
            jobId: "j1",
            retries: 3,
            suspended: true,
          },
          {
            activityId: "remind",
            kind: "timer",
            jobId: "j2",
            dueDate: "d",
            retries: 3,
            suspended: true,
          },
        ],
      },
      120,
    )
    expect(text).toMatch(/approve +userTask +t1 +Approve/)
    expect(text).toMatch(/book +asyncContinuation +j1 +retries 3, suspended/)
    expect(text).toMatch(/remind +timer +j2 +due d, suspended/)
  })

  it("lists the follow-ups of the retry report and its request errors", () => {
    const text = retryText(
      {
        retried: 0,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        gone: 0,
        errors: 1,
        incidents: [
          {
            incidentId: "i1",
            type: "customIncident",
            activityId: "a",
            processInstanceId: "p1",
            action: "none",
            result: "skipped",
            next: "operate incident resolve i1 --yes",
          },
          {
            incidentId: "i2",
            type: "failedJob",
            activityId: "b",
            processInstanceId: "p1",
            action: "retries=1",
            result: "error",
            error: "HTTP 500: boom",
          },
        ],
      },
      100,
    )
    expect(text).toContain("Retried 0, succeeded 0, failed 0, skipped 1, gone 0, errors 1")
    expect(text).toMatch(/i2 +failedJob +b +error +HTTP 500: boom/)
    expect(text.endsWith("\nNext:\n  operate incident resolve i1 --yes\n")).toBe(true)
  })

  it("renders an advance whose instance could not be read", () => {
    expect(
      advanceText(
        { advanced: { processInstanceId: "p1", activityId: "a", kind: "userTask", id: "t" } },
        80,
      ),
    ).toBe("Advanced  a (userTask)\n")
  })
})

describe("instance text details", () => {
  const ID = "a-very-long-task-id-0123456789abcdef"
  const view: InstanceView = {
    id: "p1",
    definition: { key: "k", id: "k:1:x" },
    state: "COMPLETED",
    endTime: "e",
    waitingAt: [
      { activityId: "approve-the-invoice-now", kind: "userTask", taskId: ID },
      { activityId: "x", kind: "userTask", taskId: "t2", name: "Named" },
    ],
    incidents: [],
    children: [{ id: ID, parentId: "p1", key: "child-process-key", state: "ACTIVE" }],
    variables: {
      plain: 1,
      typed: { type: "Json", value: "{}" },
      untyped: { value: 2 },
    },
    next: [],
  }

  it("never truncates ids, shows the end time and the variable types", () => {
    const lines = instanceText(view, 60).split("\n")
    expect(lines).toContain("Ended             e")
    expect(lines.filter((line) => line.includes(ID))).toHaveLength(2)
    const text = instanceText(view, 40)
    expect(text).toContain(
      '\nVariables:\nNAME     VALUE        TYPE\nplain    1\ntyped    {}           Json\nuntyped  {"value":2}\n',
    )
  })

  it("formats elapsed times at the unit boundaries", () => {
    expect([999, 1000, 59_999, 60_000, 61_500].map(formatElapsed)).toEqual([
      "999ms",
      "1.0s",
      "60.0s",
      "1m 0s",
      "1m 2s",
    ])
  })
})
