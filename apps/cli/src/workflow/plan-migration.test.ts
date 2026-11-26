import { MigrationPlanParser, MigrationPlanText } from "@miragon/pulse-migration-plan"
import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import { BASE_URL, type FakeServer, json } from "../../test/support/fake-fetch.js"
import { fakeRuntime, type FakeRuntimeOptions } from "../../test/support/fake-runtime.js"
import {
  bodyOf,
  instruction,
  PLAN_PATH as PATH,
  planEngine,
  PROPOSAL,
  sentRoutes as routes,
  V1,
  V2,
} from "../../test/support/plan-migration-engine.js"
import { loadCatalog } from "../catalog/catalog.js"
import { PLAN_MIGRATION_DOC } from "../docs/workflow-plan-migration.js"
import { compact } from "../util.js"
import { planMigration, type PlanMigrationOptions } from "./plan-migration.js"

const BASE: PlanMigrationOptions = {
  key: "invoice",
  source: 1,
  target: 2,
  map: [],
  unmap: [],
  dryRun: false,
}

/** Options that replace those of BASE; an undefined one leaves it out (`target` for the latest). */
type Overrides = {
  readonly [K in keyof PlanMigrationOptions]?: PlanMigrationOptions[K] | undefined
}

function setup(server: FakeServer = planEngine(), files: FakeRuntimeOptions = {}) {
  const runtime = fakeRuntime(files)
  const deps = { port: portOf(server.fetch), fs: runtime.fs }
  return {
    server,
    runtime,
    run: (options: Overrides = {}) =>
      planMigration(deps, compact({ ...BASE, ...options }) as PlanMigrationOptions),
    written: (path = PATH) => {
      const file = runtime.files.get(path)
      return file === undefined ? undefined : new TextDecoder().decode(file.data)
    },
  }
}

const LOOKUPS = ["GET /process-definition", "GET /process-definition"]
const ALL = [...LOOKUPS, "POST /migration/generate", "POST /migration/validate"]

