import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/client"
import { CAMUNDA7_ADMIN_ONLY_TOOLS } from "@miragon/pulse-camunda7-connector"
import { bootServer, createTestRuntime, listToolNames, type BootedServer } from "./boot-server.js"
import {
  EXPECTED_TOOLS_ADMIN,
  EXPECTED_TOOLS_OPERATIONS,
  EXPECTED_TOOLS_READ_ONLY,
} from "./expected-tools.js"

function textPayload(result: { content?: unknown }): unknown {
  const content = result.content as Array<{ type: string; text?: string }> | undefined
  const text = content?.find((c) => c.type === "text")?.text
  expect(text, "tool result should carry a text content block").toBeTruthy()
  return JSON.parse(text!)
}

/** The full surface: an explicit admin + deployment opt-in under OAuth — never a default. */
const FULL_SURFACE = {
  authenticated: true,
  env: {
    MCP_ACTIVE_MODULES: "camunda7:admin,analytics:standard",
    CAMUNDA_ALLOW_DEPLOYMENTS: "true",
  },
}

/**
 * E2E smoke test: boots the real composition in-process (`createApp`, the
 * exact boot `src/index.ts` runs, with a stand-in widget bundle and in-memory
 * persistence) and speaks the MCP protocol to it over streamable HTTP.
 * Together with the toolset suites below this is the only coverage of tool
 * *registration* — plugin.ts wiring, setup.ts module activation and the
 * framework tools — rather than the tool implementations.
 */
