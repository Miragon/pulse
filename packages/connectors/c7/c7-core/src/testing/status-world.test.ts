import { describe, expect, it } from "vitest"
import type { C7SeedAnswer, C7SeedEngine, C7SeedRequest } from "./c7-world.js"
import {
  STATUS_APPROVAL_DIAGRAM,
  STATUS_DISPATCH_DIAGRAM,
  STATUS_LABEL_DIAGRAM,
} from "./status-diagrams.js"
import { C7_STATUS_WORLD, seedC7StatusWorld } from "./status-world.js"

const ROOT = "http://engine.test/engine-rest"
const TASKS = "GET /task/count?processDefinitionKey=pulse-status-approval"
const EXECUTABLE = "GET /job/count?executable=true&active=true"

function answer(status: number, body?: unknown): C7SeedAnswer {
  return {
    ok: status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  }
}

const roots = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `r${index}`, rootCauseIncidentId: null }))

/**
 * A C7 engine that answers the seed's requests, records them and the waits, and settles each poll
 * after `slow` answers that are not yet done.
 */
class StatusEngine implements C7SeedEngine {
  readonly url = ROOT
  readonly sent: { readonly line: string; readonly request: C7SeedRequest | undefined }[] = []
  readonly waits: number[] = []
  private started = 0

  constructor(private readonly slow = 0) {}

  get lines(): string[] {
    return this.sent.map(({ line }) => line)
  }

  send(url: string, request?: C7SeedRequest): Promise<C7SeedAnswer> {
    const line = `${request?.method ?? "GET"} ${url.slice(ROOT.length)}`
    this.sent.push({ line, request })
    return Promise.resolve(this.answer(line, request?.body ?? ""))
  }

  wait(ms: number): Promise<void> {
    this.waits.push(ms)
    return Promise.resolve()
  }

  /** Whether `line` was asked more often than the `slow` answers that are not yet done. */
  private settled(line: string): boolean {
    return this.lines.filter((sent) => sent === line).length > this.slow
  }

  /**
   * The root incidents raised so far: the dispatch's chain once it started, the failing body once
   * the third instance started, the batch's once it was asked for.
   */
  private raised(): number {
    const batch = this.lines.includes("POST /job/retries") ? 1 : 0
    return Math.min(this.started, 1) + Math.max(this.started - 2, 0) + batch
  }

  private polled(line: string): C7SeedAnswer | undefined {
    const settled = this.settled(line)
    if (line === "GET /incident") return answer(200, roots(settled ? this.raised() : 0))
    if (line === TASKS) return answer(200, { count: settled ? 3 : 0 })
    if (line === EXECUTABLE) return answer(200, { count: settled ? 0 : 1 })
    return undefined
  }

  private answer(line: string, body: string): C7SeedAnswer {
    if (line === "POST /deployment/create") {
      const process = /filename="(\S+)\.bpmn"/.exec(body)?.[1] ?? "none"
      const id = `${process}:1:d`
      return answer(200, { deployedProcessDefinitions: { [id]: { id } } })
    }
    if (line.endsWith("/start")) {
      this.started += 1
      return answer(200, { id: `pi-${(JSON.parse(body) as { businessKey: string }).businessKey}` })
    }
    if (line === "POST /job/retries") return answer(200, { id: "batch-1" })
    return this.polled(line) ?? answer(204)
  }
}

