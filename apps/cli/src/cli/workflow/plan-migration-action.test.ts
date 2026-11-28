/** `pulse plan-migration` through the CLI, against the scripted workflow engine and a fake disk. */

import { MigrationPlanParser } from "@miragon/pulse-migration-plan"
import { describe, expect, it } from "vitest"
import { errorOf, workflowSetup } from "../../../test/support/cli-workflow.js"
import type { FakeRuntimeOptions } from "../../../test/support/fake-runtime.js"
import { routes } from "../../../test/support/workflow-engine.js"
import { run } from "../run.js"

const PATH = ".pulse/migrations/invoice-v1-to-v2.migration.json"

/** The engine with invoice v1 and v2, both with the elements approve and book. */
function setup(options: FakeRuntimeOptions = {}) {
  const world = workflowSetup(run, "approve", options)
  world.engine.definitions.push(world.engine.definition("invoice", "invoice.bpmn", "dep-2"))
  const written = (path = PATH) => {
    const file = world.runtime.files.get(path)
    return file === undefined ? "" : new TextDecoder().decode(file.data)
  }
  return { ...world, written }
}

describe("pulse plan-migration", () => {
  it("writes the plan of the latest version and prints its view, exit 0", async () => {
    const { cli, engine, written } = setup()
    const result = await cli(["plan-migration", "invoice", "1"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({
      planFile: PATH,
      replaced: false,
      bpmnProcessId: "invoice",
      source: { version: 1, definitionId: "invoice:1:def-1" },
      target: { version: 2, definitionId: "invoice:2:def-2" },
      mappings: [
        { sourceElementId: "approve", targetElementId: "approve", from: "engine" },
        { sourceElementId: "book", targetElementId: "book", from: "engine" },
      ],
      leftOut: 0,
      problems: [],
    })
    expect(routes(engine)).toEqual([
      "GET /process-definition",
      "GET /process-definition",
      "POST /migration/generate",
      "POST /migration/validate",
    ])
    expect(MigrationPlanParser.parse(written())).toEqual({
      plan: {
        bpmnProcessId: "invoice",
        source: { version: 1 },
        target: { version: 2 },
        mappings: [
          { sourceElementId: "approve", targetElementId: "approve" },
          { sourceElementId: "book", targetElementId: "book" },
        ],
      },
      notes: [],
    })
  })

  it("writes the plan with the engine's problems, prints them and exits 9", async () => {
    const { cli, written } = setup()
    const result = await cli(["plan-migration", "invoice", "1", "2", "--map", "book=bill"])
    expect(result.code).toBe(9)
    expect(JSON.parse(result.stdout)).toMatchObject({
      problems: [
        {
          sourceElementId: "book",
          targetElementId: "bill",
          message: "Target activity 'bill' does not exist",
        },
      ],
    })
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CHECK_FAILED",
      exitCode: 9,
      message: "The engine finds 1 problem in the plan",
    })
    expect(written()).toContain('"targetElementId": "bill"')
    expect(written()).not.toContain("does not exist")
  })

  it("prints sections on -o table and writes the view, not the plan, to --out-file", async () => {
    const { cli, runtime, written } = setup()
    const table = await cli([
      "plan-migration",
      "invoice",
      "1",
      "2",
      "--unmap",
      "book",
      "-o",
      "table",
    ])
    expect(table.stdout).toBe(
      [
        `Plan file  ${PATH} (new)`,
        "Process    invoice v1 → v2",
        "Mappings   1",
        "Check      no problems",
        "",
        "Mappings:",
        "SOURCE   TARGET   FROM",
        "approve  approve  engine",
        "",
      ].join("\n"),
    )
    const refused = await cli(["plan-migration", "invoice", "1"])
    expect(refused.code).toBe(2)
    expect(errorOf(refused.stderr)).toMatchObject({ message: `The plan file ${PATH} exists` })
    const again = await cli([
      "plan-migration",
      "invoice",
      "1",
      "--replace",
      "--out-file",
      "view.json",
    ])
    expect(again.code).toBe(0)
    expect(
      JSON.parse(new TextDecoder().decode(runtime.files.get("view.json")?.data)),
    ).toMatchObject({ planFile: PATH, replaced: true })
    expect(written()).toMatch(/^\{\n {2}"schemaVersion": 1,/)
  })

  it("writes --plan-file where the command runs and works in read-only mode", async () => {
    const { cli, runtime } = setup({ dirs: ["plans"], env: { PULSE_CLI_READ_ONLY: "1" } })
    const result = await cli([
      "plan-migration",
      "invoice",
      "1",
      "2",
      "--plan-file",
      "plans/invoice.migration.json",
    ])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(runtime.files.has("plans/invoice.migration.json")).toBe(true)
    expect(runtime.dirs.has(".pulse/migrations")).toBe(false)
    const flag = await cli(["plan-migration", "invoice", "1", "--read-only", "--dry-run"])
    expect(flag.code).toBe(0)
  })

  it("previews the two lookups with --dry-run, sending and writing nothing", async () => {
    const { cli, engine, runtime } = setup()
    const result = await cli(["plan-migration", "invoice", "1", "--dry-run"])
    expect(result.code).toBe(0)
    const view = JSON.parse(result.stdout) as { plan: unknown; requests: { url: string }[] }
    expect(view.plan).toEqual({ planFile: null, exists: null })
    const named = await cli(["plan-migration", "invoice", "1", "2", "--dry-run"])
    expect(JSON.parse(named.stdout)).toMatchObject({ plan: { planFile: PATH, exists: false } })
    expect(view.requests.map((request) => request.url)).toEqual([
      "http://localhost:8080/engine-rest/process-definition?key=invoice&version=1&firstResult=0&maxResults=11",
      "http://localhost:8080/engine-rest/process-definition?key=invoice&latestVersion=true&firstResult=0&maxResults=11",
    ])
    expect(engine.requests).toEqual([])
    expect(runtime.files.size).toBe(0)
  })

  it("fails a version the engine does not have as NOT_FOUND, exit 5", async () => {
    const { cli, engine, runtime } = setup()
    const result = await cli(["plan-migration", "invoice", "1", "3"])
    expect(result.code).toBe(5)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "NOT_FOUND",
      message: "invoice has no version 3 on this engine",
    })
    expect(routes(engine)).not.toContain("POST /migration/generate")
    expect(runtime.files.size).toBe(0)
  })

  it.each([
    [["invoice", "one"], '<source> expects an integer, got "one"'],
    [
      ["invoice", "1", "99999999999"],
      '<target> "99999999999" must be a version number from 1 to 2147483647',
    ],
    [
      ["invoice", "-99999999999999999999"],
      '<source> "-99999999999999999999" must be a version number from 1 to 2147483647',
    ],
    [["invoice", "1", "1.5"], '<target> expects an integer, got "1.5"'],
    [["invoice", "1", "1"], "<source> and <target> are both version 1"],
    [["invoice", "0"], '<source> "0" must be a version number from 1 to 2147483647'],
    [
      ["invoice:1:def-1", "1"],
      expect.stringMatching(/^<key> "invoice:1:def-1" must be a BPMN process id/),
    ],
    [
      ["a b", "1", "99999999999999999999"],
      expect.stringMatching(/^<key> "a b" must be a BPMN process id/),
    ],
    [["a b", "one"], expect.stringMatching(/^<key> "a b" must be a BPMN process id/)],
    [["invoice", "1", "--map", "a=b", "--unmap", "a"], "--map and --unmap both name a"],
  ])("refuses %j as USAGE, exit 2, before any request", async (args, message) => {
    const { cli, engine } = setup()
    const result = await cli(["plan-migration", ...args])
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({ code: "USAGE", message })
    expect(engine.requests).toEqual([])
  })

  it("needs the key and the source version, and takes no fourth argument", async () => {
    const { cli } = setup()
    for (const args of [["invoice"], ["invoice", "1", "2", "3"]]) {
      const result = await cli(["plan-migration", ...args])
      expect(result.code, args.join(" ")).toBe(2)
      expect(errorOf(result.stderr), args.join(" ")).toMatchObject({ code: "USAGE" })
    }
  })

  it("documents its arguments, options and examples in --help", async () => {
    const { cli } = setup()
    const { stdout, code } = await cli(["plan-migration", "--help"])
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Usage: pulse plan-migration <key> <source> \[target\] \[options\]\n/)
    expect(stdout).toContain("\nEffect: read; writes the plan file; nothing changes on the engine;")
    expect(stdout).toMatch(/\n {2}--map <source>=<target> +Map the element <source> of the source/)
    expect(stdout).toContain("\n  $ pulse plan-migration invoice 1 2\n")
  })
})