describe("mcp-server-camunda7 E2E smoke", () => {
  let server: BootedServer
  let client: Client
  let port: number

  beforeAll(async () => {
    server = await bootServer({
      ...FULL_SURFACE,
      runtime: createTestRuntime({ readiness: { always: () => {} } }),
    })
    ;({ client, port } = server)
  })

  afterAll(async () => {
    await server?.close()
  })

  it("exposes exactly the full admin surface (tools/list snapshot)", async () => {
    expect(await listToolNames(client)).toEqual([...EXPECTED_TOOLS_ADMIN])
  })

  it("advertises the pagination envelope on every list/query tool", async () => {
    const paginatedTools = [
      "camunda7_list_process_definitions",
      "camunda7_list_deployments",
      "camunda7_list_process_instances",
      "camunda7_list_tasks",
      "camunda7_list_jobs",
      "camunda7_list_incidents",
      "camunda7_list_external_tasks",
      "camunda7_query_historic_process_instances",
      "camunda7_query_historic_activity_instances",
      "camunda7_query_historic_task_instances",
      "camunda7_query_historic_variable_instances",
    ]
    const { tools } = await client.listTools()
    for (const name of paginatedTools) {
      const tool = tools.find((t) => t.name === name)
      expect(tool, `${name} should be exposed`).toBeDefined()
      const outputProps = (tool!.outputSchema as { properties?: Record<string, unknown> } | null)
        ?.properties
      expect(outputProps, `${name} should advertise an outputSchema`).toBeTruthy()
      expect(Object.keys(outputProps!)).toEqual(
        expect.arrayContaining(["items", "totalCount", "hasMore", "nextOffset"]),
      )
      const inputProps = (tool!.inputSchema as { properties?: Record<string, unknown> })?.properties
      expect(inputProps, `${name} should accept firstResult`).toHaveProperty("firstResult")
      expect(inputProps?.maxResults, `${name} caps its page size`).toMatchObject({ maximum: 100 })
    }
  })

  // Structural, not a list: the show tools are model-visible too, and a host
  // that keeps structuredContent hands their whole page to the model — so
  // every tool on the wire that takes a page size caps it, show tools and
  // app-only feeds included.
  it("caps maxResults at 100 on every tool that takes it", async () => {
    const { tools } = await client.listTools()
    const paged = tools.filter(
      (t) => (t.inputSchema as { properties?: Record<string, unknown> }).properties?.maxResults,
    )
    expect(paged.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "camunda7_list_process_instances",
        "camunda7_show_history_timeline",
        "camunda7_show_process_instances",
        "camunda7_process_instances_data",
      ]),
    )
    for (const tool of paged) {
      const maxResults = (tool.inputSchema as { properties: Record<string, { maximum?: number }> })
        .properties.maxResults
      expect(maxResults.maximum, `${tool.name} caps its page size`).toBe(100)
    }
  })

  it("answers camunda7_list_engines from the engine registry without a live engine", async () => {
    const result = await client.callTool({ name: "camunda7_list_engines", arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(textPayload(result)).toEqual({
      engines: [
        {
          id: "default",
          environment: "default",
          flavor: "camunda7",
          engineName: "Camunda 7",
        },
      ],
      environments: [{ id: "default", engineIds: ["default"] }],
      defaultEngineId: null,
    })
  })

  it("serves the health probes and the Prometheus scrape next to the MCP transport", async () => {
    const base = `http://127.0.0.1:${port}`
    const live = await fetch(`${base}/health/live`)
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ status: "up" })

    const ready = await fetch(`${base}/health/ready`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: "up", checks: { always: "up" } })

    // A real tools/call through the transport must reach the metrics middleware.
    const call = await client.callTool({ name: "camunda7_list_engines", arguments: {} })
    expect(call.isError).toBeFalsy()

    const metrics = await fetch(`${base}/metrics`)
    expect(metrics.status).toBe(200)
    expect(metrics.headers.get("content-type")).toContain("text/plain")
    const text = await metrics.text()
    expect(text).toMatch(
      /^mcp_tool_calls_total\{tool="camunda7_list_engines",outcome="ok"\} [1-9]\d*$/m,
    )
    expect(text).toMatch(
      /^mcp_http_requests_total\{method="GET",route="\/health",status="200"\} [1-9]\d*$/m,
    )
    expect(text).toMatch(
      /^mcp_http_requests_total\{method="POST",route="\/mcp",status="200"\} [1-9]\d*$/m,
    )
    expect(text).toContain("process_cpu_user_seconds_total")
  })

  it("states destructiveHint explicitly on every module write — MCP reads an absent hint as TRUE", async () => {
    const { tools } = await client.listTools()
    const writes = tools.filter(
      (t) => /^(camunda7|analytics)_/.test(t.name) && t.annotations?.readOnlyHint !== true,
    )
    expect(writes.length).toBeGreaterThanOrEqual(20)
    for (const tool of writes) {
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean")
    }
  })

  it("answers get-framework-manifest with the active modules", async () => {
    const result = await client.callTool({ name: "get-framework-manifest", arguments: {} })
    expect(result.isError).toBeFalsy()
    const manifest = JSON.stringify(textPayload(result))
    expect(manifest).toContain("camunda7")
    expect(manifest).toContain("analytics")
  })
})

/**
 * The tool surface per toolset, on the wire: each boot resolves its selection
 * through `createApp` like `src/index.ts` (the shared boot's `resolveBoot` →
 * plugin config → registrar filter + builder decision), so the fail-closed
 * defaults are pinned end to end, not just the filter in isolation. The
 * authenticated boots install a stub OAuth provider — the real bearer gate.
 */
