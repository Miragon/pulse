import { afterEach, describe, expect, it, vi } from "vitest"
import { registerEngineTools } from "../../tools/engines.js"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { registerTools } from "../../tools/index.js"
import { registerIncidentIssueTools } from "../../tools/incident-issue.js"
import type { EngineRegistry } from "../engine/resolve-engine.js"
import type { ToolConfig } from "@miragon/pulse-widget-shell/server"
import {
  allowedWidgetActions,
  ENGINE_ADMIN_ONLY_TOOLS,
  ENGINE_TOOLSETS,
  isToolInToolset,
  resolveEngineToolset,
  withToolsetFilter,
  type EngineToolset,
} from "./toolsets.js"
import { ENGINE_WIDGET_ACTIONS } from "../../tool-names.js"

type Register = Parameters<typeof registerTools>[0]
type Config = ToolConfig<EngineRegistry>

afterEach(() => {
  vi.restoreAllMocks()
})

function configsFor(toolset: EngineToolset, { allowDeployments = false } = {}): Config[] {
  const configs: Config[] = []
  const recorder = ((config: Config) => configs.push(config)) as unknown as Register
  const register = withToolsetFilter(recorder, toolset)
  registerEngineTools(register, DEFAULT_VERDICT_THRESHOLDS)
  registerTools(register, { allowDeployments })
  registerIncidentIssueTools(register, {})
  return configs
}

function toolNamesFor(toolset: EngineToolset, options?: { allowDeployments?: boolean }) {
  return configsFor(toolset, options)
    .map((c) => c.name)
    .sort()
}

/** The widest surface there is: named `admin` AND the deployment opt-in. */
const FULL = { allowDeployments: true }

const ADMIN_ONLY = [
  "engine_delete_process_instance",
  "engine_modify_process_instance",
  // a read that feeds modify's activity and transition instance ids
  "engine_get_activity_instance_tree",
  "engine_set_process_instance_suspension",
  "engine_create_deployment",
  "engine_create_migration_plan",
  "engine_migrate_process_instances_async",
  "engine_set_job_retries_batch",
  "engine_get_batch",
  // engine-wide broadcast
  "engine_throw_signal",
  // the external-task worker protocol
  "engine_fetch_and_lock",
  "engine_complete_external_task",
  "engine_handle_external_task_failure",
]

const ENGINE_WRITES = [
  "engine_start_process_instance",
  "engine_complete_task",
  "engine_claim_task",
  "engine_set_process_instance_variable",
  "engine_set_job_retries",
  "engine_set_external_task_retries",
  "engine_correlate_message",
]

describe("withToolsetFilter over the real engine tool surface", () => {
  it("read-only advertises no admin-only or engine-write tools (deployment opt-in included)", () => {
    const names = toolNamesFor("read-only", FULL)
    for (const tool of [...ADMIN_ONLY, ...ENGINE_WRITES]) {
      expect(names, `${tool} must not be in read-only`).not.toContain(tool)
    }
  })

  it("read-only keeps the queries, the engine list included", () => {
    expect(toolNamesFor("read-only")).toEqual(
      expect.arrayContaining([
        "engine_list_engines",
        "engine_list_process_instances",
        "engine_inspect_process_instance",
        "engine_status",
        "engine_query_historic_process_instances",
        "engine_list_incidents",
        "engine_list_jobs",
        "engine_list_external_tasks",
        "engine_get_task_form",
        "engine_format_incident_issue",
      ]),
    )
  })

  it("operations adds engine writes but still hides the admin-only tools", () => {
    const names = toolNamesFor("operations", FULL)
    expect(names).toEqual(expect.arrayContaining(ENGINE_WRITES))
    for (const tool of ADMIN_ONLY) {
      expect(names, `${tool} must not be in operations`).not.toContain(tool)
    }
  })

  it("admin with the deployment opt-in exposes the whole surface", () => {
    expect(toolNamesFor("admin", FULL)).toEqual(
      expect.arrayContaining([...ADMIN_ONLY, ...ENGINE_WRITES]),
    )
  })

  it("toolsets are strictly nested: read-only ⊂ operations ⊂ admin", () => {
    const readOnly = toolNamesFor("read-only")
    const operations = toolNamesFor("operations")
    const admin = toolNamesFor("admin")
    expect(operations).toEqual(expect.arrayContaining(readOnly))
    expect(admin).toEqual(expect.arrayContaining(operations))
    expect(readOnly.length).toBeLessThan(operations.length)
    expect(operations.length).toBeLessThan(admin.length)
  })
})

