/** The details of waitAndInspect and waitCommand (wait.ts, wait-command.ts). */

import { describe, expect, it } from "vitest"
import { depsOf } from "../../test/support/engine-port.js"
import { engineError, fakeServer, json } from "../../test/support/fake-fetch.js"
import { WorkflowEngine } from "../../test/support/workflow-engine.js"
import { IDLE, setup, VIEW } from "../../test/support/workflow-wait.js"
import { waitAndInspect } from "./wait.js"
import { waitCommand } from "./wait-command.js"

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
      "No job is due: the instance rests at approve (userTask). Move it with `pulse-cli advance pi-1`, or check the --until condition against `pulse-cli inspect pi-1`.",
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
    ).rejects.toMatchObject({ details: { hint: expect.stringContaining("pulse-cli wait a") } })
    const { deps, engine } = setup("approve")
    const result = await waitCommand(deps, { ...base, selection: { id: "pi-1", latest: false } })
    expect(result.kind === "view" ? result.view : {}).not.toHaveProperty("timeline")
    expect(engine.requests.some((request) => request.path.startsWith("/history/activity"))).toBe(
      false,
    )
  })
})