describe("planMigration", () => {
  it("looks both versions up, has the engine propose and check the plan, then writes it", async () => {
    const { server, run, written } = setup()
    const result = await run()
    expect(routes(server)).toEqual(ALL)
    const [source, target, generate, validate] = server.requests
    expect(Object.fromEntries(source?.query ?? [])).toEqual({
      key: "invoice",
      version: "1",
      firstResult: "0",
      maxResults: "11",
    })
    expect(target?.query.get("version")).toBe("2")
    expect(bodyOf(generate)).toEqual({
      sourceProcessDefinitionId: V1.id,
      targetProcessDefinitionId: V2.id,
      updateEventTriggers: false,
    })
    expect(bodyOf(validate)).toEqual({
      sourceProcessDefinitionId: V1.id,
      targetProcessDefinitionId: V2.id,
      instructions: PROPOSAL,
    })
    expect(result).toEqual({
      kind: "view",
      view: {
        planFile: PATH,
        replaced: false,
        bpmnProcessId: "invoice",
        source: { version: 1, definitionId: V1.id },
        target: { version: 2, definitionId: V2.id },
        mappings: [
          { sourceElementId: "approve", targetElementId: "approve", from: "engine" },
          { sourceElementId: "check", targetElementId: "check", from: "engine" },
        ],
        leftOut: 0,
        problems: [],
      },
    })
    const plan = {
      bpmnProcessId: "invoice",
      source: { version: 1 },
      target: { version: 2 },
      mappings: [
        { sourceElementId: "approve", targetElementId: "approve" },
        { sourceElementId: "check", targetElementId: "check" },
      ],
    }
    expect(written()).toBe(MigrationPlanText.of(plan))
    expect(MigrationPlanParser.parse(written() ?? "")).toEqual({ plan, notes: [] })
  })

  it("writes no definition id, engine address, engine name or engine text into the file", async () => {
    const reports = [{ instruction: instruction(["check"], ["check"]), failures: ["Bad types"] }]
    const { run, written } = setup(planEngine({ reports }))
    await run()
    for (const word of ["def-1", "def-2", "invoice:", BASE_URL, "localhost", "Bad types", "from"])
      expect(written(), word).not.toContain(word)
  })

  it("sends what the docs entry names, and only that", async () => {
    const { server, run } = setup()
    await run()
    const catalog = loadCatalog()
    const sent = server.requests.map(
      (request) =>
        catalog.operations.find(
          (operation) => operation.method === request.method && operation.path === request.path,
        )?.operationId,
    )
    expect([...new Set(sent)]).toEqual(PLAN_MIGRATION_DOC.calls)
  })

  it("applies --unmap, then --map, and names each mapping's origin", async () => {
    const { server, run, written } = setup()
    const result = await run({ map: ["check=review", "extra=extra"], unmap: ["approve"] })
    expect(result.kind === "view" && result.view.mappings).toEqual([
      { sourceElementId: "check", targetElementId: "review", from: "--map" },
      { sourceElementId: "extra", targetElementId: "extra", from: "--map" },
    ])
    expect(bodyOf(server.requests[3])).toMatchObject({
      instructions: [instruction(["check"], ["review"]), instruction(["extra"], ["extra"])],
    })
    expect(written()).toContain('"targetElementId": "review"')
  })

  it("counts what the engine proposes that a plan file cannot hold as left out", async () => {
    const instructions = [
      instruction(["approve"], ["approve"]),
      instruction(["a", "b"], ["c"]),
      instruction(["pack#multiInstanceBody"], ["pack#multiInstanceBody"]),
      instruction(["a#b#c"], ["d"]),
      instruction(["approve"], ["other"]),
    ]
    const { run } = setup(planEngine({ instructions }))
    const result = await run()
    expect(result.kind === "view" && result.view).toMatchObject({
      mappings: [
        { sourceElementId: "approve", targetElementId: "approve" },
        { sourceElementId: "pack#multiInstanceBody", targetElementId: "pack#multiInstanceBody" },
      ],
      leftOut: 3,
    })
  })

  it("still writes the file when the engine finds problems, then fails CHECK_FAILED", async () => {
    const reports = [
      { instruction: instruction(["check"], ["check"]), failures: ["Activities differ"] },
      { instruction: instruction(["a", "b"], ["c"]), failures: ["Not one to one"] },
    ]
    const { run, written } = setup(planEngine({ reports }))
    const result = await run()
    expect(result.kind === "view" && result.view.problems).toEqual([
      { sourceElementId: "check", targetElementId: "check", message: "Activities differ" },
      { message: "Not one to one" },
    ])
    expect(result.kind === "view" && result.failure).toMatchObject({
      code: "CHECK_FAILED",
      exitCode: 9,
      message: "The engine finds 2 problems in the plan",
      details: {
        hint: "Change the mapping with --map or --unmap and run the command again, or edit the file.",
      },
    })
    expect(written()).toContain('"sourceElementId": "check"')
    const one = await setup(planEngine({ reports: reports.slice(0, 1) })).run()
    expect(one.kind === "view" && one.failure?.message).toBe(
      "The engine finds 1 problem in the plan",
    )
  })

  it("replaces a regular file and says so; writes --plan-file without creating a folder", async () => {
    const { run, runtime } = setup(planEngine(), { files: { [PATH]: "old" } })
    const replaced = await run()
    expect(replaced.kind === "view" && replaced.view.replaced).toBe(true)
    expect(runtime.dirs.has(".pulse/migrations")).toBe(true)
    const own = setup(planEngine(), { dirs: ["plans"] })
    const result = await own.run({ planFile: "plans/invoice.migration.json" })
    expect(result.kind === "view" && result.view).toMatchObject({
      planFile: "plans/invoice.migration.json",
      replaced: false,
    })
    expect(own.runtime.dirs.has(".pulse/migrations")).toBe(false)
    expect(own.written("plans/invoice.migration.json")).toContain('"bpmnProcessId": "invoice"')
    const here = setup()
    await here.run({ planFile: "invoice.migration.json" })
    expect(here.written("invoice.migration.json")).toContain('"schemaVersion": 1')
  })

  it("fails an engine answer it cannot read as CONFIG, exit 3", async () => {
    const server = planEngine().on("POST", "/migration/generate", json([1, 2]))
    const { run, written } = setup(server)
    await expect(run()).rejects.toMatchObject({
      code: "CONFIG",
      exitCode: 3,
      message: expect.stringMatching(/^Unexpected answer of the engine to generateMigrationPlan: /),
    })
    expect(written()).toBeUndefined()
    const rows = planEngine().on("GET", "/process-definition", json([{ id: 1 }]))
    await expect(setup(rows).run()).rejects.toMatchObject({ code: "CONFIG", exitCode: 3 })
  })

  it("previews the two lookups with --dry-run, sending and writing nothing", async () => {
    const { server, run, runtime } = setup()
    expect(await run({ dryRun: true, target: undefined })).toEqual({
      kind: "dry-run",
      requests: [
        {
          operationId: "getProcessDefinitions",
          input: {
            pathArgs: [],
            query: { key: "invoice", version: "1", firstResult: "0", maxResults: "11" },
          },
        },
        {
          operationId: "getProcessDefinitions",
          input: {
            pathArgs: [],
            query: { key: "invoice", latestVersion: "true", firstResult: "0", maxResults: "11" },
          },
        },
      ],
    })
    expect(server.requests).toEqual([])
    expect(runtime.files.size + runtime.dirs.size).toBe(0)
  })

  it("refuses more mappings than a plan file holds before the check", async () => {
    const instructions = Array.from({ length: 1001 }, (_, index) =>
      instruction([`a${String(index)}`], [`a${String(index)}`]),
    )
    const { server, run } = setup(planEngine({ instructions }))
    await expect(run()).rejects.toMatchObject({
      code: "USAGE",
      message: "The plan has 1001 mappings; a plan file holds at most 1000",
    })
    expect(routes(server)).not.toContain("POST /migration/validate")
  })
})