describe("mcp-server-camunda7 E2E toolset surfaces", () => {
  it.each([
    ["no suffix, no OAuth → read-only", {}, EXPECTED_TOOLS_READ_ONLY],
    ["no suffix, OAuth → operations", { authenticated: true }, EXPECTED_TOOLS_OPERATIONS],
    [
      "explicit camunda7:read-only,analytics:read-only under OAuth",
      {
        authenticated: true,
        env: { MCP_ACTIVE_MODULES: "camunda7:read-only,analytics:read-only" },
      },
      EXPECTED_TOOLS_READ_ONLY,
    ],
    [
      "explicit camunda7:operations,analytics:standard under OAuth",
      {
        authenticated: true,
        env: { MCP_ACTIVE_MODULES: "camunda7:operations,analytics:standard" },
      },
      EXPECTED_TOOLS_OPERATIONS,
    ],
    ["explicit admin + deployments under OAuth", FULL_SURFACE, EXPECTED_TOOLS_ADMIN],
  ])("%s", async (_label, options, expected) => {
    // mcp-use keeps the LAST registration of a tool name, so a duplicate makes
    // one tool silently vanish; the toolkit's install guard (2.6+) reports it
    // as a console warning naming both owners.
    const warn = vi.spyOn(console, "warn")
    const server = await bootServer(options)
    try {
      expect(await listToolNames(server.client)).toEqual([...expected])
      const duplicates = warn.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((line) => line.includes("Duplicate tool name"))
      expect(duplicates).toEqual([])
    } finally {
      warn.mockRestore()
      await server.close()
    }
  })

  it("keeps a module out entirely when it is not selected (camunda7:read-only alone)", async () => {
    const server = await bootServer({ env: { MCP_ACTIVE_MODULES: "camunda7:read-only" } })
    try {
      const names = await listToolNames(server.client)
      expect(names.some((n) => n.startsWith("analytics_"))).toBe(false)
      expect(names).toEqual(
        expect.arrayContaining(["camunda7_list_engines", "camunda7_list_external_tasks"]),
      )
    } finally {
      await server.close()
    }
  })
})

/**
 * The #323 guardrail: no selection that does not NAME `camunda7:admin` may
 * ever list an admin-only tool — not unset, not `all`, not a bare module
 * list, not an empty or unknown suffix, in either auth mode. The admin list
 * comes from the connector itself (`CAMUNDA7_ADMIN_ONLY_TOOLS`), so a tool
 * added there is guarded here without touching this test.
 */
describe("mcp-server-camunda7 E2E fail-closed guard", () => {
  const SELECTIONS = [
    undefined,
    "all",
    "camunda7,analytics",
    "camunda7:",
    "camunda7:,analytics:",
    " camunda7 : , analytics : ",
    "camunda7:bogus,analytics:bogus",
    "camunda7:admin:read-only",
  ]

  describe.each(SELECTIONS)("MCP_ACTIVE_MODULES=%j", (selection) => {
    it.each([false, true])("authenticated=%s lists no admin-only tool", async (authenticated) => {
      const server = await bootServer({
        authenticated,
        // The deployment flag alone must never surface create_deployment.
        env: { MCP_ACTIVE_MODULES: selection, CAMUNDA_ALLOW_DEPLOYMENTS: "true" },
      })
      try {
        const names = await listToolNames(server.client)
        for (const tool of CAMUNDA7_ADMIN_ONLY_TOOLS) {
          expect(names, `${tool} must not be listed`).not.toContain(tool)
        }
        if (!authenticated) {
          expect(names).not.toContain("save-dashboard")
          expect(names).not.toContain("delete-dashboard")
        }
      } finally {
        await server.close()
      }
    })
  })

  it.each(["camunda7:", "camunda7:bogus", "camunda7:admin:read-only"])(
    "an empty or unknown suffix (%j) falls back to read-only even under OAuth",
    async (camunda7) => {
      const server = await bootServer({
        authenticated: true,
        env: { MCP_ACTIVE_MODULES: `${camunda7},analytics:read-only` },
      })
      try {
        expect(await listToolNames(server.client)).toEqual([...EXPECTED_TOOLS_READ_ONLY])
      } finally {
        await server.close()
      }
    },
  )

  it("registers camunda7_create_deployment only with admin AND CAMUNDA_ALLOW_DEPLOYMENTS=true", async () => {
    const cases = [
      [{ MCP_ACTIVE_MODULES: "camunda7:operations", CAMUNDA_ALLOW_DEPLOYMENTS: "true" }, false],
      [{ MCP_ACTIVE_MODULES: "camunda7:admin", CAMUNDA_ALLOW_DEPLOYMENTS: "false" }, false],
      [{ MCP_ACTIVE_MODULES: "camunda7:admin" }, false],
      [{ MCP_ACTIVE_MODULES: "camunda7:admin", CAMUNDA_ALLOW_DEPLOYMENTS: "true" }, true],
    ] as const
    for (const [env, listed] of cases) {
      const server = await bootServer({ authenticated: true, env })
      try {
        expect(await listToolNames(server.client), JSON.stringify(env)).toEqual(
          listed
            ? expect.arrayContaining(["camunda7_create_deployment"])
            : expect.not.arrayContaining(["camunda7_create_deployment"]),
        )
      } finally {
        await server.close()
      }
    }
  })
})

