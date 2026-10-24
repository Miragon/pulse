/**
 * `operate deploy`: deploys files and directories with a stable deployment name
 * and source (so unchanged files are really skipped), reports the versions in effect per
 * resource and optionally starts an instance.
 */

import { findByOperationId } from "../catalog/catalog.js"
import type { Catalog, MultipartBodySpec } from "../catalog/types.js"
import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { OperateError, usageError } from "../errors.js"
import { readInputFile } from "../operation/files.js"
import type { Resource } from "../operation/multipart.js"
import type { OperationInput } from "../operation/request.js"
import { bpmnProcessIds, collectResources, isBpmn } from "../operation/resources.js"
import type { TypedValue } from "../operation/variables.js"
import type { FileSystem } from "../runtime.js"
import { compact } from "../util.js"
import { type DeployResult, resourceViews } from "./deploy-view.js"
import { json, queryInput } from "./engine.js"
import { loadView } from "./inspect.js"
import { engineTime, type Rec, records, str } from "./records.js"
import type { EndedInstance, InstanceView, Waited, WorkflowResult } from "./types.js"
import { type WaitDeps, type WaitResult, type WaitSettings, waitAndInspect } from "./wait.js"

const DEPLOYMENT_SOURCE = "operate"
const DEFAULT_NAME = "operate"

export interface DeployOptions {
  readonly paths: readonly string[]
  readonly name?: string
  readonly baseDir?: string
  readonly tenantId?: string
  /** `--start` or `--start-key`; the key when given. */
  readonly start?: { readonly key?: string }
  readonly businessKey?: string
  readonly variables?: Readonly<Record<string, TypedValue>>
  readonly wait?: WaitSettings
  readonly variablesShown: boolean
  readonly dryRun: boolean
}

export interface DeployView extends DeployResult {
  readonly instance?: (InstanceView | EndedInstance) & { readonly waited?: Waited }
}

export interface DeployDeps extends WaitDeps {
  readonly fs: FileSystem
  readonly catalog: Catalog
}

function deploymentSpec(catalog: Catalog): MultipartBodySpec {
  const body = findByOperationId(catalog, "createDeployment")?.body
  if (body?.kind !== "multipart")
    throw new OperateError("INTERNAL", "createDeployment has no multipart body")
  return body
}

/** The multipart request and the process ids of the BPMN files (read once). */
async function deploymentInput(
  fs: FileSystem,
  resources: readonly Resource[],
  options: DeployOptions,
): Promise<{ readonly input: OperationInput; readonly processIds: readonly string[] }> {
  const contents = await Promise.all(resources.map(({ file }) => readInputFile(fs, file)))
  const files = resources.map(({ name }, index) => ({
    field: name,
    fileName: name,
    data: new Blob([contents[index] ?? new Uint8Array()]),
  }))
  const decoder = new TextDecoder()
  const processIds = resources.flatMap(({ name }, index) =>
    isBpmn(name) ? bpmnProcessIds(decoder.decode(contents[index])) : [],
  )
  const fields = {
    "deployment-name": options.name ?? DEFAULT_NAME,
    "deployment-source": DEPLOYMENT_SOURCE,
    "deploy-changed-only": "true",
    ...compact({ "tenant-id": options.tenantId }),
  }
  return { input: { pathArgs: [], query: {}, multipart: { fields, files } }, processIds }
}

/**
 * The key to start, decided before any request: `--start-key`, else the only executable process
 * of the BPMN files (several or none are usage errors, so nothing is deployed in vain).
 */
function startKey(processIds: readonly string[], options: DeployOptions): string | undefined {
  if (options.start === undefined) return undefined
  if (options.start.key !== undefined) return options.start.key
  const keys = [...new Set(processIds)]
  const [only, ...others] = keys
  if (only === undefined)
    throw usageError(
      "The files contain no process to start",
      "Deploy a BPMN file, or start an existing process with --start-key <key>.",
    )
  if (others.length > 0) {
    throw usageError(
      `The files contain ${keys.length} processes: ${keys.join(", ")}`,
      `Choose one with --start-key <key>, e.g. --start-key ${only}.`,
    )
  }
  return only
}

