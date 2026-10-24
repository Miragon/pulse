import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import { fakeServer, json } from "../../test/support/fake-fetch.js"
import { type Condition, conditionLabel, decide, measure, parseCondition } from "./conditions.js"

describe("parseCondition", () => {
  it.each([
    ["idle", { kind: "idle" }],
    ["ended", { kind: "ended" }],
    ["incident", { kind: "incident" }],
    ["task", { kind: "task" }],
    ["task:approve", { kind: "task", key: "approve" }],
    ["activity:book", { kind: "activity", id: "book" }],
    ["activity:a:b", { kind: "activity", id: "a:b" }],
  ])("reads %s", (raw, condition) => {
    expect(parseCondition(raw)).toEqual(condition)
    expect(conditionLabel(condition as Condition)).toBe(raw)
  })

  it.each(["", "idel", "task:", "activity:", "activity", "job:x"])(
    'refuses "%s" listing the forms',
    (raw) => {
      expect(() => parseCondition(raw)).toThrow(
        `--until expects one of idle, ended, incident, task, task:<taskDefinitionKey>, activity:<activityId>, got "${raw}"`,
      )
    },
  )
})

function countingEngine(counts: Readonly<Record<string, number>>) {
  const answer = (name: string) => () => json({ count: counts[name] ?? 0 })
  return fakeServer()
    .on("GET", "/process-instance/count", (request) =>
      json({ count: counts[request.query.has("withIncident") ? "incidents" : "active"] ?? 0 }),
    )
    .on("GET", "/job/count", answer("jobs"))
    .on("GET", "/task/count", answer("tasks"))
    .on("GET", "/history/activity-instance/count", answer("history"))
}

const ACTIVE = { id: "p1", ended: false, tree: ["p1", "c1"] }

