import { once } from "node:events"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import type {
  CreateDeploymentResponse,
  MultiFormDeploymentDto,
} from "@miragon/pulse-camunda7-client/types"
import {
  createEngineRegistry,
  type EngineEntry,
  type EngineRegistry,
} from "../lib/resolve-engine.js"
import { providerForEntry } from "../providers/index.js"
import { registerDeploymentTools } from "./deployments.js"

const DEPLOY = "camunda7_create_deployment"

interface RecordedRequest {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: Buffer
}

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/**
 * A real loopback server, not a fetch stub: a stub could not tell a well-formed multipart body
 * from the empty one the FormData-through-`Object.entries` bug produced (#326).
 */
async function startFakeEngine(reply: unknown) {
  const requests: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(reply))
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}/engine-rest`, requests }
}

function decodeForm(request: RecordedRequest): Promise<FormData> {
  return new Response(new Uint8Array(request.body), {
    headers: { "Content-Type": String(request.headers["content-type"]) },
  }).formData()
}

/**
 * Raw `filename="…"` as the engine reads it: commons-fileupload keeps fetch's `%22`/`%0D`/`%0A`
 * escapes, so on the engine `a"b` and a literal `a%22b` are the same name.
 */
function wireFilenames(request: RecordedRequest): string[] {
  return request.body
    .toString("utf8")
    .split("\r\n")
    .flatMap(
      (line) => /^Content-Disposition: form-data; .*; filename="(.*)"$/i.exec(line)?.[1] ?? [],
    )
}

/** CIB seven `DeploymentRestServiceImpl.RESERVED_KEYWORDS`; typed against the DTO so a spec change breaks compile. */
const RESERVED_FIELDS: ReadonlySet<string> = new Set(
  Object.keys({
    "deployment-name": true,
    "deployment-activation-time": true,
    "enable-duplicate-filtering": true,
    "deploy-changed-only": true,
    "deployment-source": true,
    "tenant-id": true,
  } satisfies Record<Exclude<keyof MultiFormDeploymentDto, "data">, true>),
)

/**
 * The request as the engine reads it: parts in a map keyed by name (CIB seven
 * `MultipartFormData`, last wins). Fails on what that map would hide: a duplicate part name, a
 * file under a reserved name, a text part posing as a resource.
 */
async function engineView(request: RecordedRequest) {
  const form = await decodeForm(request)
  const partNames = [...form.keys()]
  expect(partNames, "a repeated part name keeps only its last part").toEqual([
    ...new Set(partNames),
  ])
  const fields: Record<string, string> = {}
  const files: File[] = []
  for (const [name, value] of form.entries()) {
    if (RESERVED_FIELDS.has(name)) {
      expect(value, `reserved part "${name}" must be a text field`).toBeTypeOf("string")
      fields[name] = value as string
    } else {
      expect(value, `part "${name}" must be a file the engine can deploy`).toBeInstanceOf(File)
      files.push(value as File)
    }
  }
  const filenames = wireFilenames(request)
  expect(filenames).toHaveLength(files.length)
  const resources = await Promise.all(
    files.map(async (file, index) => ({ filename: filenames[index], content: await file.text() })),
  )
  return { partNames, fields, resources }
}

const DEPLOYMENT: CreateDeploymentResponse = {
  id: "dep-1",
  name: "orders",
  source: "pulse",
  deploymentTime: "2026-10-08T12:00:00.000+0200",
  tenantId: null,
  deployedProcessDefinitions: {
    "order:1:pd-1": { id: "order:1:pd-1", key: "order", version: 1, resource: "order.bpmn" },
  },
}

const ORDER_BPMN =
  '<?xml version="1.0" encoding="UTF-8"?><definitions id="d"><process id="order" isExecutable="true"/></definitions>'
// Non-ASCII on purpose: the part must carry the resource byte-exact as UTF-8.
const RULES_DMN = '<?xml version="1.0"?><definitions name="Größe – Rabattstufen"/>'