function dryRun(
  input: OperationInput,
  resources: readonly Resource[],
  options: DeployOptions & { readonly key?: string | undefined },
): WorkflowResult<DeployView> {
  const plan = {
    name: options.name ?? DEFAULT_NAME,
    resources: resources.map(({ file, name }) => ({ resource: name, file })),
    ...compact({
      start:
        options.key === undefined
          ? undefined
          : { key: options.key, ...compact({ businessKey: options.businessKey }) },
    }),
  }
  const request: PlannedRequest = {
    summary: `deploy ${resources.length} resource(s) as ${plan.name}`,
    operationId: "createDeployment",
    input,
  }
  return { kind: "dry-run", plan, requests: [request] }
}

async function latestDeployment(
  port: EnginePort,
  options: DeployOptions,
): Promise<Rec | undefined> {
  const query = {
    name: options.name ?? DEFAULT_NAME,
    sortBy: "deploymentTime",
    sortOrder: "desc",
    maxResults: "1",
    tenantIdIn: options.tenantId,
  }
  return records(await json(port, "getDeployments", queryInput(query)))[0]
}

/** A new deployment: none before, or another id with a later deployment time (engine clock). */
function isChanged(before: Rec | undefined, after: Rec): boolean {
  if (before === undefined) return true
  if (str(before, "id") === str(after, "id")) return false
  return (
    (engineTime(str(after, "deploymentTime")) ?? 0) >
    (engineTime(str(before, "deploymentTime")) ?? 0)
  )
}

async function start(deps: DeployDeps, key: string, options: DeployOptions): Promise<WaitResult> {
  const body = compact({ businessKey: options.businessKey, variables: options.variables })
  const input =
    options.tenantId === undefined
      ? { operationId: "startProcessInstanceByKey", pathArgs: [key] }
      : { operationId: "startProcessInstanceByKeyAndTenantId", pathArgs: [key, options.tenantId] }
  const started = await json(deps.port, input.operationId, {
    pathArgs: input.pathArgs,
    query: {},
    body,
  })
  const id = records([started])[0]?.id
  if (typeof id !== "string")
    throw new OperateError("INTERNAL", `Starting ${key} returned no process instance id`)
  const inspect = { variables: options.variablesShown, history: false, stacktrace: false }
  if (options.wait === undefined) return { view: await loadView(deps.port, id, inspect) }
  return waitAndInspect(deps, { id, known: true }, options.wait, inspect)
}

export async function deploy(
  deps: DeployDeps,
  options: DeployOptions,
): Promise<WorkflowResult<DeployView>> {
  const resources = await collectResources(deps.fs, options.paths, {
    baseDir: options.baseDir,
    spec: deploymentSpec(deps.catalog),
  })
  const { input, processIds } = await deploymentInput(deps.fs, resources, options)
  const key = startKey(processIds, options)
  if (options.dryRun) return dryRun(input, resources, { ...options, key })
  const before = await latestDeployment(deps.port, options)
  const deployment = records([await json(deps.port, "createDeployment", input)])[0] ?? {}
  const result = await resourceViews(deps.port, {
    deployment,
    changed: isChanged(before, deployment),
    resources,
    name: options.name ?? DEFAULT_NAME,
    source: DEPLOYMENT_SOURCE,
    tenantId: options.tenantId,
  })
  if (key === undefined) return { kind: "view", view: result }
  try {
    const instance = await start(deps, key, options)
    return {
      kind: "view",
      view: { ...result, instance: instance.view },
      ...compact({ failure: instance.failure }),
    }
  } catch (error) {
    // the deployment happened: its report is printed before the error of the start
    if (error instanceof OperateError) return { kind: "view", view: result, failure: error }
    throw error
  }
}