describe("planMigration versions", () => {
  it("takes the latest version without a target", async () => {
    const { server, run } = setup()
    const result = await run({ target: undefined })
    expect(server.requests[1]?.query.get("latestVersion")).toBe("true")
    expect(result.kind === "view" && result.view.target).toEqual({
      version: 2,
      definitionId: V2.id,
    })
  })

  it("refuses a latest version that is the source, before any proposal", async () => {
    const { server, run } = setup()
    await expect(run({ source: 2, target: undefined })).rejects.toMatchObject({
      code: "USAGE",
      message: "v2 is the latest version of invoice on this engine",
      details: { hint: "Name the version to migrate to: pulse plan-migration invoice 2 <target>" },
    })
    expect(routes(server)).toEqual(LOOKUPS)
  })

  it("fails a version the engine does not have as NOT_FOUND before the proposal", async () => {
    const { server, run } = setup()
    await expect(run({ target: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      exitCode: 5,
      message: "invoice has no version 3 on this engine",
      details: { hint: "List the versions with: pulse process-definition list --key invoice" },
    })
    expect(routes(server)).toEqual(LOOKUPS)
    await expect(setup(planEngine({ definitions: [] })).run()).rejects.toMatchObject({
      message: "invoice has no version 1 on this engine",
    })
    const none = planEngine().on("GET", "/process-definition", (request) =>
      json(request.query.has("latestVersion") ? [] : [V1]),
    )
    await expect(setup(none).run({ target: undefined })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "invoice has no latest version on this engine",
    })
  })

  it("refuses a version deployed more than once (tenants), naming them", async () => {
    const definitions = [V1, { ...V2, tenantId: "a" }, { ...V2, id: "invoice:2:b", tenantId: null }]
    const { server, run } = setup(planEngine({ definitions }))
    await expect(run()).rejects.toMatchObject({
      code: "USAGE",
      message:
        "Version 2 of invoice is deployed 2 times on this engine (tenants: a, no tenant); a plan names no tenant",
      details: { hint: "Name versions that exist once on this engine." },
    })
    expect(routes(server)).toEqual(LOOKUPS)
    await expect(
      setup(planEngine({ definitions })).run({ target: undefined }),
    ).rejects.toMatchObject({
      message:
        "invoice has 2 latest versions on this engine, one per tenant (a, no tenant); a plan names no tenant",
      details: {
        hint: "Name the target version, one that exists once on this engine: pulse plan-migration invoice <source> <target>",
      },
    })
  })

  it("says more than 10 times when the lookup was cut", async () => {
    const tenants = Array.from({ length: 12 }, (_, index) => ({
      ...V2,
      id: `invoice:2:t${String(index)}`,
      tenantId: `t${String(index)}`,
    }))
    await expect(setup(planEngine({ definitions: [V1, ...tenants] })).run()).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Version 2 of invoice is deployed more than 10 times on this engine \(tenants: t0, t1, .*, t9\);/,
      ),
    })
  })
})