/**
 * "read-only lists only readOnlyHint tools", on the wire — the module tools,
 * the widget tools and the framework tools alike. The ONLY exemptions are the
 * toolkit's `render-view` (model-visible) and `refresh-view` (app-only): both
 * are reads by construction (every registered pipeline step is a `load-*`
 * read) but ship unannotated in @miragon/mcp-toolkit-core 2.6, and a
 * view-bound tool cannot be re-registered app-side (mcp-toolkit#177).
 */
describe("mcp-server-camunda7 E2E read-only annotations", () => {
  const UNANNOTATED_TOOLKIT_READS = new Set(["render-view", "refresh-view"])
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer()
  })

  afterAll(async () => {
    await server?.close()
  })

  it("lists only readOnlyHint tools (minus the documented toolkit exemptions)", async () => {
    const { tools } = await server.client.listTools()
    const unannotated = tools
      .filter((t) => t.annotations?.readOnlyHint !== true)
      .map((t) => t.name)
      .sort()
    expect(unannotated).toEqual([...UNANNOTATED_TOOLKIT_READS].sort())
  })

  it("lists the engines but never the durable camunda7_select_engine", async () => {
    const names = await listToolNames(server.client)
    expect(names).toContain("camunda7_list_engines")
    expect(names).not.toContain("camunda7_select_engine")
  })
})

/**
 * The `engine` parameter on the wire: a boot-time enum of the CONFIGURED ids
 * (the routing rule itself lives in the server instructions). An explicit id
 * must stay accepted everywhere it was before — the widgets' Ask-AI hand-offs
 * and prompts pass it — also with a single engine.
 */
describe("mcp-server-camunda7 E2E engine parameter", () => {
  type Properties = Record<string, { enum?: string[]; type?: string }>
  const engineEnums = async (client: Client) => {
    const { tools } = await client.listTools()
    return tools.flatMap((t) => {
      const engine = (t.inputSchema as { properties?: Properties }).properties?.engine
      return engine && t.name.startsWith("camunda7_") ? [{ name: t.name, engine }] : []
    })
  }

  it("a multi-engine boot advertises the enum of the configured ids on every camunda7 tool", async () => {
    const server = await bootServer({
      env: {
        CAMUNDA_ENGINES_JSON: JSON.stringify([
          { id: "prod-a", baseUrl: "http://localhost:1/engine-rest" },
          { id: "prod-b", baseUrl: "http://localhost:2/engine-rest" },
        ]),
      },
    })
    try {
      const params = await engineEnums(server.client)
      expect(params.length).toBeGreaterThan(40)
      for (const { name, engine } of params) {
        expect(engine.enum, name).toEqual(["prod-a", "prod-b"])
      }
      expect(server.client.getInstructions()).toContain("engines prod-a, prod-b")
    } finally {
      await server.close()
    }
  })

  it("a single-engine boot keeps `engine` and accepts the explicit id", async () => {
    const server = await bootServer()
    try {
      for (const { name, engine } of await engineEnums(server.client)) {
        expect(engine.enum, name).toEqual(["default"])
      }
      const result = await server.client.callTool({
        name: "camunda7_open_cockpit",
        arguments: { engine: "default" },
      })
      expect(result.isError).toBeFalsy()
      const unknown = await server.client.callTool({
        name: "camunda7_open_cockpit",
        arguments: { engine: "prod-z" },
      })
      expect(unknown.isError).toBe(true)
    } finally {
      await server.close()
    }
  })
})