describe("measure", () => {
  it("sends only the requests the conditions need, plus the incident check", async () => {
    const server = countingEngine({ incidents: 1, jobs: 0, tasks: 2 })
    const conditions: Condition[] = [
      { kind: "idle" },
      { kind: "task", key: "approve" },
      { kind: "ended" },
    ]
    const result = await measure(portOf(server.fetch), ACTIVE, conditions, true)
    expect(result).toEqual({ incidents: 1, held: ["idle", "task:approve"] })
    expect(
      server.requests.map((request) => `${request.path}?${request.query.toString()}`).sort(),
    ).toEqual([
      // active: jobs of a suspended job definition never run
      "/job/count?processInstanceIds=p1%2Cc1&executable=true&active=true",
      "/process-instance/count?processInstanceIds=p1%2Cc1&withIncident=true",
      "/task/count?processInstanceIdIn=p1%2Cc1&taskDefinitionKey=approve",
    ])
  })

  it("asks for incidents only once the condition counts are answered, never in parallel", async () => {
    // a job that fails for good loses its last retry and gets its incident in one transaction:
    // only an incident count read after the job count is sure to see what the job count missed
    const answers: ((response: Response) => void)[] = []
    const server = countingEngine({ incidents: 1 }).on(
      "GET",
      "/job/count",
      () => new Promise<Response>((resolve) => answers.push(resolve)),
    )
    const measured = measure(portOf(server.fetch), ACTIVE, [{ kind: "idle" }], true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(server.requests.map((request) => request.path)).toEqual(["/job/count"])
    answers[0]?.(json({ count: 0 }))
    expect(await measured).toEqual({ incidents: 1, held: ["idle"] })
    expect(server.requests.map((request) => request.path)).toEqual([
      "/job/count",
      "/process-instance/count",
    ])
  })

  it("looks for an activity in the active tree and in the history of every instance", async () => {
    const server = countingEngine({ active: 0, history: 1 })
    const result = await measure(
      portOf(server.fetch),
      ACTIVE,
      [{ kind: "activity", id: "book" }],
      false,
    )
    expect(result.held).toEqual(["activity:book"])
    expect(server.requests.map((request) => request.path).sort()).toEqual([
      "/history/activity-instance/count",
      "/history/activity-instance/count",
      "/process-instance/count",
    ])
    const none = await measure(
      portOf(countingEngine({}).fetch),
      ACTIVE,
      [{ kind: "activity", id: "book" }, { kind: "task" }],
      false,
    )
    expect(none.held).toEqual([])
  })

  it("sends no counts for an ended instance except its activity history", async () => {
    const server = countingEngine({ history: 0 })
    const ended = { id: "p1", ended: true, tree: [] }
    const result = await measure(
      portOf(server.fetch),
      ended,
      [{ kind: "idle" }, { kind: "incident" }, { kind: "activity", id: "x" }],
      true,
    )
    expect(result).toEqual({ incidents: 0, held: ["idle"] })
    expect(server.requests.map((request) => request.path)).toEqual([
      "/history/activity-instance/count",
    ])
  })

  it("chunks a tree of more than 50 instances", async () => {
    const tree = Array.from({ length: 120 }, (_, index) => `p${index}`)
    const server = countingEngine({ jobs: 1 })
    expect(
      (
        await measure(
          portOf(server.fetch),
          { id: "p0", ended: false, tree },
          [{ kind: "idle" }],
          false,
        )
      ).held,
    ).toEqual([])
    expect(server.requests).toHaveLength(3)
  })
})

describe("decide", () => {
  const idle: Condition[] = [{ kind: "idle" }]

  it("takes --until incident before failing fast", () => {
    expect(
      decide([{ kind: "incident" }, { kind: "idle" }], true, ACTIVE, {
        incidents: 1,
        held: ["idle"],
      }),
    ).toEqual({ kind: "held", until: "incident" })
  })

  it("fails fast on an incident before any other condition: a failed job with no retries is not idle", () => {
    expect(decide(idle, true, ACTIVE, { incidents: 1, held: ["idle"] })).toEqual({
      kind: "incident",
    })
    expect(decide(idle, false, ACTIVE, { incidents: 1, held: ["idle"] })).toEqual({
      kind: "held",
      until: "idle",
    })
  })

  it("reports the first condition that holds, then an ended instance, else pending", () => {
    expect(
      decide([{ kind: "task" }, { kind: "idle" }], true, ACTIVE, {
        incidents: 0,
        held: ["task", "idle"],
      }),
    ).toEqual({ kind: "held", until: "task" })
    expect(
      decide([{ kind: "task" }], true, { ...ACTIVE, ended: true }, { incidents: 0, held: [] }),
    ).toEqual({ kind: "ended" })
    expect(decide([{ kind: "task" }], true, ACTIVE, { incidents: 0, held: [] })).toEqual({
      kind: "pending",
    })
  })
})

describe("conditions details", () => {
  it("names an example in the usage error", () => {
    try {
      parseCondition("nope")
      expect.unreachable()
    } catch (error) {
      expect((error as { details: { hint: string } }).details.hint).toBe(
        "Example: --until task:approve --until ended (any one of them ends the wait).",
      )
    }
  })

  it("asks for the activity in the tree and per instance in the history; one hit is enough", async () => {
    const server = (active: number, history: Readonly<Record<string, number>>) =>
      fakeServer()
        .on("GET", "/process-instance/count", json({ count: active }))
        .on("GET", "/history/activity-instance/count", (request) =>
          json({ count: history[request.query.get("processInstanceId") ?? ""] ?? 0 }),
        )
    const activity: Condition[] = [{ kind: "activity", id: "book" }]
    const running = server(1, {})
    expect((await measure(portOf(running.fetch), ACTIVE, activity, false)).held).toEqual([
      "activity:book",
    ])
    expect(
      running.requests.map((request) => `${request.path}?${request.query.toString()}`).sort(),
    ).toEqual([
      "/history/activity-instance/count?processInstanceId=c1&activityId=book",
      "/history/activity-instance/count?processInstanceId=p1&activityId=book",
      "/process-instance/count?processInstanceIds=p1%2Cc1&activityIdIn=book",
    ])
    const child = server(0, { c1: 1 })
    expect((await measure(portOf(child.fetch), ACTIVE, activity, false)).held).toEqual([
      "activity:book",
    ])
  })

  it("asks for any task without a key", async () => {
    const server = countingEngine({ tasks: 1 })
    expect((await measure(portOf(server.fetch), ACTIVE, [{ kind: "task" }], false)).held).toEqual([
      "task",
    ])
    expect(server.requests[0]?.query.toString()).toBe("processInstanceIdIn=p1%2Cc1")
  })

  it("holds incident only with an incident", () => {
    const conditions: Condition[] = [{ kind: "incident" }]
    expect(decide(conditions, false, ACTIVE, { incidents: 0, held: [] })).toEqual({
      kind: "pending",
    })
    expect(decide(conditions, false, ACTIVE, { incidents: 1, held: [] })).toEqual({
      kind: "held",
      until: "incident",
    })
  })
})
