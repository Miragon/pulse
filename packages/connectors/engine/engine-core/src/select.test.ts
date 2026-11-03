import { describe, expect, it } from "vitest"
import { isWorkflowError, type WorkflowErrorReason } from "./errors.js"
import { checkSelection, mergeCandidates, selectInstance, selectionRequests } from "./select.js"
import { fakePort, type Route } from "./testing/fake-port.js"

function reasonOf(fn: () => unknown): WorkflowErrorReason {
  try {
    fn()
  } catch (error) {
    if (isWorkflowError(error)) return error.reason
  }
  throw new Error("expected a WorkflowError")
}

async function rejection(promise: Promise<unknown>): Promise<WorkflowErrorReason> {
  try {
    await promise
  } catch (error) {
    if (isWorkflowError(error)) return error.reason
  }
  throw new Error("expected a WorkflowError")
}

const history = (id: string, state: string, startTime?: string) => ({
  id,
  processDefinitionKey: "order",
  processDefinitionVersion: 2,
  businessKey: "B-1",
  state,
  ...(startTime === undefined ? {} : { startTime }),
})

function engine(historic: readonly unknown[], running: readonly unknown[]) {
  const routes: Record<string, Route> = {
    getHistoricProcessInstances: () => historic,
    getProcessInstances: () => running,
  }
  return fakePort(routes)
}

describe("checkSelection", () => {
  it("refuses an id with filters or latest, and a selection without id or filter", () => {
    expect(
      reasonOf(() => {
        checkSelection({ id: "p", businessKey: "b", latest: false })
      }),
    ).toEqual({
      kind: "selection-conflict",
    })
    expect(
      reasonOf(() => {
        checkSelection({ id: "p", latest: true })
      }),
    ).toEqual({
      kind: "selection-conflict",
    })
    expect(
      reasonOf(() => {
        checkSelection({ latest: false })
      }),
    ).toEqual({
      kind: "selection-missing",
      latest: false,
    })
    expect(
      reasonOf(() => {
        checkSelection({ latest: true })
      }),
    ).toEqual({
      kind: "selection-missing",
      latest: true,
    })
    expect(() => {
      checkSelection({ processDefinitionKey: "k", latest: true })
    }).not.toThrow()
  })
})

describe("selectionRequests", () => {
  it("reads history and runtime for filters, nothing for an id", () => {
    expect(selectionRequests({ businessKey: "B-1", latest: false })).toEqual([
      {
        operationId: "getHistoricProcessInstances",
        input: {
          pathArgs: [],
          query: {
            processInstanceBusinessKey: "B-1",
            processDefinitionKey: undefined,
            sortBy: "startTime",
            sortOrder: "desc",
            maxResults: "11",
          },
        },
      },
      {
        operationId: "getProcessInstances",
        input: {
          pathArgs: [],
          query: { businessKey: "B-1", processDefinitionKey: undefined, maxResults: "11" },
        },
      },
    ])
    expect(selectionRequests({ id: "p", latest: false })).toEqual([])
  })
})

describe("mergeCandidates", () => {
  it("merges by id (history first), active first, then the most recently started", () => {
    expect(
      mergeCandidates(
        [
          history("old", "COMPLETED", "2026-01-01T00:00:00.000+0000"),
          history("new", "ACTIVE", "2026-01-02T00:00:00.000+0000"),
          { state: "ACTIVE" },
        ],
        [
          { id: "new", definitionKey: "order", suspended: true },
          { id: "run", definitionId: "order:1:x", businessKey: "B-1", suspended: true },
          {},
        ],
      ),
    ).toEqual([
      {
        id: "new",
        key: "order",
        version: 2,
        businessKey: "B-1",
        state: "ACTIVE",
        startTime: "2026-01-02T00:00:00.000+0000",
      },
      { id: "run", key: "order", businessKey: "B-1", state: "SUSPENDED" },
      {
        id: "old",
        key: "order",
        version: 2,
        businessKey: "B-1",
        state: "COMPLETED",
        startTime: "2026-01-01T00:00:00.000+0000",
      },
    ])
  })
})

describe("selectInstance", () => {
  it("returns an id without a request", async () => {
    const port = engine([], [])
    expect(await selectInstance(port, { id: "p1", latest: false })).toBe("p1")
    expect(port.calls).toEqual([])
  })

  it("resolves a single match and reports none and several", async () => {
    const selection = { businessKey: "B-1", latest: false }
    expect(await selectInstance(engine([history("h", "COMPLETED")], []), selection)).toBe("h")
    expect(await rejection(selectInstance(engine([], []), selection))).toEqual({
      kind: "selection-not-found",
      selection,
    })
    const reason = await rejection(
      selectInstance(engine([history("a", "ACTIVE"), history("b", "COMPLETED")], []), selection),
    )
    expect(reason).toMatchObject({ kind: "selection-ambiguous", selection, more: false })
    expect(reason.kind === "selection-ambiguous" && reason.candidates.map((c) => c.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("names the first 10 of more than 10 matches and says there are more", async () => {
    const selection = { processDefinitionKey: "order", latest: false }
    const ids = Array.from({ length: 11 }, (_, index) => `h${String(index).padStart(2, "0")}`)
    const rows = ids.map((id) => history(id, "ACTIVE"))
    const reason = await rejection(selectInstance(engine(rows, rows), selection))
    expect(reason).toMatchObject({ kind: "selection-ambiguous", more: true })
    expect(reason.kind === "selection-ambiguous" && reason.candidates.length).toBe(10)
    const ten = await rejection(selectInstance(engine(rows.slice(0, 10), []), selection))
    expect(ten).toMatchObject({ kind: "selection-ambiguous", more: false })
  })

  it("takes the latest from the history, else the only running one", async () => {
    const latest = { processDefinitionKey: "order", latest: true }
    const both = engine([history("h1", "COMPLETED"), history("h2", "ACTIVE")], [{ id: "r" }])
    expect(await selectInstance(both, latest)).toBe("h1")
    expect(await selectInstance(engine([], [{ id: "r" }]), latest)).toBe("r")
    expect(await rejection(selectInstance(engine([], [{ id: "r" }, { id: "s" }]), latest))).toEqual(
      { kind: "latest-needs-history" },
    )
    expect(await rejection(selectInstance(engine([], []), latest))).toEqual({
      kind: "selection-not-found",
      selection: latest,
    })
  })
})