type CreateArgs = {
  deploymentName: string
  enableDuplicateFiltering?: boolean
  deployChangedOnly?: boolean
  deploymentSource?: string
  tenantId?: string
  resources: Array<{ name: string; content: string }>
  engine?: string
}
type Handler = (registry: EngineRegistry, args: CreateArgs) => Promise<unknown>

/** Wired like plugin.ts, so the handler runs withEngine → resolveEngine → SDK → fetch. */
function deploymentTool(engines: EngineEntry[]) {
  const tools = new Map<string, ToolConfig<EngineRegistry>>()
  const recorder = Object.assign(
    (config: ToolConfig<EngineRegistry>) => tools.set(config.name, config),
    { getRegisteredTools: () => [] },
  )
  registerDeploymentTools(recorder as never, { allowDeployments: true })
  const config = tools.get(DEPLOY)
  if (!config) throw new Error(`${DEPLOY} did not register`)
  const registry = createEngineRegistry(engines, (e) =>
    providerForEntry(e).createClient(e, { type: "basic", username: "demo", password: "demo" }),
  )
  const handler = (config as unknown as { handler: Handler }).handler
  return { config, call: (args: CreateArgs) => handler(registry, args) }
}

describe("camunda7_create_deployment on the wire (recording fake engine)", () => {
  it("sends deployment-name plus one file part per resource as a real multipart body", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])

    await call({
      deploymentName: "orders",
      resources: [
        { name: "order.bpmn", content: ORDER_BPMN },
        { name: "rules.dmn", content: RULES_DMN },
      ],
    })

    expect(engine.requests).toHaveLength(1)
    const [request] = engine.requests
    expect(request.method).toBe("POST")
    expect(request.path).toBe("/engine-rest/deployment/create")
    // A stale `application/json` default would drop the boundary.
    const contentType = String(request.headers["content-type"])
    const boundary = /^multipart\/form-data; boundary=(\S+)$/.exec(contentType)?.[1]
    expect(boundary, contentType).toBeTruthy()
    expect(request.body.toString("utf8")).toContain(`--${boundary}--`)
    expect(request.headers.authorization).toBe(`Basic ${btoa("demo:demo")}`)

    expect(await engineView(request)).toEqual({
      partNames: ["deployment-name", "resource-0", "resource-1"],
      fields: { "deployment-name": "orders" },
      resources: [
        { filename: "order.bpmn", content: ORDER_BPMN },
        { filename: "rules.dmn", content: RULES_DMN },
      ],
    })
  })

  it("forwards every optional field the schema exposes, in the engine's spelling", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])

    await call({
      deploymentName: "orders",
      enableDuplicateFiltering: true,
      deployChangedOnly: false,
      deploymentSource: "pulse",
      tenantId: "tenant-a",
      resources: [{ name: "order.bpmn", content: ORDER_BPMN }],
    })

    expect(await engineView(engine.requests[0])).toEqual({
      partNames: [
        "deployment-name",
        "enable-duplicate-filtering",
        "deploy-changed-only",
        "deployment-source",
        "tenant-id",
        "resource-0",
      ],
      fields: {
        "deployment-name": "orders",
        "enable-duplicate-filtering": "true",
        "deploy-changed-only": "false",
        "deployment-source": "pulse",
        "tenant-id": "tenant-a",
      },
      resources: [{ filename: "order.bpmn", content: ORDER_BPMN }],
    })
  })

  it("never lets a resource name or an empty field masquerade as a form field", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])

    await call({
      deploymentName: "orders",
      deploymentSource: "",
      tenantId: "",
      resources: [
        { name: "tenant-id", content: ORDER_BPMN },
        { name: "deployment-name", content: RULES_DMN },
      ],
    })

    // Resources named after reserved fields travel under synthetic part names.
    expect(await engineView(engine.requests[0])).toEqual({
      partNames: ["deployment-name", "resource-0", "resource-1"],
      fields: { "deployment-name": "orders" },
      resources: [
        { filename: "tenant-id", content: ORDER_BPMN },
        { filename: "deployment-name", content: RULES_DMN },
      ],
    })
  })

  it("delivers every name the input schema accepts byte-exact as the filename", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { config, call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])
    const names = ["processes/order process.bpmn", "Größe – Rabattstufen.dmn", "order%22v2.bpmn"]

    await call(
      z.object(config.inputSchema).parse({
        deploymentName: "orders",
        resources: names.map((name) => ({ name, content: ORDER_BPMN })),
      }) as CreateArgs,
    )

    const { resources } = await engineView(engine.requests[0])
    expect(resources.map((r) => r.filename)).toEqual(names)
  })

  it("refuses names the transport would rewrite into a collision", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { config, call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])
    const colliding = {
      deploymentName: "orders",
      resources: [
        { name: 'order"v2.bpmn', content: ORDER_BPMN },
        { name: "order%22v2.bpmn", content: RULES_DMN },
      ],
    }

    // Unvalidated, fetch percent-escapes the quote: two names reach the engine as ONE.
    await call(colliding)
    const { resources } = await engineView(engine.requests[0])
    expect(resources.map((r) => r.filename)).toEqual(["order%22v2.bpmn", "order%22v2.bpmn"])

    expect(z.object(config.inputSchema).safeParse(colliding).error?.issues).toEqual([
      expect.objectContaining({ path: ["resources", 0, "name"] }),
    ])
  })

  it("maps the engine's response back to the caller unchanged", async () => {
    const engine = await startFakeEngine(DEPLOYMENT)
    const { call } = deploymentTool([{ id: "local", baseUrl: engine.baseUrl }])

    await expect(
      call({ deploymentName: "orders", resources: [{ name: "order.bpmn", content: ORDER_BPMN }] }),
    ).resolves.toEqual(DEPLOYMENT)
  })

  it("routes through withEngine: the per-call engine override picks the engine", async () => {
    const alpha = await startFakeEngine({ ...DEPLOYMENT, id: "dep-alpha" })
    const beta = await startFakeEngine({ ...DEPLOYMENT, id: "dep-beta" })
    const { call } = deploymentTool([
      { id: "alpha", baseUrl: alpha.baseUrl },
      { id: "beta", baseUrl: beta.baseUrl },
    ])

    const result = await call({
      engine: "beta",
      deploymentName: "orders",
      resources: [{ name: "order.bpmn", content: ORDER_BPMN }],
    })

    expect(result).toMatchObject({ id: "dep-beta" })
    expect(alpha.requests).toHaveLength(0)
    expect(beta.requests).toHaveLength(1)
  })
})

describe("camunda7_create_deployment keeps its gate", () => {
  it("stays a destructive, open-world tool that names its admin + opt-in requirement", () => {
    const { config } = deploymentTool([{ id: "local", baseUrl: "http://127.0.0.1:1/engine-rest" }])
    expect(config.category).toBe("deployments")
    expect(config.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    expect(config.description).toMatch(/admin toolset with CAMUNDA_ALLOW_DEPLOYMENTS=true/)
  })

  it("validates with the client's deployment schema plus the per-call engine override", () => {
    const { config } = deploymentTool([{ id: "local", baseUrl: "http://127.0.0.1:1/engine-rest" }])
    const input = z.object(config.inputSchema)
    const resource = { name: "order.bpmn", content: ORDER_BPMN }
    expect(input.parse({ deploymentName: "d", engine: "local", resources: [resource] })).toEqual({
      deploymentName: "d",
      engine: "local",
      resources: [resource],
    })
    expect(input.safeParse({ deploymentName: "d", resources: [resource, resource] }).success).toBe(
      false,
    )
  })
})
