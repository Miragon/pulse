import { WORLD_TENANT, WORLD_TENANT_DEPLOYMENTS } from "@miragon/pulse-engine-core/testing"
import { describe, expect, it } from "vitest"
import type { C7SeedAnswer, C7SeedEngine, C7SeedRequest } from "./c7-world.js"
import { removeC7Deployments, seedC7TenantWorld } from "./seed-tenants.js"

const ROOT = "http://engine.test/engine-rest"
const DIAGRAMS = { label: "<label/>", dispatch: "<dispatch/>" }
const PLAN = {
  deployments: WORLD_TENANT_DEPLOYMENTS.map(({ alias, process, tenant }) => ({
    alias,
    process,
    tenantId: WORLD_TENANT[tenant],
  })),
  diagrams: DIAGRAMS,
}

function answer(status: number, body?: unknown): C7SeedAnswer {
  return {
    ok: status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  }
}

/** A C7 engine that answers each deployment with ids of its alias, and records what it was sent. */
class TenantEngine implements C7SeedEngine {
  readonly url = ROOT
  readonly sent: { readonly line: string; readonly body: string }[] = []

  constructor(private readonly namesDeployments = true) {}

  send(url: string, request?: C7SeedRequest): Promise<C7SeedAnswer> {
    const line = `${request?.method ?? "GET"} ${url.slice(ROOT.length)}`
    const body = request?.body ?? ""
    this.sent.push({ line, body })
    if (line !== "POST /deployment/create") return Promise.resolve(answer(200))
    const alias = /pulse-world-(\S+)/.exec(body)?.[1] ?? ""
    const id = `definition-of-${alias}`
    return Promise.resolve(
      answer(200, {
        ...(this.namesDeployments ? { id: `deployment-of-${alias}` } : {}),
        deployedProcessDefinitions: { [id]: { id } },
      }),
    )
  }

  wait(): Promise<void> {
    return Promise.resolve()
  }
}

describe("seedC7TenantWorld", () => {
  it("deploys each diagram into its tenant in the plan's order and names the ids by alias", async () => {
    const engine = new TenantEngine()

    const world = await seedC7TenantWorld(engine, PLAN)

    expect(world.definitionIds).toStrictEqual({
      "north/label@1": "definition-of-north/label@1",
      "south/label@1": "definition-of-south/label@1",
      "south/label@2": "definition-of-south/label@2",
      "north/dispatch@1": "definition-of-north/dispatch@1",
    })
    expect(world.deploymentIds).toHaveLength(4)
    expect(engine.sent.map(({ body }) => /name="tenant-id"\r\n\r\n(\S+)/.exec(body)?.[1])).toEqual([
      "pulse-north",
      "pulse-south",
      "pulse-south",
      "pulse-north",
    ])
  })

  it("fails on a diagram the plan lacks and on an engine that names no deployment", async () => {
    await expect(
      seedC7TenantWorld(new TenantEngine(), { ...PLAN, diagrams: { label: "<label/>" } }),
    ).rejects.toThrow("the tenant world has no diagram of dispatch")
    await expect(seedC7TenantWorld(new TenantEngine(false), PLAN)).rejects.toThrow(
      "deploying north/label@1 named no deployment",
    )
  })
})

describe("removeC7Deployments", () => {
  it("deletes each deployment with everything that runs on it", async () => {
    const engine = new TenantEngine()

    await removeC7Deployments(engine, ["d 1", "d2"])

    expect(engine.sent.map(({ line }) => line)).toStrictEqual([
      "DELETE /deployment/d%201?cascade=true",
      "DELETE /deployment/d2?cascade=true",
    ])
  })
})
