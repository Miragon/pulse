import { describe, expect, it } from "vitest"
import { depsOf } from "../../test/support/engine-port.js"
import { engineError, fakeServer, json, noContent } from "../../test/support/fake-fetch.js"
import { type Stage, WorkflowEngine } from "../../test/support/workflow-engine.js"
import { type WaitSettings, waitAndInspect } from "./wait.js"
import { waitCommand } from "./wait-command.js"

const IDLE: WaitSettings = {
  conditions: [{ kind: "idle" }],
  timeoutMs: 60_000,
  failOnIncident: true,
  executeJobs: false,
}
const VIEW = { variables: false, history: false, stacktrace: false }

function setup(stage: Stage) {
  const engine = new WorkflowEngine(stage)
  return {
    engine,
    deps: depsOf(engine.fetch, () => {
      engine.tick()
    }),
  }
}

describe("waitAndInspect", () => {
  it('ends at once when the condition holds and adds "waited"', async () => {
    const { deps } = setup("approve")
    const result = await waitAndInspect(deps, { id: "pi-1", known: true }, IDLE, VIEW)
    expect(result.failure).toBeUndefined()
    expect(result.view).toMatchObject({
      id: "pi-1",
      waited: { until: "idle", elapsedMs: 0, polls: 1 },
    })
  })

  it("fails fast with INCIDENT once the job executor fails the job; keeps waiting without fail fast", async () => {
    const { deps } = setup("book")
    const result = await waitAndInspect(deps, { id: "pi-1", known: true }, IDLE, VIEW)
    expect(result.failure).toMatchObject({
      code: "INCIDENT",
      details: { data: { incidents: [{ id: "inc-1", type: "failedJob" }] } },
    })
    expect(result.view).toMatchObject({ incidents: [{ id: "inc-1" }] })
    expect(deps.sleeps).toEqual([250])
    const patient = setup("book")
    const waited = await waitAndInspect(
      patient.deps,
      { id: "pi-1", known: true },
      { ...IDLE, failOnIncident: false },
      VIEW,
    )
    expect(waited.view).toMatchObject({ waited: { until: "idle", polls: 2 } })
  })

  it("succeeds with --until incident when the incident appears", async () => {
    const { deps } = setup("book")
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "incident" }] },
      VIEW,
    )
    expect(result.view).toMatchObject({ waited: { until: "incident" } })
  })

  it("reports INSTANCE_ENDED when the instance ends before the condition", async () => {
    const { deps } = setup("ended")
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "task" }] },
      VIEW,
    )
    expect(result.failure).toMatchObject({
      code: "INSTANCE_ENDED",
      message: "Process instance pi-1 ended (COMPLETED) before reaching task",
      details: { data: { until: ["task"], state: "COMPLETED" } },
    })
  })

  it("times out with WAIT_TIMEOUT and the view of the state at the end", async () => {
    const { deps } = setup("approve")
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }], timeoutMs: 1000 },
      VIEW,
    )
    expect(result.failure).toMatchObject({
      code: "WAIT_TIMEOUT",
      details: { data: { until: ["ended"], elapsedMs: 1000, polls: 4 } },
    })
    expect(result.view).toMatchObject({ state: "ACTIVE" })
    expect("waited" in result.view).toBe(false)
  })

  it("executes due jobs with --execute-jobs and fails with JOB_FAILED", async () => {
    const { deps, engine } = setup("book")
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, executeJobs: true },
      VIEW,
    )
    expect(result.failure).toMatchObject({
      code: "JOB_FAILED",
      details: { data: { failures: [{ jobId: "job-1", activityId: "book" }] } },
    })
    const request = engine.requests.find(
      (entry) => entry.path === "/job" && entry.query.get("sortBy") === "jobDueDate",
    )
    expect(request?.query.get("executable")).toBe("true")
  })

  it("executes due jobs until the instance is idle", async () => {
    const engine = new WorkflowEngine("failed")
    engine.stage = "book"
    const deps = depsOf(engine.fetch)
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }], executeJobs: true },
      VIEW,
    )
    expect(result.view).toMatchObject({ state: "COMPLETED", waited: { until: "ended", polls: 2 } })
  })

  it("is NOT_FOUND for an unknown id on the first poll, and ENDED without history later", async () => {
    const missing = fakeServer()
      .on("GET", "/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
      .on("GET", "/history/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
    await expect(
      waitAndInspect(depsOf(missing.fetch), { id: "x", known: false }, IDLE, VIEW),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    const result = await waitAndInspect(depsOf(missing.fetch), { id: "x", known: true }, IDLE, VIEW)
    expect(result.view).toEqual({
      id: "x",
      state: "ENDED",
      waited: { until: "idle", elapsedMs: 0, polls: 1 },
    })
    const ended = await waitAndInspect(
      depsOf(missing.fetch),
      { id: "x", known: true },
      { ...IDLE, conditions: [{ kind: "task" }] },
      VIEW,
    )
    expect(ended.failure).toMatchObject({
      code: "INSTANCE_ENDED",
      details: { data: { state: "ENDED" } },
    })
  })
})

describe("waitCommand", () => {
  const base = { ...IDLE, variables: false, dryRun: false }

  it("selects by business key and waits", async () => {
    const { deps } = setup("approve")
    const result = await waitCommand(deps, {
      ...base,
      selection: { businessKey: "B-1", latest: false },
    })
    expect(result).toMatchObject({ kind: "view", view: { id: "pi-1", waited: { until: "idle" } } })
  })

  it("previews the first poll with --dry-run", async () => {
    const { deps, engine } = setup("approve")
    const filters = await waitCommand(deps, {
      ...base,
      dryRun: true,
      selection: { businessKey: "B-1", latest: false },
    })
    expect(
      filters.kind === "dry-run" ? filters.requests.map((request) => request.operationId) : [],
    ).toEqual(["getHistoricProcessInstances", "getProcessInstances"])
    const batch = await waitCommand(deps, {
      ...base,
      dryRun: true,
      selection: { latest: false },
      batchId: "b1",
    })
    expect(batch.kind === "dry-run" ? batch.requests : []).toEqual([
      { operationId: "getBatchStatistics", input: { pathArgs: [], query: { batchId: "b1" } } },
    ])
    expect(engine.requests).toEqual([])
  })

  it("waits for a batch", async () => {
    const server = fakeServer()
      .on("GET", "/batch/statistics", json([]))
      .on(
        "GET",
        "/history/batch/b1",
        json({ id: "b1", type: "instance-deletion", totalJobs: 2, startTime: "s", endTime: "e" }),
      )
    const result = await waitCommand(depsOf(server.fetch), {
      ...base,
      selection: { latest: false },
      batchId: "b1",
    })
    expect(result).toMatchObject({ kind: "view", view: { batch: { id: "b1", endTime: "e" } } })
  })
})

describe("waitAndInspect details", () => {
  it("counts incidents for --until incident even without fail fast, and not at all otherwise", async () => {
    const { deps, engine } = setup("book")
    const result = await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, failOnIncident: false, conditions: [{ kind: "incident" }] },
      VIEW,
    )
    expect(result.view).toMatchObject({ waited: { until: "incident", polls: 2 } })
    expect(engine.requests.some((request) => request.query.get("withIncident") === "true")).toBe(
      true,
    )
    const either = setup("book")
    const first = await waitAndInspect(
      either.deps,
      { id: "pi-1", known: true },
      { ...IDLE, failOnIncident: false, conditions: [{ kind: "ended" }, { kind: "incident" }] },
      VIEW,
    )
    expect(first.view).toMatchObject({ waited: { until: "incident", polls: 2 } })
    const quiet = setup("approve")
    await waitAndInspect(
      quiet.deps,
      { id: "pi-1", known: true },
      { ...IDLE, failOnIncident: false },
      VIEW,
    )
    expect(
      quiet.engine.requests.some((request) => request.query.get("withIncident") === "true"),
    ).toBe(false)
  })

  it("asks for the due jobs of the tree in due date order", async () => {
    const { deps, engine } = setup("book")
    await waitAndInspect(deps, { id: "pi-1", known: true }, { ...IDLE, executeJobs: true }, VIEW)
    const request = engine.requests.find(
      (entry) => entry.path === "/job" && entry.query.get("executable") === "true",
    )
    expect(
      ["sortBy", "sortOrder", "processInstanceIds", "maxResults"].map((name) =>
        request?.query.get(name),
      ),
    ).toEqual(["jobDueDate", "asc", "pi-1", "11"])
    // a job of a suspended job definition is "executable" for the engine, but never runs
    expect(request?.query.get("active")).toBe("true")
  })

  it("tells a human at a terminal once that it waits", async () => {
    const { engine } = setup("approve")
    const lines: string[] = []
    const deps = { ...depsOf(engine.fetch), notice: (line: string) => lines.push(line) }
    await waitAndInspect(
      deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }, { kind: "incident" }], timeoutMs: 2000 },
      VIEW,
    )
    expect(lines).toEqual(["Waiting until ended or incident (up to 2s; Ctrl-C to stop)..."])
    lines.length = 0
    await waitAndInspect(deps, { id: "pi-1", known: true }, IDLE, VIEW)
    expect(lines).toEqual([])
  })

  it("names where an idle instance rests when the wait times out, and the job executor while jobs are due", async () => {
    const idle = setup("approve")
    const result = await waitAndInspect(
      idle.deps,
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }], timeoutMs: 600 },
      VIEW,
    )
    expect(result.failure?.details.hint).toBe(
      "No job is due: the instance rests at approve (userTask). Move it with `operate advance pi-1`, or check the --until condition against `operate inspect pi-1`.",
    )
    const busy = new WorkflowEngine("book")
    const due = await waitAndInspect(
      depsOf(busy.fetch),
      { id: "pi-1", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }], timeoutMs: 600 },
      VIEW,
    )
    expect(due.failure?.details.hint).toMatch(/^The job executor may be backing off/)
  })

  it("is ENDED, not NOT_FOUND, when an unknown id disappears after the first poll", async () => {
    const server = (withIncident: number) => {
      let polls = 0
      return fakeServer()
        .on("GET", "/process-instance/x", () => {
          polls += 1
          return polls === 1
            ? json({ id: "x", definitionId: "k:1:x" })
            : engineError(404, "InvalidRequestException", "gone")
        })
        .on("GET", "/history/process-instance/x", engineError(404, "InvalidRequestException", "no"))
        .on("GET", "/process-instance", json([]))
        .on("GET", "/process-instance/count", (request) =>
          json({ count: request.query.get("withIncident") === "true" ? withIncident : 1 }),
        )
    }
    const settings = { ...IDLE, conditions: [{ kind: "ended" as const }] }
    const result = await waitAndInspect(
      depsOf(server(0).fetch),
      { id: "x", known: false },
      settings,
      VIEW,
    )
    expect(result.view).toEqual({
      id: "x",
      state: "ENDED",
      waited: { until: "ended", elapsedMs: 250, polls: 2 },
    })
    const failed = await waitAndInspect(
      depsOf(server(1).fetch),
      { id: "x", known: true },
      settings,
      VIEW,
    )
    expect(failed.failure).toMatchObject({
      code: "INCIDENT",
      details: { data: { incidents: [] } },
    })
  })
})