describe("the toolset resolution fails closed", () => {
  it("a missing toolset resolves to the read-only floor silently, never to everything", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const resolved = resolveEngineToolset(undefined)
    expect(resolved).toBe("read-only")
    expect(warn).not.toHaveBeenCalled()
    const names = toolNamesFor(resolved, FULL)
    for (const tool of ENGINE_ADMIN_ONLY_TOOLS) expect(names).not.toContain(tool)
    expect(names).toEqual(toolNamesFor("read-only"))
  })

  it("an unknown toolset warns and degrades to read-only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveEngineToolset("does-not-exist")).toBe("read-only")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "does-not-exist"'))
  })

  it.each(ENGINE_TOOLSETS)("a known toolset (%s) resolves to itself", (toolset) => {
    expect(resolveEngineToolset(toolset)).toBe(toolset)
  })
})

describe("deployments are opt-in on top of admin (code execution in the engine JVM)", () => {
  const DEPLOY = "engine_create_deployment"

  it("is absent without the flag, even under admin", () => {
    expect(toolNamesFor("admin")).not.toContain(DEPLOY)
  })

  it("is present with the flag under admin", () => {
    expect(toolNamesFor("admin", FULL)).toContain(DEPLOY)
  })

  it("stays absent with the flag under operations and read-only", () => {
    expect(toolNamesFor("operations", FULL)).not.toContain(DEPLOY)
    expect(toolNamesFor("read-only", FULL)).not.toContain(DEPLOY)
  })

  it("is destructive and says so in its description", () => {
    const config = configsFor("admin", FULL).find((c) => c.name === DEPLOY)
    expect(config?.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    expect(config?.description).toMatch(/runs code inside the engine JVM/)
    expect(config?.description).toMatch(/admin toolset with ENGINE_ALLOW_DEPLOYMENTS=true/)
  })
})

describe("signals and the external-task worker protocol are admin-only", () => {
  const TOOLS = [
    "engine_throw_signal",
    "engine_fetch_and_lock",
    "engine_complete_external_task",
    "engine_handle_external_task_failure",
  ]

  it.each(TOOLS)("%s is destructive and exists only in admin", (name) => {
    const config = configsFor("admin").find((c) => c.name === name)
    expect(config?.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    expect(toolNamesFor("operations")).not.toContain(name)
    expect(toolNamesFor("read-only")).not.toContain(name)
  })

  it("throw_signal's description states its engine-wide scope", () => {
    const config = configsFor("admin").find((c) => c.name === "engine_throw_signal")
    expect(config?.description).toMatch(
      /every matching signal catch event in every running process instance/,
    )
    expect(config?.description).toMatch(/starts a new instance through every matching signal start/)
  })

  it("correlate_message stays an operations tool", () => {
    expect(toolNamesFor("operations")).toContain("engine_correlate_message")
  })
})

describe("ENGINE_ADMIN_ONLY_TOOLS (the public guard list)", () => {
  it("is exactly the admin-only set, frozen", () => {
    expect([...ENGINE_ADMIN_ONLY_TOOLS].sort()).toEqual([...ADMIN_ONLY].sort())
    expect(Object.isFrozen(ENGINE_ADMIN_ONLY_TOOLS)).toBe(true)
  })

  it("names only real tools of the full surface", () => {
    const all = toolNamesFor("admin", FULL)
    for (const name of ENGINE_ADMIN_ONLY_TOOLS) expect(all).toContain(name)
  })
})

describe("isToolInToolset (the rule, per branch)", () => {
  const ADMIN_TOOL = "engine_delete_process_instance"
  const WRITE_TOOL = "engine_start_process_instance"
  const READ = { readOnlyHint: true }

  it.each([
    // admin: everything, admin-only included
    [ADMIN_TOOL, undefined, "admin", true],
    [WRITE_TOOL, undefined, "admin", true],
    // admin-only: never below admin, a readOnlyHint does not lift it
    [ADMIN_TOOL, READ, "operations", false],
    [ADMIN_TOOL, READ, "read-only", false],
    // writes: operations yes, read-only no
    [WRITE_TOOL, undefined, "operations", true],
    [WRITE_TOOL, undefined, "read-only", false],
    [WRITE_TOOL, { readOnlyHint: false }, "read-only", false],
    // reads: everywhere
    [WRITE_TOOL, READ, "read-only", true],
  ] as const)("%s %o in %s → %s", (name, annotations, toolset, expected) => {
    expect(isToolInToolset({ name, annotations }, toolset)).toBe(expected)
  })
})

// Derived from each tool's OWN annotations, so a new tool can't slip past a hand-kept list.
describe("toolset rule holds structurally for every registered tool", () => {
  it("every destructiveHint tool is kept out of operations (i.e. is admin-only)", () => {
    const operations = new Set(toolNamesFor("operations", FULL))
    const destructive = configsFor("admin", FULL).filter(
      (c) => c.annotations?.destructiveHint === true,
    )
    // Sanity: the surface does carry destructive tools; otherwise this test is vacuous.
    expect(destructive.length).toBeGreaterThanOrEqual(9)
    for (const config of destructive) {
      expect(
        operations.has(config.name),
        `${config.name} carries destructiveHint but is advertised in operations. Add it to ADMIN_ONLY_TOOLS`,
      ).toBe(false)
    }
  })

  it("every write states destructiveHint explicitly: MCP defaults an absent hint to TRUE", () => {
    const writes = configsFor("admin", FULL).filter((c) => c.annotations?.readOnlyHint !== true)
    // Sanity: the surface does carry writes; otherwise this test is vacuous.
    expect(writes.length).toBeGreaterThanOrEqual(20)
    for (const config of writes) {
      expect(
        typeof config.annotations?.destructiveHint,
        `${config.name} is a write without an explicit destructiveHint: hosts read the absent hint as destructive`,
      ).toBe("boolean")
    }
  })

  it("read-only advertises only readOnlyHint tools (no exemption)", () => {
    const readOnly = configsFor("read-only", FULL)
    expect(readOnly.length).toBeGreaterThan(0)
    for (const config of readOnly) {
      expect(
        config.annotations?.readOnlyHint,
        `${config.name} is advertised in read-only but does not declare readOnlyHint: true`,
      ).toBe(true)
    }
  })

  it("every non-admin readOnlyHint tool is advertised in read-only", () => {
    const readOnly = new Set(toolNamesFor("read-only"))
    for (const config of configsFor("admin", FULL)) {
      if (config.annotations?.readOnlyHint !== true) continue
      if (ENGINE_ADMIN_ONLY_TOOLS.includes(config.name)) continue
      expect(readOnly.has(config.name), `${config.name} is read-only but not in read-only`).toBe(
        true,
      )
    }
  })
})

describe("allowedWidgetActions mirrors the registered tool surface", () => {
  it("every widget action is a real tool of the admin surface", () => {
    const all = toolNamesFor("admin")
    for (const action of ENGINE_WIDGET_ACTIONS) {
      expect(all, `${action} is listed as a widget action but not registered`).toContain(action)
    }
  })

  it.each(ENGINE_TOOLSETS)("toolset %s allows exactly the registered widget actions", (toolset) => {
    const registered = new Set(toolNamesFor(toolset))
    expect(allowedWidgetActions(toolset)).toEqual(
      ENGINE_WIDGET_ACTIONS.filter((action) => registered.has(action)),
    )
  })

  it("read-only allows none, operations all but the admin-only suspend/cancel, admin all", () => {
    expect(allowedWidgetActions("read-only")).toEqual([])
    expect(allowedWidgetActions("operations")).toEqual([
      "engine_set_job_retries",
      "engine_set_external_task_retries",
      "engine_resolve_incident",
      "engine_complete_task",
      "engine_set_process_instance_variable",
    ])
    expect(allowedWidgetActions("admin")).toEqual([...ENGINE_WIDGET_ACTIONS])
  })
})