describe("seedC7StatusWorld", () => {
  it("deploys, starts each instance once the one before settled, then the failing batch, which it suspends", async () => {
    const engine = new StatusEngine()

    const world = await seedC7StatusWorld(engine)

    expect(engine.lines).toStrictEqual([
      "POST /deployment/create",
      "POST /deployment/create",
      "POST /deployment/create",
      "POST /deployment/create",
      "POST /deployment/create",
      "POST /process-definition/pulse-status-dispatch%3A1%3Ad/start",
      "GET /incident",
      "POST /process-definition/pulse-status-approval%3A1%3Ad/start",
      TASKS,
      "POST /process-definition/pulse-status-approval%3A1%3Ad/start",
      "GET /incident",
      "POST /job/retries",
      "GET /incident",
      "PUT /batch/batch-1/suspended",
      EXECUTABLE,
    ])
    expect(world).toStrictEqual({
      definitionIds: {
        label: "pulse-status-label:1:d",
        dispatch: "pulse-status-dispatch:1:d",
        approval: "pulse-status-approval:1:d",
      },
      tenantLabelIds: { north: "pulse-status-label:1:d", south: "pulse-status-label:1:d" },
      instanceIds: { dispatch: "pi-DSP-139", approving: "pi-APR-139-1", failing: "pi-APR-139-2" },
      batchId: "batch-1",
    })
    expect(engine.waits).toStrictEqual([])
  })

  it("deploys each diagram, starts the approving instance with its copies and the batch on the unknown job", async () => {
    const engine = new StatusEngine()

    await seedC7StatusWorld(engine)

    const bodies = engine.sent.map(({ request }) => request?.body ?? "")
    expect(bodies[0]).toContain(STATUS_LABEL_DIAGRAM)
    expect(bodies[1]).toContain(STATUS_DISPATCH_DIAGRAM)
    expect(bodies[2]).toContain(STATUS_APPROVAL_DIAGRAM)
    expect(bodies[0]).toContain("pulse-world-pulse-status-label@1")
    expect(bodies[1]).toContain('calledElementTenantId="pulse-north"')
    for (const [index, tenant] of [
      [3, "pulse-north"],
      [4, "pulse-south"],
    ] as const) {
      expect(bodies[index]).toContain(STATUS_LABEL_DIAGRAM)
      expect(bodies[index]).toContain(`name="tenant-id"\r\n\r\n${tenant}\r\n`)
    }
    expect(JSON.parse(bodies[5] ?? "")).toStrictEqual({ businessKey: "DSP-139", variables: {} })
    expect(JSON.parse(bodies[7] ?? "")).toStrictEqual({
      businessKey: "APR-139-1",
      variables: { copies: { value: C7_STATUS_WORLD.items, type: "Integer" } },
    })
    expect(JSON.parse(bodies[9] ?? "")).toStrictEqual({ businessKey: "APR-139-2", variables: {} })
    expect(JSON.parse(bodies[11] ?? "")).toStrictEqual({
      jobIds: [C7_STATUS_WORLD.unknownJob],
      retries: 1,
    })
    expect(engine.sent[13]?.request).toStrictEqual({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"suspended":true}',
    })
  })

  it("waits a second between two polls until each settles", async () => {
    const engine = new StatusEngine(2)

    await seedC7StatusWorld(engine)

    // The first poll of the incidents, of the items and of the executable jobs each wait twice.
    expect(engine.lines.filter((line) => line === "GET /incident")).toHaveLength(5)
    expect(engine.lines.filter((line) => line === TASKS)).toHaveLength(3)
    expect(engine.lines.filter((line) => line === EXECUTABLE)).toHaveLength(3)
    expect(engine.waits).toStrictEqual([1000, 1000, 1000, 1000, 1000, 1000])
  })

  it("fails naming what never settled once the waits passed two minutes", async () => {
    const engine = new StatusEngine(Number.MAX_SAFE_INTEGER)
    const tasksOnly: C7SeedEngine = {
      url: ROOT,
      wait: (ms) => engine.wait(ms),
      send: (url, request) =>
        url.includes("/incident")
          ? Promise.resolve(answer(200, roots(3)))
          : engine.send(url, request),
    }

    await expect(seedC7StatusWorld(tasksOnly)).rejects.toThrow(
      "the status world has no items waiting after 120000 ms",
    )
    expect(engine.waits).toHaveLength(121)
  })

  it("fails on a suspension the engine refuses", async () => {
    const engine = new StatusEngine()
    const refusing: C7SeedEngine = {
      url: ROOT,
      wait: (ms) => engine.wait(ms),
      send: (url, request) =>
        request?.method === "PUT"
          ? Promise.resolve(answer(404, "no batch"))
          : engine.send(url, request),
    }

    await expect(seedC7StatusWorld(refusing)).rejects.toThrow(
      `PUT ${ROOT}/batch/batch-1/suspended: HTTP 404 no batch`,
    )
  })
})