describe("waitCommand details", () => {
  const base = { ...IDLE, variables: false, dryRun: false }

  it("checks the selection first and previews the instance request of an id", async () => {
    const { deps, engine } = setup("approve")
    await expect(waitCommand(deps, { ...base, selection: { latest: false } })).rejects.toThrow(
      "Select a process instance",
    )
    const preview = await waitCommand(deps, {
      ...base,
      dryRun: true,
      selection: { id: "pi-1", latest: false },
    })
    expect(preview).toEqual({
      kind: "dry-run",
      requests: [{ operationId: "getProcessInstance", input: { pathArgs: ["pi-1"], query: {} } }],
    })
    expect(engine.requests).toEqual([])
  })

  it("is NOT_FOUND for an unknown id, but ENDED for an instance found by filters that is gone", async () => {
    const gone = () =>
      fakeServer()
        .on("GET", "/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
        .on(
          "GET",
          "/history/process-instance/x",
          engineError(404, "InvalidRequestException", "gone"),
        )
        .on("GET", "/history/process-instance", json([{ id: "x", state: "ACTIVE" }]))
        .on("GET", "/process-instance", json([]))
    await expect(
      waitCommand(depsOf(gone().fetch), { ...base, selection: { id: "x", latest: false } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(
      await waitCommand(depsOf(gone().fetch), {
        ...base,
        selection: { businessKey: "B", latest: false },
      }),
    ).toEqual({
      kind: "view",
      view: { id: "x", state: "ENDED", waited: { until: "idle", elapsedMs: 0, polls: 1 } },
    })
  })

  it("names wait in the commands of an ambiguous selection and loads no history", async () => {
    const server = fakeServer()
      .on("GET", "/history/process-instance", json([{ id: "a" }, { id: "b" }]))
      .on("GET", "/process-instance", json([]))
    await expect(
      waitCommand(depsOf(server.fetch), {
        ...base,
        selection: { businessKey: "B", latest: false },
      }),
    ).rejects.toMatchObject({ details: { hint: expect.stringContaining("operate wait a") } })
    const { deps, engine } = setup("approve")
    const result = await waitCommand(deps, { ...base, selection: { id: "pi-1", latest: false } })
    expect(result.kind === "view" ? result.view : {}).not.toHaveProperty("timeline")
    expect(engine.requests.some((request) => request.path.startsWith("/history/activity"))).toBe(
      false,
    )
  })
})

describe("--execute-jobs order", () => {
  it("executes the due jobs in due date order", async () => {
    let polls = 0
    const server = fakeServer()
      .on("GET", "/process-instance/x", () => {
        polls += 1
        return polls === 1
          ? json({ id: "x", definitionId: "k:1:x" })
          : engineError(404, "InvalidRequestException", "ended")
      })
      .on(
        "GET",
        "/history/process-instance/x",
        json({ id: "x", state: "COMPLETED", processDefinitionId: "k:1:x" }),
      )
      .on("GET", "/process-instance", json([]))
      .on("GET", "/process-instance/count", json({ count: 0 }))
      .on(
        "GET",
        "/job",
        json([
          { id: "j2", dueDate: "2026-01-01T00:00:02.000+0000" },
          { id: "j3" },
          { id: "j1", dueDate: "2026-01-01T00:00:01.000+0000" },
        ]),
      )
      .on("POST", "/job/j1/execute", noContent())
      .on("POST", "/job/j2/execute", noContent())
      .on("POST", "/job/j3/execute", noContent())
    const result = await waitAndInspect(
      depsOf(server.fetch),
      { id: "x", known: true },
      { ...IDLE, conditions: [{ kind: "ended" }], executeJobs: true },
      VIEW,
    )
    expect(result.view).toMatchObject({ state: "COMPLETED", waited: { until: "ended" } })
    expect(
      server.requests.filter((request) => request.method === "POST").map((request) => request.path),
    ).toEqual(["/job/j1/execute", "/job/j2/execute", "/job/j3/execute"])
  })
})
